import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Database } from '../schema/schema';

// Regression tests for the 2026-07-14 "empty inbox" incident: after a large
// live backfill, a client index silently lost ~30% of its thread docs while
// sync_meta claimed the backfill was complete. Three verified mechanisms:
//
//  1. `insertMultiple` throws at the first invalid doc in a sync page and the
//     rest of the page was silently dropped — while the synced window still
//     advanced, so the docs were never refetched.
//  2. Websocket entity events carried the FULL entity, which fails the sparse
//     index's schema validation (arrays/objects/nulls). After the
//     remove-before-insert, the doc vanished from the index.
//  3. The client→server switch threshold counted cumulative inserts, which a
//     live backfill inflates with re-synced updates of the same docs.
//
// These tests drive the REAL client sync protocol against a REAL DatabaseServer.

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
		if ((match = sql.match(/^DELETE FROM (\w+) WHERE (\w+) = \?/))) {
			const [, table_name, pk] = match;
			const table = getTable(table_name);
			for (const [key, row] of table.entries()) {
				if (row[pk] === args[0]) table.delete(key);
			}
			return makeCursor([]);
		}
		throw new Error(`Fake SQL storage does not understand: ${sql}`);
	};

	return { exec: vi.fn(exec), tables };
}

// Mirrors the mail app's thread table shape: enum folder + numeric sort field.
const threadTable = Database.table('thread', (s) => ({
	id: s.primaryKey(),
	subject: s.string().searchable(),
	folder: s.enum(['inbox', 'sent', 'archive']).searchable().default('inbox'),
	last_message_at: s.number().searchable(),
}));

async function createTestServer() {
	const { DatabaseServer } = await import('../server/db.server');
	const sql = createFakeSqlStorage();
	const ctx = {
		id: { toString: () => 'test-id' },
		storage: {
			sql,
			transactionSync: (cb: () => unknown) => cb(),
			deleteAlarm: vi.fn(),
			deleteAll: vi.fn(),
		},
		abort: vi.fn(),
	};
	const server = new DatabaseServer(
		{ thread: threadTable as unknown as Database.Table },
		() => undefined,
		ctx as any,
		{ DEV: true } as any,
	);
	return { server, sql, ctx };
}

function bridgeFetchToServer(
	server: { sync: (q?: any) => any },
	options: {
		page_limit?: number;
		on_page?: (n: number) => void;
		corrupt?: (body: any) => void;
	} = {},
) {
	let pages = 0;
	return vi.fn(async (input: string | URL, init?: RequestInit) => {
		const url = String(input);
		if (!url.startsWith('/api/sync')) {
			return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
		}
		const body = init?.body ? JSON.parse(String(init.body)) : {};
		if (options.page_limit) body.limit = options.page_limit;
		options.on_page?.(++pages);
		const result = server.sync(body);
		options.corrupt?.(result);
		return new Response(JSON.stringify(result), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	});
}

async function createWorker(threshold = 50_000) {
	(globalThis as any).self = { addEventListener: vi.fn() };
	const { DatabaseWorker } = await import('./database.worker');
	const worker = new DatabaseWorker();
	await worker.init({
		tables: {
			thread: {
				orama: threadTable.config.orama as any,
				primary_key: 'id',
			},
		},
		db_name: 'test-db',
		default_threshold: threshold,
	});
	return worker;
}

const T0 = 1_750_000_000_000;

describe('sync durability regressions (2026-07-14 incident)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(T0);
		idb_stores.clear();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('a rapid multi-page backfill loses no documents (sparse folders survive)', async () => {
		const { server } = await createTestServer();
		const ids: string[] = [];
		for (let i = 0; i < 300; i++) {
			if (i % 10 === 0) vi.setSystemTime(T0 + i); // clustered wall-clock
			ids.push(
				server.create('thread', {
					subject: `thread ${i}`,
					folder: i % 40 === 0 ? 'inbox' : i % 3 === 0 ? 'sent' : 'archive',
					last_message_at: T0 - i * 1000,
				}).id as string,
			);
		}
		vi.stubGlobal('fetch', bridgeFetchToServer(server, { page_limit: 37 }));

		const worker = await createWorker();
		await worker.sync();

		const result = await worker.search('thread', { limit: 1000 });
		expect(result.count).toBe(300);
		expect(await worker.isSynced('thread')).toBe(true);

		// The sparse folder must survive — the incident dropped the (small,
		// older) inbox entirely while big folders filled the index.
		const inbox = await worker.search('thread', {
			where: { folder: { eq: 'inbox' } },
			limit: 100,
		} as any);
		expect(inbox.count).toBe(8);
		// ~700ms locally, but 2-vCPU CI runners have run it anywhere from 2s to
		// past vitest's 5s default — which blocked two releases on pure noise.
	}, 20_000);

	it('a single sync page larger than 1000 docs loses nothing (2026-08-10 incident)', async () => {
		// Prod shape: a fresh client (config_version 0) gets the ENTIRE dataset in
		// one schema_changed page — 2500+ docs, newest first. The incident: orama's
		// removeMultiple only processes its first 1000-id batch synchronously and
		// runs the rest on fire-and-forget setTimeout chains, so the worker's
		// remove-before-insert had those deferred batches fire AFTER the insert and
		// delete every doc past #1000 — while sync_meta claimed a complete window.
		// A mailbox rendered 6 inbox threads out of 52 and never refetched the rest.
		//
		// REAL timers are load-bearing: under fake timers the deferred removal
		// batches never fire and the unfixed code false-passes.
		vi.useRealTimers();
		const { server } = await createTestServer();
		// One transaction: per-doc create() re-serializes the whole index each
		// time, which makes seeding 2600 docs takes minutes in the fake harness.
		server.transaction(
			Array.from({ length: 2600 }, (_, i) => ({
				create: {
					type: 'thread',
					data: {
						subject: `thread ${i}`,
						// Sparse old folder: the first 50 created (oldest updated_at) are
						// inbox — exactly the docs a newest-first page cap silently drops.
						folder: i < 50 ? 'inbox' : i % 3 === 0 ? 'sent' : 'archive',
						last_message_at: T0 - i * 1000,
					},
				},
			})),
		);
		vi.stubGlobal('fetch', bridgeFetchToServer(server)); // no page_limit: one giant page

		const worker = await createWorker();
		await worker.sync();
		// Drain macrotasks so any deferred removal batches actually run before
		// the assertions (in the live app they fire within milliseconds).
		for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));

		expect(await worker.isSynced('thread')).toBe(true);
		const result = await worker.search('thread', { limit: 5000 });
		expect(result.count).toBe(2600);
		const inbox = await worker.search('thread', {
			where: { folder: { eq: 'inbox' } },
			limit: 100,
		} as any);
		expect(inbox.count).toBe(50);
	}, 20_000);

	it('one invalid document in a sync page loses only itself, never the page tail', async () => {
		const { server } = await createTestServer();
		const ids: string[] = [];
		for (let i = 0; i < 60; i++) {
			vi.setSystemTime(T0 + i * 1000);
			ids.push(
				server.create('thread', {
					subject: `thread ${i}`,
					folder: 'archive',
					last_message_at: T0 + i,
				}).id as string,
			);
		}

		// Corrupt one doc mid-page the way legacy/bad data would arrive: a null
		// searchable string fails Orama's schema validation on insert.
		vi.stubGlobal(
			'fetch',
			bridgeFetchToServer(server, {
				page_limit: 50,
				corrupt: (body) => {
					const docs = [
						...(body.entity.thread?.created ?? []),
						...(body.entity.thread?.updated ?? []),
					];
					if (docs.length >= 10) docs[9].subject = null; // 10th doc of the page
				},
			}),
		);

		const worker = await createWorker();
		await worker.sync();

		// Before the fix, insertMultiple threw at doc 10 and the remaining ~40
		// docs of the page were silently dropped while the window advanced.
		// Now the corrupt doc still indexes (projection drops the null field).
		const result = await worker.search('thread', { limit: 1000 });
		expect(result.count).toBe(60);
	});

	it('websocket full-entity events do not evict docs from the index', async () => {
		const { server } = await createTestServer();
		const ids: string[] = [];
		for (let i = 0; i < 20; i++) {
			vi.setSystemTime(T0 + i * 1000);
			ids.push(
				server.create('thread', {
					subject: `thread ${i}`,
					folder: 'inbox',
					last_message_at: T0 + i,
				}).id as string,
			);
		}
		vi.stubGlobal('fetch', bridgeFetchToServer(server));

		const worker = await createWorker();
		await worker.sync();
		expect((await worker.search('thread', { limit: 100 })).count).toBe(20);

		// Simulate the ws flood during a backfill: FULL entities (objects,
		// arrays, nulls — shapes the sparse index schema rejects) arrive for
		// already-indexed docs. Before the fix this removed each doc and then
		// silently failed the re-insert — the doc vanished until a rebuild.
		for (const id of ids) {
			await worker.applyExternalChange('thread', 'update', id, {
				id,
				subject: `bumped ${id}`,
				folder: 'inbox',
				last_message_at: T0,
				updated_at: T0 + 100_000,
				created_at: T0,
				participants: [{ name: 'Someone', email: 'x@y.z' }], // not in schema
				gmail_thread_ids: { acc1: 'abc' }, // not in schema
				snippet: null, // null field
			});
		}

		const result = await worker.search('thread', { limit: 100 });
		expect(result.count).toBe(20);

		// And when the event carries the server's sparse projection, that exact
		// doc is what lands in the index.
		await worker.applyExternalChange(
			'thread',
			'update',
			ids[0],
			{ id: ids[0], subject: 'full entity', complex: { deep: true } },
			{ id: ids[0], subject: 'sparse wins', folder: 'inbox', updated_at: T0 + 200_000 },
		);
		const hit = await worker.search('thread', { term: 'sparse', limit: 10 });
		expect(hit.hits.some((h: any) => h.id === ids[0])).toBe(true);
	});

	it('re-synced updates during a live backfill do not trip the client→server switch', async () => {
		const { server } = await createTestServer();
		const created_ids: string[] = [];
		for (let i = 0; i < 150; i++) {
			vi.setSystemTime(T0 + i * 1000);
			created_ids.push(
				server.create('thread', {
					subject: `thread ${i}`,
					folder: 'archive',
					last_message_at: T0 + i,
				}).id as string,
			);
		}

		// While the client backfills, keep bumping existing docs (a live Gmail
		// backfill re-touches threads constantly). Total distinct docs stay at
		// 150 + 40 new = 190, far under the 250 threshold — but the OLD
		// cumulative-inserts counter also counted every re-synced bump and
		// switched to server mode anyway.
		let round = 0;
		vi.stubGlobal(
			'fetch',
			bridgeFetchToServer(server, {
				page_limit: 40,
				on_page: () => {
					if (round >= 8) return;
					vi.setSystemTime(T0 + 500_000 + round * 1000);
					for (let i = 0; i < 5; i++) {
						server.create('thread', {
							subject: `live ${round}-${i}`,
							folder: 'archive',
							last_message_at: T0 + round,
						});
					}
					for (let i = 0; i < 20; i++) {
						const id = created_ids[(round * 20 + i) % created_ids.length];
						server.update('thread', id, { last_message_at: T0 + round });
					}
					round++;
				},
			}),
		);

		const worker = await createWorker(250);
		await worker.sync();
		for (let i = 0; i < 10 && !(await worker.isSynced('thread')); i++) {
			await worker.sync();
		}

		expect(await worker.getSearchMode('thread')).toBe('client');
		const result = await worker.search('thread', { limit: 1000 });
		expect(result.count).toBe(190);
		expect(await worker.isSynced('thread')).toBe(true);
		// Same CI headroom as the multi-page backfill above (2s+ on slow runners).
	}, 20_000);

	it('legacy equal-timestamp runs are never split across sync pages', async () => {
		// Bypass create() (which makes timestamps strictly monotonic) and seed
		// raw rows sharing one updated_at — data written before monotonic
		// timestamps existed. The index rebuilds from the raw table.
		const { server, sql } = await createTestServer();
		vi.setSystemTime(T0);
		server.create('thread', {
			subject: 'seed',
			folder: 'inbox',
			last_message_at: T0,
		});
		// Raw rows: 12 docs all at T0 + 50_000
		const table = sql.tables.get('thread')!;
		for (let i = 0; i < 12; i++) {
			table.set(`legacy_${i}`, {
				id: `legacy_${i}`,
				subject: `legacy ${i}`,
				folder: 'archive',
				last_message_at: T0,
				created_at: T0 + 50_000,
				updated_at: T0 + 50_000,
				json: '{}',
			});
		}
		// Drop the persisted index so a fresh server rebuilds from the raw table
		sql.tables.delete('search_index');
		const { DatabaseServer } = await import('../server/db.server');
		const ctx2 = {
			id: { toString: () => 'test-id-2' },
			storage: {
				sql,
				transactionSync: (cb: () => unknown) => cb(),
				deleteAlarm: vi.fn(),
				deleteAll: vi.fn(),
			},
			abort: vi.fn(),
		};
		const server2 = new DatabaseServer(
			{ thread: threadTable as unknown as Database.Table },
			() => undefined,
			ctx2 as any,
			{ DEV: true } as any,
		);

		vi.stubGlobal('fetch', bridgeFetchToServer(server2, { page_limit: 5 }));
		const worker = await createWorker();
		await worker.sync();

		// Before the fix, the server cut the equal-timestamp run at the page
		// limit (Orama pre-truncated the fetch), the next page's exclusive
		// boundary skipped the rest of the run, and those docs were permanently lost.
		const result = await worker.search('thread', { limit: 100 });
		expect(result.count).toBe(13); // 1 seed + 12 legacy
		expect(await worker.isSynced('thread')).toBe(true);
	});
});
