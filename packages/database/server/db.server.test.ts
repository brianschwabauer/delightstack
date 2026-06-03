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
					return mockCursor([
						{
							id: 'main',
							json: '{}',
							created_at: Date.now(),
							updated_at: Date.now(),
							table_config: {},
							sql_indexes: [],
						},
					]);
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

		dbServer = new DatabaseServer(testConfig, () => ({}) as any, mockCtx as any, mockEnv);
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
				const name = args.find(
					(a: any) => typeof a === 'string' && a !== 'u1' && a !== 'u2',
				);
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

// ── FK-Derived Fields Tests ─────────────────────────────────────────────────

describe('DatabaseServer: FK-derived fields', () => {
	let dbServer: DatabaseServer<Record<string, Database.Table>>;
	let mockSql: { exec: Mock };
	let executedQueries: { sql: string; args: any[] }[];

	// Derived function for computing author_name from FK ref
	const authorNameFn = (data: any, refs: any) => refs.author_id?.name ?? 'Unknown';

	const fkTestConfig: Record<string, Database.Table> = {
		authors: {
			name: 'authors',
			_: {} as any,
			config: {
				primary_key: 'id',
				primary_key_type: 'string',
				table_definition: {
					id: 'TEXT PRIMARY KEY',
					name: 'TEXT',
				},
				indexes: [],
				foreign_keys: {},
				derived_fields: {},
				sortable_fields: ['updated_at'],
				searchable_fields: ['id', 'name'],
				unique_fields: [],
				orama: {
					schema: { id: 'string', name: 'string', updated_at: 'number' },
					sort: { enabled: false },
				},
			},
			parse: vi.fn((data: any) => data),
			toSparse: vi.fn((data: any) => ({
				id: data.id,
				name: data.name,
				updated_at: data.updated_at,
				created_at: data.created_at,
			})),
		} as unknown as Database.Table,
		books: {
			name: 'books',
			_: {
				author_name: {
					_: {
						type: 'string',
						derived: true,
						derived_fn: authorNameFn,
						derived_foreign_keys: ['author_id'],
						searchable: true,
					},
				},
			} as any,
			config: {
				primary_key: 'id',
				primary_key_type: 'string',
				table_definition: {
					id: 'TEXT PRIMARY KEY',
					title: 'TEXT',
					author_id: 'TEXT REFERENCES authors(id)',
				},
				indexes: [],
				foreign_keys: {
					author_id: { type: 'string', table: 'authors', column: 'id' },
				},
				derived_fields: {
					author_name: { foreign_keys: ['author_id'] },
				},
				sortable_fields: ['updated_at'],
				searchable_fields: ['id', 'title', 'author_name'],
				unique_fields: [],
				orama: {
					schema: {
						id: 'string',
						title: 'string',
						author_name: 'string',
						updated_at: 'number',
					},
					sort: { enabled: false },
				},
			},
			parse: vi.fn((data: any) => data),
			toSparse: vi.fn((data: any) => ({
				id: data.id,
				title: data.title,
				updated_at: data.updated_at,
				created_at: data.created_at,
			})),
		} as unknown as Database.Table,
	};

	beforeEach(() => {
		executedQueries = [];

		mockSql = {
			exec: vi.fn((sql: string, ...args: any[]) => {
				executedQueries.push({ sql, args });

				if (sql.includes('SELECT * FROM state WHERE id = main')) {
					return mockCursor([
						{
							id: 'main',
							json: '{}',
							created_at: Date.now(),
							updated_at: Date.now(),
							table_config: {},
							sql_indexes: [],
						},
					]);
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
			fkTestConfig,
			() => ({}) as any,
			mockCtx as any,
			mockEnv,
		);
	});

	it('should build reverse FK map from config', () => {
		// The reverse FK map should know that updating 'authors' may affect 'books'
		// We can't directly access #reverse_fk_map, but we can test the behavior
		// by verifying cascade reindexing occurs on author update
		expect(dbServer).toBeDefined();
	});

	it('should compute FK-derived fields on create', () => {
		const mockAuthor = { id: 'a1', name: 'Alice', created_at: 100, updated_at: 100 };
		const mockBook = {
			id: 'b1',
			title: 'Book 1',
			author_id: 'a1',
			created_at: 200,
			updated_at: 200,
		};

		mockSql.exec.mockImplementation((sql: string, ...args: any[]) => {
			executedQueries.push({ sql, args });
			// When creating the book, the system will fetch the referenced author
			if (sql.includes('SELECT * FROM authors WHERE id = ?') && args[0] === 'a1') {
				return mockCursor([mockAuthor]);
			}
			if (sql.startsWith('INSERT INTO books')) {
				return mockCursor([mockBook]);
			}
			if (sql.includes('SELECT * FROM search_index')) {
				return emptyCursor();
			}
			return emptyCursor();
		});

		const results = dbServer.transaction([
			{ create: { type: 'books', data: { title: 'Book 1', author_id: 'a1' } } },
		]);

		expect(results).toHaveLength(1);

		// Verify the author was fetched for FK-derived computation
		const authorFetch = executedQueries.find(
			(q) => q.sql.includes('SELECT * FROM authors WHERE id = ?') && q.args[0] === 'a1',
		);
		expect(authorFetch).toBeDefined();
	});

	it('should cascade reindex books when author is updated', () => {
		const mockAuthor = { id: 'a1', name: 'New Name', created_at: 100, updated_at: 300 };
		const mockExistingAuthor = {
			id: 'a1',
			name: 'Old Name',
			created_at: 100,
			updated_at: 100,
		};
		const mockBook1 = {
			id: 'b1',
			title: 'Book 1',
			author_id: 'a1',
			created_at: 200,
			updated_at: 200,
		};
		const mockBook2 = {
			id: 'b2',
			title: 'Book 2',
			author_id: 'a1',
			created_at: 200,
			updated_at: 200,
		};

		mockSql.exec.mockImplementation((sql: string, ...args: any[]) => {
			executedQueries.push({ sql, args });
			// GET existing author for update
			if (sql.includes('SELECT * FROM authors WHERE id = ?') && args[0] === 'a1') {
				return mockCursor([mockExistingAuthor]);
			}
			// UPDATE author
			if (sql.startsWith('UPDATE authors')) {
				return mockCursor([mockAuthor]);
			}
			// CASCADE: find books referencing this author
			if (sql.includes('SELECT * FROM books WHERE author_id = ?') && args[0] === 'a1') {
				return mockCursor([mockBook1, mockBook2]);
			}
			// CASCADE: fetch author for each book's FK-derived recomputation
			if (sql.includes('SELECT * FROM authors WHERE id = ? LIMIT 1')) {
				return mockCursor([mockAuthor]);
			}
			if (sql.includes('SELECT * FROM search_index')) {
				return emptyCursor();
			}
			return emptyCursor();
		});

		const results = dbServer.transaction([
			{ update: { type: 'authors', id: 'a1', data: { name: 'New Name' } } },
		]);

		expect(results).toHaveLength(1);

		// Verify cascade query was executed — books referencing author a1 were found
		const cascadeQuery = executedQueries.find(
			(q) =>
				q.sql.includes('SELECT * FROM books WHERE author_id = ?') && q.args[0] === 'a1',
		);
		expect(cascadeQuery).toBeDefined();
	});

	it('should cascade reindex books when author is deleted', () => {
		const mockBook1 = {
			id: 'b1',
			title: 'Book 1',
			author_id: 'a1',
			created_at: 200,
			updated_at: 200,
		};

		mockSql.exec.mockImplementation((sql: string, ...args: any[]) => {
			executedQueries.push({ sql, args });
			// CASCADE: find books referencing this author
			if (sql.includes('SELECT * FROM books WHERE author_id = ?') && args[0] === 'a1') {
				return mockCursor([mockBook1]);
			}
			// CASCADE: fetch author for FK-derived recomputation (author is now deleted)
			if (sql.includes('SELECT * FROM authors WHERE id = ? LIMIT 1')) {
				return emptyCursor(); // Author no longer exists
			}
			if (sql.includes('SELECT * FROM search_index')) {
				return emptyCursor();
			}
			return emptyCursor();
		});

		const results = dbServer.transaction([{ delete: { type: 'authors', id: 'a1' } }]);

		expect(results).toHaveLength(1);

		// Verify cascade query was executed
		const cascadeQuery = executedQueries.find(
			(q) =>
				q.sql.includes('SELECT * FROM books WHERE author_id = ?') && q.args[0] === 'a1',
		);
		expect(cascadeQuery).toBeDefined();
	});
});
