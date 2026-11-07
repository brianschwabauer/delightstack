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
	/** Epoch ms of the last frame received on the current socket (pongs included). */
	last_frame_at: number;
	/** Frames received on the current socket; a probe compares it before and after. */
	frame_count: number;
	/** Pending liveness probe started by `nudge()` on a socket that looks open. */
	probe_timer: ReturnType<typeof setTimeout> | null;
	intentional_close: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30_000;
const JITTER_FACTOR = 0.3;
const PING_INTERVAL_MS = 30_000;
/**
 * A socket that has delivered nothing — not even the server's auto-pong — for
 * this long is dead even if the browser still reports it OPEN. After a laptop
 * sleeps or the network changes, a TCP connection can sit "open" for many
 * minutes with nothing flowing; only a missing reply reveals it.
 */
const STALE_AFTER_MS = PING_INTERVAL_MS * 2 + 10_000;
/** How long a `nudge()` probe waits for any frame before declaring the socket dead. */
const PROBE_TIMEOUT_MS = 5_000;

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
			// Announce the status this connection is ALREADY in. `#setStatus` only fires on
			// socket transitions, so a tab joining an already-open socket would otherwise
			// never hear one: its client stays at the initial 'disconnected' and reports
			// itself offline while events flow past it. Reloading can't fix it either — the
			// socket it joins never drops, so there is no transition to hear. Re-announcing
			// is safe: the client only dispatches ws:connected / ws:disconnected when the
			// status actually changes.
			this.#announceStatus(existing);
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
			last_frame_at: 0,
			frame_count: 0,
			probe_timer: null,
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

	/**
	 * Something suggests the connection may be stale or newly recoverable — the
	 * network came back, the tab became visible, the device woke up. Tabs call
	 * this; there is no way to hear those events from inside a SharedWorker for
	 * every browser.
	 *
	 * - Not connected: abandon any pending backoff and reconnect right now.
	 * - Looks connected: send a ping and give the server {@link PROBE_TIMEOUT_MS}
	 *   to answer; silence means the socket died while we weren't looking.
	 */
	async nudge(channel_name: string): Promise<void> {
		const conn = this.#connections.get(channel_name);
		if (!conn || conn.intentional_close) return;
		if (
			conn.status !== 'connected' ||
			!conn.ws ||
			conn.ws.readyState !== WebSocket.OPEN
		) {
			if (conn.ws && conn.ws.readyState === WebSocket.CONNECTING) return;
			this.#clearReconnectTimer(conn);
			conn.reconnect_attempts = 0;
			this.#doConnect(conn);
			return;
		}
		if (conn.probe_timer !== null) return;
		const probed = conn.ws;
		const frames_before = conn.frame_count;
		probed.send(PING_MESSAGE);
		conn.probe_timer = setTimeout(() => {
			conn.probe_timer = null;
			if (conn.ws === probed && conn.frame_count === frames_before)
				this.#dropDeadSocket(conn);
		}, PROBE_TIMEOUT_MS);
	}

	/** {@link nudge} every connection — used when the network comes back. */
	nudgeAll(): void {
		for (const name of this.#connections.keys()) void this.nudge(name);
	}

	/** Returns the current connection status for a specific org. */
	async getStatus(channel_name: string): Promise<WorkerStatus> {
		return this.#connections.get(channel_name)?.status ?? 'disconnected';
	}

	// -----------------------------------------------------------------------
	// Private
	// -----------------------------------------------------------------------

	#doConnect(conn: Connection): void {
		// Clear any ping timer left over from a previous connection attempt
		// (e.g. a socket that errored without ever firing onclose).
		this.#stopPing(conn);
		// A nudge can start a fresh attempt while an old socket is still attached
		// (half-open after sleep). Detach it so its late onclose can't schedule a
		// second, competing reconnect.
		if (conn.ws) {
			const old = conn.ws;
			old.onopen = null;
			old.onmessage = null;
			old.onclose = null;
			old.onerror = null;
			try {
				old.close();
			} catch {
				/* already closed */
			}
			conn.ws = null;
		}
		this.#setStatus(conn, conn.reconnect_attempts > 0 ? 'reconnecting' : 'connecting');

		try {
			conn.ws = new WebSocket(conn.url);
		} catch {
			this.#scheduleReconnect(conn);
			return;
		}

		conn.ws.onopen = () => {
			conn.reconnect_attempts = 0;
			conn.last_frame_at = Date.now();
			this.#setStatus(conn, 'connected');
			this.#startPing(conn);
		};

		conn.ws.onmessage = (event: MessageEvent) => {
			conn.last_frame_at = Date.now();
			conn.frame_count++;
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
			// Stop pinging immediately — onclose normally fires after this and
			// handles reconnection, but don't rely on it to clear the timer.
			this.#stopPing(conn);
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

	/**
	 * Retries forever. Giving up after N attempts left a tab that slept through
	 * an outage permanently offline — live updates stopped until a reload — and a
	 * capped backoff already keeps a long outage cheap.
	 */
	#scheduleReconnect(conn: Connection): void {
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
			if (conn.ws?.readyState !== WebSocket.OPEN) return;
			if (Date.now() - conn.last_frame_at > STALE_AFTER_MS) {
				this.#dropDeadSocket(conn);
				return;
			}
			conn.ws.send(PING_MESSAGE);
		}, PING_INTERVAL_MS);
	}

	/**
	 * The socket is open in name only. Closing a dead TCP connection can take
	 * minutes to fire `onclose`, so detach it and reconnect immediately.
	 */
	#dropDeadSocket(conn: Connection): void {
		if (conn.intentional_close) return;
		this.#stopPing(conn);
		const dead = conn.ws;
		conn.ws = null;
		if (dead) {
			dead.onopen = null;
			dead.onmessage = null;
			dead.onclose = null;
			dead.onerror = null;
			try {
				dead.close(4000, 'No response');
			} catch {
				/* already closed */
			}
		}
		conn.reconnect_attempts = 0;
		this.#scheduleReconnect(conn);
	}

	#stopPing(conn: Connection): void {
		if (conn.ping_timer !== null) {
			clearInterval(conn.ping_timer);
			conn.ping_timer = null;
		}
		if (conn.probe_timer !== null) {
			clearTimeout(conn.probe_timer);
			conn.probe_timer = null;
		}
	}

	#setStatus(conn: Connection, status: WorkerStatus): void {
		conn.status = status;
		this.#announceStatus(conn);
	}

	/**
	 * Broadcast a connection's current status to every tab on its channel, so their
	 * reactive state can follow it. Separate from #setStatus because a tab joining an
	 * existing connection needs to be told the status without anything having changed.
	 */
	#announceStatus(conn: Connection): void {
		conn.channel.postMessage({ event: '__ws_status', status: conn.status });
	}
}

// ---------------------------------------------------------------------------
// Expose via Comlink (supports SharedWorker and Worker)
// ---------------------------------------------------------------------------

const worker = new WebsocketWorker();

// Regular Worker mode
expose(worker);

// Workers hear the network come back too; reconnect without waiting out a backoff.
self.addEventListener('online', () => worker.nudgeAll());

// SharedWorker mode — expose on each connecting port
self.addEventListener('connect', (event) => {
	const port = (event as MessageEvent)?.ports?.[0];
	if (port) expose(worker, port);
});
