// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { Database } from '../schema/schema';
import { createDurableObjectState } from '../search/__tests__/sqlite_harness';
import { createDatabaseHandle } from '../server/database.handler';
import type { OutboxScheduler } from './database.outbox';

// The whole offline path, end to end and unmocked: the real DatabaseWorker over
// `fake-indexeddb`, its fetches routed through the REAL SvelteKit handler into
// a REAL DatabaseServer over real SQLite. Only the network is a function call
// instead of a socket — which is precisely what lets a test "go offline".

vi.mock('cloudflare:workers', () => {
	class DurableObject {
		constructor(
			public ctx: any,
			public env: any,
		) {}
	}
	return { DurableObject };
});

vi.mock('comlink', () => ({ expose: vi.fn(), proxy: (value: unknown) => value }));

const itemTable = Database.table('item', (s) => ({
	id: s.primaryKey(),
	name: s.string().searchable(),
	rank: s.number().optional(),
}));

const tables = { item: itemTable as unknown as Database.Table };

const open_states: ReturnType<typeof createDurableObjectState>[] = [];

afterEach(() => {
	while (open_states.length) open_states.pop()?.close();
});

async function createTestServer() {
	const { DatabaseServer } = await import('../server/db.server');
	const state = createDurableObjectState();
	open_states.push(state);
	const db = new DatabaseServer(
		tables,
		() => undefined,
		state.ctx as any,
		{
			DEV: true,
		} as any,
	);
	return db;
}

/* -------------------------------------------------------------------------- */
/* The "network"                                                              */
/* -------------------------------------------------------------------------- */

interface Network {
	fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
	/** Every request that actually reached the server: `METHOD /path`. */
	log: string[];
	online: boolean;
	/** Force a status for the next matching request (a 4xx, a 500). */
	reject:
		| ((method: string, path: string, body: string | undefined) => number | undefined)
		| null;
	/**
	 * Let a request reach the server and commit, then lose the response on the
	 * way back — the case `op_id` exists for. The client cannot tell it apart
	 * from a request that never arrived, so it retries.
	 */
	swallow: ((method: string, path: string) => boolean) | null;
}

/**
 * Route the worker's fetches through `createDatabaseHandle` into a real
 * `DatabaseServer`. `online = false` throws the same `TypeError` a browser
 * throws with no network.
 */
function createNetwork(server: Awaited<ReturnType<typeof createTestServer>>): Network {
	const handle = createDatabaseHandle({
		getDatabase: () => server as never,
		tables,
		requireAuth: false,
	});

	const network: Network = {
		log: [],
		online: true,
		reject: null,
		swallow: null,
		fetch: async (input, init) => {
			const path = String(input);
			const method = init?.method ?? 'GET';
			if (!network.online) throw new TypeError('Failed to fetch');

			const body = typeof init?.body === 'string' ? init.body : undefined;
			const forced = network.reject?.(method, path, body);
			if (forced !== undefined) {
				return new Response(JSON.stringify({ message: 'forced', code: 'forced' }), {
					status: forced,
					headers: { 'content-type': 'application/json' },
				});
			}

			network.log.push(`${method} ${path}`);
			const url = new URL(path, 'http://localhost');
			const request = new Request(url, init as RequestInit);
			const event = {
				url,
				request,
				locals: {},
			} as unknown as RequestEvent;
			const response = await handle({
				event,
				resolve: async () => new Response('not found', { status: 404 }),
			} as never);
			// The write has committed by now; only the reply is lost.
			if (network.swallow?.(method, path)) throw new TypeError('Failed to fetch');
			return response;
		},
	};
	return network;
}

/* -------------------------------------------------------------------------- */
/* The worker                                                                 */
/* -------------------------------------------------------------------------- */

/** A clock/timer the test drives, so no backoff is ever waited out for real. */
function createScheduler() {
	let now = 2_000_000;
	let next_handle = 1;
	const timers = new Map<number, { at: number; fn: () => void }>();
	const scheduler: OutboxScheduler = {
		now: () => now,
		setTimeout: (fn, delay_ms) => {
			const handle = next_handle++;
			timers.set(handle, { at: now + delay_ms, fn });
			return handle;
		},
		clearTimeout: (handle) => void timers.delete(handle as number),
		random: () => 1,
	};
	return {
		scheduler,
		async advance(ms: number, settle: () => Promise<void>): Promise<void> {
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
				await settle();
				await new Promise((resolve) => setImmediate(resolve));
			}
		},
	};
}

let database_counter = 0;
let db_name = 'offline-test-0';

/**
 * Every worker a test built. They MUST be torn down: a worker left alive keeps
 * a queue that drains through the *global* `fetch`, which the next test
 * re-stubs at its own server — the previous test's mutations would land there.
 */
const open_workers: { destroy(): Promise<void> }[] = [];

async function createWorker(scheduler?: OutboxScheduler) {
	(globalThis as any).self = { addEventListener: vi.fn() };
	const { DatabaseWorker } = await import('./database.worker');
	const worker = new DatabaseWorker();
	await worker.init({
		tables: {
			item: {
				index_schema: itemTable.config.index_schema as never,
				primary_key: 'id',
				primary_key_type: 'string',
			},
		},
		// Forced client-side search: these tests read the LOCAL index to see what
		// the optimistic layer did, and coverage-based routing would otherwise
		// send the read to a server that is (deliberately) unreachable.
		entities: { item: { search_mode: 'client' } },
		db_name,
		offline: true,
		outbox_scheduler: scheduler,
	});
	open_workers.push(worker);
	return worker;
}

/** The ids currently in the client's local search index, sorted. */
async function indexedIds(worker: any): Promise<string[]> {
	const result = await worker.list('item', { limit: 1000 });
	return result.hits.map((hit: any) => hit.id).sort();
}

const T0 = 1_750_000_000_000;

describe('DatabaseWorker offline outbox', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(T0);
		database_counter += 1;
		db_name = `offline-test-${database_counter}`;
	});

	afterEach(async () => {
		while (open_workers.length) await open_workers.pop()?.destroy();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('replays every offline mutation exactly once, in order, after a worker restart', async () => {
		const server = await createTestServer();
		const network = createNetwork(server);
		vi.stubGlobal('fetch', network.fetch);
		network.online = false;

		const clock = createScheduler();
		let worker = await createWorker(clock.scheduler);

		// ── Airplane mode ────────────────────────────────────────────────────
		const first = await worker.create('item', { name: 'alpha', rank: 1 });
		const second = await worker.create('item', { name: 'beta', rank: 2 });
		await worker.update('item', first.id as string, { name: 'alpha renamed' });
		await worker.update('item', first.id as string, { rank: 10 });
		await worker.delete('item', second.id as string);

		// The ids were minted locally, so they are stable from this moment on.
		expect(typeof first.id).toBe('string');
		// Everything is visible locally already.
		expect(await indexedIds(worker)).toEqual([first.id]);
		expect(worker.outboxSnapshot()).toMatchObject({
			pending_count: 5,
			sync_state: 'offline',
		});
		// Nothing reached the server.
		expect(server.list('item', { limit: 10 }).count).toBe(0);

		// ── Hard reload: a brand-new worker over the same IndexedDB ──────────
		await worker.destroy();
		// The SAME clock: a reload does not rewind wall time, and the persisted
		// `next_attempt_at` of the rows that already failed is expressed in it.
		worker = await createWorker(clock.scheduler);
		expect(worker.outboxSnapshot()?.pending_count).toBe(5);
		// The optimistic state survived the reload too.
		expect(await indexedIds(worker)).toEqual([first.id]);

		// ── Reconnect ────────────────────────────────────────────────────────
		network.online = true;
		await clock.advance(60_000, () => worker.drainOutbox());
		await worker.drainOutbox();

		expect(worker.outboxSnapshot()).toMatchObject({
			pending_count: 0,
			failed: [],
			sync_state: 'synced',
		});

		// Exactly once, in order.
		expect(network.log).toEqual([
			'POST /api/item',
			'POST /api/item',
			`PATCH /api/item/${first.id}`,
			`PATCH /api/item/${first.id}`,
			`DELETE /api/item/${second.id}`,
		]);

		// And the server's state is what the offline session described.
		expect(server.list('item', { limit: 10 }).count).toBe(1);
		expect(server.get('item', first.id as string)).toMatchObject({
			id: first.id,
			name: 'alpha renamed',
			rank: 10,
		});
	});

	it('an identical op_id replay is a no-op end to end', async () => {
		const server = await createTestServer();
		const network = createNetwork(server);
		vi.stubGlobal('fetch', network.fetch);
		const worker = await createWorker(createScheduler().scheduler);

		const created = await worker.create('item', { name: 'once' });
		await worker.drainOutbox();
		expect(server.list('item', { limit: 10 }).count).toBe(1);

		// Re-send the very request the outbox sent, byte for byte.
		const sent = network.log.length;
		const op_id = 'replayed-op';
		const body = JSON.stringify({ id: `${created.id}-twin`, name: 'once' });
		const headers = { 'content-type': 'application/json', 'Operation-ID': op_id };
		const one = await network.fetch('/api/item', { method: 'POST', headers, body });
		const two = await network.fetch('/api/item', { method: 'POST', headers, body });

		expect(one.status).toBe(200);
		expect(two.status).toBe(200);
		expect(await two.json()).toEqual(await one.json());
		expect(network.log.length).toBe(sent + 2); // both requests were made
		expect(server.list('item', { limit: 10 }).count).toBe(2); // only one row added
	});

	it('a lost response is retried and still lands exactly once', async () => {
		const server = await createTestServer();
		const network = createNetwork(server);
		vi.stubGlobal('fetch', network.fetch);
		const clock = createScheduler();
		const worker = await createWorker(clock.scheduler);
		const failures: string[] = [];
		await worker.subscribeOutbox(
			() => {},
			(operation) => failures.push(`${operation.operation}:${operation.reason}`),
		);

		// The first POST commits on the server and then the reply is lost. The
		// client has no way to know it landed, so the drain retries the row —
		// with the same `op_id`, which is the only thing standing between this
		// and a duplicate row. It also pins the header name: the id has to
		// survive the trip the client actually makes, not one a test builds.
		let swallowed = false;
		network.swallow = (method) => {
			if (method !== 'POST' || swallowed) return false;
			swallowed = true;
			return true;
		};

		await worker.create('item', { name: 'exactly once' });
		await worker.drainOutbox();
		await clock.advance(60_000, () => worker.drainOutbox());

		expect(swallowed).toBe(true);
		expect(network.log.filter((entry) => entry.startsWith('POST')).length).toBe(2);
		expect(server.list('item', { limit: 10 }).count).toBe(1);
		expect(worker.outboxSnapshot()?.pending_count).toBe(0);
		// One row could also mean the retry was REJECTED as a duplicate id —
		// which is what happens if the `op_id` never reaches the server. The
		// retry has to have been recognised and answered, not refused.
		expect(failures).toEqual([]);
		expect(worker.outboxSnapshot()?.failed ?? []).toEqual([]);
	});

	it('a 4xx moves the mutation to the failed store and is never retried', async () => {
		const server = await createTestServer();
		const network = createNetwork(server);
		vi.stubGlobal('fetch', network.fetch);

		const failures: string[] = [];
		const clock = createScheduler();
		const worker = await createWorker(clock.scheduler);
		await worker.subscribeOutbox(
			() => {},
			(operation) => failures.push(`${operation.operation}:${operation.reason}`),
		);

		// Queue everything BEFORE the server gets a say, the way an offline
		// session does — that is the only situation in which one rejection has
		// dependants to take with it.
		network.online = false;
		const doomed = await worker.create('item', { name: 'invalid' });
		await worker.update('item', doomed.id as string, { name: 'still invalid' });
		const healthy = await worker.create('item', { name: 'fine' });

		// Reconnect into a server that rejects the doomed row's create.
		network.online = true;
		network.reject = (method, _path, body) =>
			method === 'POST' && body?.includes('invalid') ? 422 : undefined;
		await clock.advance(60_000, () => worker.drainOutbox());
		await worker.drainOutbox();

		expect(failures).toEqual(['create:rejected', 'update:dependency_failed']);
		const snapshot = worker.outboxSnapshot()!;
		expect(snapshot.sync_state).toBe('error');
		expect(snapshot.failed.map((f) => f.error.status)).toEqual([422, 409]);
		expect(snapshot.pending_count).toBe(0);

		// The unrelated row still landed, and no amount of time retries the
		// rejected one.
		expect(server.list('item', { limit: 10 }).hits.map((h: any) => h.id)).toEqual([
			healthy.id,
		]);
		const attempts = network.log.length;
		await clock.advance(300_000, () => worker.drainOutbox());
		expect(network.log.length).toBe(attempts);
	});

	it('treats a 404 on a queued delete as success, not as a rejection', async () => {
		const server = await createTestServer();
		const network = createNetwork(server);
		vi.stubGlobal('fetch', network.fetch);
		const clock = createScheduler();
		const worker = await createWorker(clock.scheduler);

		const created = await worker.create('item', { name: 'gone' });
		await worker.drainOutbox();

		// The row disappeared some other way — another device, or a replay whose
		// op-log entry aged out. Re-sending cannot bring it back, and the desired
		// state already holds, so this must not sit in `failed` forever.
		network.reject = (method) => (method === 'DELETE' ? 404 : undefined);
		await worker.delete('item', created.id as string);
		await clock.advance(60_000, () => worker.drainOutbox());
		await worker.drainOutbox();

		expect(worker.outboxSnapshot()).toMatchObject({
			pending_count: 0,
			failed: [],
			sync_state: 'synced',
		});
	});

	it('retries a 5xx with backoff instead of failing it', async () => {
		const server = await createTestServer();
		const network = createNetwork(server);
		vi.stubGlobal('fetch', network.fetch);
		const clock = createScheduler();
		const worker = await createWorker(clock.scheduler);

		let broken = true;
		network.reject = () => (broken ? 503 : undefined);
		await worker.create('item', { name: 'eventually' });
		await worker.drainOutbox();

		expect(worker.outboxSnapshot()).toMatchObject({
			pending_count: 1,
			failed: [],
			sync_state: 'offline',
		});

		broken = false;
		await clock.advance(60_000, () => worker.drainOutbox());
		await worker.drainOutbox();
		expect(worker.outboxSnapshot()).toMatchObject({
			pending_count: 0,
			sync_state: 'synced',
		});
		expect(server.list('item', { limit: 10 }).count).toBe(1);
	});

	it('a sync() pull does not erase mutations that are still queued', async () => {
		const server = await createTestServer();
		const network = createNetwork(server);
		vi.stubGlobal('fetch', network.fetch);

		// A row that already exists on the server and in the client index.
		vi.setSystemTime(T0);
		const existing = server.create('item', { name: 'server name' });
		const clock = createScheduler();
		const worker = await createWorker(clock.scheduler);
		await worker.sync();
		expect(await indexedIds(worker)).toEqual([existing.id as string]);

		// Go offline and edit it, plus create something new.
		network.online = false;
		vi.setSystemTime(T0 + 5_000);
		await worker.update('item', existing.id as string, { name: 'my offline edit' });
		const fresh = await worker.create('item', { name: 'offline creation' });

		// A sync while the queue is still full. The server knows neither change.
		network.online = true;
		vi.setSystemTime(T0 + 10_000);
		server.update('item', existing.id as string, { rank: 3 });
		await worker.sync();

		// The optimistic edit is still there, layered over the synced page…
		const hits = await worker.list('item', { limit: 10 });
		const edited = hits.hits.find((hit: any) => hit.id === existing.id);
		expect((edited!.document as any).name).toBe('my offline edit');
		// …and the offline creation was not swept away by a page that lacks it.
		expect(await indexedIds(worker)).toEqual(
			[existing.id as string, fresh.id as string].sort(),
		);

		// Draining then reconciles everything with the server.
		await clock.advance(60_000, () => worker.drainOutbox());
		await worker.drainOutbox();
		expect(server.get('item', existing.id as string).name).toBe('my offline edit');
		expect(server.list('item', { limit: 10 }).count).toBe(2);
	});

	it('refuses an offline create on a table whose primary key is numeric', async () => {
		const server = await createTestServer();
		vi.stubGlobal('fetch', createNetwork(server).fetch);
		(globalThis as any).self = { addEventListener: vi.fn() };
		const { DatabaseWorker } = await import('./database.worker');
		const worker = new DatabaseWorker();
		await worker.init({
			tables: {
				item: {
					index_schema: itemTable.config.index_schema as never,
					primary_key: 'id',
					primary_key_type: 'number',
				},
			},
			db_name: `${db_name}-numeric`,
			offline: true,
		});

		await expect(worker.create('item', { name: 'nope' })).rejects.toMatchObject({
			status: 400,
		});
	});
});
