import { describe, it, expect, vi, afterEach } from 'vitest';
import { decode as decodeMsgPack } from '@msgpack/msgpack';
import { DatabaseServer } from './db.server';
import { Database } from '../schema/schema';

// Search-index persistence: entity writes append to `search_journal` (O(1) per
// doc) instead of re-serializing the whole Orama index (O(entire index), which
// measured 9-11s of blocked CPU on a ~50k-doc production index). A cold start
// replays the journal on top of the last snapshot; compaction folds the journal
// back into a snapshot off the write path.

vi.mock('cloudflare:workers', () => {
	class DurableObject {
		constructor(
			public ctx: any,
			public env: any,
		) {}
	}
	return { DurableObject };
});

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

type FakeTables = Map<string, Map<string | number, Record<string, any>>>;

/**
 * In-memory SQL fake. Unlike the other suites' fakes this one implements real
 * rollback for `transactionSync` — journal atomicity is exactly what the batch
 * test below is checking, and a fake that never rolls back would pass whatever
 * the implementation did.
 */
function createFakeSqlStorage(tables: FakeTables = new Map()) {
	const getTable = (name: string) => {
		let table = tables.get(name);
		if (!table) {
			table = new Map();
			tables.set(name, table);
		}
		return table;
	};
	let snapshot_saves = 0;

	// SELECTs hand back copies: real SQL returns fresh row objects each time, and
	// getIndex() deletes `index_data` off the rows it reads to free memory — with
	// shared references that would empty the snapshot for every later boot.
	const copies = (rows: Record<string, any>[]) => rows.map((row) => ({ ...row }));

	const exec = (sql: string, ...args: any[]) => {
		if (/^\s*CREATE\s|^\s*ALTER\s|^\s*DROP\s|^\s*PRAGMA\s/i.test(sql))
			return makeCursor([]);
		let match: RegExpMatchArray | null;
		if ((match = sql.match(/^SELECT \* FROM (\w+) WHERE (\w+) = \? LIMIT 1/))) {
			const [, table_name, pk] = match;
			const rows = [...getTable(table_name).values()].filter((r) => r[pk] === args[0]);
			return makeCursor(copies(rows.slice(0, 1)));
		}
		if ((match = sql.match(/^SELECT \* FROM (\w+) WHERE (\w+) IN \(/))) {
			const [, table_name, pk] = match;
			const wanted = new Set(args);
			return makeCursor(
				copies([...getTable(table_name).values()].filter((r) => wanted.has(r[pk]))),
			);
		}
		if ((match = sql.match(/^SELECT \* FROM (\w+) WHERE (\w+) = \?$/))) {
			const [, table_name, col] = match;
			return makeCursor(
				copies([...getTable(table_name).values()].filter((r) => r[col] === args[0])),
			);
		}
		if ((match = sql.match(/^SELECT \* FROM (\w+) WHERE id LIKE \?/))) {
			const [, table_name] = match;
			const prefix = String(args[0]).replace(/%$/, '');
			return makeCursor(
				copies(
					[...getTable(table_name).values()].filter((r) =>
						String(r.id).startsWith(prefix),
					),
				),
			);
		}
		if ((match = sql.match(/^DELETE FROM (\w+) WHERE id LIKE \?/))) {
			const [, table_name] = match;
			if (table_name === 'search_index') snapshot_saves++;
			const prefix = String(args[0]).replace(/%$/, '');
			const table = getTable(table_name);
			for (const key of table.keys()) {
				if (String(key).startsWith(prefix)) table.delete(key);
			}
			return makeCursor([]);
		}
		if ((match = sql.match(/^DELETE FROM (\w+) WHERE (\w+) = \?/))) {
			const [, table_name, col] = match;
			const table = getTable(table_name);
			for (const [key, row] of table.entries()) {
				if (row[col] === args[0]) table.delete(key);
			}
			return makeCursor([]);
		}
		if ((match = sql.match(/^SELECT \* FROM (\w+)$/))) {
			return makeCursor(copies([...getTable(match[1]).values()]));
		}
		// Composite (entity_type, doc_id) primary key — upsert, not append.
		if ((match = sql.match(/^INSERT OR REPLACE INTO (\w+) \(([^)]+)\) VALUES/))) {
			const [, table_name, raw_columns] = match;
			const columns = raw_columns.split(',').map((c) => c.trim());
			const row: Record<string, any> = {};
			columns.forEach((col, i) => {
				row[col] = args[i] === undefined ? null : args[i];
			});
			getTable(table_name).set(`${row.entity_type}|${row.doc_id}`, row);
			return makeCursor([{ ...row }]);
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

	let depth = 0;
	const transactionSync = <T>(cb: () => T): T => {
		// Only the outermost transaction snapshots — nested ones join it, which is
		// how DO storage behaves for the batch()/transaction() pairing here.
		const undo = depth === 0 ? cloneTables(tables) : undefined;
		depth++;
		try {
			return cb();
		} catch (error) {
			if (undo) restoreTables(tables, undo);
			throw error;
		} finally {
			depth--;
		}
	};

	return {
		sql: { exec: vi.fn(exec) },
		tables,
		transactionSync,
		snapshotSaves: () => snapshot_saves,
	};
}

function cloneTables(tables: FakeTables): FakeTables {
	const copy: FakeTables = new Map();
	for (const [name, rows] of tables) {
		const rows_copy = new Map<string | number, Record<string, any>>();
		for (const [key, row] of rows) rows_copy.set(key, { ...row });
		copy.set(name, rows_copy);
	}
	return copy;
}

function restoreTables(tables: FakeTables, undo: FakeTables) {
	tables.clear();
	for (const [name, rows] of undo) tables.set(name, rows);
}

const itemTable = Database.table('item', (s) => ({
	id: s.primaryKey(),
	name: s.string().searchable(),
}));

/** Boots a DatabaseServer over the given storage — pass `tables` to simulate a cold start */
function boot(tables?: FakeTables) {
	const storage = createFakeSqlStorage(tables);
	const ctx = {
		id: { toString: () => 'test-id' },
		storage: {
			sql: storage.sql,
			transactionSync: storage.transactionSync,
			deleteAlarm: vi.fn(),
			deleteAll: vi.fn(),
		},
		abort: vi.fn(),
	};
	const db = new DatabaseServer(
		{ item: itemTable as unknown as Database.Table },
		() => undefined,
		ctx as any,
		{ DEV: true } as any,
	);
	return { db, storage, tables: storage.tables };
}

const journalRows = (tables: FakeTables) => tables.get('search_journal')?.size ?? 0;

/** Document ids inside the persisted (msgpack) snapshot — i.e. what a cold boot would see WITHOUT the journal */
function snapshotDocIds(tables: FakeTables): string[] {
	const rows = [...(tables.get('search_index')?.values() ?? [])].sort((a, b) =>
		String(a.id).localeCompare(String(b.id)),
	);
	if (!rows.length) return [];
	const size = rows.reduce((total, row) => total + row.index_data.byteLength, 0);
	const combined = new Uint8Array(size);
	let offset = 0;
	for (const row of rows) {
		combined.set(new Uint8Array(row.index_data), offset);
		offset += row.index_data.byteLength;
	}
	const decoded = decodeMsgPack(combined) as {
		docs?: { docs?: Record<string, unknown> };
	};
	return Object.keys(decoded?.docs?.docs ?? {});
}

const names = (db: ReturnType<typeof boot>['db']) =>
	(db.list('item', { limit: 100 }) as unknown as { hits: { document: { name: string } }[] }).hits
		.map((hit) => hit.document.name)
		.sort();

const DEFAULT_MAX_JOURNAL_ROWS = DatabaseServer.MAX_SEARCH_JOURNAL_ROWS;

afterEach(() => {
	DatabaseServer.MAX_SEARCH_JOURNAL_ROWS = DEFAULT_MAX_JOURNAL_ROWS;
});

describe('search index journaling', () => {
	it('journals writes instead of re-snapshotting the index', () => {
		const { db, storage, tables } = boot();
		db.create('item', { name: 'warmup' }); // first touch builds + saves an empty snapshot
		const saves_after_warmup = storage.snapshotSaves();

		for (let i = 0; i < 10; i++) db.create('item', { name: `item ${i}` });

		// Zero full-index serializations for 10 writes — the whole point.
		expect(storage.snapshotSaves()).toBe(saves_after_warmup);
		expect(journalRows(tables)).toBe(11);
		// ...and the in-memory index still answers for every one of them.
		expect(names(db)).toHaveLength(11);
		expect(
			(db.list('item', { term: 'item 3' }) as { count: number }).count,
		).toBeGreaterThan(0);
	});

	it('collapses repeated writes to one doc onto a single journal row', () => {
		const { db, tables } = boot();
		const item = db.create('item', { name: 'v1' }) as unknown as { id: string };
		for (let i = 2; i <= 20; i++) db.update('item', item.id, { name: `v${i}` });
		expect(journalRows(tables)).toBe(1);
	});

	it('replays the journal over a stale snapshot on cold start', () => {
		const { db, tables } = boot();
		const keep = db.create('item', { name: 'keep' }) as unknown as { id: string };
		const edit = db.create('item', { name: 'before' }) as unknown as { id: string };
		const gone = db.create('item', { name: 'doomed' }) as unknown as { id: string };
		db.update('item', edit.id, { name: 'after' });
		db.delete('item', gone.id);

		// The crash window: the only snapshot on disk is the empty one written when
		// the index was first built — every doc above exists solely in the journal.
		expect(snapshotDocIds(tables)).toEqual([]);
		expect(journalRows(tables)).toBe(3);

		const cold = boot(tables);
		expect(names(cold.db)).toEqual(['after', 'keep']);
		expect(() => cold.db.get('item', gone.id)).toThrow();
		// The tombstone survived too, so incremental clients still learn of the delete
		const sync = cold.db.sync({ start_updated_at: 0, limit: 100 });
		expect((sync.entity.item as { deleted: string[] }).deleted).toContain(gone.id);
		const synced = sync.entity.item as { created: { id: string }[]; updated: { id: string }[] };
		expect([...synced.created, ...synced.updated].map((doc) => doc.id)).toEqual(
			expect.arrayContaining([keep.id, edit.id]),
		);
	});

	it('compacts into a snapshot and empties the journal once past the threshold', async () => {
		DatabaseServer.MAX_SEARCH_JOURNAL_ROWS = 5;
		const { db, tables } = boot();
		for (let i = 0; i < 8; i++) db.create('item', { name: `item ${i}` });

		// Compaction is scheduled off the write path, so nothing has happened yet
		expect(journalRows(tables)).toBe(8);
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(journalRows(tables)).toBe(0);
		expect(snapshotDocIds(tables)).toHaveLength(8);

		// A cold boot now reads everything from the snapshot alone
		const cold = boot(tables);
		expect(names(cold.db)).toHaveLength(8);
	});

	it('stays correct across a compaction followed by more journaled writes', async () => {
		DatabaseServer.MAX_SEARCH_JOURNAL_ROWS = 3;
		const { db, tables } = boot();
		for (let i = 0; i < 5; i++) db.create('item', { name: `old ${i}` });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(journalRows(tables)).toBe(0);

		const post = db.create('item', { name: 'post-compaction' }) as unknown as { id: string };
		expect(snapshotDocIds(tables)).not.toContain(post.id);

		const cold = boot(tables);
		expect(names(cold.db)).toContain('post-compaction');
		expect(names(cold.db)).toHaveLength(6);
	});

	it('leaves no journal rows and no index changes when a batch throws', () => {
		const { db, tables } = boot();
		db.create('item', { name: 'committed' });
		const rows_before = journalRows(tables);

		expect(() =>
			db.batch(() => {
				db.create('item', { name: 'doomed a' });
				db.create('item', { name: 'doomed b' });
				throw new Error('boom');
			}),
		).toThrow('boom');

		expect(journalRows(tables)).toBe(rows_before);
		// The in-memory orama index was mutated before the rollback, so it must have
		// been dropped — otherwise the doomed docs stay searchable (and get baked
		// into the next snapshot).
		expect(names(db)).toEqual(['committed']);
		expect(names(boot(tables).db)).toEqual(['committed']);
	});
});
