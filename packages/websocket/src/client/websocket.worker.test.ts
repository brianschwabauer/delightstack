import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

// Mock comlink so importing the module doesn't try to expose on the global scope
vi.mock('comlink', () => ({ expose: vi.fn() }));

// ---------------------------------------------------------------------------
// Fake browser globals
// ---------------------------------------------------------------------------

class FakeWebSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;
	static instances: FakeWebSocket[] = [];

	readyState = FakeWebSocket.CONNECTING;
	sent: string[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	close = vi.fn((_code?: number, _reason?: string) => {
		this.readyState = FakeWebSocket.CLOSED;
	});

	constructor(public url: string) {
		FakeWebSocket.instances.push(this);
	}

	send(message: string): void {
		this.sent.push(message);
	}

	/** Simulate the server accepting the connection */
	open(): void {
		this.readyState = FakeWebSocket.OPEN;
		this.onopen?.();
	}
}

class FakeBroadcastChannel {
	messages: unknown[] = [];
	close = vi.fn();
	constructor(public name: string) {}
	postMessage(message: unknown): void {
		this.messages.push(message);
	}
}

// The worker module is imported dynamically AFTER globals are stubbed because
// it has module-level side effects (singleton + SharedWorker port wiring).
let WebsocketWorker: typeof import('./websocket.worker').WebsocketWorker;

beforeAll(async () => {
	vi.stubGlobal('WebSocket', FakeWebSocket);
	vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
	vi.stubGlobal('self', { addEventListener: vi.fn() });
	({ WebsocketWorker } = await import('./websocket.worker'));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PING = JSON.stringify({ event: 'ping' });
const OPTIONS = { url: 'wss://example.com/api/websocket', channel_name: 'org1' };

function lastSocket(): FakeWebSocket {
	return FakeWebSocket.instances.at(-1)!;
}

function statusEvents(): string[] {
	return channel()
		.messages.filter((m): m is { event: string; status: string } => {
			return (m as { event?: string }).event === '__ws_status';
		})
		.map((m) => m.status);
}

let channels: FakeBroadcastChannel[] = [];
function channel(): FakeBroadcastChannel {
	return channels[0];
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(Math, 'random').mockReturnValue(0.5); // no reconnect jitter
	FakeWebSocket.instances = [];
	channels = [];
	const original = FakeBroadcastChannel;
	vi.stubGlobal(
		'BroadcastChannel',
		class extends original {
			constructor(name: string) {
				super(name);
				channels.push(this);
			}
		},
	);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebsocketWorker', () => {
	describe('connect / status', () => {
		it('creates a WebSocket and reports connected after open', async () => {
			const worker = new WebsocketWorker();
			await worker.connect(OPTIONS);

			expect(FakeWebSocket.instances).toHaveLength(1);
			expect(lastSocket().url).toBe(OPTIONS.url);
			expect(await worker.getStatus('org1')).toBe('connecting');

			lastSocket().open();
			expect(await worker.getStatus('org1')).toBe('connected');
			expect(statusEvents()).toEqual(['connecting', 'connected']);
		});

		it('reuses the connection for a second tab on the same channel', async () => {
			const worker = new WebsocketWorker();
			await worker.connect(OPTIONS);
			await worker.connect(OPTIONS);

			expect(FakeWebSocket.instances).toHaveLength(1);

			// First disconnect only decrements the tab count
			await worker.disconnect('org1');
			expect(lastSocket().close).not.toHaveBeenCalled();

			// Last tab leaving tears the connection down
			await worker.disconnect('org1');
			expect(lastSocket().close).toHaveBeenCalledWith(1000, 'Client disconnect');
			expect(channel().close).toHaveBeenCalled();
		});

		it('tells a tab joining an already-open connection that it is connected', async () => {
			// A tab that attaches to a live socket sees no transition, so without an
			// explicit announcement it never learns the status and reports itself offline
			// forever — reloading cannot help, because the socket it joins never drops.
			const worker = new WebsocketWorker();
			await worker.connect(OPTIONS);
			lastSocket().open();
			expect(statusEvents()).toEqual(['connecting', 'connected']);

			await worker.connect(OPTIONS); // second tab

			expect(FakeWebSocket.instances).toHaveLength(1); // still one socket
			expect(statusEvents()).toEqual(['connecting', 'connected', 'connected']);
		});

		it('announces the true status to a tab that joins mid-reconnect', async () => {
			const worker = new WebsocketWorker();
			await worker.connect(OPTIONS);
			lastSocket().open();
			lastSocket().onclose?.(); // drops → schedules a reconnect
			const before = statusEvents().length;

			await worker.connect(OPTIONS); // second tab joins while reconnecting

			// A fresh announcement, not just the one the reconnect itself already sent.
			expect(statusEvents()).toHaveLength(before + 1);
			expect(statusEvents().at(-1)).toBe('reconnecting');
		});

		it('getStatus returns disconnected for unknown channels', async () => {
			const worker = new WebsocketWorker();
			expect(await worker.getStatus('nope')).toBe('disconnected');
		});
	});

	describe('ping keep-alive', () => {
		it('pings every 30s while connected', async () => {
			const worker = new WebsocketWorker();
			await worker.connect(OPTIONS);
			lastSocket().open();

			vi.advanceTimersByTime(90_000);
			expect(lastSocket().sent.filter((m) => m === PING)).toHaveLength(3);
		});

		it('stops pinging when the socket errors (before any close event)', async () => {
			const worker = new WebsocketWorker();
			await worker.connect(OPTIONS);
			const socket = lastSocket();
			socket.open();

			vi.advanceTimersByTime(30_000);
			expect(socket.sent.filter((m) => m === PING)).toHaveLength(1);

			// Error fires without onclose — the ping timer must still be cleared
			socket.onerror?.();
			vi.advanceTimersByTime(120_000);
			expect(socket.sent.filter((m) => m === PING)).toHaveLength(1);
		});

		it('clears the old ping timer before reconnecting', async () => {
			const worker = new WebsocketWorker();
			await worker.connect(OPTIONS);
			const first = lastSocket();
			first.open();
			vi.advanceTimersByTime(30_000);
			expect(first.sent.filter((m) => m === PING)).toHaveLength(1);

			// Server drops the connection — reconnect is scheduled (1s base delay)
			first.readyState = FakeWebSocket.CLOSED;
			first.onclose?.();
			vi.advanceTimersByTime(1_000);
			expect(FakeWebSocket.instances).toHaveLength(2);

			// While the new socket is still CONNECTING, no pings fire anywhere
			vi.advanceTimersByTime(120_000);
			expect(first.sent.filter((m) => m === PING)).toHaveLength(1);
			expect(lastSocket().sent).toHaveLength(0);

			// Once open, pings resume on the new socket only
			lastSocket().open();
			vi.advanceTimersByTime(30_000);
			expect(lastSocket().sent.filter((m) => m === PING)).toHaveLength(1);
		});

		it('stops pinging after teardown', async () => {
			const worker = new WebsocketWorker();
			await worker.connect(OPTIONS);
			const socket = lastSocket();
			socket.open();
			await worker.disconnect('org1');

			vi.advanceTimersByTime(120_000);
			expect(socket.sent.filter((m) => m === PING)).toHaveLength(0);
		});
	});

	describe('reconnection', () => {
		it('reconnects with exponential backoff after an unintentional close', async () => {
			const worker = new WebsocketWorker();
			await worker.connect(OPTIONS);
			lastSocket().open();

			lastSocket().onclose?.();
			expect(await worker.getStatus('org1')).toBe('reconnecting');

			// First retry after the 1s base delay
			vi.advanceTimersByTime(999);
			expect(FakeWebSocket.instances).toHaveLength(1);
			vi.advanceTimersByTime(1);
			expect(FakeWebSocket.instances).toHaveLength(2);

			// Second retry doubles to 2s
			lastSocket().onclose?.();
			vi.advanceTimersByTime(1_999);
			expect(FakeWebSocket.instances).toHaveLength(2);
			vi.advanceTimersByTime(1);
			expect(FakeWebSocket.instances).toHaveLength(3);
		});

		it('resets the backoff counter once a connection opens', async () => {
			const worker = new WebsocketWorker();
			await worker.connect(OPTIONS);
			lastSocket().onclose?.();
			vi.advanceTimersByTime(1_000);
			lastSocket().open(); // successful reconnect resets attempts

			lastSocket().onclose?.();
			vi.advanceTimersByTime(1_000); // back to base delay, not doubled
			expect(FakeWebSocket.instances).toHaveLength(3);
		});

		it('does not reconnect after an intentional disconnect', async () => {
			const worker = new WebsocketWorker();
			await worker.connect(OPTIONS);
			lastSocket().open();
			await worker.disconnect('org1');

			vi.advanceTimersByTime(120_000);
			expect(FakeWebSocket.instances).toHaveLength(1);
			expect(await worker.getStatus('org1')).toBe('disconnected');
		});
	});

	describe('messaging', () => {
		it('fans incoming messages out to the BroadcastChannel', async () => {
			const worker = new WebsocketWorker();
			await worker.connect(OPTIONS);
			const socket = lastSocket();
			socket.open();

			socket.onmessage?.({ data: JSON.stringify({ event: 'entity:updated', id: 1 }) });
			expect(channel().messages.at(-1)).toEqual({ event: 'entity:updated', id: 1 });
		});

		it('swallows pong messages and unparseable data', async () => {
			const worker = new WebsocketWorker();
			await worker.connect(OPTIONS);
			const socket = lastSocket();
			socket.open();
			const count = channel().messages.length;

			socket.onmessage?.({ data: JSON.stringify({ event: 'pong' }) });
			socket.onmessage?.({ data: 'not json{' });
			expect(channel().messages).toHaveLength(count);
		});

		it('send() forwards JSON when connected and throws when not', async () => {
			const worker = new WebsocketWorker();
			await expect(worker.send('org1', { event: 'x' })).rejects.toThrow(
				'WebSocket not connected',
			);

			await worker.connect(OPTIONS);
			await expect(worker.send('org1', { event: 'x' })).rejects.toThrow(
				'WebSocket not connected',
			);

			lastSocket().open();
			await worker.send('org1', { event: 'cursor:move', x: 2 });
			expect(lastSocket().sent).toContain(JSON.stringify({ event: 'cursor:move', x: 2 }));
		});
	});
});
