import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseServer, DatabaseSyncResponse } from './db.server';
import { Database } from '../schema/schema';

// Mock cloudflare:workers (the only module not available in the test runtime).
// Everything else (orama, msgpack, schema) is REAL so these tests exercise the
// actual sync/index logic rather than mocks.
vi.mock('cloudflare:workers', () => {
	class DurableObject {
		constructor(
			public ctx: any,
			public env: any,
		) {}
	}
	return { DurableObject };
});

// ── In-memory SQL fake ───────────────────────────────────────────────────────
// Implements just the SQL statement shapes that DatabaseServer issues, backed
// by plain Maps. This lets create/update/delete/sync run end-to-end against
// the real Orama index.

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
	// table name -> primary key -> row
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
		const statements = sql.includes(';\n') || sql.match(/;\s*CREATE/i) ? sql : sql;
		void statements;

		// CREATE TABLE / CREATE INDEX / ALTER TABLE → no-op
		if (/^\s*CREATE\s|^\s*ALTER\s|^\s*DROP\s|^\s*PRAGMA\s/i.test(sql))
			return makeCursor([]);

		let match: RegExpMatchArray | null;

		// SELECT * FROM <t> WHERE <pk> = ? LIMIT 1
		if ((match = sql.match(/^SELECT \* FROM (\w+) WHERE (\w+) = \? LIMIT 1/))) {
			const [, table_name, pk] = match;
			const rows = [...getTable(table_name).values()].filter((r) => r[pk] === args[0]);
			return makeCursor(rows.slice(0, 1));
		}

		// SELECT * FROM <t> WHERE <pk> IN (?, ...)
		if ((match = sql.match(/^SELECT \* FROM (\w+) WHERE (\w+) IN \(/))) {
			const [, table_name, pk] = match;
			const wanted = new Set(args);
			const rows = [...getTable(table_name).values()].filter((r) => wanted.has(r[pk]));
			return makeCursor(rows);
		}

		// SELECT * FROM <t> WHERE <col> = ?  (FK lookups / cascade queries)
		if ((match = sql.match(/^SELECT \* FROM (\w+) WHERE (\w+) = \?$/))) {
			const [, table_name, col] = match;
			const rows = [...getTable(table_name).values()].filter((r) => r[col] === args[0]);
			return makeCursor(rows);
		}

		// SELECT * FROM <t> WHERE id LIKE ?  (search_index chunks)
		if ((match = sql.match(/^SELECT \* FROM (\w+) WHERE id LIKE \?/))) {
			const [, table_name] = match;
			const prefix = String(args[0]).replace(/%$/, '');
			const rows = [...getTable(table_name).values()].filter((r) =>
				String(r.id).startsWith(prefix),
			);
			return makeCursor(rows);
		}

		// DELETE FROM <t> WHERE id LIKE ?
		if ((match = sql.match(/^DELETE FROM (\w+) WHERE id LIKE \?/))) {
			const [, table_name] = match;
			const prefix = String(args[0]).replace(/%$/, '');
			const table = getTable(table_name);
			for (const key of [...table.keys()]) {
				if (String(key).startsWith(prefix)) table.delete(key);
			}
			return makeCursor([]);
		}

		// DELETE FROM <t> WHERE <pk> = ?
		if ((match = sql.match(/^DELETE FROM (\w+) WHERE (\w+) = \?/))) {
			const [, table_name, pk] = match;
			const table = getTable(table_name);
			for (const [key, row] of [...table.entries()]) {
				if (row[pk] === args[0]) table.delete(key);
			}
			return makeCursor([]);
		}

		// SELECT * FROM <t>  (full scan, index rebuild)
		if ((match = sql.match(/^SELECT \* FROM (\w+)$/))) {
			return makeCursor([...getTable(match[1]).values()]);
		}

		// INSERT INTO <t> (cols) VALUES (?, ...) [RETURNING *]
		if ((match = sql.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES/))) {
			const [, table_name, raw_columns] = match;
			const columns = raw_columns.split(',').map((c) => c.trim());
			const row: Record<string, any> = {};
			columns.forEach((col, i) => {
				row[col] = args[i] === undefined ? null : args[i];
			});
			// emulate INTEGER PRIMARY KEY auto-increment when id is null
			const table = getTable(table_name);
			if (row.id == null && columns.includes('id')) {
				row.id = table.size + 1;
			}
			table.set(row.id ?? `${table.size + 1}`, row);
			return makeCursor([{ ...row }]);
		}

		// UPDATE <t> SET a = ?, b = ? WHERE <pk> = ? [RETURNING *]
		if ((match = sql.match(/^UPDATE (\w+) SET (.+?) WHERE (\w+) = \?/))) {
			const [, table_name, set_clause, pk] = match;
			const columns = set_clause.split(',').map((c) => c.trim().split(' ')[0]);
			const pk_value = args[args.length - 1];
			const table = getTable(table_name);
			const updated: Record<string, any>[] = [];
			for (const row of table.values()) {
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

	return { exec: vi.fn(exec), tables };
}

// ── Server factory ───────────────────────────────────────────────────────────

const itemTable = Database.table('item', (s) => ({
	id: s.primaryKey(),
	name: s.string().searchable(),
}));

function createServer() {
	const sql = createFakeSqlStorage();
	const storage = {
		sql,
		transactionSync: (cb: () => unknown) => cb(),
		deleteAlarm: vi.fn(),
		deleteAll: vi.fn(),
	};
	const ctx = {
		id: { toString: () => 'test-id' },
		storage,
		abort: vi.fn(),
	};
	const db = new DatabaseServer(
		{ item: itemTable as unknown as Database.Table },
		() => undefined,
		ctx as any,
		{ DEV: true } as any,
	);
	return { db, sql };
}

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
		expect(created_ids).toEqual([...ids.slice(1)].sort());
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
