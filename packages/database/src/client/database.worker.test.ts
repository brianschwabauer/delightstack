import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Database } from '../schema/schema';

// These tests run the REAL client sync protocol against a REAL DatabaseServer
// (real Orama, real schema) — fetch is bridged straight to the server instance
// and IndexedDB is replaced with an in-memory Map. This verifies the actual
// client/server pagination contract end to end.

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

// ── In-memory IndexedDB replacement ─────────────────────────────────────────

const idb_stores = new Map<string, Map<string, unknown>>();
function idbStore(store: string) {
	let map = idb_stores.get(store);
	if (!map) {
		map = new Map();
		idb_stores.set(store, map);
	}
	return map;
}

vi.mock('./database.idb', () => ({
	openDatabase: vi.fn(async () => ({ close: vi.fn() })),
	idbGet: vi.fn(async (_db: unknown, store: string, key: string) =>
		idbStore(store).get(key),
	),
	idbPut: vi.fn(async (_db: unknown, store: string, key: string, value: unknown) => {
		idbStore(store).set(key, value);
	}),
	idbDelete: vi.fn(async (_db: unknown, store: string, key: string) => {
		idbStore(store).delete(key);
	}),
	idbDeleteByPrefix: vi.fn(async (_db: unknown, store: string, prefix: string) => {
		for (const key of idbStore(store).keys()) {
			if (key.startsWith(prefix)) idbStore(store).delete(key);
		}
	}),
	idbClear: vi.fn(async (_db: unknown, store: string) => {
		idbStore(store).clear();
	}),
	idbGetAllKeys: vi.fn(async (_db: unknown, store: string) => [
		...idbStore(store).keys(),
	]),
	idbBatch: vi.fn(
		async (
			_db: unknown,
			ops: { store: string; type: 'put' | 'delete'; key: string; value?: unknown }[],
		) => {
			for (const op of ops) {
				if (op.type === 'put') idbStore(op.store).set(op.key, op.value);
				else idbStore(op.store).delete(op.key);
			}
		},
	),
	deleteDatabase: vi.fn(async () => {}),
}));

// ── In-memory SQL fake for the server (same as db.server.sync.test.ts) ──────

function makeCursor<T extends Record<string, any>>(rows: T[]) {
	let index = 0;
	return {
		next: () => {
			if (index < rows.length) return { done: false, value: rows[index++] };
			return { done: true, value: undefined };
		},
		toArray: () => rows,
		one: () => {
			if (rows.length !== 1)
				throw new Error(`Expected exactly one row, got ${rows.length}`);
			return rows[0];
		},
		[Symbol.iterator]: function* () {
			yield* rows;
		},
	};
}

function createFakeSqlStorage() {
	const tables = new Map<string, Map<string | number, Record<string, any>>>();
	const getTable = (name: string) => {
		let table = tables.get(name);
		if (!table) {
			table = new Map();
			tables.set(name, table);
		}
		return table;
	};

	const exec = (sql: string, ...args: any[]) => {
		if (/^\s*CREATE\s|^\s*ALTER\s|^\s*DROP\s|^\s*PRAGMA\s/i.test(sql))
			return makeCursor([]);
		let match: RegExpMatchArray | null;
		if ((match = sql.match(/^SELECT \* FROM (\w+) WHERE (\w+) = \? LIMIT 1/))) {
			const [, table_name, pk] = match;
			const rows = [...getTable(table_name).values()].filter((r) => r[pk] === args[0]);
			return makeCursor(rows.slice(0, 1));
		}
		if ((match = sql.match(/^SELECT \* FROM (\w+) WHERE (\w+) IN \(/))) {
			const [, table_name, pk] = match;
			const wanted = new Set(args);
			return makeCursor(
				[...getTable(table_name).values()].filter((r) => wanted.has(r[pk])),
			);
		}
		if ((match = sql.match(/^SELECT \* FROM (\w+) WHERE (\w+) = \?$/))) {
			const [, table_name, col] = match;
			return makeCursor(
				[...getTable(table_name).values()].filter((r) => r[col] === args[0]),
			);
		}
		if ((match = sql.match(/^SELECT \* FROM (\w+) WHERE id LIKE \?/))) {
			const [, table_name] = match;
			const prefix = String(args[0]).replace(/%$/, '');
			return makeCursor(
				[...getTable(table_name).values()].filter((r) => String(r.id).startsWith(prefix)),
			);
		}
		if ((match = sql.match(/^DELETE FROM (\w+) WHERE id LIKE \?/))) {
			const [, table_name] = match;
			const prefix = String(args[0]).replace(/%$/, '');
			const table = getTable(table_name);
			for (const key of table.keys()) {
				if (String(key).startsWith(prefix)) table.delete(key);
			}
			return makeCursor([]);
		}
		if ((match = sql.match(/^DELETE FROM (\w+) WHERE (\w+) = \?/))) {
			const [, table_name, pk] = match;
			const table = getTable(table_name);
			for (const [key, row] of table.entries()) {
				if (row[pk] === args[0]) table.delete(key);
			}
			return makeCursor([]);
		}
		if ((match = sql.match(/^SELECT \* FROM (\w+)$/))) {
			return makeCursor([...getTable(match[1]).values()]);
		}
		if ((match = sql.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES/))) {
			const [, table_name, raw_columns] = match;
			const columns = raw_columns.split(',').map((c) => c.trim());
			const row: Record<string, any> = {};
			columns.forEach((col, i) => {
				row[col] = args[i] === undefined ? null : args[i];
			});
			const table = getTable(table_name);
			if (row.id == null && columns.includes('id')) row.id = table.size + 1;
			table.set(row.id ?? `${table.size + 1}`, row);
			return makeCursor([{ ...row }]);
		}
		if ((match = sql.match(/^UPDATE (\w+) SET (.+?) WHERE (\w+) = \?/))) {
			const [, table_name, set_clause, pk] = match;
			const columns = set_clause.split(',').map((c) => c.trim().split(' ')[0]);
			const pk_value = args[args.length - 1];
			const updated: Record<string, any>[] = [];
			for (const row of getTable(table_name).values()) {
				if (row[pk] !== pk_value) continue;
				columns.forEach((col, i) => {
					row[col] = args[i] === undefined ? null : args[i];
				});
				updated.push({ ...row });
			}
			return makeCursor(updated);
		}
		throw new Error(`Fake SQL storage does not understand: ${sql}`);
	};

	return { exec: vi.fn(exec) };
}

const itemTable = Database.table('item', (s) => ({
	id: s.primaryKey(),
	name: s.string().searchable(),
}));

async function createTestServer() {
	const { DatabaseServer } = await import('../server/db.server');
	const ctx = {
		id: { toString: () => 'test-id' },
		storage: {
			sql: createFakeSqlStorage(),
			transactionSync: (cb: () => unknown) => cb(),
			deleteAlarm: vi.fn(),
			deleteAll: vi.fn(),
		},
		abort: vi.fn(),
	};
	return new DatabaseServer(
		{ item: itemTable as unknown as Database.Table },
		() => undefined,
		ctx as any,
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
		if (options.page_limit) body.limit = options.page_limit;
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
				orama: itemTable.config.orama as any,
				primary_key: 'id',
			},
		},
		db_name: 'test-db',
		default_threshold: 5000,
	});
	return worker;
}

async function searchAllIds(worker: any): Promise<string[]> {
	const result = await worker.search('item', { limit: 1000 });
	return result.hits.map((h: any) => h.id).sort();
}

const T0 = 1_750_000_000_000;

describe('DatabaseWorker.sync() against a real DatabaseServer', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(T0);
		idb_stores.clear();
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
		expect(await worker.isSynced('item')).toBe(true);
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
		expect(await worker.isSynced('item')).toBe(true);
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
		const renamed = await worker.search('item', { term: 'renamed', limit: 10 });
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
		idbStore('entities').set(`item/${a.id}`, {
			entity_type: 'item',
			id: a.id,
			data: a,
			updated_at: T0,
		});

		vi.setSystemTime(T0 + 5000);
		server.delete('item', a.id as string);
		await worker.sync();

		expect(idbStore('entities').has(`item/${a.id}`)).toBe(false);
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
		expect(await worker.isSynced('item')).toBe(false);
		expect(await searchAllIds(worker)).toEqual([]);

		// The persisted cursor must NOT claim the entity was synced
		const meta = idbStore('sync_meta').get('item') as
			| { start_updated_at?: number }
			| undefined;
		expect(meta?.start_updated_at ?? undefined).toBeUndefined();

		// Connectivity restored — the full dataset syncs
		should_fail = false;
		await worker.sync();
		expect(await searchAllIds(worker)).toEqual([...ids].sort());
		expect(await worker.isSynced('item')).toBe(true);
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
		expect(await worker.isSynced('item')).toBe(false);

		// Simulate a page refresh: a fresh worker that only has the persisted
		// IDB state. The persisted synced window must never claim documents
		// that are missing from the persisted index — they'd never be
		// refetched and would be lost permanently.
		const reloaded = await createWorker();
		failing = false;
		await reloaded.sync();

		expect(await searchAllIds(reloaded)).toEqual([...ids].sort());
		expect(await reloaded.isSynced('item')).toBe(true);
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

		const hit = await worker.search('item', { term: 'patched', limit: 10 });
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

		const result = await worker.search('item', { limit: 100 });
		expect(result.count).toBe(10); // 9 originals + the late arrival
		expect(await worker.isSynced('item')).toBe(true);
	});
});
