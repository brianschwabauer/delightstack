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
		tables: {
			note: { index_schema: table.config.index_schema as never, primary_key: 'id' },
		},
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
		expect((await worker.list('note', { term: 'optimistic' })).count).toBe(1);

		// The server's own version then arrives through sync and replaces it whole.
		vi.setSystemTime(T0 + 20_000);
		server.update('note', ids[0], { title: 'server title' });
		await worker.sync();

		const corrected = (await readAll<DocRecord>('docs')).find(
			(row) => row.doc_id === ids[0],
		);
		expect(corrected?.sparse_doc.title).toBe('server title');
		expect(corrected?.sparse_doc.body).toBe('alpha beta gamma');
		expect((await worker.list('note', { term: 'optimistic' })).count).toBe(0);
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

		const result = await worker.list('note', {
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
		await worker.list('note', { term: 'note' });
		expect(listed).toBe(1);

		await worker.sync();
		expect(await worker.getSearchMode('note')).toBe('client');
		const local = await worker.list('note', { term: 'note', limit: 10 });
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
		const result = await worker.list('note', { term: 'note' });
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
		await worker.list('note', { term: 'note' });
		expect(listed).toBe(1);
		expect(await worker.getSearchMode('note')).toBe('server');
	});

	it('query.source overrides routing per query', async () => {
		const { server } = await createTestServer();
		seed(server as any, 6);
		let listed = 0;
		vi.stubGlobal('fetch', bridgeFetch(server, { on_list: () => listed++ }));

		const worker = await createWorker();
		// Nothing synced: coverage routes to the server, but `source: 'client'`
		// forces the (empty) local index — a partial-corpus answer by choice.
		const empty = await worker.list('note', { term: 'note', source: 'client' });
		expect(listed).toBe(0);
		expect(empty.count).toBe(0);

		await worker.sync();
		// Coverage now says client; `source: 'server'` still forces the server.
		expect(await worker.getSearchMode('note')).toBe('client');
		await worker.list('note', { term: 'note', source: 'server' });
		expect(listed).toBe(1);

		// And the explicit spellings of the default change nothing.
		const auto = await worker.list('note', { term: 'note', source: 'auto' });
		expect(listed).toBe(1);
		expect(auto.count).toBe(6);
	});

	it("source: 'client' rejects vector queries and server-only entities", async () => {
		const { server } = await createTestServer();
		seed(server as any, 2);
		vi.stubGlobal('fetch', bridgeFetch(server));
		const { DelightError } = await import('@delightstack/utilities');

		const worker = await createWorker();
		await worker.sync();
		const vector_failure = await worker
			.list('note', {
				source: 'client',
				vector: { value: [0.1, 0.2], field: 'embedding' },
			} as never)
			.catch((error: Error) => error);
		expect(DelightError.fromWorker(vector_failure)?.code).toBe('invalid_search_source');

		const server_only = await createWorker({
			entities: { note: { search_mode: 'server' } },
		});
		const mode_failure = await server_only
			.list('note', { term: 'note', source: 'client' })
			.catch((error: Error) => error);
		expect(DelightError.fromWorker(mode_failure)?.code).toBe('invalid_search_source');
	});

	// ── Backfill ceiling (max_synced_docs) ───────────────────────────────────

	it('defers the backfill when the table exceeds max_synced_docs', async () => {
		const { server } = await createTestServer();
		seed(server as any, 6);
		let listed = 0;
		vi.stubGlobal('fetch', bridgeFetch(server, { on_list: () => listed++ }));

		const worker = await createWorker({ max_synced_docs: 4 });
		await worker.sync();

		// Nothing mirrored, nothing indexed; queries answer from the server.
		expect(await readAll('docs')).toEqual([]);
		expect(await worker.getSearchMode('note')).toBe('server');
		await worker.list('note', { term: 'note' });
		expect(listed).toBe(1);
		expect(await worker.isSynced('note')).toBe(false);

		// The count survives the deferral so a reload knows before its first probe.
		const meta = await readKeyed<{ server_total?: number }>('sync_meta', 'note');
		expect(meta?.server_total).toBe(6);
	});

	it('resumes the backfill when the table shrinks below the ceiling', async () => {
		const { server } = await createTestServer();
		const ids = seed(server as any, 6);
		vi.stubGlobal('fetch', bridgeFetch(server));

		const worker = await createWorker({ max_synced_docs: 4 });
		await worker.sync();
		expect(await readAll('docs')).toEqual([]);

		// Every sync run re-probes (count-only): dropping below the ceiling
		// resumes the backfill with no client-side action.
		for (const id of ids.slice(0, 3)) (server as any).delete('note', id);
		await worker.sync();
		expect((await readAll('docs')).length).toBe(3);
		expect(await worker.getSearchMode('note')).toBe('client');
	});

	it('resumes the backfill when the ceiling is raised', async () => {
		const { server } = await createTestServer();
		seed(server as any, 6);
		vi.stubGlobal('fetch', bridgeFetch(server));

		const capped = await createWorker({ max_synced_docs: 4 });
		await capped.sync();
		expect(await readAll('docs')).toEqual([]);

		// A "reload" with a raised ceiling — same IndexedDB, new config.
		const raised = await createWorker({ max_synced_docs: 100 });
		await raised.sync();
		expect((await readAll('docs')).length).toBe(6);
		expect(await raised.getSearchMode('note')).toBe('client');
	});

	it('a fully-mirrored table keeps syncing incrementally past the ceiling', async () => {
		const { server } = await createTestServer();
		seed(server as any, 6);
		vi.stubGlobal('fetch', bridgeFetch(server));

		const worker = await createWorker({ max_synced_docs: 10 });
		await worker.sync();
		expect((await readAll('docs')).length).toBe(6);

		// The table grows past the ceiling AFTER the mirror finished. The
		// ceiling gates the big download, not incremental pages — the paid-for
		// index keeps tracking the server.
		seed(server as any, 8);
		await worker.sync();
		expect((await readAll('docs')).length).toBe(14);
		expect(await worker.getSearchMode('note')).toBe('client');
	});

	it("search_mode: 'client' is exempt from the global ceiling but not its own", async () => {
		const { server } = await createTestServer();
		seed(server as any, 6);
		vi.stubGlobal('fetch', bridgeFetch(server));

		// Forced client: the global ceiling does not apply.
		const forced = await createWorker({
			max_synced_docs: 2,
			entities: { note: { search_mode: 'client' } },
		});
		await forced.sync();
		expect((await readAll('docs')).length).toBe(6);

		// An explicit per-entity ceiling still caps a forced-client entity.
		database_counter += 1;
		db_name = `worker-search-${database_counter}`;
		const capped = await createWorker({
			entities: { note: { search_mode: 'client', max_synced_docs: 4 } },
		});
		await capped.sync();
		expect(await readAll('docs')).toEqual([]);
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
			server as unknown as {
				search: { store: { bumpConfigVersion(type: string): number } };
			}
		).search.store.bumpConfigVersion('note');

		await worker.sync();

		expect(await databaseVersion()).toBeGreaterThan(first_version);
		const docs = await readAll<DocRecord>('docs');
		expect(docs.length).toBe(4); // rebuilt from the server, ghost gone
		expect(docs.some((row) => row.doc_id === 'ghost')).toBe(false);
		expect((await worker.list('note', { term: 'stale' })).count).toBe(0);
		expect((await worker.list('note', { term: 'note', limit: 10 })).count).toBe(4);
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
			const actual = await worker.list('note', query as never);
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

	// ── Index shape drift (field arity change without a config bump) ─────────

	it('a field arity change without a config bump rebuilds the docs index', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{}', { status: 404 })),
		);
		(globalThis as any).self = { addEventListener: vi.fn() };
		const { DatabaseWorker } = await import('./database.worker');

		// Build 1 declares `tags` as a scalar string…
		const w1 = new DatabaseWorker();
		await w1.init({
			tables: {
				note: {
					index_schema: { id: 'string', title: 'string', tags: 'string' } as never,
					primary_key: 'id',
				},
			},
			db_name,
			entities: { note: { search_mode: 'client' } },
		});
		await w1.applyExternalChange('note', 'update', 'a', undefined, {
			id: 'a',
			title: 'first',
			tags: 'alpha',
			updated_at: T0,
		});
		const scalar_version = await databaseVersion();
		await w1.destroy();

		// …build 2 re-declares it as `string[]`. Same index NAME, different
		// physical shape (bare multiEntry vs compound scalar) — the shape check
		// must force a version bump and rebuild, or the stale scalar index
		// answers every contains_any probe with zero rows: silent exclusion.
		const w2 = new DatabaseWorker();
		await w2.init({
			tables: {
				note: {
					index_schema: { id: 'string', title: 'string', tags: 'string[]' } as never,
					primary_key: 'id',
				},
			},
			db_name,
			entities: { note: { search_mode: 'client' } },
		});
		expect(await databaseVersion()).toBeGreaterThan(scalar_version);
		await w2.applyExternalChange('note', 'update', 'a', undefined, {
			id: 'a',
			title: 'first',
			tags: ['alpha'],
			updated_at: T0 + 1000,
		});
		const result = await w2.list('note', {
			where: { tags: { contains_any: ['alpha'] } },
		} as never);
		expect(result.count).toBe(1);
		expect(result.hits[0]?.id).toBe('a');
		await w2.destroy();
	});

	// ── IDB unavailable → server-only mode ───────────────────────────────────

	it('continues in server-only mode when IndexedDB is unavailable', async () => {
		const { server } = await createTestServer();
		seed(server as any, 3);
		let listed = 0;
		vi.stubGlobal('fetch', bridgeFetch(server, { on_list: () => listed++ }));
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

		// A factory whose open throws — private browsing / storage blocked.
		const broken_factory = {
			open: () => {
				throw new Error('storage disabled');
			},
		} as unknown as IDBFactory;

		// init must NOT throw, and every later call must answer, not die with
		// 'Unknown entity type'.
		const worker = await createWorker({ idb_factory: broken_factory });
		expect(errors).toHaveBeenCalled();
		errors.mockRestore();

		expect(await worker.getSearchMode('note')).toBe('server');
		const result = await worker.list('note', { term: 'note' });
		expect(listed).toBe(1);
		expect(result.count).toBe(0); // the stubbed server answer
		await worker.sync(); // a no-op, not a crash
		expect(await worker.isSynced('note')).toBe(false);
		const listed_result = await worker.list('note', {});
		expect(listed_result.hits).toEqual([]);
	});

	// ── Subscription result ordering (sequence tokens) ───────────────────────

	it('echoes the query token so stale results can be discarded', async () => {
		const { server } = await createTestServer();
		seed(server as any, 2);
		// Server-mode (never synced): every query goes through fetch, whose
		// latency this stub controls per term — the deterministic interleaving.
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL) => {
				const url = new URL(String(input), 'http://localhost');
				if (url.pathname === '/api/sync') {
					return new Response(JSON.stringify({ entity: {} }), { status: 200 });
				}
				const term = url.searchParams.get('term') ?? '';
				await new Promise((resolve) => setTimeout(resolve, term === 'slow' ? 60 : 0));
				return new Response(
					JSON.stringify({ hits: [], count: term === 'slow' ? 1 : 2 }),
					{ status: 200 },
				);
			}),
		);

		const worker = await createWorker();
		type Result = import('./database.worker').WorkerSearchResult;
		const calls: Result[] = [];
		const id = await worker.subscribe(
			'note',
			{ term: '' } as never,
			(result) => calls.push(result),
			0,
		);
		expect(calls[0]?.token).toBe(0);

		// Push A (slow, token 1) then B (fast, token 2) — A's result arrives
		// LAST but still carries token 1, which is what lets the client discard
		// it instead of overwriting B's newer results.
		await Promise.all([
			worker.updateSubscription(id, { term: 'slow' } as never, 1),
			worker.updateSubscription(id, { term: 'fast' } as never, 2),
		]);
		const tokens = calls.map((entry) => entry.token);
		expect(tokens).toContain(1);
		expect(tokens).toContain(2);
		expect(calls[calls.length - 1]?.token).toBe(1); // out-of-order arrival
		expect(calls.find((entry) => entry.token === 2)?.count).toBe(2);
		expect(calls.find((entry) => entry.token === 1)?.count).toBe(1);
	});

	// ── Server search errors surface instead of blanking ─────────────────────

	it('propagates a server search failure to the subscription callback', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL) => {
				const url = String(input);
				if (url.startsWith('/api/sync')) {
					return new Response(JSON.stringify({ entity: {} }), { status: 200 });
				}
				return new Response(JSON.stringify({ message: 'boom' }), { status: 500 });
			}),
		);
		const worker = await createWorker();

		type Result = import('./database.worker').WorkerSearchResult;
		const calls: Result[] = [];
		await worker.subscribe('note', { term: 'x' } as never, (result) =>
			calls.push(result),
		);
		expect(calls).toHaveLength(1);
		expect(calls[0].error).toMatchObject({ status: 500, message: 'boom' });

		// One-shot paths reject with the status intact (transferable envelope).
		const { DelightError } = await import('@delightstack/utilities');
		const failure = await worker.list('note', {}).catch((error: Error) => error);
		expect(DelightError.fromWorker(failure)?.status).toBe(500);
	});

	// ── Cross-worker invalidation (dedicated-Worker fallback) ────────────────

	it('invalidates peer workers over the same database via BroadcastChannel', async () => {
		const { server } = await createTestServer();
		vi.stubGlobal('fetch', bridgeFetch(server));
		(globalThis as any).self = { addEventListener: vi.fn() };
		const { DatabaseWorker } = await import('./database.worker');
		const tables = {
			note: { index_schema: noteTable.config.index_schema as never, primary_key: 'id' },
		};
		const entities = { note: { search_mode: 'client' as const } };

		const a = new DatabaseWorker();
		await a.init({ tables, db_name, entities });
		const b = new DatabaseWorker();
		await b.init({ tables, db_name, entities });

		await a.applyExternalChange('note', 'update', 'n1', undefined, {
			id: 'n1',
			title: 'zulu first',
			updated_at: T0,
		});
		// Warm B's in-memory dictionary cache off the current index state.
		await vi.waitFor(async () => {
			expect((await b.list('note', { term: 'zulu' })).count).toBe(1);
		});

		const counts: number[] = [];
		await b.subscribe('note', { term: 'yankee' } as never, (result) =>
			counts.push(result.count),
		);
		expect(counts).toEqual([0]);

		// A indexes a document with a NEW token. Without the broadcast, B's
		// cached dictionary never learns 'yankee' and its subscription never
		// re-runs — the cross-tab staleness this channel exists to fix.
		await a.applyExternalChange('note', 'update', 'n2', undefined, {
			id: 'n2',
			title: 'yankee second',
			updated_at: T0 + 1000,
		});
		await vi.waitFor(async () => {
			expect(counts[counts.length - 1]).toBe(1);
			expect((await b.list('note', { term: 'yankee' })).count).toBe(1);
		});

		await a.destroy();
		await b.destroy();
	});

	// ── versionchange recovery ───────────────────────────────────────────────

	it('reopens the database after a versionchange instead of degrading permanently', async () => {
		const { server } = await createTestServer();
		seed(server as any, 3);
		let listed = 0;
		vi.stubGlobal('fetch', bridgeFetch(server, { on_list: () => listed++ }));

		const worker = await createWorker();
		await worker.sync();
		expect((await worker.list('note', { term: 'note', limit: 10 })).count).toBe(3);

		// Another tab upgrades the database: this worker's connection gets
		// `versionchange`, closes, and used to stay dead for the session.
		const current = await databaseVersion();
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.open(db_name, current + 1);
			request.onsuccess = () => {
				request.result.close();
				resolve();
			};
			request.onerror = () => reject(request.error);
		});

		// The next search lazily reopens and still answers locally.
		const result = await worker.list('note', { term: 'note', limit: 10 });
		expect(result.count).toBe(3);
		expect(listed).toBe(0);
	});

	// ── Failed local index write after a server-confirmed update ─────────────

	it('resyncs when a server-confirmed update cannot be written locally', async () => {
		const { server } = await createTestServer();
		const ids = seed(server as any, 2);
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL, init?: RequestInit) => {
				const url = String(input);
				if (url.startsWith('/api/sync')) {
					return new Response(
						JSON.stringify(server.sync(init?.body ? JSON.parse(String(init.body)) : {})),
						{ status: 200 },
					);
				}
				const patch = url.match(/^\/api\/note\/([^/?]+)$/);
				if (patch && init?.method === 'PATCH') {
					const updated = server.update(
						'note',
						patch[1],
						JSON.parse(String(init.body)) as never,
					);
					return new Response(JSON.stringify(updated), { status: 200 });
				}
				return new Response('{}', { status: 404 });
			}),
		);

		const worker = await createWorker();
		await worker.sync();

		// The optimistic write AND the server-echo write both fail; the sync the
		// recovery triggers then runs against the healthy store.
		const { IdbSearchStore } = await import('../search/client/idb_store');
		const original = IdbSearchStore.prototype.applyWrites;
		let fails = 2;
		const apply = vi
			.spyOn(IdbSearchStore.prototype, 'applyWrites')
			.mockImplementation(async function (
				this: InstanceType<typeof IdbSearchStore>,
				...args: Parameters<typeof original>
			) {
				if (fails-- > 0) throw new Error('disk full');
				return original.apply(this, args);
			});
		const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

		vi.setSystemTime(T0 + 60_000);
		await worker.update('note', ids[0], { title: 'rewritten title' });
		expect(fails).toBeLessThanOrEqual(0);

		// Without the recovery, the confirmed row would stay missing from local
		// search until the next app-driven sync. The recovery resync repairs it.
		await vi.waitFor(async () => {
			expect((await worker.list('note', { term: 'rewritten', limit: 10 })).count).toBe(1);
		});
		apply.mockRestore();
		errors.mockRestore();
	});
});
