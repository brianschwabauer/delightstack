import type { Remote } from 'comlink';
import type { WebsocketWorker } from './websocket.worker';
import type {
	WebsocketMessage,
	ConnectionStatus,
	EntityChangeEvent,
	EntityChangedMessage,
} from '../types';
import { getWsWorker, resetWsWorker } from './websocket.worker.init';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the WebsocketClient */
export interface WebsocketClientConfig {
	/** The WebSocket endpoint path @default '/api/websocket' */
	path?: string;
	/** Whether the app is in dev mode (uses regular Worker instead of SharedWorker) */
	dev?: boolean;
}

type EventCallback = (message: WebsocketMessage) => void;

// ---------------------------------------------------------------------------
// WebsocketClient
// ---------------------------------------------------------------------------

/**
 * Reactive WebSocket client for Svelte 5.
 * Manages a WebSocket connection via a SharedWorker (shared across browser tabs)
 * and provides event subscription and DatabaseClient integration.
 *
 * @example
 * ```ts
 * const ws = new WebsocketClient({ dev: import.meta.env.DEV });
 * await ws.connect(org_id);
 *
 * // Listen for events
 * const unsub = ws.on('session:connected', (msg) => {
 *   console.log(`${msg.user_name} joined`);
 * });
 *
 * // Wire into DatabaseClient for real-time sync
 * const db = new DatabaseClient({
 *   tables,
 *   db_name: `org:${org_id}`,
 *   hooks: ws.databaseHooks(),
 * });
 * ```
 */
export class WebsocketClient {
	#config: WebsocketClientConfig;
	#worker: Remote<WebsocketWorker> | null = null;
	#channel: BroadcastChannel | null = null;
	#listeners = new Map<string, Set<EventCallback>>();
	#entity_change_listeners = new Set<(event: EntityChangeEvent) => void>();

	// Reactive state (Svelte 5 runes)
	#status = $state<ConnectionStatus>('disconnected');
	#connected = $derived(this.#status === 'connected');

	/** Current connection status (reactive) */
	get status(): ConnectionStatus {
		return this.#status;
	}

	/** Whether the WebSocket is currently connected (reactive) */
	get connected(): boolean {
		return this.#connected;
	}

	constructor(config?: WebsocketClientConfig) {
		this.#config = {
			path: '/api/websocket',
			...config,
		};
	}

	/**
	 * Connect to the WebSocket server for the given org.
	 * The org_id is used to scope the BroadcastChannel so different orgs are isolated.
	 */
	async connect(org_id: string): Promise<void> {
		if (typeof window === 'undefined') return; // SSR guard

		this.#worker = await getWsWorker(this.#config.dev);

		// Build the WebSocket URL from the current page origin
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const url = `${protocol}//${window.location.host}${this.#config.path}`;
		const channel_name = `ws:${org_id}`;

		// Set up BroadcastChannel to receive events from the SharedWorker
		this.#channel = new BroadcastChannel(channel_name);
		this.#channel.onmessage = (event: MessageEvent) => {
			const message = event.data as WebsocketMessage;
			if (!message?.event) return;

			// Handle internal status updates from the worker
			if (message.event === '__ws_status') {
				this.#status = (message as unknown as { status: ConnectionStatus }).status;
				return;
			}

			// Dispatch to event-specific listeners
			const listeners = this.#listeners.get(message.event);
			if (listeners) {
				for (const cb of listeners) {
					try {
						cb(message);
					} catch {
						/* listener errors should not break the chain */
					}
				}
			}

			// Dispatch to wildcard listeners
			const wildcard = this.#listeners.get('*');
			if (wildcard) {
				for (const cb of wildcard) {
					try {
						cb(message);
					} catch {
						/* listener errors should not break the chain */
					}
				}
			}

			// Map entity events to EntityChangeEvent for DatabaseClient integration
			if (
				message.event === 'entity:created' ||
				message.event === 'entity:updated' ||
				message.event === 'entity:deleted'
			) {
				const entity_msg = message as EntityChangedMessage;
				const type =
					message.event === 'entity:created'
						? 'create'
						: message.event === 'entity:updated'
							? 'update'
							: 'delete';
				const change_event: EntityChangeEvent = {
					type,
					entity_type: entity_msg.entity_type,
					id: entity_msg.id,
					data: entity_msg.data,
				};
				for (const cb of this.#entity_change_listeners) {
					try {
						cb(change_event);
					} catch {
						/* listener errors should not break the chain */
					}
				}
			}
		};

		// Tell the SharedWorker to connect
		await this.#worker.connect({ url, channel_name });
	}

	/** Disconnect and clean up all resources. */
	async disconnect(): Promise<void> {
		if (this.#worker) {
			await this.#worker.disconnect();
			this.#worker = null;
		}
		resetWsWorker();
		this.#channel?.close();
		this.#channel = null;
		this.#status = 'disconnected';
		this.#listeners.clear();
		this.#entity_change_listeners.clear();
	}

	/**
	 * Listen for a specific event type. Returns an unsubscribe function.
	 * Use `'*'` to listen for all events.
	 *
	 * @example
	 * ```ts
	 * const unsub = ws.on('session:connected', (msg) => {
	 *   console.log('User connected:', msg.user_name);
	 * });
	 *
	 * // Later: unsub();
	 * ```
	 */
	on(event: string, callback: EventCallback): () => void {
		let set = this.#listeners.get(event);
		if (!set) {
			set = new Set();
			this.#listeners.set(event, set);
		}
		set.add(callback);
		return () => {
			set!.delete(callback);
			if (set!.size === 0) this.#listeners.delete(event);
		};
	}

	/**
	 * Send a message to the server.
	 * The message must have an `event` field.
	 */
	async send(message: WebsocketMessage): Promise<void> {
		if (!this.#worker) throw new Error('WebSocket not connected');
		await this.#worker.send(message as Record<string, unknown>);
	}

	// -----------------------------------------------------------------------
	// DatabaseClient integration
	// -----------------------------------------------------------------------

	/**
	 * Returns hooks compatible with `DatabaseClientConfig.hooks`.
	 * Wire this into your DatabaseClient to enable real-time entity sync.
	 *
	 * When a WebSocket `entity:created/updated/deleted` event arrives,
	 * it triggers the DatabaseClient to sync the affected entity type
	 * from the server (via `/api/sync`), keeping the local Orama index
	 * and all reactive searches up to date.
	 *
	 * @example
	 * ```ts
	 * const ws = new WebsocketClient();
	 * const db = new DatabaseClient({
	 *   tables,
	 *   db_name: `org:${org_id}`,
	 *   hooks: ws.databaseHooks(),
	 * });
	 * ```
	 */
	databaseHooks(): {
		onEntityChange: (event: EntityChangeEvent) => void;
		onSubscribe: (callback: (event: EntityChangeEvent) => void) => () => void;
	} {
		return {
			onEntityChange: () => {
				// No-op: when the local DatabaseClient performs a CRUD operation,
				// the server-side DatabaseServer already broadcasts the entity change
				// via ws().entityChanged(). No need to duplicate from the client.
			},
			onSubscribe: (callback) => {
				this.#entity_change_listeners.add(callback);
				return () => {
					this.#entity_change_listeners.delete(callback);
				};
			},
		};
	}
}
