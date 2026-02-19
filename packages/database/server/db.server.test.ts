import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { DatabaseServer } from './db.server';
import type { Database } from '../schema/schema';

// Mock cloudflare:workers
vi.mock('cloudflare:workers', () => {
	class DurableObject {
		constructor(
			public ctx: any,
			public env: any,
		) {}
	}
	return { DurableObject };
});

// Mock @orama/orama
vi.mock('@orama/orama', async () => {
	const actual = await vi.importActual('@orama/orama');
	return {
		...actual,
		create: vi.fn(() => ({})),
		insert: vi.fn(),
		insertMultiple: vi.fn(),
		remove: vi.fn(),
		search: vi.fn(() => ({ hits: [], count: 0, elapsed: 0 })),
		save: vi.fn(() => ({ data: new Uint8Array() })),
		load: vi.fn(),
	};
});

// Mock fast-equals
vi.mock('fast-equals', () => ({
	deepEqual: (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b),
}));

// Mock msgpack
vi.mock('@msgpack/msgpack', () => ({
	encode: (val: any) => new Uint8Array(),
	decode: (val: any) => ({}),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

type TestConfig = Record<string, Database.Table>;

const testConfig: TestConfig = {
	users: {
		name: 'users',
		_: {} as any,
		config: {
			primary_key: 'id',
			primary_key_type: 'string',
			table_definition: {
				id: 'TEXT PRIMARY KEY',
				name: 'TEXT',
				email: 'TEXT',
			},
			indexes: [],
			foreign_keys: {},
			sortable_fields: ['updated_at', 'name'],
			searchable_fields: ['id', 'name', 'email'],
			unique_fields: [],
			orama: {
				schema: {
					id: 'string',
					name: 'string',
					email: 'string',
					updated_at: 'number',
				},
				sort: { enabled: false },
			},
		},
		parse: vi.fn((data: any) => data),
		toSparse: vi.fn((data: any) => data),
	} as unknown as Database.Table,
};

/** Creates a mock SqlStorageCursor that mimics Cloudflare's cursor API */
function mockCursor<T extends Record<string, any>>(rows: T[]) {
	let index = 0;
	return {
		next: () => {
			if (index < rows.length) {
				return { done: false, value: rows[index++] };
			}
			return { done: true, value: undefined };
		},
		toArray: () => rows,
		one: () => rows[0],
		[Symbol.iterator]: function* () {
			yield* rows;
		},
	};
}

function emptyCursor() {
	return mockCursor([]);
}

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('DatabaseServer', () => {
	let dbServer: DatabaseServer<TestConfig>;
	let mockSql: { exec: Mock };
	let executedQueries: { sql: string; args: any[] }[];

	beforeEach(() => {
		executedQueries = [];

		mockSql = {
			exec: vi.fn((sql: string, ...args: any[]) => {
				executedQueries.push({ sql, args });

				if (sql.includes('SELECT * FROM state WHERE id = main')) {
					return mockCursor([{
						id: 'main',
						json: '{}',
						created_at: Date.now(),
						updated_at: Date.now(),
						table_config: {},
						sql_indexes: [],
					}]);
				}

				if (sql.includes('SELECT * FROM search_index')) {
					return emptyCursor();
				}

				return emptyCursor();
			}),
		};

		const mockStorage = {
			sql: mockSql,
			transactionSync: vi.fn((cb: () => void) => cb()),
			getAlarm: vi.fn(),
			setAlarm: vi.fn(),
			deleteAlarm: vi.fn(),
			deleteAll: vi.fn(),
			getBookmarkForTime: vi.fn(),
			onNextSessionRestoreBookmark: vi.fn(),
		};

		const mockCtx = {
			id: { toString: () => 'mock-id' },
			storage: mockStorage,
			abort: vi.fn(),
		};

		const mockEnv = { DEV: true };

		dbServer = new DatabaseServer(
			testConfig,
			() => ({}) as any,
			mockCtx as any,
			mockEnv,
		);
	});

	// ── Initialization ──────────────────────────────────────────────────

	it('should initialize and create tables', () => {
		const createTableQuery = executedQueries.find((q) =>
			q.sql.includes('CREATE TABLE IF NOT EXISTS users'),
		);
		expect(createTableQuery).toBeDefined();
		expect(createTableQuery!.sql).toContain('id TEXT PRIMARY KEY');
		expect(createTableQuery!.sql).toContain('name TEXT');
	});

	// ── Single get ──────────────────────────────────────────────────────

	it('should fetch an entity', () => {
		const mockUser = { id: '123', name: 'Test User' };

		mockSql.exec.mockImplementation((sql: string, ...args: any[]) => {
			executedQueries.push({ sql, args });
			if (sql.includes('SELECT * FROM users WHERE id = ?')) {
				return mockCursor([{ ...mockUser }]);
			}
			return emptyCursor();
		});

		const result = dbServer.get('users', '123');
		expect(result).toEqual(mockUser);
		expect(
			executedQueries.some(
				(q) => q.sql.includes('SELECT * FROM users WHERE id = ?') && q.args[0] === '123',
			),
		).toBe(true);
	});

	it('should throw 404 for missing entity', () => {
		mockSql.exec.mockImplementation((sql: string, ...args: any[]) => {
			executedQueries.push({ sql, args });
			return emptyCursor();
		});

		expect(() => dbServer.get('users', 'nonexistent')).toThrow();
		try {
			dbServer.get('users', 'nonexistent');
		} catch (err: any) {
			expect(err.status).toBe(404);
		}
	});

	it('should throw 400 for invalid entity type', () => {
		expect(() => (dbServer as any).get('nonexistent_type', '123')).toThrow();
		try {
			(dbServer as any).get('nonexistent_type', '123');
		} catch (err: any) {
			expect(err.status).toBe(400);
		}
	});

	// ── Batch get ───────────────────────────────────────────────────────

	it('should batch get multiple entities', () => {
		const user1 = { id: '1', name: 'Alice' };
		const user2 = { id: '2', name: 'Bob' };

		mockSql.exec.mockImplementation((sql: string, ...args: any[]) => {
			executedQueries.push({ sql, args });
			if (sql.includes('WHERE id IN')) {
				return mockCursor([user1, user2]);
			}
			return emptyCursor();
		});

		const results = dbServer.get([
			{ entity_type: 'users', id: '1' },
			{ entity_type: 'users', id: '2' },
		]);

		expect(results).toHaveLength(2);
		expect(results[0]).toEqual(user1);
		expect(results[1]).toEqual(user2);

		// Should use a single IN query, not N individual queries
		const inQuery = executedQueries.find((q) => q.sql.includes('WHERE id IN'));
		expect(inQuery).toBeDefined();
	});

	it('should return empty array for empty batch', () => {
		const results = dbServer.get([]);
		expect(results).toEqual([]);
	});

	it('should preserve order in batch get results', () => {
		const user1 = { id: '1', name: 'Alice' };
		const user2 = { id: '2', name: 'Bob' };

		mockSql.exec.mockImplementation((sql: string, ...args: any[]) => {
			executedQueries.push({ sql, args });
			if (sql.includes('WHERE id IN')) {
				// Return in reverse order from DB
				return mockCursor([user2, user1]);
			}
			return emptyCursor();
		});

		const results = dbServer.get([
			{ entity_type: 'users', id: '1' },
			{ entity_type: 'users', id: '2' },
		]);

		// Results should be in request order, not DB order
		expect(results[0]).toEqual(user1);
		expect(results[1]).toEqual(user2);
	});

	it('should throw 404 if any batch entity is missing', () => {
		const user1 = { id: '1', name: 'Alice' };

		mockSql.exec.mockImplementation((sql: string, ...args: any[]) => {
			executedQueries.push({ sql, args });
			if (sql.includes('WHERE id IN')) {
				return mockCursor([user1]); // Only one of two requested
			}
			return emptyCursor();
		});

		expect(() =>
			dbServer.get([
				{ entity_type: 'users', id: '1' },
				{ entity_type: 'users', id: 'missing' },
			]),
		).toThrow();
	});

	// ── Create ──────────────────────────────────────────────────────────

	it('should create an entity', () => {
		const newUser = { name: 'New User', email: 'test@example.com' };
		const createdUser = {
			...newUser,
			id: 'generated-id',
			created_at: 'now',
			updated_at: 'now',
		};

		mockSql.exec.mockImplementation((sql: string, ...args: any[]) => {
			executedQueries.push({ sql, args });
			if (sql.startsWith('INSERT INTO users')) {
				return mockCursor([createdUser]);
			}
			return emptyCursor();
		});

		const result = dbServer.create('users', newUser as any);

		expect(result).toEqual(createdUser);
		const insertQuery = executedQueries.find((q) =>
			q.sql.startsWith('INSERT INTO users'),
		);
		expect(insertQuery).toBeDefined();
		expect(insertQuery!.sql).toContain('name, email');
	});

	// ── Update ──────────────────────────────────────────────────────────

	it('should update an entity', () => {
		const existingUser = {
			id: '123',
			name: 'Old Name',
			created_at: 'then',
			updated_at: 'then',
		};
		const updateData = { name: 'New Name' };
		const updatedUser = { ...existingUser, ...updateData, updated_at: 'now' };

		mockSql.exec.mockImplementation((sql: string, ...args: any[]) => {
			executedQueries.push({ sql, args });
			if (sql.includes('SELECT * FROM users WHERE id = ?')) {
				return mockCursor([existingUser]);
			}
			if (sql.startsWith('UPDATE users')) {
				return mockCursor([updatedUser]);
			}
			return emptyCursor();
		});

		const result = dbServer.update('users', '123', updateData);

		expect(result).toEqual(updatedUser);
		const updateQuery = executedQueries.find((q) => q.sql.startsWith('UPDATE users'));
		expect(updateQuery).toBeDefined();
		expect(updateQuery!.sql).toContain('name = ?');
		expect(updateQuery!.args).toContain('New Name');
	});

	// ── Delete ──────────────────────────────────────────────────────────

	it('should delete an entity', () => {
		mockSql.exec.mockImplementation((sql: string, ...args: any[]) => {
			executedQueries.push({ sql, args });
			return emptyCursor();
		});

		dbServer.delete('users', '123');

		const deleteQuery = executedQueries.find((q) =>
			q.sql.startsWith('DELETE FROM users'),
		);
		expect(deleteQuery).toBeDefined();
		expect(deleteQuery!.args).toContain('123');
	});

	// ── Transaction ─────────────────────────────────────────────────────

	it('should execute a transaction with multiple operations', () => {
		const user1 = { id: 'u1', name: 'Alice', created_at: 'now', updated_at: 'now' };
		const user2 = { id: 'u2', name: 'Bob', created_at: 'now', updated_at: 'now' };

		mockSql.exec.mockImplementation((sql: string, ...args: any[]) => {
			executedQueries.push({ sql, args });
			if (sql.startsWith('INSERT INTO users')) {
				// Return different users for each insert
				const name = args.find((a: any) => typeof a === 'string' && a !== 'u1' && a !== 'u2');
				if (name === 'Alice') return mockCursor([user1]);
				return mockCursor([user2]);
			}
			return emptyCursor();
		});

		const results = dbServer.transaction([
			{ create: { type: 'users', data: { name: 'Alice' } } },
			{ create: { type: 'users', data: { name: 'Bob' } } },
		]);

		expect(results).toHaveLength(2);
		results.forEach((result) => {
			expect('entity' in result).toBe(true);
		});
	});

	it('should reject transactions over 5000 operations', () => {
		const ops = Array.from({ length: 5001 }, () => ({
			create: { type: 'users' as const, data: { name: 'x' } },
		}));

		expect(() => dbServer.transaction(ops)).toThrow();
	});

	it('should return empty array for empty transaction', () => {
		const results = dbServer.transaction([]);
		expect(results).toEqual([]);
	});

	// ── List ────────────────────────────────────────────────────────────

	it('should list entities with default query', () => {
		mockSql.exec.mockImplementation((sql: string, ...args: any[]) => {
			executedQueries.push({ sql, args });
			if (sql.startsWith('SELECT * FROM search_index')) {
				return emptyCursor();
			}
			if (sql.startsWith('SELECT * FROM users')) {
				const item = { id: '1', name: 'User 1', updated_at: 100 };
				return mockCursor([item]);
			}
			return emptyCursor();
		});

		const result = dbServer.list('users', {} as any);
		expect(result).toBeDefined();
	});

	// ── exec ────────────────────────────────────────────────────────────

	it('should execute raw SQL with string overload', () => {
		mockSql.exec.mockImplementation((sql: string, ...args: any[]) => {
			executedQueries.push({ sql, args });
			if (sql === 'SELECT COUNT(*) as count FROM users') {
				return mockCursor([{ count: 42 }]);
			}
			return emptyCursor();
		});

		const results = dbServer.exec('SELECT COUNT(*) as count FROM users');
		expect(results).toEqual([{ count: 42 }]);
	});
});
