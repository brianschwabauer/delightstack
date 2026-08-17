// @vitest-environment node
/**
 * `DatabaseServer`'s entity API — get/create/update/delete/transaction/exec —
 * over **real SQLite**.
 *
 * This suite used to hand the server a `{ exec: vi.fn() }` that pattern-matched
 * SQL strings and replayed canned rows, with `@orama/orama` and `@msgpack/msgpack`
 * mocked on top. With the search index living in SQL, that shape could no longer
 * tell the truth about anything: the write path now writes postings in the same
 * transaction as the entity row, so a fake that never executes a statement is a
 * fake of the entire feature. It therefore drives the production class against
 * `node:sqlite` through the `DurableObjectState` façade in
 * `search/__tests__/sqlite_harness.ts` — the same harness the native integration
 * suite uses — and asserts through the public API.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseServer } from './db.server';
import { Database } from '../schema/schema';
import { createDurableObjectState } from '../search/__tests__/sqlite_harness';

vi.mock('cloudflare:workers', () => {
	class DurableObject {
		constructor(
			public ctx: unknown,
			public env: unknown,
		) {}
	}
	return { DurableObject };
});

const userTable = Database.table('users', (s) => ({
	id: s.primaryKey(),
	name: s.string().searchable(),
	email: s.string().searchable().optional(),
	profile: s
		.object({
			nickname: s.string().optional(),
		})
		.optional(),
}));

const CONFIG = { users: userTable } as unknown as Record<string, Database.Table>;

interface Fixture {
	db: DatabaseServer<Record<string, Database.Table>>;
	state: ReturnType<typeof createDurableObjectState>;
}

function createServer(config: Record<string, Database.Table> = CONFIG): Fixture {
	const state = createDurableObjectState();
	const db = new DatabaseServer(
		config as never,
		() => undefined,
		state.ctx as never,
		{ DEV: true } as never,
	) as DatabaseServer<Record<string, Database.Table>>;
	return { db, state };
}

describe('DatabaseServer: entity API', () => {
	let fixture: Fixture;
	beforeEach(() => {
		fixture = createServer();
	});
	afterEach(() => fixture.state.close());

	it('creates the entity table from the config', () => {
		const columns = fixture.state.db
			.prepare(`PRAGMA table_info(users)`)
			.all()
			.map((row) => (row as { name: string }).name);
		expect(columns).toEqual(
			expect.arrayContaining(['id', 'name', 'email', 'json', 'created_at', 'updated_at']),
		);
	});

	it('fetches an entity', () => {
		const created = fixture.db.create('users', {
			name: 'Test User',
		} as never) as unknown as { id: string };
		expect(fixture.db.get('users', created.id)).toMatchObject({
			id: created.id,
			name: 'Test User',
		});
	});

	it('throws 404 for a missing entity', () => {
		expect(() => fixture.db.get('users', 'nonexistent')).toThrow(
			expect.objectContaining({ status: 404 }),
		);
	});

	it('throws 400 for an invalid entity type', () => {
		expect(() => fixture.db.get('nonexistent_type' as never, '123')).toThrow(
			expect.objectContaining({ status: 400 }),
		);
	});

	it('creates an entity with generated id and timestamps', () => {
		const created = fixture.db.create('users', {
			name: 'New User',
			email: 'test@example.com',
		} as never) as unknown as Record<string, unknown>;
		expect(created.id).toEqual(expect.any(String));
		expect(created.created_at).toEqual(expect.any(Number));
		expect(created.updated_at).toEqual(created.created_at);
		expect(created.email).toBe('test@example.com');
	});

	it('deep-merges an update and bumps updated_at', () => {
		const created = fixture.db.create('users', {
			name: 'Old Name',
			profile: { nickname: 'old' },
		} as never) as unknown as { id: string; updated_at: number };
		const updated = fixture.db.update('users', created.id, {
			name: 'New Name',
		} as never) as unknown as Record<string, unknown>;
		expect(updated.name).toBe('New Name');
		expect(updated.profile).toEqual({ nickname: 'old' });
		expect(Number(updated.updated_at)).toBeGreaterThan(created.updated_at);
	});

	it('deletes an entity', () => {
		const created = fixture.db.create('users', {
			name: 'Doomed',
		} as never) as unknown as { id: string };
		fixture.db.delete('users', created.id);
		expect(() => fixture.db.get('users', created.id)).toThrow(
			expect.objectContaining({ status: 404 }),
		);
	});

	it('executes a transaction with multiple operations', () => {
		const results = fixture.db.transaction([
			{ create: { type: 'users', data: { name: 'Alice' } } },
			{ create: { type: 'users', data: { name: 'Bob' } } },
		]);
		expect(results).toHaveLength(2);
		expect(results.every((result) => 'entity' in result)).toBe(true);
		expect(fixture.db.list('users', {} as never).count).toBe(2);
	});

	it('rolls the whole transaction back when one operation throws', () => {
		fixture.db.create('users', { name: 'Alice' } as never);
		expect(() =>
			fixture.db.transaction([
				{ create: { type: 'users', data: { name: 'Bob' } } },
				{ update: { type: 'users', id: 'does-not-exist', data: { name: 'x' } } },
			]),
		).toThrow();
		expect(fixture.db.list('users', {} as never).count).toBe(1);
	});

	it('rejects transactions over 5000 operations', () => {
		const ops = Array.from({ length: 5001 }, () => ({
			create: { type: 'users' as const, data: { name: 'x' } },
		}));
		expect(() => fixture.db.transaction(ops)).toThrow();
	});

	it('returns an empty array for an empty transaction', () => {
		expect(fixture.db.transaction([])).toEqual([]);
	});

	it('lists entities with the default query', () => {
		fixture.db.create('users', { name: 'User 1' } as never);
		fixture.db.create('users', { name: 'User 2' } as never);
		const result = fixture.db.list('users', {} as never);
		expect(result.count).toBe(2);
		expect(result.hits).toHaveLength(2);
	});

	it('executes raw SQL with the string overload', () => {
		fixture.db.create('users', { name: 'Alice' } as never);
		expect(fixture.db.exec('SELECT COUNT(*) as count FROM users')).toEqual([
			{ count: 1 },
		]);
	});

	it('does not crash on a corrupt json column and falls back to plain columns', () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		const created = fixture.db.create('users', {
			name: 'Test User',
		} as never) as unknown as { id: string };
		fixture.state.db
			.prepare(`UPDATE users SET json = ? WHERE id = ?`)
			.run('{not valid json', created.id);

		expect(fixture.db.get('users', created.id)).toMatchObject({ name: 'Test User' });
		expect(consoleError).toHaveBeenCalledWith(
			expect.stringContaining(`'users'`),
			expect.anything(),
		);
		expect(consoleError).toHaveBeenCalledWith(
			expect.stringContaining(created.id),
			expect.anything(),
		);
		consoleError.mockRestore();
	});

	it('sanitizes configured index names before interpolating into CREATE INDEX', () => {
		const state = createDurableObjectState();
		const config = {
			users: {
				...userTable,
				config: {
					...userTable.config,
					indexes: [
						{
							name: 'Idx-Users"; DROP TABLE users;--',
							table: 'users',
							unique: false,
							columns: [{ column: 'name', direction: 'ASC' as const }],
						},
					],
				},
			},
		} as unknown as Record<string, Database.Table>;
		new DatabaseServer(
			config as never,
			() => undefined,
			state.ctx as never,
			{
				DEV: true,
			} as never,
		);

		const create_index = state.log.find((entry) => entry.sql.startsWith('CREATE INDEX'));
		expect(create_index?.sql).toBe(
			'CREATE INDEX IF NOT EXISTS "idxusersdroptableusers" ON "users" ("name" ASC);',
		);
		expect(
			state.db
				.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'`)
				.all(),
		).toHaveLength(1);
		state.close();
	});
});

/* -------------------------------------------------------------------------- */
/* FK-derived fields                                                          */
/* -------------------------------------------------------------------------- */

const authorTable = Database.table('authors', (s) => ({
	id: s.primaryKey(),
	name: s.string().searchable(),
}));

const bookTable = Database.table('books', (s) => ({
	id: s.primaryKey(),
	title: s.string().searchable(),
	author_id: s.foreignKey({ type: 'string', table: 'authors', column: 'id' }).optional(),
	author_name: s
		.string()
		.derived(
			['author_id'],
			(_data, refs) => (refs.author_id?.name ?? 'Unknown') as string,
		),
}));

const FK_CONFIG = {
	authors: authorTable,
	books: bookTable,
} as unknown as Record<string, Database.Table>;

describe('DatabaseServer: FK-derived fields', () => {
	let fixture: Fixture;
	beforeEach(() => {
		fixture = createServer(FK_CONFIG);
	});
	afterEach(() => fixture.state.close());

	/** The `author_name` a book's search index and sync payload currently carry. */
	function indexedAuthorName(id: string): unknown {
		const hits = fixture.db.list('books', { limit: 100 } as never).hits as {
			id: string;
			document: Record<string, unknown>;
		}[];
		return hits.find((hit) => hit.id === id)?.document.author_name;
	}

	it('computes FK-derived fields on create', () => {
		const author = fixture.db.create('authors', {
			name: 'Alice',
		} as never) as unknown as { id: string };
		const book = fixture.db.create('books', {
			title: 'Book 1',
			author_id: author.id,
		} as never) as unknown as { id: string };
		expect(indexedAuthorName(book.id)).toBe('Alice');
	});

	it('cascades to dependent books when the author is updated', () => {
		const author = fixture.db.create('authors', {
			name: 'Old Name',
		} as never) as unknown as { id: string };
		const first = fixture.db.create('books', {
			title: 'Book 1',
			author_id: author.id,
		} as never) as unknown as { id: string; updated_at: number };
		const second = fixture.db.create('books', {
			title: 'Book 2',
			author_id: author.id,
		} as never) as unknown as { id: string };

		fixture.db.update('authors', author.id, { name: 'New Name' } as never);

		expect(indexedAuthorName(first.id)).toBe('New Name');
		expect(indexedAuthorName(second.id)).toBe('New Name');
		// The dependent rows must move in the sync timeline or clients never see it.
		expect(
			Number(
				(fixture.db.get('books', first.id) as unknown as { updated_at: number })
					.updated_at,
			),
		).toBeGreaterThan(first.updated_at);
	});

	it('cascades to dependent books when the author is deleted', () => {
		const author = fixture.db.create('authors', {
			name: 'Alice',
		} as never) as unknown as { id: string };
		const book = fixture.db.create('books', {
			title: 'Book 1',
			author_id: author.id,
		} as never) as unknown as { id: string };
		expect(indexedAuthorName(book.id)).toBe('Alice');

		fixture.db.delete('authors', author.id);
		expect(indexedAuthorName(book.id)).toBe('Unknown');
	});
});

/* -------------------------------------------------------------------------- */
/* SQLite reserved words as identifiers                                       */
/* -------------------------------------------------------------------------- */

/**
 * A consumer is free to name a table `transaction` and a column `order`. Every
 * generated statement must therefore double-quote identifiers — unquoted, the
 * boot-time `CREATE TABLE` alone is a syntax error and the DO never comes up.
 */
const reservedTable = Database.table('transaction', (s) => ({
	id: s.primaryKey(),
	order: s.string().searchable().indexable(),
	group: s.string().searchable(),
}));

const RESERVED_CONFIG = { transaction: reservedTable } as unknown as Record<
	string,
	Database.Table
>;

describe('DatabaseServer: reserved-word identifiers', () => {
	let fixture: Fixture;
	beforeEach(() => {
		fixture = createServer(RESERVED_CONFIG);
	});
	afterEach(() => fixture.state.close());

	it('creates a table named `transaction` with a column named `order`', () => {
		// `PRAGMA table_info` reports names UNQUOTED — only the SQL text carries quotes.
		const columns = fixture.state.db
			.prepare(`PRAGMA table_info("transaction")`)
			.all()
			.map((row) => (row as { name: string }).name);
		expect(columns).toEqual(expect.arrayContaining(['id', 'order', 'group', 'json']));
	});

	it('round-trips create/get/update/delete against the reserved names', () => {
		const created = fixture.db.create('transaction', {
			order: 'first',
			group: 'alpha',
		} as never) as unknown as { id: string; order: string };
		expect(created.order).toBe('first');

		expect(
			(fixture.db.get('transaction', created.id) as unknown as { order: string }).order,
		).toBe('first');

		const updated = fixture.db.update('transaction', created.id, {
			order: 'second',
		} as never) as unknown as { order: string; group: string };
		expect(updated.order).toBe('second');
		expect(updated.group).toBe('alpha');

		fixture.db.delete('transaction', created.id);
		expect(() => fixture.db.get('transaction', created.id)).toThrow();
	});

	it('answers a search query against the reserved table', () => {
		fixture.db.create('transaction', { order: 'apricot', group: 'alpha' } as never);
		fixture.db.create('transaction', { order: 'banana', group: 'beta' } as never);

		const results = fixture.db.list('transaction', {
			term: 'apricot',
		} as never) as unknown as { count: number; hits: { document: { order: string } }[] };
		expect(results.count).toBe(1);
		expect(results.hits[0]?.document.order).toBe('apricot');

		const all = fixture.db.list('transaction', {} as never) as unknown as {
			count: number;
		};
		expect(all.count).toBe(2);
	});

	it('creates the configured sql index on the reserved column', () => {
		const index = fixture.state.db
			.prepare(
				`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'transaction' AND name = ?`,
			)
			.all('idx_transaction_order');
		expect(index).toHaveLength(1);
	});

	it('syncs the reserved table', () => {
		const created = fixture.db.create('transaction', {
			order: 'synced',
			group: 'alpha',
		} as never) as unknown as { id: string };

		const response = fixture.db.sync({
			entity: { transaction: { start_updated_at: 0, limit: 10 } },
		} as never) as unknown as {
			entity: { transaction: { created?: { id: string }[] } };
		};
		expect(response.entity.transaction.created?.map((row) => row.id)).toContain(
			created.id,
		);
	});
});
