import type { Remote } from 'comlink';
import type { DatabaseClientHooks } from '@delightstack/database';
import type { WebsocketWorker } from './websocket.worker.js';
import type {
	WebsocketMessage,
	ConnectionStatus,
	EntityChangeEvent,
	EntityChangedMessage,
	SessionConnectedMessage,
	SessionDisconnectedMessage,
	SessionListMessage,
	ErrorMessage,
	AuthSessionMeta,
	SessionInfo,
} from '../types/index.js';
import { getWsWorker } from './websocket.worker.init.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the WebsocketClient */
export interface WebsocketClientConfig {
	/** The WebSocket endpoint path (used to build URL from window.location) @default '/api/websocket' */
	path?: string;
	/** Full WebSocket URL override — takes precedence over path. Use for external WS servers. */
	url?: string;
	/**
	 * Whether the app is in dev mode. When true:
	 * - a regular Worker is used instead of a SharedWorker (Vite SSR limitation);
	 * - if no `url` is provided, the client connects directly to the wrangler
	 *   worker at `ws://localhost:${dev_worker_port}${path}` because Vite can't
	 *   proxy WebSocket upgrades through its dev server's RPC proxy.
	 */
	dev?: boolean;
	/** Port of the wrangler dev worker. Used only when `dev` is true. @default 8787 */
	dev_worker_port?: number;
	/**
	 * Query params appended to the WebSocket URL in dev mode. Use to pass
	 * identity/session metadata (e.g. user_id, user_name) to the dev worker,
	 * since SvelteKit's auth handle is bypassed when connecting directly.
	 * Ignored in prod.
	 */
	dev_query?: Record<string, string | undefined>;
}

/** Built-in event names and their message types */
type BuiltinEventMap<Meta extends Record<string, unknown>> = {
	'entity:created': EntityChangedMessage;
	'entity:updated': EntityChangedMessage;
	'entity:deleted': EntityChangedMessage;
	'session:connected': SessionConnectedMessage<Meta>;
	'session:disconnected': SessionDisconnectedMessage<Meta>;
	'session:list': SessionListMessage<Meta>;
	error: ErrorMessage;
	'*': WebsocketMessage;
};

/** Full event map — built-in events merged with app-specific custom events */
type WebsocketEventMap<
	Meta extends Record<string, unknown>,
	Events extends object,
> = BuiltinEventMap<Meta> & Events;

type EventCallback<T = WebsocketMessage> = (message: T) => void;

// ---------------------------------------------------------------------------
// WebsocketClient
// ---------------------------------------------------------------------------

/**
 * Reactive WebSocket client for Svelte 5.
 * Manages a WebSocket connection via a SharedWorker (shared across browser tabs)
 * and provides event subscription and DatabaseClient integration.
 *
 * The `room` parameter scopes the connection — use an org_id for multi-tenant apps,
 * or any arbitrary string for custom rooms/channels.
 *
 * @typeParam Meta - The session metadata shape. Defaults to `AuthSessionMeta`.
 *   Pass your own type to get typed `meta` access on session events.
 * @typeParam Events - Custom event map for app-specific events.
 *   Keys are event names, values are message types.
 *
 * @example
 * ```ts
 * // With @delightstack/auth (default):
 * const ws = new WebsocketClient({ dev: true });
 * await ws.connect(org_id);
 * ws.on('session:connected', (msg) => {
 *   console.log(msg.meta?.user_name); // typed as string | undefined
 * });
 * console.log(ws.sessions); // reactive list of connected sessions
 *
 * // With custom metadata and typed events:
 * type MyEvents = {
 *   'chat:message': { event: 'chat:message'; text: string; sender: string };
 * };
 * const ws = new WebsocketClient<AuthSessionMeta, MyEvents>();
 * ws.on('chat:message', (msg) => msg.text); // typed!
 * ```
 */
export class WebsocketClient<
	Meta extends Record<string, unknown> = AuthSessionMeta,
	Events extends object = object,
> {
	#config: WebsocketClientConfig;
	#worker: Remote<WebsocketWorker> | null = null;
	#channel: BroadcastChannel | null = null;
	#channel_name: string | null = null;
	#listeners = new Map<string, Set<EventCallback>>();
	#entity_change_listeners = new Set<(event: EntityChangeEvent) => void>();
	#reconnect_listeners = new Set<() => void>();
	/** Whether this room's socket has been connected at least once (so the next connect is a REconnect). */
	#ever_connected = false;
	#remove_wake_listeners: (() => void) | null = null;

	// Reactive state (Svelte 5 runes)
	#status = $state<ConnectionStatus>('disconnected');
	#connected = $derived(this.#status === 'connected');
	#sessions = $state<SessionInfo<Meta>[]>([]);

	/**
	 * Epoch ms when we last transitioned from `connected` to `disconnected`.
	 * `null` before we've ever been connected (or while currently connected).
	 * Used by `isLive` to give the feed a short grace window across
	 * transient drops so IDB-trusting consumers don't refetch on every blip.
	 */
	#disconnected_at: number | null = $state(null);

	/**
	 * How long after a disconnect we still consider the change feed
	 * trustworthy. A drop longer than this means consumers (e.g. the
	 * database client's stale-refresh path) should stop trusting the
	 * local cache and go back to refetching.
	 */
	#live_grace_ms = 60_000;

	/** Current connection status (reactive) */
	get status(): ConnectionStatus {
		return this.#status;
	}

	/** Whether the WebSocket is currently connected (reactive) */
	get connected(): boolean {
		return this.#connected;
	}

	/**
	 * Whether the client believes it has a trustworthy live change feed
	 * right now — `true` when currently connected, or when we were connected
	 * and disconnected less than ~60s ago (transient drop). `false` after a
	 * longer outage or before the first connection. Used by `DatabaseClient`
	 * via `databaseHooks().isLive` to decide whether to skip redundant
	 * network refreshes.
	 */
	get isLive(): boolean {
		if (this.#connected) return true;
		if (this.#disconnected_at == null) return false;
		return Date.now() - this.#disconnected_at < this.#live_grace_ms;
	}

	/** Currently connected sessions (reactive). Auto-updates from session events. */
	get sessions(): readonly SessionInfo<Meta>[] {
		return this.#sessions;
	}

	constructor(config?: WebsocketClientConfig) {
		this.#config = {
			path: '/api/websocket',
			...config,
		};
	}

	/**
	 * Connect to the WebSocket server for the given room.
	 * The room scopes the BroadcastChannel so different rooms are isolated.
	 * Use an org_id for multi-tenant apps, or any string for custom rooms.
	 * Safe to call multiple times — handles room switching automatically.
	 */
	async connect(room: string): Promise<void> {
		if (typeof window === 'undefined') return; // SSR guard

		const channel_name = `ws:${room}`;

		// Already connected to this room — nothing to do
		if (this.#channel_name === channel_name) return;

		// Disconnect from previous room if switching
		if (this.#channel_name && this.#worker) {
			await this.#worker.disconnect(this.#channel_name);
		}
		this.#channel?.close();
		this.#channel = null;

		this.#worker = await getWsWorker(this.#config.dev);

		// Build the WebSocket URL. Precedence:
		//   1. explicit `url` override
		//   2. dev mode → direct connection to the wrangler worker at the
		//      configured port, with `room` and any `dev_query` appended
		//      (Vite can't proxy WS upgrades, so we bypass it in dev)
		//   3. prod → wss(s)://<host><path> derived from window.location
		const url =
			this.#config.url ??
			(() => {
				const path = this.#config.path ?? '/api/websocket';
				if (this.#config.dev) {
					const port = this.#config.dev_worker_port ?? 8787;
					const params = new URLSearchParams();
					params.set('room', room);
					for (const [key, value] of Object.entries(this.#config.dev_query ?? {})) {
						if (value !== undefined) params.set(key, value);
					}
					return `ws://localhost:${port}${path}?${params.toString()}`;
				}
				const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
				return `${protocol}//${window.location.host}${path}`;
			})();

		this.#channel_name = channel_name;
		this.#ever_connected = false;

		// Set up BroadcastChannel to receive events from the SharedWorker
		this.#channel = new BroadcastChannel(channel_name);
		this.#channel.onmessage = (event: MessageEvent) => {
			const message = event.data as WebsocketMessage;
			if (!message?.event) return;

			// Handle internal status updates from the worker
			if (message.event === '__ws_status') {
				const new_status = (message as unknown as { status: ConnectionStatus }).status;
				const old_status = this.#status;
				this.#status = new_status;

				// Fire transport-level lifecycle events
				if (new_status === 'connected' && old_status !== 'connected') {
					// We're live again — clear the disconnect timestamp so any
					// grace-window check returns to "fully trusted."
					this.#disconnected_at = null;
					this.#dispatch('ws:connected', message);
					if (this.#ever_connected) {
						// Everything sent while the socket was down is gone for good —
						// tell listeners to catch up (DatabaseClient re-syncs).
						this.#dispatch('ws:reconnected', message);
						for (const cb of this.#reconnect_listeners) {
							try {
								cb();
							} catch {
								/* listener errors should not break the chain */
							}
						}
					}
					this.#ever_connected = true;
				} else if (old_status === 'connected' && new_status !== 'connected') {
					// Record the drop so `isLive` can grant a grace period. Covers
					// 'reconnecting' too: the worker goes straight there on a drop.
					this.#disconnected_at = Date.now();
					this.#dispatch('ws:disconnected', message);
				}
				return;
			}

			// Update reactive sessions state before dispatching to listeners
			this.#updateSessions(message);

			// Dispatch to event-specific listeners + wildcard
			this.#dispatch(message.event, message);

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
					sparse: entity_msg.sparse,
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

		// Tell the SharedWorker to connect (increments tab count or creates new connection)
		await this.#worker.connect({ url, channel_name });
		this.#watchForWake();
	}

	/**
	 * Ask the worker to check the connection now: reconnect immediately if it is
	 * down, or probe it if it only looks up. Called automatically when the tab
	 * becomes visible, regains focus, or the network comes back — the moments a
	 * long-idle tab is most likely holding a dead socket.
	 */
	async checkConnection(): Promise<void> {
		if (!this.#worker || !this.#channel_name) return;
		try {
			await this.#worker.nudge(this.#channel_name);
		} catch {
			/* worker gone — the next connect() rebuilds it */
		}
	}

	#watchForWake(): void {
		this.#remove_wake_listeners?.();
		if (typeof window === 'undefined') return;
		let last = 0;
		const wake = () => {
			if (document.visibilityState === 'hidden') return;
			// visibilitychange + focus + pageshow often fire together; one check is enough.
			const now = Date.now();
			if (now - last < 1000) return;
			last = now;
			void this.checkConnection();
		};
		window.addEventListener('online', wake);
		window.addEventListener('focus', wake);
		window.addEventListener('pageshow', wake);
		document.addEventListener('visibilitychange', wake);
		this.#remove_wake_listeners = () => {
			window.removeEventListener('online', wake);
			window.removeEventListener('focus', wake);
			window.removeEventListener('pageshow', wake);
			document.removeEventListener('visibilitychange', wake);
			this.#remove_wake_listeners = null;
		};
	}

	/**
	 * Disconnect and clean up resources.
	 * Event listeners are preserved so they survive reconnection.
	 * Call `destroy()` for full cleanup including listeners.
	 */
	async disconnect(): Promise<void> {
		this.#remove_wake_listeners?.();
		if (this.#status === 'connected') this.#disconnected_at = Date.now();
		if (this.#worker && this.#channel_name) {
			await this.#worker.disconnect(this.#channel_name);
		}
		this.#channel?.close();
		this.#channel = null;
		this.#channel_name = null;
		this.#sessions = [];
		this.#status = 'disconnected';
	}

	/**
	 * Full teardown — disconnects and removes all event listeners.
	 * Use when the WebsocketClient instance is being disposed of entirely.
	 */
	async destroy(): Promise<void> {
		await this.disconnect();
		this.#listeners.clear();
		this.#entity_change_listeners.clear();
		this.#reconnect_listeners.clear();
	}

	/**
	 * Listen for a specific event type. Returns an unsubscribe function.
	 * Use `'*'` to listen for all events.
	 *
	 * @example
	 * ```ts
	 * const unsub = ws.on('session:connected', (msg) => {
	 *   console.log('User connected:', msg.meta?.user_name);
	 * });
	 *
	 * // Transport lifecycle
	 * ws.on('ws:connected', () => console.log('WebSocket connected'));
	 * ws.on('ws:disconnected', () => console.log('WebSocket disconnected'));
	 * // Connected again after a drop — anything sent meanwhile was missed
	 * ws.on('ws:reconnected', () => refetchWhatMatters());
	 *
	 * // Wildcard — receives any WebsocketMessage
	 * ws.on('*', (msg) => console.log(msg.event));
	 * ```
	 */
	on<K extends keyof WebsocketEventMap<Meta, Events>>(
		event: K,
		callback: EventCallback<WebsocketEventMap<Meta, Events>[K]>,
	): () => void;
	on(event: string, callback: EventCallback): () => void;
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
	 * Listen for a specific event type once. The listener auto-removes after first invocation.
	 * Returns an unsubscribe function in case you need to cancel before the event fires.
	 */
	once<K extends keyof WebsocketEventMap<Meta, Events>>(
		event: K,
		callback: EventCallback<WebsocketEventMap<Meta, Events>[K]>,
	): () => void;
	once(event: string, callback: EventCallback): () => void;
	once(event: string, callback: EventCallback): () => void {
		const unsub = this.on(event, (message) => {
			unsub();
			callback(message);
		});
		return unsub;
	}

	/**
	 * Send a message to the server.
	 * The message must have an `event` field.
	 */
	async send(message: WebsocketMessage): Promise<void> {
		if (!this.#worker || !this.#channel_name) throw new Error('WebSocket not connected');
		await this.#worker.send(this.#channel_name, message as Record<string, unknown>);
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
	// Typed as the contract from @delightstack/database, so a drift between the
	// two packages is a compile error here rather than a runtime mismatch.
	databaseHooks(): Required<DatabaseClientHooks> {
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
			// Lets DatabaseClient skip the worker's safety-net stale refresh
			// while the websocket is live (or just briefly dropped): change
			// events are flowing in, so IDB is the source of truth.
			isLive: () => this.isLive,
			// The change feed only carries what happens while connected; after a
			// drop the database pulls the gap with a catch-up sync.
			onReconnect: (callback) => {
				this.#reconnect_listeners.add(callback);
				return () => {
					this.#reconnect_listeners.delete(callback);
				};
			},
		};
	}

	// -----------------------------------------------------------------------
	// Private
	// -----------------------------------------------------------------------

	#updateSessions(message: WebsocketMessage): void {
		if (message.event === 'session:list') {
			const msg = message as SessionListMessage;
			this.#sessions = msg.sessions.map((s) => ({
				ws_session_id: s.ws_session_id,
				...(s.meta != null && { meta: s.meta as Meta }),
			}));
		} else if (message.event === 'session:connected') {
			const msg = message as SessionConnectedMessage;
			this.#sessions = [
				...this.#sessions,
				{
					ws_session_id: msg.ws_session_id,
					...(msg.meta != null && { meta: msg.meta as Meta }),
				},
			];
		} else if (message.event === 'session:disconnected') {
			const msg = message as SessionDisconnectedMessage;
			this.#sessions = this.#sessions.filter(
				(s) => s.ws_session_id !== msg.ws_session_id,
			);
		}
	}

	#dispatch(event_name: string, message: WebsocketMessage): void {
		const listeners = this.#listeners.get(event_name);
		if (listeners) {
			for (const cb of listeners) {
				try {
					cb(message);
				} catch {
					/* listener errors should not break the chain */
				}
			}
		}

		// Dispatch to wildcard listeners (skip for wildcard itself to avoid double-fire)
		if (event_name !== '*') {
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
		}
	}
}
