// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Database } from '../schema/schema';
import { createDurableObjectState } from '../search/__tests__/sqlite_harness';

// These tests run the REAL client sync protocol against a REAL DatabaseServer
// (real schema, real search engine) — fetch is bridged straight to the server
// instance and IndexedDB is `fake-indexeddb`, the same in-process IDB the
// client driver's own tests use. Nothing about the storage layer is mocked, so
// the client/server pagination contract AND the index/cursor atomicity it
// depends on are both exercised end to end.

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
let db_name = 'worker-test-0';

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

/** The `String(primary key)`s currently in the client index, sorted. */
async function indexedIds(entity_type: string): Promise<string[]> {
	const db = await openRaw();
	if (!db.objectStoreNames.contains('docs')) {
		db.close();
		return [];
	}
	const txn = db.transaction('docs', 'readonly');
	const request = txn.objectStore('docs').getAllKeys();
	const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
		txn.oncomplete = () => resolve(request.result as IDBValidKey[]);
		txn.onerror = () => reject(txn.error);
	});
	db.close();
	return keys
		.map((key) => key as [string, string])
		.filter(([type]) => type === entity_type)
		.map(([, doc_id]) => doc_id)
		.sort();
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

/**
 * Bridges the worker's fetch('/api/sync') calls to a real server instance.
 * `page_limit` mimics server-side page truncation so pagination is exercised
 * without creating 5000+ rows.
 */
function bridgeFetchToServer(
	server: { sync: (q?: any) => any },
	options: { page_limit?: number; fail?: () => boolean } = {},
) {
	return vi.fn(async (input: string | URL, init?: RequestInit) => {
		const url = String(input);
		if (options.fail?.()) throw new TypeError('Failed to fetch');
		if (!url.startsWith('/api/sync')) {
			return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
		}
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		// The sync protocol carries ranges/limits per entity — no top-level limit.
		if (options.page_limit) {
			for (const entity of Object.values(
				(body.entity ?? {}) as Record<string, { limit?: number }>,
			)) {
				entity.limit = options.page_limit;
			}
		}
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

const T0 = 1_750_000_000_000;

describe('DatabaseWorker.sync() against a real DatabaseServer', () => {
	beforeEach(() => {
		// Only `Date` is faked: `fake-indexeddb` drives its transactions on real
		// timers, and faking those would stall every IDB request forever.
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(T0);
		database_counter += 1;
		db_name = `worker-test-${database_counter}`;
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('initial sync loads all server documents into the client index', async () => {
		const server = await createTestServer();
		const ids: string[] = [];
		for (let i = 0; i < 7; i++) {
			vi.setSystemTime(T0 + i * 1000);
			ids.push(server.create('item', { name: `item ${i}` }).id as string);
		}
		vi.stubGlobal('fetch', bridgeFetchToServer(server));

		const worker = await createWorker();
		await worker.sync();

		expect(await searchAllIds(worker)).toEqual([...ids].sort());
		expect((await worker.list('item', { limit: 1 })).mode).toBe('client');
	});

	it('pages through a large dataset without losing or duplicating documents', async () => {
		const server = await createTestServer();
		const ids: string[] = [];
		for (let i = 0; i < 20; i++) {
			vi.setSystemTime(T0 + i * 1000);
			ids.push(server.create('item', { name: `item ${i}` }).id as string);
		}
		const fetch_mock = bridgeFetchToServer(server, { page_limit: 3 });
		vi.stubGlobal('fetch', fetch_mock);

		const worker = await createWorker();
		await worker.sync();

		expect(fetch_mock.mock.calls.length).toBeGreaterThan(1); // actually paginated
		expect(await searchAllIds(worker)).toEqual([...ids].sort());
		expect((await worker.list('item', { limit: 1 })).mode).toBe('client');
	});

	it('incremental sync picks up creates, updates, and deletes since the last run', async () => {
		const server = await createTestServer();
		const ids: string[] = [];
		for (let i = 0; i < 5; i++) {
			vi.setSystemTime(T0 + i * 1000);
			ids.push(server.create('item', { name: `item ${i}` }).id as string);
		}
		vi.stubGlobal('fetch', bridgeFetchToServer(server, { page_limit: 2 }));

		const worker = await createWorker();
		await worker.sync();
		expect(await searchAllIds(worker)).toEqual([...ids].sort());

		// Server-side changes after the initial sync
		vi.setSystemTime(T0 + 100_000);
		const created = server.create('item', { name: 'new item' });
		vi.setSystemTime(T0 + 101_000);
		server.update('item', ids[1], { name: 'renamed item' });
		vi.setSystemTime(T0 + 102_000);
		server.delete('item', ids[0]);

		await worker.sync();

		const expected = [...ids.slice(1), created.id as string].sort();
		expect(await searchAllIds(worker)).toEqual(expected);
		const renamed = await worker.list('item', { term: 'renamed', limit: 10 });
		expect(renamed.hits.some((h: any) => h.id === ids[1])).toBe(true);
	});

	it('a delete synced from the server purges the IDB entity cache', async () => {
		const server = await createTestServer();
		vi.setSystemTime(T0);
		const a = server.create('item', { name: 'cached item' });
		vi.stubGlobal('fetch', bridgeFetchToServer(server));

		const worker = await createWorker();
		await worker.sync();

		// Simulate the row being in the entity cache (e.g. from a previous get())
		await writeEntityCache(`item/${a.id}`, {
			entity_type: 'item',
			id: a.id,
			data: a,
			updated_at: T0,
		});

		vi.setSystemTime(T0 + 5000);
		server.delete('item', a.id as string);
		await worker.sync();

		expect((await readStore('entities')).has(`item/${a.id}`)).toBe(false);
		expect(await searchAllIds(worker)).toEqual([]);
	});

	it('a failed first sync stays resumable and does not mark the entity as synced', async () => {
		const server = await createTestServer();
		const ids: string[] = [];
		for (let i = 0; i < 4; i++) {
			vi.setSystemTime(T0 + i * 1000);
			ids.push(server.create('item', { name: `item ${i}` }).id as string);
		}

		let should_fail = true;
		vi.stubGlobal('fetch', bridgeFetchToServer(server, { fail: () => should_fail }));

		const worker = await createWorker();
		await worker.sync(); // network failure
		// With an incomplete window a query routes to the server (§7.6) — which is
		// still down here, so a one-shot list rejects instead of answering locally.
		await expect(worker.list('item', { limit: 1 })).rejects.toThrow();
		// Read the index directly rather than through search(): with an incomplete
		// window, a search is routed to the server by design (§7.6), and the point
		// here is that the failed sync left NOTHING indexed locally.
		expect(await indexedIds('item')).toEqual([]);

		// The persisted cursor must NOT claim the entity was synced
		const meta = (await readStore('sync_meta')).get('item') as
			| { start_updated_at?: number }
			| undefined;
		expect(meta?.start_updated_at ?? undefined).toBeUndefined();

		// Connectivity restored — the full dataset syncs
		should_fail = false;
		await worker.sync();
		expect(await searchAllIds(worker)).toEqual([...ids].sort());
		expect((await worker.list('item', { limit: 1 })).mode).toBe('client');
	});

	it('a sync interrupted mid-backfill survives a worker reload without losing documents', async () => {
		const server = await createTestServer();
		const ids: string[] = [];
		for (let i = 0; i < 12; i++) {
			vi.setSystemTime(T0 + i * 1000);
			ids.push(server.create('item', { name: `item ${i}` }).id as string);
		}

		// Let two sync pages through, then drop the connection mid-backfill
		let fetch_count = 0;
		let failing = true;
		vi.stubGlobal(
			'fetch',
			bridgeFetchToServer(server, {
				page_limit: 3,
				fail: () => failing && ++fetch_count > 2,
			}),
		);

		const worker = await createWorker();
		await worker.sync(); // network drops after 2 pages
		// The persisted cursor must not claim a complete window (`0` is the
		// backfill-complete sentinel).
		const mid_meta = (await readStore('sync_meta')).get('item') as
			| { start_updated_at?: number }
			| undefined;
		expect(mid_meta?.start_updated_at ?? -1).not.toBe(0);

		// Simulate a page refresh: a fresh worker that only has the persisted
		// IDB state. The persisted synced window must never claim documents
		// that are missing from the persisted index — they'd never be
		// refetched and would be lost permanently.
		const reloaded = await createWorker();
		failing = false;
		await reloaded.sync();

		expect(await searchAllIds(reloaded)).toEqual([...ids].sort());
		expect((await reloaded.list('item', { limit: 1 })).mode).toBe('client');
	});

	it('applyLocalPatch overlays the index without any network', async () => {
		const server = await createTestServer();
		vi.setSystemTime(T0);
		const a = server.create('item', { name: 'original name' });
		const fetch_mock = bridgeFetchToServer(server);
		vi.stubGlobal('fetch', fetch_mock);

		const worker = await createWorker();
		await worker.sync();
		const fetches_after_sync = fetch_mock.mock.calls.length;

		const applied = await worker.applyLocalPatch('item', a.id as string, {
			name: 'patched locally',
		});
		expect(applied).toBe(true);
		expect(fetch_mock.mock.calls.length).toBe(fetches_after_sync); // zero network

		const hit = await worker.list('item', { term: 'patched', limit: 10 });
		expect(hit.hits.some((h: any) => h.id === String(a.id))).toBe(true);

		// Unknown id → false, no crash.
		expect(await worker.applyLocalPatch('item', 'nope', { name: 'x' })).toBe(false);
	});

	it('changes that land while backfilling are picked up before reporting synced', async () => {
		const server = await createTestServer();
		for (let i = 0; i < 9; i++) {
			vi.setSystemTime(T0 + i * 1000);
			server.create('item', { name: `item ${i}` });
		}

		// Inject a new row on the server while the client is mid-backfill
		let injected = false;
		const base_fetch = bridgeFetchToServer(server, { page_limit: 3 });
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL, init?: RequestInit) => {
				const response = await base_fetch(input, init);
				if (!injected) {
					injected = true;
					vi.setSystemTime(T0 + 60_000);
					server.create('item', { name: 'late arrival' });
				}
				return response;
			}),
		);

		const worker = await createWorker();
		await worker.sync();

		const result = await worker.list('item', { limit: 100 });
		expect(result.count).toBe(10); // 9 originals + the late arrival
		expect(result.mode).toBe('client'); // backfill reported complete
	});
});
