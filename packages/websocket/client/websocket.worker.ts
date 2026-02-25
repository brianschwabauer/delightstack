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

// ---------------------------------------------------------------------------
// Reconnection constants
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
	#ws: WebSocket | null = null;
	#channel: BroadcastChannel | null = null;
	#url: string | null = null;
	#channel_name: string | null = null;
	#status: WorkerStatus = 'disconnected';
	#reconnect_attempts = 0;
	#reconnect_timer: ReturnType<typeof setTimeout> | null = null;
	#ping_timer: ReturnType<typeof setInterval> | null = null;
	#intentional_close = false;
	#tab_count = 0;

	/** Called when a new tab connects (via comlink port). */
	async addTab(): Promise<void> {
		this.#tab_count++;
	}

	/** Called when a tab disconnects. Closes WS when no tabs remain. */
	async removeTab(): Promise<void> {
		this.#tab_count = Math.max(0, this.#tab_count - 1);
		if (this.#tab_count === 0) {
			await this.disconnect();
		}
	}

	/** Connect to the WebSocket server. Handles org switching — disconnects the old connection if options changed. */
	async connect(options: ConnectOptions): Promise<void> {
		// If already connected/connecting to the same target, do nothing
		if (this.#status !== 'disconnected') {
			if (this.#url === options.url && this.#channel_name === options.channel_name) {
				return;
			}
			// Options changed (e.g. org switch) — tear down old connection
			this.#stopPing();
			this.#clearReconnectTimer();
			this.#reconnect_attempts = 0;
			if (this.#ws) {
				// Detach handlers to prevent stale close/error from triggering reconnect
				this.#ws.onclose = null;
				this.#ws.onerror = null;
				this.#ws.close(1000, 'Switching connection');
				this.#ws = null;
			}
		}

		this.#url = options.url;

		// Create or swap BroadcastChannel if the org changed
		if (!this.#channel || this.#channel_name !== options.channel_name) {
			this.#channel?.close();
			this.#channel = new BroadcastChannel(options.channel_name);
		}
		this.#channel_name = options.channel_name;

		this.#intentional_close = false;
		this.#doConnect();
	}

	/** Disconnect from the WebSocket server. Stops reconnection. */
	async disconnect(): Promise<void> {
		this.#intentional_close = true;
		this.#stopPing();
		this.#clearReconnectTimer();
		this.#reconnect_attempts = 0;
		if (this.#ws) {
			this.#ws.close(1000, 'Client disconnect');
			this.#ws = null;
		}
		this.#setStatus('disconnected');
		this.#channel?.close();
		this.#channel = null;
		this.#channel_name = null;
		this.#url = null;
	}

	/** Send a JSON message to the server. */
	async send(message: Record<string, unknown>): Promise<void> {
		if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
			throw new Error('WebSocket not connected');
		}
		this.#ws.send(JSON.stringify(message));
	}

	/** Returns the current connection status. */
	async getStatus(): Promise<WorkerStatus> {
		return this.#status;
	}

	// -----------------------------------------------------------------------
	// Private
	// -----------------------------------------------------------------------

	#doConnect(): void {
		if (!this.#url) return;

		this.#setStatus(this.#reconnect_attempts > 0 ? 'reconnecting' : 'connecting');

		try {
			this.#ws = new WebSocket(this.#url);
		} catch {
			this.#scheduleReconnect();
			return;
		}

		this.#ws.onopen = () => {
			this.#reconnect_attempts = 0;
			this.#setStatus('connected');
			this.#startPing();
		};

		this.#ws.onmessage = (event: MessageEvent) => {
			try {
				const data = JSON.parse(event.data as string);
				// Skip pong messages — they're just keep-alive responses
				if (data?.event === 'pong') return;
				// Fan out to all tabs via BroadcastChannel
				this.#channel?.postMessage(data);
			} catch {
				// Ignore unparseable messages
			}
		};

		this.#ws.onclose = () => {
			this.#ws = null;
			this.#stopPing();
			if (!this.#intentional_close) {
				this.#scheduleReconnect();
			} else {
				this.#setStatus('disconnected');
			}
		};

		this.#ws.onerror = () => {
			// onclose will fire after this, which handles reconnection
		};
	}

	#scheduleReconnect(): void {
		if (this.#reconnect_attempts >= MAX_RECONNECT_ATTEMPTS) {
			this.#setStatus('disconnected');
			return;
		}

		this.#clearReconnectTimer();
		this.#setStatus('reconnecting');

		const delay = Math.min(
			BASE_DELAY_MS * Math.pow(2, this.#reconnect_attempts),
			MAX_DELAY_MS,
		);
		const jitter = delay * JITTER_FACTOR * (Math.random() * 2 - 1);
		this.#reconnect_attempts++;
		this.#reconnect_timer = setTimeout(() => {
			this.#reconnect_timer = null;
			this.#doConnect();
		}, delay + jitter);
	}

	#clearReconnectTimer(): void {
		if (this.#reconnect_timer !== null) {
			clearTimeout(this.#reconnect_timer);
			this.#reconnect_timer = null;
		}
	}

	#startPing(): void {
		this.#stopPing();
		this.#ping_timer = setInterval(() => {
			if (this.#ws?.readyState === WebSocket.OPEN) {
				this.#ws.send(PING_MESSAGE);
			}
		}, PING_INTERVAL_MS);
	}

	#stopPing(): void {
		if (this.#ping_timer !== null) {
			clearInterval(this.#ping_timer);
			this.#ping_timer = null;
		}
	}

	#setStatus(status: WorkerStatus): void {
		this.#status = status;
		// Broadcast status changes so tabs can update their reactive state
		this.#channel?.postMessage({ event: '__ws_status', status });
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
