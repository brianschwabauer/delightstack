// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Database } from '../schema/schema';
import { decodeSearchQuery } from '../search-query';
import { createDurableObjectState } from '../search/__tests__/sqlite_harness';

// Per-entity sync denial, from the client's side. Same harness as
// database.worker.test.ts — a REAL DatabaseServer behind fetch and
// `fake-indexeddb` for storage — with the bridge marking one entity type
// `denied: true` the way `createDatabaseHandle`'s per-entity `beforeSync`
// gate does. The contract: a denied type routes its queries to the server,
// leaves the sync request for good, and stays that way across a reload.

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

/** Unique database names, so no two tests can ever share state. */
let database_counter = 0;
let db_name = 'denied-test-0';

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

const itemTable = Database.table('item', (s) => ({
	id: s.primaryKey(),
	name: s.string().searchable(),
}));

const secretTable = Database.table('secret', (s) => ({
	id: s.primaryKey(),
	label: s.string().searchable(),
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
		{
			item: itemTable as unknown as Database.Table,
			secret: secretTable as unknown as Database.Table,
		},
		() => undefined,
		state.ctx as any,
		{ DEV: true } as any,
	);
}

/** The minimal per-entity refusal `createDatabaseHandle` synthesizes. */
function deniedEntity() {
	return {
		config_version: 0,
		deleted: [],
		created: [],
		updated: [],
		start_updated_at: 0,
		end_updated_at: 0,
		first_updated_at: 0,
		last_updated_at: 0,
		total_count: 0,
		denied: true,
	};
}

/**
 * Bridges the worker to a real server, denying `deny` on sync the way the
 * handler's per-entity gate does, and serving `/api/{type}` list requests so a
 * server-routed query has somewhere to land.
 *
 * `sync_requests` records the entity map of every sync request, so a test can
 * assert what the client stopped asking for.
 */
function bridgeFetchToServer(
	server: {
		sync: (q?: any) => any;
		list: (...args: any[]) => any;
		get: (...args: any[]) => any;
		create: (...args: any[]) => any;
		update: (...args: any[]) => any;
		delete: (...args: any[]) => any;
	},
	deny: string[],
	sync_requests: Record<string, unknown>[],
) {
	return vi.fn(async (input: string | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		if (url.startsWith('/api/sync')) {
			const body = init?.body ? JSON.parse(String(init.body)) : {};
			const requested: Record<string, unknown> = body.entity ?? {};
			sync_requests.push(requested);
			const allowed: Record<string, unknown> = {};
			for (const [entity_type, entity_query] of Object.entries(requested)) {
				if (!deny.includes(entity_type)) allowed[entity_type] = entity_query;
			}
			const result = server.sync({ ...body, entity: allowed });
			for (const entity_type of Object.keys(requested)) {
				if (deny.includes(entity_type)) result.entity[entity_type] = deniedEntity();
			}
			return new Response(JSON.stringify(result), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		}
		const [path, qs] = url.split('?');
		const [entity_type, id] = path.slice('/api/'.length).split('/');
		if (entity_type !== 'item' && entity_type !== 'secret') {
			return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
		}
		// CRUD on one entity — enough for the write paths a denied type must
		// not repopulate from.
		if (id) {
			if (method === 'DELETE') {
				server.delete(entity_type, id);
				return new Response(null, { status: 204 });
			}
			const patch = init?.body ? JSON.parse(String(init.body)) : {};
			const updated =
				method === 'PATCH'
					? server.update(entity_type, id, patch)
					: server.get(entity_type, id);
			return new Response(JSON.stringify(updated), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		}
		if (method === 'POST') {
			const created = server.create(entity_type, JSON.parse(String(init?.body ?? '{}')));
			return new Response(JSON.stringify(created), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		}
		const query = decodeSearchQuery(new URLSearchParams(qs ?? ''));
		return new Response(JSON.stringify(server.list(entity_type, query as never)), {
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
			secret: {
				index_schema: secretTable.config.index_schema as never,
				primary_key: 'id',
			},
		},
		db_name,
	});
	return worker;
}

/** The indexed `docs` keys belonging to one entity type (keys are `[type, id]`). */
async function indexedDocKeys(entity_type: string): Promise<string[]> {
	return [...(await readStore('docs')).keys()].filter((key) =>
		key.startsWith(`${entity_type},`),
	);
}

/** The cached `entities` keys belonging to one entity type. */
async function cachedEntityKeys(entity_type: string): Promise<string[]> {
	return [...(await readStore('entities')).keys()].filter((key) =>
		key.startsWith(`${entity_type}/`),
	);
}

/** The entity types named by every sync request made so far. */
function requestedTypes(requests: Record<string, unknown>[]): Set<string> {
	const types = new Set<string>();
	for (const request of requests)
		for (const type of Object.keys(request)) types.add(type);
	return types;
}

const T0 = 1_750_000_000_000;

describe('DatabaseWorker — a denied entity type', () => {
	beforeEach(() => {
		// Only `Date` is faked: `fake-indexeddb` drives its transactions on real
		// timers, and faking those would stall every IDB request forever.
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(T0);
		database_counter += 1;
		db_name = `denied-test-${database_counter}`;
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('routes its queries to the server while the allowed type stays local', async () => {
		const server = await createTestServer();
		server.create('item', { name: 'visible' });
		server.create('secret', { label: 'classified' });
		const requests: Record<string, unknown>[] = [];
		vi.stubGlobal('fetch', bridgeFetchToServer(server, ['secret'], requests));

		const worker = await createWorker();
		await worker.sync();

		expect((await worker.list('item', { limit: 10 })).mode).toBe('client');
		const secret_result = await worker.list('secret', { limit: 10 });
		expect(secret_result.mode).toBe('server');
		// The server still answers the type it refused to mirror.
		expect(secret_result.count).toBe(1);
	});

	it('is dropped from every later sync request', async () => {
		const server = await createTestServer();
		server.create('item', { name: 'visible' });
		server.create('secret', { label: 'classified' });
		const requests: Record<string, unknown>[] = [];
		vi.stubGlobal('fetch', bridgeFetchToServer(server, ['secret'], requests));

		const worker = await createWorker();
		await worker.sync();
		expect(requestedTypes(requests).has('secret')).toBe(true);

		// Everything after the refusal: the type is never asked for again.
		const after_first = requests.length;
		vi.setSystemTime(T0 + 60_000);
		server.create('item', { name: 'later' });
		await worker.sync();
		await worker.sync();

		const later = requests.slice(after_first);
		expect(later.length).toBeGreaterThan(0);
		expect(requestedTypes(later)).toEqual(new Set(['item']));
		// Nothing of the denied type was indexed locally (`docs` is keyed
		// `[entity_type, doc_id]`, which `readStore` stringifies comma-joined).
		const doc_keys = [...(await readStore('docs')).keys()];
		expect(doc_keys.length).toBeGreaterThan(0);
		expect(doc_keys.some((key) => key.startsWith('secret'))).toBe(false);
	});

	it("never answers a denied type locally, even under source: 'client'", async () => {
		const server = await createTestServer();
		server.create('secret', { label: 'classified' });
		const requests: Record<string, unknown>[] = [];
		vi.stubGlobal('fetch', bridgeFetchToServer(server, ['secret'], requests));

		const worker = await createWorker();
		await worker.sync();

		// A runtime refusal is not a caller error — the query is honored, it
		// just cannot be honored locally.
		expect((await worker.list('secret', { limit: 10, source: 'client' })).mode).toBe(
			'server',
		);
	});

	it('purges what was already mirrored when the denial arrives', async () => {
		const server = await createTestServer();
		server.create('item', { name: 'visible' });
		const secret = server.create('secret', { label: 'classified' });
		const requests: Record<string, unknown>[] = [];
		// Allowed at first — the revocation lands on a later sync run.
		const deny: string[] = [];
		vi.stubGlobal('fetch', bridgeFetchToServer(server, deny, requests));

		const worker = await createWorker();
		await worker.sync();
		await worker.get('secret', secret.id as string);

		// Precondition: the type IS mirrored, index and cache alike.
		expect((await worker.list('secret', { limit: 10 })).mode).toBe('client');
		expect(await indexedDocKeys('secret')).toHaveLength(1);
		expect(await cachedEntityKeys('secret')).toHaveLength(1);

		// Access is revoked; the next sync run carries the refusal.
		deny.push('secret');
		vi.setSystemTime(T0 + 60_000);
		server.create('item', { name: 'later' });
		await worker.sync();

		// The mirror the permission was protecting is gone — both stores.
		expect(await indexedDocKeys('secret')).toEqual([]);
		expect(await cachedEntityKeys('secret')).toEqual([]);
		expect((await worker.list('secret', { limit: 10 })).mode).toBe('server');
		// The allowed type is untouched by its neighbour's revocation.
		expect((await indexedDocKeys('item')).length).toBeGreaterThan(0);
		expect((await worker.list('item', { limit: 10 })).mode).toBe('client');
	});

	it('does not repopulate the mirror through a later create or update', async () => {
		const server = await createTestServer();
		const secret = server.create('secret', { label: 'classified' });
		const requests: Record<string, unknown>[] = [];
		vi.stubGlobal('fetch', bridgeFetchToServer(server, ['secret'], requests));

		const worker = await createWorker();
		await worker.sync();

		// The optimistic write paths: a create's index insert + cache write …
		const created = await worker.create('secret', { label: 'new one' });
		expect(created.label).toBe('new one');
		expect(await indexedDocKeys('secret')).toEqual([]);
		expect(await cachedEntityKeys('secret')).toEqual([]);

		// … an update's optimistic overlay and its server-echo replacement …
		await worker.update('secret', secret.id as string, { label: 'renamed' });
		expect(await indexedDocKeys('secret')).toEqual([]);
		expect(await cachedEntityKeys('secret')).toEqual([]);

		// … a websocket-style external change …
		await worker.applyExternalChange('secret', 'update', secret.id as string, {
			id: secret.id,
			label: 'pushed',
		});
		expect(await indexedDocKeys('secret')).toEqual([]);
		expect(await cachedEntityKeys('secret')).toEqual([]);

		// … a local patch, and a get()'s fetch-and-cache.
		expect(
			await worker.applyLocalPatch('secret', secret.id as string, { label: 'patched' }),
		).toBe(false);
		await worker.get('secret', secret.id as string);
		expect(await indexedDocKeys('secret')).toEqual([]);
		expect(await cachedEntityKeys('secret')).toEqual([]);
	});

	it('still removes stale rows from a denied mirror', async () => {
		const server = await createTestServer();
		const secret = server.create('secret', { label: 'classified' });
		const requests: Record<string, unknown>[] = [];
		const deny: string[] = [];
		vi.stubGlobal('fetch', bridgeFetchToServer(server, deny, requests));

		const worker = await createWorker();
		await worker.sync();
		await worker.get('secret', secret.id as string);
		expect(await cachedEntityKeys('secret')).toHaveLength(1);

		// A row cached before the denial, then a delete after it: removal is
		// never gated — dropping stale data from a revoked mirror is desirable.
		const other = server.create('secret', { label: 'second' });
		await worker.get('secret', other.id as string);
		deny.push('secret');
		vi.setSystemTime(T0 + 60_000);
		await worker.sync();

		await expect(worker.delete('secret', secret.id as string)).resolves.toBeUndefined();
		await expect(
			worker.applyExternalChange('secret', 'delete', other.id as string),
		).resolves.toBeUndefined();
		expect(await indexedDocKeys('secret')).toEqual([]);
		expect(await cachedEntityKeys('secret')).toEqual([]);
	});

	it('stays purged across a reload, with no backfill to refill it', async () => {
		const server = await createTestServer();
		server.create('item', { name: 'visible' });
		const secret = server.create('secret', { label: 'classified' });
		const requests: Record<string, unknown>[] = [];
		const deny: string[] = [];
		vi.stubGlobal('fetch', bridgeFetchToServer(server, deny, requests));

		const worker = await createWorker();
		await worker.sync();
		await worker.get('secret', secret.id as string);
		deny.push('secret');
		vi.setSystemTime(T0 + 60_000);
		server.create('item', { name: 'later' });
		await worker.sync();
		await worker.destroy();

		// The reset window is on disk too, so a re-grant backfills from scratch
		// rather than resuming a cursor over documents nothing kept.
		const meta = (await readStore('sync_meta')).get('secret') as {
			denied?: true;
			start_updated_at?: number;
			end_updated_at?: number;
		};
		expect(meta?.denied).toBe(true);
		expect(meta?.start_updated_at).toBeUndefined();
		expect(meta?.end_updated_at).toBeUndefined();

		requests.length = 0;
		const reloaded = await createWorker();
		await reloaded.sync();

		expect(requestedTypes(requests)).toEqual(new Set(['item']));
		expect(await indexedDocKeys('secret')).toEqual([]);
		expect(await cachedEntityKeys('secret')).toEqual([]);
		expect((await reloaded.list('secret', { limit: 10 })).mode).toBe('server');
	});

	it('survives a reload — a fresh worker over the same IDB does not backfill it', async () => {
		const server = await createTestServer();
		server.create('item', { name: 'visible' });
		server.create('secret', { label: 'classified' });
		const requests: Record<string, unknown>[] = [];
		vi.stubGlobal('fetch', bridgeFetchToServer(server, ['secret'], requests));

		const worker = await createWorker();
		await worker.sync();
		await worker.destroy();

		// The denial is on disk, not just in memory.
		const meta = (await readStore('sync_meta')).get('secret') as { denied?: true };
		expect(meta?.denied).toBe(true);

		// A reload: a new worker over the same database. It must not re-ask.
		requests.length = 0;
		const reloaded = await createWorker();
		await reloaded.sync();

		expect(requests.length).toBeGreaterThan(0);
		expect(requestedTypes(requests)).toEqual(new Set(['item']));
		expect((await reloaded.list('secret', { limit: 10 })).mode).toBe('server');
		expect((await reloaded.list('item', { limit: 10 })).mode).toBe('client');
	});
});
