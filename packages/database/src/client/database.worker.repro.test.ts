// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Database } from '../schema/schema';
import { createDurableObjectState } from '../search/__tests__/sqlite_harness';

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

/** Unique database names, so no two tests can ever share state. */
let database_counter = 0;
let db_name = 'worker-repro-0';

// Mirrors the mail app's thread table shape: enum folder + numeric sort field.
const threadTable = Database.table('thread', (s) => ({
	id: s.primaryKey(),
	subject: s.string().searchable(),
	folder: s.enum(['inbox', 'sent', 'archive']).searchable().default('inbox'),
	last_message_at: s.number().searchable(),
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
	const server = new DatabaseServer(
		{ thread: threadTable as unknown as Database.Table },
		() => undefined,
		state.ctx as any,
		{ DEV: true } as any,
	);
	return { server, state };
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
		// The sync protocol carries ranges/limits per entity — no top-level limit.
		if (options.page_limit) {
			for (const entity of Object.values(
				(body.entity ?? {}) as Record<string, { limit?: number }>,
			)) {
				entity.limit = options.page_limit;
			}
		}
		options.on_page?.(++pages);
		const result = server.sync(body);
		options.corrupt?.(result);
		return new Response(JSON.stringify(result), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	});
}

async function createWorker() {
	(globalThis as any).self = { addEventListener: vi.fn() };
	const { DatabaseWorker } = await import('./database.worker');
	const worker = new DatabaseWorker();
	await worker.init({
		tables: {
			thread: {
				index_schema: threadTable.config.index_schema as never,
				primary_key: 'id',
			},
		},
		db_name,
	});
	return worker;
}

const T0 = 1_750_000_000_000;

describe('sync durability regressions (2026-07-14 incident)', () => {
	beforeEach(() => {
		// Only `Date` is faked: `fake-indexeddb` drives its transactions on real
		// timers, and faking those would stall every IDB request forever.
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(T0);
		database_counter += 1;
		db_name = `worker-repro-${database_counter}`;
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

		const result = await worker.list('thread', { limit: 1000 });
		expect(result.count).toBe(300);
		expect(result.mode).toBe('client'); // backfill reported complete

		// The sparse folder must survive — the incident dropped the (small,
		// older) inbox entirely while big folders filled the index.
		const inbox = await worker.list('thread', {
			where: { folder: { eq: 'inbox' } },
			limit: 100,
		} as any);
		expect(inbox.count).toBe(8);
		// ~700ms locally, but 2-vCPU CI runners have run it anywhere from 2s to
		// past vitest's 5s default — which blocked two releases on pure noise.
	}, 20_000);

	it('a single sync page larger than 1000 docs loses nothing (2026-08-10 incident)', async () => {
		// Prod shape: a fresh client (config_version 0) gets the ENTIRE dataset in
		// one schema_changed page — 2500+ docs, newest first. The 2026-08-10
		// incident: the previous engine's bulk remove processed only its first
		// 1000-id batch synchronously and deferred the rest, so the worker's
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

		const result = await worker.list('thread', { limit: 5000 });
		expect(result.mode).toBe('client'); // backfill reported complete
		expect(result.count).toBe(2600);
		const inbox = await worker.list('thread', {
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
		// searchable string, which the legacy engine rejected on insert.
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
		// docs of the page were silently dropped while the window advanced. The
		// native driver has no validation step to throw at all: a null field is
		// simply an absent field, and the page is one transaction either way.
		const result = await worker.list('thread', { limit: 1000 });
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
		expect((await worker.list('thread', { limit: 100 })).count).toBe(20);

		// Simulate the ws flood during a backfill: FULL entities (objects,
		// arrays, nulls — shapes the sparse index schema rejected) arrive for
		// already-indexed docs. Before the fix this removed each doc and then
		// silently failed the re-insert — the doc vanished until a rebuild. Now
		// the full entity is reshaped like `toSparse` and simply overwrites it.
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

		const result = await worker.list('thread', { limit: 100 });
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
		const hit = await worker.list('thread', { term: 'sparse', limit: 10 });
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
		// 150 + 40 new = 190 — the OLD (since-removed) count valve's
		// cumulative-inserts counter also counted every re-synced bump and
		// switched to server mode anyway. Routing must stay client throughout.
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

		const worker = await createWorker();
		await worker.sync();
		// The live injections stop after 8 pages; a bounded number of catch-up
		// syncs drains the tail. `mode: 'client'` on the answered list is the
		// whole assertion: the valve must never flip this entity to server
		// routing (a server-routed list would hit the unstubbed REST route).
		let result = await worker.list('thread', { limit: 1000 }).catch(() => undefined);
		for (let i = 0; i < 10 && result?.mode !== 'client'; i++) {
			await worker.sync();
			result = await worker.list('thread', { limit: 1000 }).catch(() => undefined);
		}

		expect(result?.mode).toBe('client');
		expect(result?.count).toBe(190);
		// Same CI headroom as the multi-page backfill above (2s+ on slow runners).
	}, 20_000);

	it('legacy equal-timestamp runs are never split across sync pages', async () => {
		// Bypass create() (which makes timestamps strictly monotonic) and seed
		// raw rows sharing one updated_at — data written before monotonic
		// timestamps existed. A second server over the same database rebuilds its
		// search rows from those raw rows on its first wake.
		const { server, state } = await createTestServer();
		vi.setSystemTime(T0);
		server.create('thread', {
			subject: 'seed',
			folder: 'inbox',
			last_message_at: T0,
		});
		for (let i = 0; i < 12; i++) {
			state.db
				.prepare(
					`INSERT INTO thread (id, subject, folder, last_message_at, created_at, updated_at, json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(`legacy_${i}`, `legacy ${i}`, 'archive', T0, T0 + 50_000, T0 + 50_000, '{}');
		}
		// Force the next boot to rebuild: clear the persisted schema signature.
		const row = state.db.prepare(`SELECT json FROM state WHERE id = 'main'`).get() as {
			json: string;
		};
		const persisted = JSON.parse(row.json) as { native_search?: unknown };
		delete persisted.native_search;
		state.db
			.prepare(`UPDATE state SET json = ? WHERE id = 'main'`)
			.run(JSON.stringify(persisted));

		const { DatabaseServer } = await import('../server/db.server');
		const server2 = new DatabaseServer(
			{ thread: threadTable as unknown as Database.Table },
			() => undefined,
			state.ctx as any,
			{ DEV: true } as any,
		);

		vi.stubGlobal('fetch', bridgeFetchToServer(server2, { page_limit: 5 }));
		const worker = await createWorker();
		await worker.sync();

		// Before the fix, the server cut the equal-timestamp run at the page limit
		// (the search engine pre-truncated the fetch), the next page's exclusive
		// boundary skipped the rest of the run, and those docs were permanently lost.
		const result = await worker.list('thread', { limit: 100 });
		expect(result.count).toBe(13); // 1 seed + 12 legacy
		expect(result.mode).toBe('client'); // backfill reported complete
	});
});
