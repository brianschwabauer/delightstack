import { expose } from 'comlink';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectOptions {
	/** Full WebSocket URL (e.g. wss://example.com/api/websocket) */
	url: string;
	/** Channel name for BroadcastChannel event fan-out to tabs */
	channel_name: string;
}

type WorkerStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** Per-org connection state */
interface Connection {
	ws: WebSocket | null;
	channel: BroadcastChannel;
	url: string;
	channel_name: string;
	status: WorkerStatus;
	tab_count: number;
	reconnect_attempts: number;
	reconnect_timer: ReturnType<typeof setTimeout> | null;
	ping_timer: ReturnType<typeof setInterval> | null;
	intentional_close: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const JITTER_FACTOR = 0.3;
const MAX_RECONNECT_ATTEMPTS = 20;
const PING_INTERVAL_MS = 30_000;

const PING_MESSAGE = JSON.stringify({ event: 'ping' });

// ---------------------------------------------------------------------------
// WebsocketWorker
// ---------------------------------------------------------------------------

export class WebsocketWorker {
	#connections = new Map<string, Connection>();

	/**
	 * Connect to the WebSocket server for a given org.
	 * If a connection for this channel_name already exists, increments the tab count.
	 * Otherwise creates a new connection and starts the WebSocket.
	 */
	async connect(options: ConnectOptions): Promise<void> {
		const existing = this.#connections.get(options.channel_name);
		if (existing) {
			existing.tab_count++;
			return;
		}

		const conn: Connection = {
			ws: null,
			channel: new BroadcastChannel(options.channel_name),
			url: options.url,
			channel_name: options.channel_name,
			status: 'disconnected',
			tab_count: 1,
			reconnect_attempts: 0,
			reconnect_timer: null,
			ping_timer: null,
			intentional_close: false,
		};
		this.#connections.set(options.channel_name, conn);
		this.#doConnect(conn);
	}

	/**
	 * Disconnect a tab from a specific org's connection.
	 * Decrements tab count; tears down the connection when the last tab leaves.
	 */
	async disconnect(channel_name: string): Promise<void> {
		const conn = this.#connections.get(channel_name);
		if (!conn) return;

		conn.tab_count = Math.max(0, conn.tab_count - 1);
		if (conn.tab_count === 0) {
			this.#teardown(conn);
		}
	}

	/** Send a JSON message on a specific org's connection. */
	async send(channel_name: string, message: Record<string, unknown>): Promise<void> {
		const conn = this.#connections.get(channel_name);
		if (!conn?.ws || conn.ws.readyState !== WebSocket.OPEN) {
			throw new Error('WebSocket not connected');
		}
		conn.ws.send(JSON.stringify(message));
	}

	/** Returns the current connection status for a specific org. */
	async getStatus(channel_name: string): Promise<WorkerStatus> {
		return this.#connections.get(channel_name)?.status ?? 'disconnected';
	}

	// -----------------------------------------------------------------------
	// Private
	// -----------------------------------------------------------------------

	#doConnect(conn: Connection): void {
		this.#setStatus(conn, conn.reconnect_attempts > 0 ? 'reconnecting' : 'connecting');

		try {
			conn.ws = new WebSocket(conn.url);
		} catch {
			this.#scheduleReconnect(conn);
			return;
		}

		conn.ws.onopen = () => {
			conn.reconnect_attempts = 0;
			this.#setStatus(conn, 'connected');
			this.#startPing(conn);
		};

		conn.ws.onmessage = (event: MessageEvent) => {
			try {
				const data = JSON.parse(event.data as string);
				// Skip pong messages — they're just keep-alive responses
				if (data?.event === 'pong') return;
				// Fan out to all tabs listening on this org's channel
				conn.channel.postMessage(data);
			} catch {
				// Ignore unparseable messages
			}
		};

		conn.ws.onclose = () => {
			conn.ws = null;
			this.#stopPing(conn);
			if (!conn.intentional_close) {
				this.#scheduleReconnect(conn);
			} else {
				this.#setStatus(conn, 'disconnected');
			}
		};

		conn.ws.onerror = () => {
			// onclose will fire after this, which handles reconnection
		};
	}

	#teardown(conn: Connection): void {
		conn.intentional_close = true;
		this.#stopPing(conn);
		this.#clearReconnectTimer(conn);
		conn.reconnect_attempts = 0;
		if (conn.ws) {
			conn.ws.onclose = null;
			conn.ws.onerror = null;
			conn.ws.close(1000, 'Client disconnect');
			conn.ws = null;
		}
		this.#setStatus(conn, 'disconnected');
		conn.channel.close();
		this.#connections.delete(conn.channel_name);
	}

	#scheduleReconnect(conn: Connection): void {
		if (conn.reconnect_attempts >= MAX_RECONNECT_ATTEMPTS) {
			this.#setStatus(conn, 'disconnected');
			return;
		}

		this.#clearReconnectTimer(conn);
		this.#setStatus(conn, 'reconnecting');

		const delay = Math.min(
			BASE_DELAY_MS * Math.pow(2, conn.reconnect_attempts),
			MAX_DELAY_MS,
		);
		const jitter = delay * JITTER_FACTOR * (Math.random() * 2 - 1);
		conn.reconnect_attempts++;
		conn.reconnect_timer = setTimeout(() => {
			conn.reconnect_timer = null;
			this.#doConnect(conn);
		}, delay + jitter);
	}

	#clearReconnectTimer(conn: Connection): void {
		if (conn.reconnect_timer !== null) {
			clearTimeout(conn.reconnect_timer);
			conn.reconnect_timer = null;
		}
	}

	#startPing(conn: Connection): void {
		this.#stopPing(conn);
		conn.ping_timer = setInterval(() => {
			if (conn.ws?.readyState === WebSocket.OPEN) {
				conn.ws.send(PING_MESSAGE);
			}
		}, PING_INTERVAL_MS);
	}

	#stopPing(conn: Connection): void {
		if (conn.ping_timer !== null) {
			clearInterval(conn.ping_timer);
			conn.ping_timer = null;
		}
	}

	#setStatus(conn: Connection, status: WorkerStatus): void {
		conn.status = status;
		// Broadcast status changes so tabs can update their reactive state
		conn.channel.postMessage({ event: '__ws_status', status });
	}
}

// ---------------------------------------------------------------------------
// Expose via Comlink (supports SharedWorker and Worker)
// ---------------------------------------------------------------------------

const worker = new WebsocketWorker();

// Regular Worker mode
expose(worker);

// SharedWorker mode — expose on each connecting port
self.addEventListener('connect', (event) => {
	const port = (event as MessageEvent)?.ports?.[0];
	if (port) expose(worker, port);
});
