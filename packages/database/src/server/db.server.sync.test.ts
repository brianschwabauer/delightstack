// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseServer, DatabaseSyncResponse } from './db.server';
import { Database } from '../schema/schema';
import { createDurableObjectState } from '../search/__tests__/sqlite_harness';

// The documented sync-protocol semantics — half-open windows, equal-timestamp
// runs, deletions on the same timeline, monotonic timestamps, config_version
// resync — driven through the public API against real SQLite (the same harness
// as `db.server.native.test.ts`). Only `cloudflare:workers` is mocked.
vi.mock('cloudflare:workers', () => {
	class DurableObject {
		constructor(
			public ctx: any,
			public env: any,
		) {}
	}
	return { DurableObject };
});

// ── Server factory ───────────────────────────────────────────────────────────

const itemTable = Database.table('item', (s) => ({
	id: s.primaryKey(),
	name: s.string().searchable(),
}));

/** Every server built by a test, closed after it. */
const open_states: ReturnType<typeof createDurableObjectState>[] = [];

function createServer(
	tables: Record<string, unknown> = { item: itemTable as unknown as Database.Table },
) {
	const state = createDurableObjectState();
	open_states.push(state);
	const db = new DatabaseServer(
		tables as Record<string, Database.Table>,
		() => undefined,
		state.ctx as any,
		{ DEV: true } as any,
	);
	return { db, state };
}

afterEach(() => {
	while (open_states.length) open_states.pop()?.close();
});

type SyncEntity = NonNullable<
	DatabaseSyncResponse<{ item: typeof itemTable }>['entity']['item']
>;

/**
 * Pages through the sync endpoint the way a client is documented to:
 * start at `start_updated_at`, then keep using the response's end_updated_at
 * as the next start while last_updated_at > end_updated_at.
 */
function pageThroughSync(
	db: ReturnType<typeof createServer>['db'],
	limit: number,
	start = 0,
) {
	const created: any[] = [];
	const updated: any[] = [];
	const deleted: (string | number)[] = [];
	const pages: SyncEntity[] = [];
	for (let guard = 0; guard < 50; guard++) {
		const res = db.sync({ start_updated_at: start, limit });
		const entity = res.entity.item as SyncEntity;
		pages.push(entity);
		created.push(...entity.created);
		updated.push(...entity.updated);
		deleted.push(...entity.deleted);
		const made_progress = entity.end_updated_at > start;
		const has_more = entity.last_updated_at > entity.end_updated_at;
		if (!made_progress || !has_more) break;
		start = entity.end_updated_at;
	}
	return { created, updated, deleted, pages };
}

const T0 = 1_750_000_000_000;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('DatabaseServer.sync()', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(T0);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns all created entities on an initial ascending sync', () => {
		const { db } = createServer();
		const ids: string[] = [];
		for (let i = 0; i < 5; i++) {
			vi.setSystemTime(T0 + i * 1000);
			ids.push(db.create('item', { name: `item ${i}` }).id as string);
		}

		const res = db.sync({ start_updated_at: 0 });
		const entity = res.entity.item as SyncEntity;
		expect(entity.created.map((d: any) => d.id).sort()).toEqual([...ids].sort());
		expect(entity.updated).toEqual([]);
		expect(entity.deleted).toEqual([]);
		expect(entity.end_updated_at).toBe(entity.last_updated_at);
	});

	it('pages ascending changes with no duplicates and no gaps', () => {
		const { db } = createServer();
		const ids: string[] = [];
		for (let i = 0; i < 10; i++) {
			vi.setSystemTime(T0 + i * 1000);
			ids.push(db.create('item', { name: `item ${i}` }).id as string);
		}

		const { created, pages } = pageThroughSync(db, 3);
		expect(pages.length).toBeGreaterThan(1); // actually paginated
		const seen = created.map((d: any) => d.id);
		expect(new Set(seen).size).toBe(seen.length); // no duplicates
		expect(seen.sort()).toEqual([...ids].sort()); // no gaps
	});

	it('treats start_updated_at as exclusive so boundary rows are not duplicated', () => {
		const { db } = createServer();
		vi.setSystemTime(T0);
		db.create('item', { name: 'first' });
		vi.setSystemTime(T0 + 1000);
		const second = db.create('item', { name: 'second' });

		// A client that already synced through T0 must only get the second item
		const res = db.sync({ start_updated_at: T0 });
		const entity = res.entity.item as SyncEntity;
		expect(entity.created.map((d: any) => d.id)).toEqual([second.id]);
	});

	it('includes a row exactly at end_updated_at (window is (start, end])', () => {
		const { db } = createServer();
		vi.setSystemTime(T0);
		const a = db.create('item', { name: 'a' });
		vi.setSystemTime(T0 + 1000);
		db.create('item', { name: 'b' });

		const res = db.sync({ start_updated_at: 0, end_updated_at: T0 });
		const entity = res.entity.item as SyncEntity;
		expect(entity.created.map((d: any) => d.id)).toEqual([a.id]);
	});

	it('only reports deletes inside the requested window and never lets an outside delete extend end_updated_at', () => {
		const { db } = createServer();
		const ids: string[] = [];
		for (let i = 0; i < 5; i++) {
			vi.setSystemTime(T0 + i * 1000);
			ids.push(db.create('item', { name: `item ${i}` }).id as string);
		}
		// A delete far outside the requested window
		vi.setSystemTime(T0 + 100_000);
		db.delete('item', ids[0]);

		const res = db.sync({ start_updated_at: 0, end_updated_at: T0 + 50_000 });
		const entity = res.entity.item as SyncEntity;
		expect(entity.deleted).toEqual([]); // delete is outside (0, T0+50_000]
		expect(entity.end_updated_at).toBeLessThanOrEqual(T0 + 50_000);
		expect(entity.start_updated_at).toBeGreaterThan(0);
	});

	it('does not skip changes when a delete is newer than a limit-truncated page', () => {
		const { db } = createServer();
		const ids: string[] = [];
		for (let i = 0; i < 5; i++) {
			vi.setSystemTime(T0 + i * 1000);
			ids.push(db.create('item', { name: `item ${i}` }).id as string);
		}
		vi.setSystemTime(T0 + 10_000);
		db.delete('item', ids[0]);

		// Page with a small limit; the delete must not yank end_updated_at past
		// the not-yet-returned creates.
		const { created, deleted } = pageThroughSync(db, 2);
		const created_ids = created.map((d: any) => d.id).sort();
		expect(created_ids).toEqual(ids.slice(1).sort());
		expect(deleted).toEqual([ids[0]]);
	});

	it('reports per-page end_updated_at no further than the returned changes', () => {
		const { db } = createServer();
		for (let i = 0; i < 6; i++) {
			vi.setSystemTime(T0 + i * 1000);
			db.create('item', { name: `item ${i}` });
		}

		const res = db.sync({ start_updated_at: 0, limit: 3 });
		const entity = res.entity.item as SyncEntity;
		const returned_max = Math.max(...entity.created.map((d: any) => d.updated_at));
		expect(entity.end_updated_at).toBe(returned_max);
		expect(entity.last_updated_at).toBeGreaterThan(entity.end_updated_at);
	});

	it('keeps timestamps and last_updated_at monotonic across back-to-back transactions', () => {
		const { db } = createServer();
		// One transaction with several ops bumps the per-op timestamps by +1ms
		vi.setSystemTime(T0);
		db.transaction([
			{ create: { type: 'item', data: { name: 'a' } } },
			{ create: { type: 'item', data: { name: 'b' } } },
			{ create: { type: 'item', data: { name: 'c' } } },
		]);
		const first = db.sync({ start_updated_at: 0 });
		const synced_through = (first.entity.item as SyncEntity).end_updated_at;
		expect(synced_through).toBeGreaterThanOrEqual(T0);

		// The wall clock has NOT advanced — a second transaction must still produce
		// timestamps strictly after everything already written, or clients that
		// synced through `synced_through` will never see the new row.
		const d = db.create('item', { name: 'd' });
		expect(d.updated_at).toBeGreaterThan(synced_through);

		const second = db.sync({ start_updated_at: synced_through });
		const entity = second.entity.item as SyncEntity;
		expect(entity.created.map((doc: any) => doc.id)).toEqual([d.id]);
		expect(entity.last_updated_at).toBeGreaterThan(synced_through);
	});

	it('returns the full dataset and the new config when the client config_version is stale', () => {
		const { db } = createServer();
		const ids: string[] = [];
		for (let i = 0; i < 3; i++) {
			vi.setSystemTime(T0 + i * 1000);
			ids.push(db.create('item', { name: `item ${i}` }).id as string);
		}

		const res = db.sync({
			start_updated_at: T0 + 999_999, // far past — would normally return nothing
			entity: { item: { config_version: 999 } },
		});
		const entity = res.entity.item as SyncEntity;
		expect(entity.config).toBeDefined();
		expect(entity.created.map((d: any) => d.id).sort()).toEqual([...ids].sort());
	});

	it('clears the delete tombstone when an id is reused by a new entity', () => {
		const { db } = createServer();
		vi.setSystemTime(T0);
		const a = db.create('item', { name: 'a' });
		vi.setSystemTime(T0 + 1000);
		db.delete('item', a.id as string);

		// Re-create with the same id (numeric primary keys / imports can reuse ids)
		vi.setSystemTime(T0 + 2000);
		db.transaction([
			{
				exec: {
					statement: `INSERT INTO item (id, name, created_at, updated_at, json) VALUES (?, ?, ?, ?, ?)`,
					bindings: [a.id, 'a2', T0 + 2000, T0 + 2000, '{}'],
				},
			},
			{ update: { type: 'item', id: a.id as string, data: { name: 'a2' } } },
		]);

		const res = db.sync({ start_updated_at: 0 });
		const entity = res.entity.item as SyncEntity;
		// The id now exists again — it must NOT still be reported as deleted,
		// otherwise clients can apply the delete after the create and lose the row.
		expect(entity.deleted).not.toContain(a.id);
		expect([...entity.created, ...entity.updated].some((d: any) => d.id === a.id)).toBe(
			true,
		);
	});
});

describe('DatabaseServer: update guarantees', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(T0);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('strips readonly fields from updates', () => {
		const readonlyTable = Database.table('doc', (s) => ({
			id: s.primaryKey(),
			owner_id: s.string().readonly(),
			name: s.string().searchable(),
		}));
		const { db } = createServer({ doc: readonlyTable as unknown as Database.Table });
		const created = db.create('doc', { owner_id: 'user-1', name: 'mine' } as any) as any;

		vi.setSystemTime(T0 + 1000);
		const updated = db.update('doc', created.id, {
			owner_id: 'attacker',
			name: 'renamed',
		} as any) as any;

		expect(updated.name).toBe('renamed');
		expect(updated.owner_id).toBe('user-1'); // readonly field unchanged
	});
});

describe('DatabaseServer.sync(): vector strip (plan §7.0)', () => {
	const embeddedTable = Database.table('item', (s) => ({
		id: s.primaryKey(),
		name: s.string().searchable(),
		embedding: s.vector(3),
	}));

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(T0);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('ships the sparse document without its vector fields', () => {
		const { db } = createServer({
			item: embeddedTable as unknown as Database.Table,
		});
		db.create('item', { name: 'embedded item', embedding: [0.1, 0.2, 0.3] });

		const entity = db.sync({ start_updated_at: 0 }).entity.item as any;
		const docs = [...entity.created, ...entity.updated];
		expect(docs).toHaveLength(1);
		// The searchable fields still travel; the embedding does not — vector
		// search is server-only, so the client has no use for it and it is by far
		// the heaviest field on the wire.
		expect(docs[0].name).toBe('embedded item');
		expect('embedding' in docs[0]).toBe(false);

		// And the server's own index still has it: a vector query still works.
		const results = db.list('item', {
			vector: { value: [0.1, 0.2, 0.3], field: 'embedding' as never },
		} as never) as { count: number };
		expect(results.count).toBe(1);
	});
});
