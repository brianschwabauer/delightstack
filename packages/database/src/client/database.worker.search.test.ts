// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Database } from '../schema/schema';
import { MemorySearchEngine } from '../search/memory/engine';
import type { SearchQuery } from '../search/core/types';
import { createDurableObjectState } from '../search/__tests__/sqlite_harness';

/**
 * The Phase 4 client driver, through the worker's public API.
 *
 * `database.worker.test.ts` owns the sync *protocol* (paging, windows,
 * resumability); this file owns what the plan's Phase 4 changed underneath it:
 * the IndexedDB postings index, the one-transaction sync ingest, the
 * `config_version`-driven database upgrade, and the §7.6 routing policy.
 *
 * Everything runs against a real `DatabaseServer` over `fake-indexeddb` — no
 * storage layer is mocked, so "the postings and the cursor commit together" is
 * an assertion about actual IDB transactions.
 */

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

// ── The server side (same in-memory SQL fake the other worker tests use) ────


const noteTable = Database.table('note', (s) => ({
	id: s.primaryKey(),
	title: s.string().searchable(),
	body: s.string().searchable(),
	folder: s.enum(['inbox', 'archive']).searchable().default('inbox'),
	rank: s.number().searchable().sortable(),
}));

/** Every server built by a test, closed after it. */
const open_states: ReturnType<typeof createDurableObjectState>[] = [];

afterEach(() => {
	while (open_states.length) open_states.pop()?.close();
});

async function createTestServer(table: Database.AnyTable = noteTable) {
	const { DatabaseServer } = await import('../server/db.server');
	const state = createDurableObjectState();
	open_states.push(state);
	const server = new DatabaseServer(
		{ note: table as unknown as Database.Table },
		() => undefined,
		state.ctx as any,
		{ DEV: true } as any,
	);
	return { server, state };
}

/** Bridges the worker's `fetch` to a server instance (sync + REST + list). */
function bridgeFetch(
	server: { sync: (q?: any) => any; list?: (type: any, query: any) => any },
	options: { page_limit?: number; on_list?: () => void } = {},
) {
	return vi.fn(async (input: string | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.startsWith('/api/sync')) {
			const body = init?.body ? JSON.parse(String(init.body)) : {};
			if (options.page_limit) body.limit = options.page_limit;
			return new Response(JSON.stringify(server.sync(body)), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		}
		if (url.startsWith('/api/note?') || url === '/api/note') {
			options.on_list?.();
			return new Response(JSON.stringify({ hits: [], count: 0 }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		}
		return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
	});
}

// ── Reading the worker's IndexedDB from the outside ─────────────────────────

let database_counter = 0;
let db_name = 'worker-search-0';

function openRaw(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(db_name);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
}

/** Every record of one keyPath-keyed search store. */
async function readAll<T>(store: string): Promise<T[]> {
	const db = await openRaw();
	if (!db.objectStoreNames.contains(store)) {
		db.close();
		return [];
	}
	const txn = db.transaction(store, 'readonly');
	const request = txn.objectStore(store).getAll();
	const rows = await new Promise<T[]>((resolve, reject) => {
		txn.oncomplete = () => resolve(request.result as T[]);
		txn.onerror = () => reject(txn.error);
	});
	db.close();
	return rows;
}

/** One out-of-line-keyed record (the worker's own stores). */
async function readKeyed<T>(store: string, key: string): Promise<T | undefined> {
	const db = await openRaw();
	if (!db.objectStoreNames.contains(store)) {
		db.close();
		return undefined;
	}
	const txn = db.transaction(store, 'readonly');
	const request = txn.objectStore(store).get(key);
	const value = await new Promise<T | undefined>((resolve, reject) => {
		txn.oncomplete = () => resolve(request.result as T | undefined);
		txn.onerror = () => reject(txn.error);
	});
	db.close();
	return value;
}

async function databaseVersion(): Promise<number> {
	const db = await openRaw();
	const version = db.version;
	db.close();
	return version;
}

interface DocRecord {
	entity_type: string;
	doc_id: string;
	sparse_doc: Record<string, unknown>;
	lengths: Record<string, number>;
}

interface PostingRecord {
	entity_type: string;
	field: string;
	token: string;
	doc_id: string;
	tf: number;
	len: number;
}

async function createWorker(
	init: Partial<import('./database.worker').WorkerInitConfig> = {},
	table: Database.AnyTable = noteTable,
) {
	(globalThis as any).self = { addEventListener: vi.fn() };
	const { DatabaseWorker } = await import('./database.worker');
	const worker = new DatabaseWorker();
	await worker.init({
		tables: { note: { index_schema: table.config.index_schema as never, primary_key: 'id' } },
		db_name,
		...init,
	});
	return worker;
}

const T0 = 1_750_000_000_000;

function seed(server: { create: (type: any, data: any) => any }, count: number) {
	const ids: string[] = [];
	for (let i = 0; i < count; i++) {
		vi.setSystemTime(T0 + i * 1000);
		ids.push(
			server.create('note', {
				title: `note ${i}`,
				body: i % 2 === 0 ? 'alpha beta gamma' : 'delta epsilon',
				folder: i % 5 === 0 ? 'inbox' : 'archive',
				rank: i,
			}).id as string,
		);
	}
	return ids;
}

describe('DatabaseWorker client search (IndexedDB driver)', () => {
	beforeEach(() => {
		// Only `Date` is faked: `fake-indexeddb` drives its transactions on real
		// timers, and faking those would stall every IDB request forever.
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(T0);
		database_counter += 1;
		db_name = `worker-search-${database_counter}`;
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	// ── Sync ingest atomicity ────────────────────────────────────────────────

	it('a sync page commits documents, postings and the cursor together', async () => {
		const { server } = await createTestServer();
		const ids = seed(server as any, 6);
		vi.stubGlobal('fetch', bridgeFetch(server, { page_limit: 2 }));

		const worker = await createWorker();
		await worker.sync();

		const docs = await readAll<DocRecord>('docs');
		expect(docs.map((row) => row.doc_id).sort()).toEqual([...ids].sort());

		// Every posting points at a document that exists, and carries that
		// document's own field length — the invariant BM25 reads without a join.
		const postings = await readAll<PostingRecord>('postings');
		expect(postings.length).toBeGreaterThan(0);
		const by_id = new Map(docs.map((row) => [row.doc_id, row]));
		for (const posting of postings) {
			const doc = by_id.get(posting.doc_id);
			expect(doc).toBeDefined();
			expect(posting.len).toBe(doc!.lengths[posting.field]);
		}

		// The dictionary's `df` is the number of documents holding the token.
		const tokens = await readAll<{ field: string; token: string; df: number }>('tokens');
		for (const row of tokens) {
			const matching = postings.filter(
				(posting) => posting.field === row.field && posting.token === row.token,
			);
			expect(row.df).toBe(matching.length);
		}

		// And the persisted cursor never describes more than the persisted index.
		const meta = await readKeyed<{ start_updated_at?: number; end_updated_at?: number }>(
			'sync_meta',
			'note',
		);
		expect(meta?.start_updated_at).toBe(0);
		expect(meta?.end_updated_at).toBe(T0 + 5000);
	});

	it('a sync page that cannot be written leaves the cursor untouched', async () => {
		const { server } = await createTestServer();
		seed(server as any, 4);
		vi.stubGlobal('fetch', bridgeFetch(server));

		const { IdbSearchStore } = await import('../search/client/idb_store');
		const failed = vi
			.spyOn(IdbSearchStore.prototype, 'applyWrites')
			.mockRejectedValue(new Error('transaction aborted'));
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

		const worker = await createWorker();
		await worker.sync();

		failed.mockRestore();
		errors.mockRestore();

		// Nothing landed — and, crucially, no cursor claims otherwise. The next
		// run re-requests exactly this page.
		expect(await readAll('docs')).toEqual([]);
		const meta = await readKeyed<{ start_updated_at?: number; end_updated_at?: number }>(
			'sync_meta',
			'note',
		);
		expect(meta?.start_updated_at).toBeUndefined();
		expect(meta?.end_updated_at).toBeUndefined();
		expect(await worker.isSynced('note')).toBe(false);

		// With the store healthy again the same worker catches up completely.
		await worker.sync();
		expect((await readAll<DocRecord>('docs')).length).toBe(4);
		expect(await worker.isSynced('note')).toBe(true);
	});

	it('deletions synced from the server remove the document and its postings', async () => {
		const { server } = await createTestServer();
		const ids = seed(server as any, 4);
		vi.stubGlobal('fetch', bridgeFetch(server));

		const worker = await createWorker();
		await worker.sync();
		expect((await readAll<DocRecord>('docs')).length).toBe(4);

		vi.setSystemTime(T0 + 60_000);
		server.delete('note', ids[0]);
		await worker.sync();

		const docs = await readAll<DocRecord>('docs');
		expect(docs.map((row) => row.doc_id).sort()).toEqual(ids.slice(1).sort());
		const postings = await readAll<PostingRecord>('postings');
		expect(postings.some((posting) => posting.doc_id === ids[0])).toBe(false);
		// The field statistics moved with them, so BM25 sees a 3-document corpus.
		const stats = await readAll<{ field: string; doc_count: number }>('field_stats');
		expect(stats.find((row) => row.field === 'title')?.doc_count).toBe(3);
	});

	// ── Optimistic writes ────────────────────────────────────────────────────

	it('an optimistic local write is corrected by the server echo', async () => {
		const { server } = await createTestServer();
		const ids = seed(server as any, 3);
		vi.stubGlobal('fetch', bridgeFetch(server));

		const worker = await createWorker();
		await worker.sync();

		// A websocket event carrying the FULL entity — fields the sparse index has
		// no business holding, plus a null.
		await worker.applyExternalChange('note', 'update', ids[0], {
			id: ids[0],
			title: 'optimistic title',
			body: null,
			folder: 'inbox',
			rank: 0,
			updated_at: T0 + 10_000,
			created_at: T0,
			attachments: [{ name: 'x.pdf' }],
		});

		const optimistic = (await readAll<DocRecord>('docs')).find(
			(row) => row.doc_id === ids[0],
		);
		expect(optimistic?.sparse_doc.title).toBe('optimistic title');
		// Reshaped like `toSparse`: unknown fields dropped, nulls omitted.
		expect(optimistic?.sparse_doc.attachments).toBeUndefined();
		expect('body' in (optimistic?.sparse_doc ?? {})).toBe(false);
		expect((await worker.search('note', { term: 'optimistic' })).count).toBe(1);

		// The server's own version then arrives through sync and replaces it whole.
		vi.setSystemTime(T0 + 20_000);
		server.update('note', ids[0], { title: 'server title' });
		await worker.sync();

		const corrected = (await readAll<DocRecord>('docs')).find(
			(row) => row.doc_id === ids[0],
		);
		expect(corrected?.sparse_doc.title).toBe('server title');
		expect(corrected?.sparse_doc.body).toBe('alpha beta gamma');
		expect((await worker.search('note', { term: 'optimistic' })).count).toBe(0);
	});

	it('a websocket event carrying the sparse document indexes it verbatim', async () => {
		const { server } = await createTestServer();
		const ids = seed(server as any, 2);
		vi.stubGlobal('fetch', bridgeFetch(server));

		const worker = await createWorker();
		await worker.sync();

		await worker.applyExternalChange(
			'note',
			'update',
			ids[0],
			{ id: ids[0], title: 'full entity', nested: { deep: true } },
			{ id: ids[0], title: 'sparse wins', folder: 'inbox', updated_at: T0 + 30_000 },
		);

		const row = (await readAll<DocRecord>('docs')).find((doc) => doc.doc_id === ids[0]);
		expect(row?.sparse_doc).toEqual({
			id: ids[0],
			title: 'sparse wins',
			folder: 'inbox',
			updated_at: T0 + 30_000,
		});
	});

	// ── Routing (§7.6) ───────────────────────────────────────────────────────

	it('routes a vector query to the server even with a complete window', async () => {
		const { server } = await createTestServer();
		seed(server as any, 3);
		let listed = 0;
		vi.stubGlobal('fetch', bridgeFetch(server, { on_list: () => listed++ }));

		const worker = await createWorker();
		await worker.sync();
		expect(await worker.getSearchMode('note')).toBe('client');

		const result = await worker.search('note', {
			term: 'note',
			vector: { value: [0.1, 0.2], field: 'embedding' },
		});
		expect(listed).toBe(1);
		expect(result.count).toBe(0); // the stubbed server answer, not the local index
	});

	it('routes to the server while the window is incomplete, and locally once it is', async () => {
		const { server } = await createTestServer();
		seed(server as any, 6);
		let listed = 0;
		vi.stubGlobal(
			'fetch',
			bridgeFetch(server, { page_limit: 2, on_list: () => listed++ }),
		);

		const worker = await createWorker();
		// Nothing synced yet: the local corpus is empty, the server has everything.
		expect(await worker.getSearchMode('note')).toBe('server');
		await worker.search('note', { term: 'note' });
		expect(listed).toBe(1);

		await worker.sync();
		expect(await worker.getSearchMode('note')).toBe('client');
		const local = await worker.search('note', { term: 'note', limit: 10 });
		expect(listed).toBe(1); // no further network
		expect(local.count).toBe(6);
	});

	it('search_mode: "client" opts in before the window is complete', async () => {
		const { server } = await createTestServer();
		seed(server as any, 4);
		let listed = 0;
		vi.stubGlobal('fetch', bridgeFetch(server, { on_list: () => listed++ }));

		const worker = await createWorker({ entities: { note: { search_mode: 'client' } } });
		expect(await worker.getSearchMode('note')).toBe('client');
		const result = await worker.search('note', { term: 'note' });
		expect(listed).toBe(0);
		expect(result.count).toBe(0); // a partial-corpus answer, by the app's choice
	});

	it('search_mode: "server" never searches or syncs locally', async () => {
		const { server } = await createTestServer();
		seed(server as any, 4);
		let listed = 0;
		vi.stubGlobal('fetch', bridgeFetch(server, { on_list: () => listed++ }));

		const worker = await createWorker({ entities: { note: { search_mode: 'server' } } });
		await worker.sync();
		expect(await readAll('docs')).toEqual([]);
		await worker.search('note', { term: 'note' });
		expect(listed).toBe(1);
		expect(await worker.getSearchMode('note')).toBe('server');
	});

	it('the deprecated count threshold still forces the server above its ceiling', async () => {
		const { server } = await createTestServer();
		seed(server as any, 6);
		let listed = 0;
		vi.stubGlobal('fetch', bridgeFetch(server, { on_list: () => listed++ }));

		const worker = await createWorker({ entities: { note: { threshold: 4 } } });
		await worker.sync();

		// The window is complete, so coverage says "client" — the valve overrides.
		expect(await worker.getSearchMode('note')).toBe('server');
		await worker.search('note', { term: 'note' });
		expect(listed).toBe(1);

		// Below its ceiling the same valve is inert.
		const relaxed = await createWorker({ entities: { note: { threshold: 100 } } });
		await relaxed.sync();
		expect(await relaxed.getSearchMode('note')).toBe('client');
	});

	// ── config_version bump ──────────────────────────────────────────────────

	it('a config bump reopens the database, rebuilds the index and resyncs', async () => {
		const { server } = await createTestServer();
		seed(server as any, 4);
		vi.stubGlobal('fetch', bridgeFetch(server));

		const worker = await createWorker();
		await worker.sync();
		const first_version = await databaseVersion();
		expect((await readAll<DocRecord>('docs')).length).toBe(4);

		// A stale document the bump must clear: it belongs to the old schema and
		// no longer exists on the server.
		await worker.applyExternalChange('note', 'update', 'ghost', undefined, {
			id: 'ghost',
			title: 'stale schema doc',
			updated_at: T0,
		});
		expect((await readAll<DocRecord>('docs')).length).toBe(5);

		// Bump the server's config_version, which makes the next sync page a
		// `schema_changed` page carrying the config.
		const bumped_version = (
			server as unknown as { search: { store: { bumpConfigVersion(type: string): number } } }
		).search.store.bumpConfigVersion('note');

		await worker.sync();

		expect(await databaseVersion()).toBeGreaterThan(first_version);
		const docs = await readAll<DocRecord>('docs');
		expect(docs.length).toBe(4); // rebuilt from the server, ghost gone
		expect(docs.some((row) => row.doc_id === 'ghost')).toBe(false);
		expect((await worker.search('note', { term: 'stale' })).count).toBe(0);
		expect((await worker.search('note', { term: 'note', limit: 10 })).count).toBe(4);
		const meta = await readKeyed<{ config_version: number }>('sync_meta', 'note');
		expect(meta?.config_version).toBe(bumped_version);
	});

	it('drops the legacy index blob store on the first upgrade', async () => {
		// A database as an older client left it: version 1, three stores, no
		// postings anywhere.
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.open(db_name, 1);
			request.onupgradeneeded = () => {
				const db = request.result;
				db.createObjectStore('entities');
				db.createObjectStore('sync_meta');
				db.createObjectStore('search_index');
			};
			request.onsuccess = () => {
				const db = request.result;
				const txn = db.transaction('search_index', 'readwrite');
				txn.objectStore('search_index').put({ entity_type: 'note' }, 'note');
				txn.oncomplete = () => {
					db.close();
					resolve();
				};
				txn.onerror = () => reject(txn.error);
			};
			request.onerror = () => reject(request.error);
		});

		const { server } = await createTestServer();
		seed(server as any, 2);
		vi.stubGlobal('fetch', bridgeFetch(server));
		const worker = await createWorker();
		await worker.sync();

		const db = await openRaw();
		const stores = Array.from(db.objectStoreNames);
		db.close();
		expect(stores).not.toContain('search_index');
		expect(stores).toEqual(
			expect.arrayContaining(['docs', 'postings', 'tokens', 'field_stats']),
		);
		expect((await readAll<DocRecord>('docs')).length).toBe(2);
	});

	// ── Equivalence with the reference engine ────────────────────────────────

	it('answers identically to the memory reference over the same documents', async () => {
		const { server } = await createTestServer();
		seed(server as any, 24);
		vi.stubGlobal('fetch', bridgeFetch(server, { page_limit: 7 }));

		const worker = await createWorker();
		await worker.sync();

		// The reference is fed EXACTLY what the worker indexed — the documents the
		// wire delivered — so any difference is the driver's, not the corpus's.
		const docs = await readAll<DocRecord>('docs');
		const reference = new MemorySearchEngine({
			schema: {
				id: 'string',
				title: 'string',
				body: 'string',
				folder: 'enum',
				rank: 'number',
				created_at: 'number',
				updated_at: 'number',
			},
			primary_key: 'id',
		});
		reference.insertMany(docs.map((row) => row.sparse_doc));

		const queries: SearchQuery[] = [
			{ limit: 100 },
			{ term: 'alpha', limit: 10 },
			{ term: 'note 1', limit: 10 },
			{ term: 'delt', tolerance: 1, limit: 5 },
			{ where: { folder: 'inbox' }, limit: 50 },
			{ where: { rank: { gte: 10 } }, order: [{ field: 'rank', direction: 'DESC' }] },
			{ term: 'alpha', where: { folder: 'archive' }, limit: 4, offset: 2 },
			{ facets: { folder: {} }, limit: 5 },
			{ distinct_on: 'folder', limit: 10 },
		];
		for (const query of queries) {
			const expected = reference.search(query);
			const actual = await worker.search('note', query as never);
			expect(actual.count, JSON.stringify(query)).toBe(expected.count);
			expect(
				actual.hits.map((hit) => hit.id),
				JSON.stringify(query),
			).toEqual(expected.hits.map((hit) => String(hit.id)));
			expect(
				actual.hits.map((hit) => hit.document),
				JSON.stringify(query),
			).toEqual(expected.hits.map((hit) => hit.document));
		}
	});
});
