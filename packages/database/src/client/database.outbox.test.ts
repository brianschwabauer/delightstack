// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
	Outbox,
	backoffDelay,
	BACKOFF_CAP_MS,
	OUTBOX_STORE,
	FAILED_STORE,
	type OutboxRow,
	type OutboxScheduler,
	type OutboxSnapshot,
	type SendResult,
} from './database.outbox';

// The queue in isolation: no fetch, no worker, no search index. Everything
// time-dependent is injected, so a test can prove the 30-second cap without
// waiting 30 seconds — and never flakes on a slow machine.

/** A clock + timer queue driven entirely by the test. */
function createScheduler() {
	let now = 1_000_000;
	let next_handle = 1;
	const timers = new Map<number, { at: number; fn: () => void }>();
	// Deterministic jitter: 1 means "no shortening", so a delay equals its cap.
	let random_value = 1;

	const scheduler: OutboxScheduler = {
		now: () => now,
		setTimeout: (fn, delay_ms) => {
			const handle = next_handle++;
			timers.set(handle, { at: now + delay_ms, fn });
			return handle;
		},
		clearTimeout: (handle) => {
			timers.delete(handle as number);
		},
		random: () => random_value,
	};

	return {
		scheduler,
		get now() {
			return now;
		},
		setRandom(value: number) {
			random_value = value;
		},
		/**
		 * Advance the clock and run everything that came due, oldest first,
		 * settling the async work each timer kicked off before looking again.
		 * `settle` is supplied by the harness (it awaits the outbox's in-flight
		 * drain) — without it a timer's IndexedDB round trip would still be in
		 * flight when the assertions run.
		 */
		async advance(ms: number, settle?: () => Promise<void>): Promise<void> {
			now += ms;
			for (;;) {
				const due = [...timers.entries()]
					.filter(([, timer]) => timer.at <= now)
					.sort((a, b) => a[1].at - b[1].at);
				if (due.length === 0) break;
				for (const [handle, timer] of due) {
					timers.delete(handle);
					timer.fn();
				}
				await new Promise((resolve) => setImmediate(resolve));
				if (settle) await settle();
				await new Promise((resolve) => setImmediate(resolve));
			}
		},
		pending() {
			return timers.size;
		},
	};
}

let factory: IDBFactory;
let database_counter = 0;

function openDatabase(name: string, version?: number): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request =
			version === undefined ? factory.open(name) : factory.open(name, version);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
				db.createObjectStore(OUTBOX_STORE, { keyPath: 'seq', autoIncrement: true });
			}
			if (!db.objectStoreNames.contains(FAILED_STORE)) {
				db.createObjectStore(FAILED_STORE, { keyPath: 'op_id' });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

function row(
	overrides: Partial<OutboxRow> & Pick<OutboxRow, 'op_id'>,
): Omit<OutboxRow, 'seq'> {
	return {
		entity_type: 'item',
		operation: 'update',
		id: 'item-1',
		patch: { name: 'x' },
		created_at: 0,
		attempts: 0,
		next_attempt_at: 0,
		...overrides,
	};
}

interface Harness {
	outbox: Outbox;
	db: IDBDatabase;
	sent: OutboxRow[];
	snapshots: OutboxSnapshot[];
	failed_events: string[];
	clock: ReturnType<typeof createScheduler>;
	reply: (fn: (row: OutboxRow) => SendResult) => void;
}

async function createHarness(name?: string): Promise<Harness> {
	const db_name = name ?? `outbox-${++database_counter}`;
	const db = await openDatabase(db_name);
	const clock = createScheduler();
	const sent: OutboxRow[] = [];
	const snapshots: OutboxSnapshot[] = [];
	const failed_events: string[] = [];
	let responder: (row: OutboxRow) => SendResult = () => ({ ok: true });

	const outbox = new Outbox({
		getDatabase: () => db,
		send: async (queued) => {
			sent.push(queued);
			return responder(queued);
		},
		onChange: (snapshot) => snapshots.push(snapshot),
		onFailed: (operation) => failed_events.push(operation.op_id),
		scheduler: clock.scheduler,
	});
	await outbox.hydrate();

	return {
		outbox,
		db,
		sent,
		snapshots,
		failed_events,
		clock: {
			...clock,
			get now() {
				return clock.now;
			},
			advance: (ms: number) => clock.advance(ms, () => outbox.whenIdle()),
		},
		reply: (fn) => {
			responder = fn;
		},
	};
}

beforeEach(() => {
	factory = new IDBFactory();
	vi.stubGlobal('indexedDB', factory);
});

describe('backoffDelay', () => {
	it('grows exponentially and never exceeds the 30s cap', () => {
		const no_jitter = () => 1;
		expect(backoffDelay(1, no_jitter)).toBe(1_000);
		expect(backoffDelay(2, no_jitter)).toBe(2_000);
		expect(backoffDelay(3, no_jitter)).toBe(4_000);
		expect(backoffDelay(6, no_jitter)).toBe(32_000 > BACKOFF_CAP_MS ? 30_000 : 32_000);
		for (let attempts = 1; attempts <= 40; attempts++) {
			expect(backoffDelay(attempts, no_jitter)).toBeLessThanOrEqual(BACKOFF_CAP_MS);
		}
	});

	it('applies jitter in [0.5, 1) of the deterministic delay', () => {
		expect(backoffDelay(3, () => 0)).toBe(2_000);
		expect(backoffDelay(3, () => 1)).toBe(4_000);
		expect(backoffDelay(3, () => 0.5)).toBe(3_000);
	});
});

describe('Outbox draining', () => {
	it('drains in seq order, one at a time, and empties the queue', async () => {
		const h = await createHarness();
		await h.outbox.enqueue(row({ op_id: 'a', operation: 'create', id: 'i1' }));
		await h.outbox.enqueue(row({ op_id: 'b', id: 'i1' }));
		await h.outbox.enqueue(row({ op_id: 'c', operation: 'delete', id: 'i2' }));

		await h.outbox.drain();

		expect(h.sent.map((r) => r.op_id)).toEqual(['a', 'b', 'c']);
		expect(h.sent.map((r) => r.seq)).toEqual([1, 2, 3]);
		expect(await h.outbox.pending()).toEqual([]);
		expect(h.outbox.snapshot()).toMatchObject({
			pending_count: 0,
			sync_state: 'synced',
		});
	});

	it('assigns a monotonic seq across worker restarts', async () => {
		const db_name = 'outbox-restart';
		const first = await createHarness(db_name);
		await first.outbox.enqueue(row({ op_id: 'a' }));
		await first.outbox.enqueue(row({ op_id: 'b' }));
		first.outbox.stop();
		first.db.close();

		// A brand-new Outbox over the same database — the worker restarting.
		const second = await createHarness(db_name);
		const enqueued = await second.outbox.enqueue(row({ op_id: 'c' }));
		expect(enqueued.seq).toBe(3);

		const queued = await second.outbox.pending();
		expect(queued.map((r) => r.op_id)).toEqual(['a', 'b', 'c']);
		expect(second.outbox.snapshot().pending_count).toBe(3);
	});

	it('stops the whole queue on a retryable failure and retries after the backoff', async () => {
		const h = await createHarness();
		await h.outbox.enqueue(row({ op_id: 'a' }));
		await h.outbox.enqueue(row({ op_id: 'b', id: 'other' }));

		let offline = true;
		h.reply(() => (offline ? { ok: false, retry: true } : { ok: true }));

		await h.outbox.drain();

		// `b` was never attempted: it may depend on `a`, and while offline it
		// would fail anyway.
		expect(h.sent.map((r) => r.op_id)).toEqual(['a']);
		expect(h.outbox.snapshot()).toMatchObject({
			pending_count: 2,
			sync_state: 'offline',
		});

		// Too early — the row is not due yet.
		await h.clock.advance(500);
		expect(h.sent.map((r) => r.op_id)).toEqual(['a']);

		offline = false;
		await h.clock.advance(1_000);
		expect(h.sent.map((r) => r.op_id)).toEqual(['a', 'a', 'b']);
		expect(await h.outbox.pending()).toEqual([]);
		expect(h.outbox.snapshot().sync_state).toBe('synced');
	});

	it('caps the retry delay at 30s however long the outage lasts', async () => {
		const h = await createHarness();
		await h.outbox.enqueue(row({ op_id: 'a' }));
		h.reply(() => ({ ok: false, retry: true }));

		await h.outbox.drain();
		// 12 more attempts: uncapped this would be 2^12 = 4096 seconds.
		for (let i = 0; i < 12; i++) await h.clock.advance(BACKOFF_CAP_MS);
		expect(h.sent.length).toBe(13);

		const [queued] = await h.outbox.pending();
		expect(queued.attempts).toBe(13);
		expect(queued.next_attempt_at - h.clock.now).toBeLessThanOrEqual(BACKOFF_CAP_MS);
	});
});

describe('Outbox failures', () => {
	it('moves a 4xx to the failed store, fires the hook, and never retries it', async () => {
		const h = await createHarness();
		await h.outbox.enqueue(row({ op_id: 'bad' }));
		h.reply(() => ({
			ok: false,
			retry: false,
			error: { message: 'Nope', status: 422, code: 'invalid' },
		}));

		await h.outbox.drain();
		expect(h.sent.length).toBe(1);
		expect(h.failed_events).toEqual(['bad']);
		expect(await h.outbox.pending()).toEqual([]);

		const [failed] = h.outbox.failed();
		expect(failed).toMatchObject({
			op_id: 'bad',
			reason: 'rejected',
			error: { status: 422, code: 'invalid' },
		});
		expect(h.outbox.snapshot().sync_state).toBe('error');

		// No timer is armed, and another drain does not re-send it.
		await h.clock.advance(BACKOFF_CAP_MS * 4);
		expect(h.sent.length).toBe(1);
	});

	it('fails later mutations on the SAME row, and keeps draining unrelated ones', async () => {
		const h = await createHarness();
		await h.outbox.enqueue(row({ op_id: 'a1', operation: 'create', id: 'doomed' }));
		await h.outbox.enqueue(row({ op_id: 'a2', id: 'doomed' }));
		await h.outbox.enqueue(row({ op_id: 'b1', id: 'healthy' }));
		await h.outbox.enqueue(row({ op_id: 'a3', id: 'doomed' }));

		h.reply((queued) =>
			queued.id === 'doomed' && queued.op_id === 'a1'
				? {
						ok: false,
						retry: false,
						error: { message: 'rejected', status: 403 },
					}
				: { ok: true },
		);

		await h.outbox.drain();

		// Only `a1` was ever attempted from the doomed row; `b1` still went.
		expect(h.sent.map((r) => r.op_id)).toEqual(['a1', 'b1']);
		expect(h.failed_events).toEqual(['a1', 'a2', 'a3']);
		expect(h.outbox.failed().map((f) => f.reason)).toEqual([
			'rejected',
			'dependency_failed',
			'dependency_failed',
		]);
		expect(await h.outbox.pending()).toEqual([]);
	});

	it('retryFailed re-queues at the back of the queue, keeping its op_id', async () => {
		const h = await createHarness();
		await h.outbox.enqueue(row({ op_id: 'bad' }));
		h.reply(() => ({
			ok: false,
			retry: false,
			error: { message: 'no', status: 400 },
		}));
		await h.outbox.drain();

		// Something else queued while the failure sat there.
		h.reply(() => ({ ok: true }));
		await h.outbox.enqueue(row({ op_id: 'later', id: 'other' }));

		expect(await h.outbox.retryFailed('bad')).toBe(true);
		const order = (await h.outbox.pending()).map((r) => r.op_id);
		expect(order).toEqual(['later', 'bad']);

		await h.outbox.drain();
		expect(h.sent.map((r) => r.op_id)).toEqual(['bad', 'later', 'bad']);
		expect(h.outbox.failed()).toEqual([]);
		expect(h.outbox.snapshot().sync_state).toBe('synced');
	});

	it('discardFailed drops it permanently and clears the error state', async () => {
		const h = await createHarness();
		await h.outbox.enqueue(row({ op_id: 'bad' }));
		h.reply(() => ({
			ok: false,
			retry: false,
			error: { message: 'no', status: 400 },
		}));
		await h.outbox.drain();
		expect(h.outbox.snapshot().sync_state).toBe('error');

		expect(await h.outbox.discardFailed('bad')).toBe(true);
		expect(await h.outbox.discardFailed('bad')).toBe(false);
		expect(h.outbox.failed()).toEqual([]);
		expect(h.outbox.snapshot().sync_state).toBe('synced');
	});

	it('a failed row survives a restart in the failed store, not the queue', async () => {
		const db_name = 'outbox-failed-restart';
		const first = await createHarness(db_name);
		await first.outbox.enqueue(row({ op_id: 'bad' }));
		first.reply(() => ({
			ok: false,
			retry: false,
			error: { message: 'no', status: 400 },
		}));
		await first.outbox.drain();
		first.outbox.stop();
		first.db.close();

		const second = await createHarness(db_name);
		expect(await second.outbox.pending()).toEqual([]);
		expect(second.outbox.failed().map((f) => f.op_id)).toEqual(['bad']);
		expect(second.outbox.snapshot().sync_state).toBe('error');
	});
});

describe('Outbox scheduling', () => {
	it('drains on the idle tick without any other trigger', async () => {
		const h = await createHarness();
		h.outbox.start();
		await h.outbox.enqueue(row({ op_id: 'a' }));
		// Nothing has called drain() — only the interval will.
		expect(h.sent.length).toBe(0);

		await h.clock.advance(30_000);
		expect(h.sent.map((r) => r.op_id)).toEqual(['a']);
		h.outbox.stop();
	});

	it('stop() disarms the tick', async () => {
		const h = await createHarness();
		h.outbox.start();
		h.outbox.stop();
		await h.outbox.enqueue(row({ op_id: 'a' }));
		await h.clock.advance(120_000);
		expect(h.sent.length).toBe(0);
	});
});
