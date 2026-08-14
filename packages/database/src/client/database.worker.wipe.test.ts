// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Database } from '../schema/schema';
import { createDurableObjectState } from '../search/__tests__/sqlite_harness';

// Sign-out data wipe tests. Same harness as database.worker.test.ts: the
// worker's fetch('/api/sync') is bridged to a REAL DatabaseServer and
// IndexedDB is `fake-indexeddb`. The contract under test is freeze-then-wipe:
// after `wipe()` NOTHING searchable remains on disk, and NO subscriber
// callback may fire between the wipe and the app's navigation away — no
// late-arriving sync page, no peer worker, nothing.

vi.mock('cloudflare:workers', () => {
	class DurableObject {
		constructor(
			public ctx: any,
			public env: any,
		) {}
	}
	return { DurableObject };
});

vi.mock('comlink', () => ({ expose: vi.fn() }));

// ── Reading the worker's IndexedDB from the outside ─────────────────────────

/** Unique database names, so no two tests can ever share state. */
let database_counter = 0;
let db_name = 'wipe-test-0';

function openRaw(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(db_name);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/** Every `[key, value]` of one out-of-line-keyed store, as a Map. */
async function readStore(store: string): Promise<Map<string, unknown>> {
	const db = await openRaw();
	if (!db.objectStoreNames.contains(store)) {
		db.close();
		return new Map();
	}
	const txn = db.transaction(store, 'readonly');
	const object_store = txn.objectStore(store);
	const entries = await new Promise<Map<string, unknown>>((resolve, reject) => {
		const keys_request = object_store.getAllKeys();
		const values_request = object_store.getAll();
		txn.oncomplete = () => {
			const map = new Map<string, unknown>();
			(keys_request.result as IDBValidKey[]).forEach((key, index) => {
				map.set(String(key), values_request.result[index]);
			});
			resolve(map);
		};
		txn.onerror = () => reject(txn.error);
	});
	db.close();
	return entries;
}

/** Whether the worker's database currently exists at all. */
async function databaseExists(): Promise<boolean> {
	const databases = await (
		indexedDB as IDBFactory & { databases: () => Promise<{ name?: string }[]> }
	).databases();
	return databases.some((entry) => entry.name === db_name);
}

/** Seed a row into the entity cache the way a previous `get()` would have. */
async function writeEntityCache(key: string, value: unknown): Promise<void> {
	const db = await openRaw();
	const txn = db.transaction('entities', 'readwrite');
	txn.objectStore('entities').put(value, key);
	await new Promise<void>((resolve, reject) => {
		txn.oncomplete = () => resolve();
		txn.onerror = () => reject(txn.error);
	});
	db.close();
}

const itemTable = Database.table('item', (s) => ({
	id: s.primaryKey(),
	name: s.string().searchable(),
}));

/** Every server built by a test, closed after it. */
const open_states: ReturnType<typeof createDurableObjectState>[] = [];

afterEach(() => {
	while (open_states.length) open_states.pop()?.close();
});

async function createTestServer() {
	const { DatabaseServer } = await import('../server/db.server');
	const state = createDurableObjectState();
	open_states.push(state);
	return new DatabaseServer(
		{ item: itemTable as unknown as Database.Table },
		() => undefined,
		state.ctx as any,
		{
			DEV: true,
		} as any,
	);
}

/** Bridges the worker's fetch('/api/sync') calls to a real server instance. */
function bridgeFetchToServer(
	server: { sync: (q?: any) => any },
	options: { fail?: () => boolean } = {},
) {
	return vi.fn(async (input: string | URL, init?: RequestInit) => {
		const url = String(input);
		if (options.fail?.()) throw new TypeError('Failed to fetch');
		if (!url.startsWith('/api/sync')) {
			return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
		}
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		const result = server.sync(body);
		return new Response(JSON.stringify(result), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	});
}

async function createWorker() {
	// The worker module expects a worker global scope on import
	(globalThis as any).self = { addEventListener: vi.fn() };
	const { DatabaseWorker } = await import('./database.worker');
	const worker = new DatabaseWorker();
	await worker.init({
		tables: {
			item: {
				index_schema: itemTable.config.index_schema as never,
				primary_key: 'id',
			},
		},
		db_name,
	});
	return worker;
}

async function searchAllIds(worker: any): Promise<string[]> {
	const result = await worker.list('item', { limit: 1000 });
	return result.hits.map((h: any) => h.id).sort();
}

/** A macrotask turn — flushes queued microtask notifications and timers. */
function tick(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

const T0 = 1_750_000_000_000;

describe('DatabaseWorker.wipe() — sign-out data wipe', () => {
	beforeEach(() => {
		// Only `Date` is faked: `fake-indexeddb` drives its transactions on real
		// timers, and faking those would stall every IDB request forever.
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(T0);
		database_counter += 1;
		db_name = `wipe-test-${database_counter}`;
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('deletes the IndexedDB database — entity cache, sync_meta, and postings are gone', async () => {
		const server = await createTestServer();
		const a = server.create('item', { name: 'searchable secret' });
		vi.stubGlobal('fetch', bridgeFetchToServer(server));

		const worker = await createWorker();
		await worker.sync();
		await writeEntityCache(`item/${a.id}`, {
			entity_type: 'item',
			id: a.id,
			data: a,
			updated_at: T0,
		});

		// Preconditions: data IS on disk before the wipe.
		expect((await readStore('sync_meta')).size).toBeGreaterThan(0);
		expect((await readStore('docs')).size).toBeGreaterThan(0);
		expect((await readStore('entities')).size).toBeGreaterThan(0);
		expect(await databaseExists()).toBe(true);

		await worker.wipe();

		// The whole database (one per db_name — entity cache, sync_meta, and
		// all search postings stores live in it) is deleted from disk.
		expect(await databaseExists()).toBe(false);
		// Reopening yields a fresh empty database: every store is gone.
		for (const store of ['entities', 'sync_meta', 'docs', 'postings', 'tokens']) {
			expect((await readStore(store)).size).toBe(0);
		}
	});

	it('fires NO subscriber callback during the wipe — pre-wipe results are retained', async () => {
		const server = await createTestServer();
		server.create('item', { name: 'alpha' });
		server.create('item', { name: 'beta' });
		vi.stubGlobal('fetch', bridgeFetchToServer(server));

		const worker = await createWorker();
		await worker.sync();

		// A live subscription — the stand-in for a ListHandle's displayed hits.
		const results: any[] = [];
		await worker.subscribe('item', { limit: 100 }, (result: any) => {
			results.push(result);
		});
		await tick();
		const calls_before = results.length;
		expect(calls_before).toBeGreaterThan(0);
		const hits_before = results[results.length - 1].hits.length;
		expect(hits_before).toBe(2);

		await worker.wipe();
		await tick();
		await tick();

		// The callback was NOT invoked again; the last delivered result still
		// holds the pre-signOut hits (nothing told the UI to blank the list).
		expect(results.length).toBe(calls_before);
		expect(results[results.length - 1].hits.length).toBe(hits_before);
	});

	it('an in-flight sync resolving after wipe() writes nothing and notifies no one', async () => {
		const server = await createTestServer();
		server.create('item', { name: 'first' });
		vi.stubGlobal('fetch', bridgeFetchToServer(server));

		const worker = await createWorker();
		await worker.sync();

		const results: any[] = [];
		await worker.subscribe('item', { limit: 100 }, (result: any) => {
			results.push(result);
		});
		await tick();
		const calls_before = results.length;

		// A new server row, and a sync whose fetch is gated open mid-flight.
		vi.setSystemTime(T0 + 60_000);
		server.create('item', { name: 'late arrival' });
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const base_fetch = bridgeFetchToServer(server);
		const gated_fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
			const response = await base_fetch(input, init);
			await gate;
			return response;
		});
		vi.stubGlobal('fetch', gated_fetch);

		const sync_promise = worker.sync();
		// Wait until the sync request is actually in flight.
		await vi.waitFor(() => expect(gated_fetch).toHaveBeenCalled());

		// Wipe while the sync response is pending; then let the fetch resolve.
		const wipe_promise = worker.wipe();
		release();
		await wipe_promise;
		await sync_promise;
		await tick();
		await tick();

		// The resolved page was dropped: no write landed, no callback fired.
		expect(results.length).toBe(calls_before);
		expect(await databaseExists()).toBe(false);
		expect((await readStore('docs')).size).toBe(0);
	});

	it('an in-flight get() resolving after wipe() re-caches nothing and stays silent', async () => {
		const server = await createTestServer();
		const a = server.create('item', { name: 'to fetch' });

		const worker_setup_fetch = bridgeFetchToServer(server);
		vi.stubGlobal('fetch', worker_setup_fetch);
		const worker = await createWorker();
		await worker.sync();

		const results: any[] = [];
		await worker.subscribe('item', { limit: 100 }, (result: any) => {
			results.push(result);
		});
		await tick();
		const calls_before = results.length;

		// Gate a single-entity GET so it resolves only after the wipe.
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL) => {
				const url = String(input);
				if (url === `/api/item/${a.id}`) {
					await gate;
					return new Response(JSON.stringify(a), {
						status: 200,
						headers: { 'content-type': 'application/json' },
					});
				}
				return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
			}),
		);

		const get_promise = worker.get('item', a.id as string, true);
		await worker.wipe();
		release();
		// The promise still resolves (the caller's frozen handle drops it) …
		await expect(get_promise).resolves.toBeTruthy();
		await tick();
		await tick();

		// … but nothing was re-cached to disk and no subscriber was notified.
		expect(results.length).toBe(calls_before);
		expect((await readStore('entities')).size).toBe(0);
		expect((await readStore('docs')).size).toBe(0);
	});

	it('init() after wipe() brings the worker back — a fresh sync repopulates', async () => {
		const server = await createTestServer();
		const ids: string[] = [];
		for (let i = 0; i < 3; i++) {
			vi.setSystemTime(T0 + i * 1000);
			ids.push(server.create('item', { name: `item ${i}` }).id as string);
		}
		vi.stubGlobal('fetch', bridgeFetchToServer(server));

		const worker = await createWorker();
		await worker.sync();
		await worker.wipe();
		expect(await databaseExists()).toBe(false);

		// Fresh sign-in: init() un-wipes, sync repopulates from scratch.
		await worker.init({
			tables: {
				item: {
					index_schema: itemTable.config.index_schema as never,
					primary_key: 'id',
				},
			},
			db_name,
		});
		await worker.sync();

		expect(await searchAllIds(worker)).toEqual([...ids].sort());
		expect((await worker.list('item', { limit: 1 })).mode).toBe('client');
		expect((await readStore('docs')).size).toBeGreaterThan(0);

		// Subscriptions work again after the round-trip.
		const results: any[] = [];
		await worker.subscribe('item', { limit: 100 }, (result: any) => {
			results.push(result);
		});
		await tick();
		expect(results.length).toBeGreaterThan(0);
		expect(results[results.length - 1].hits.length).toBe(3);
	});

	it('a peer worker over the same database drops silently on the wipe broadcast', async () => {
		const server = await createTestServer();
		server.create('item', { name: 'shared row' });
		vi.stubGlobal('fetch', bridgeFetchToServer(server));

		// Two dedicated-Worker peers over ONE IndexedDB database.
		const worker_a = await createWorker();
		await worker_a.sync();
		const worker_b = await createWorker();

		const peer_results: any[] = [];
		await worker_b.subscribe('item', { limit: 100 }, (result: any) => {
			peer_results.push(result);
		});
		await tick();
		const calls_before = peer_results.length;
		expect(calls_before).toBeGreaterThan(0);

		// Peer B holds an open connection — the wipe must still complete (the
		// deleteDatabase-fired versionchange releases B's connection).
		await worker_a.wipe();
		expect(await databaseExists()).toBe(false);

		// Give the BroadcastChannel 'wiped' message time to deliver.
		await tick();
		await new Promise((resolve) => setTimeout(resolve, 25));

		// B's subscribers were NOT notified (its tab is signing out too, same
		// no-flash rule), and its in-memory entity state is gone.
		expect(peer_results.length).toBe(calls_before);
		await expect(worker_b.list('item', { limit: 1 })).rejects.toThrow();

		await worker_b.destroy();
		await worker_a.destroy();
	});
});
