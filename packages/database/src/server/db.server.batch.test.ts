import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseServer } from './db.server';
import { Database } from '../schema/schema';

// batch(): many imperative writes → ONE index serialization per touched entity,
// atomic commit, and websocket broadcasts held until the batch commits.

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
	/** Count of writes into the search_index table (one per index save chunk set). */
	let index_saves = 0;

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
				[...getTable(table_name).values()].filter((r) =>
					String(r.id).startsWith(prefix),
				),
			);
		}
		if ((match = sql.match(/^DELETE FROM (\w+) WHERE id LIKE \?/))) {
			const [, table_name] = match;
			if (table_name === 'search_index') index_saves++;
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

	return { exec: vi.fn(exec), tables, indexSaves: () => index_saves };
}

const itemTable = Database.table('item', (s) => ({
	id: s.primaryKey(),
	name: s.string().searchable(),
}));

function createServer(ws?: { entityChanged: ReturnType<typeof vi.fn> }) {
	const sql = createFakeSqlStorage();
	const storage = {
		sql,
		transactionSync: (cb: () => unknown) => cb(),
		deleteAlarm: vi.fn(),
		deleteAll: vi.fn(),
	};
	const ctx = { id: { toString: () => 'test-id' }, storage, abort: vi.fn() };
	const db = new DatabaseServer(
		{ item: itemTable as unknown as Database.Table },
		() => ws,
		ctx as any,
		{ DEV: true } as any,
	);
	return { db, sql };
}

const T0 = 1_750_000_000_000;

describe('DatabaseServer.batch()', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(T0);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('serializes each touched index once for the whole batch', () => {
		const { db, sql } = createServer();
		db.create('item', { name: 'warmup' }); // creates the table + first save
		const before = sql.indexSaves();

		db.batch(() => {
			for (let i = 0; i < 25; i++) db.create('item', { name: `item ${i}` });
		});

		// 25 creates → exactly ONE index save (was 25).
		expect(sql.indexSaves() - before).toBe(1);
		// All rows searchable.
		const res = db.list('item', { limit: 100 });
		expect((res as { count: number }).count).toBe(26);
	});

	it('returns the callback value and works when nested', () => {
		const { db } = createServer();
		const out = db.batch(() => db.batch(() => db.create('item', { name: 'nested' })));
		expect((out as unknown as { name: string }).name).toBe('nested');
	});

	it('holds websocket broadcasts until the batch completes', () => {
		const entityChanged = vi.fn();
		const { db } = createServer({ entityChanged });

		db.batch(() => {
			db.create('item', { name: 'a' });
			db.create('item', { name: 'b' });
			expect(entityChanged).not.toHaveBeenCalled(); // nothing leaks mid-batch
		});
		expect(entityChanged).toHaveBeenCalledTimes(2);
		// Broadcast carries the sparse projection for client indexes.
		expect(entityChanged.mock.calls[0][5]).toMatchObject({ name: 'a' });
	});

	it('a throw inside the batch suppresses its broadcasts', () => {
		const entityChanged = vi.fn();
		const { db } = createServer({ entityChanged });
		expect(() =>
			db.batch(() => {
				db.create('item', { name: 'doomed' });
				throw new Error('boom');
			}),
		).toThrow('boom');
		expect(entityChanged).not.toHaveBeenCalled();
	});
});
