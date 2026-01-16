// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DatabaseServer } from './db.server';

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

describe('DatabaseServer', () => {
	let dbServer: DatabaseServer<any>;
	let mockStorage: any;
	let mockSql: any;
	let mockCtx: any;
	let mockEnv: any;
	let executedQueries: { sql: string; args: any[] }[] = [];

	const testConfig = {
		users: {
			name: 'users',
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
				orama: {
					schema: {
						id: 'string',
						name: 'string',
						email: 'string',
						updated_at: 'number',
					},
				},
			},
			parse: vi.fn((data) => data),
			toSparse: vi.fn((data) => data),
		},
	};

	beforeEach(() => {
		executedQueries = [];

		// Create a basic mock for the SQL storage
		mockSql = {
			exec: vi.fn((sql, ...args) => {
				executedQueries.push({ sql: sql.toString(), args });

				// Return a fake iterator/cursor for results
				return {
					next: () => ({ done: true, value: undefined }),
					toArray: () => [],
					one: () => undefined,
					[Symbol.iterator]: function* () {
						yield* [];
					},
				};
			}),
		};

		mockStorage = {
			sql: mockSql,
			transactionSync: vi.fn((cb) => cb()),
			getAlarm: vi.fn(),
			setAlarm: vi.fn(),
			deleteAlarm: vi.fn(),
			deleteAll: vi.fn(),
			getBookmarkForTime: vi.fn(),
			onNextSessionRestoreBookmark: vi.fn(),
		};

		mockCtx = {
			id: { toString: () => 'mock-id' },
			storage: mockStorage,
			abort: vi.fn(),
		};

		mockEnv = {
			DEV: true,
		};

		// We need to return an initial state when asked
		mockSql.exec.mockImplementation((sql: string, ...args) => {
			executedQueries.push({ sql, args });

			if (sql.includes('SELECT * FROM state WHERE id = main')) {
				return {
					next: () => ({
						done: false,
						value: {
							id: 'main',
							json: '{}',
							created_at: Date.now(),
							updated_at: Date.now(),
							table_config: {},
							sql_indexes: [],
						},
					}),
					toArray: () => [],
					one: () => undefined,
					[Symbol.iterator]: function* () {
						yield* [];
					},
				};
			}

			if (sql.includes('SELECT * FROM search_index')) {
				return {
					toArray: () => [], // No existing index
					next: () => ({ done: true }),
					one: () => undefined,
					[Symbol.iterator]: function* () {
						yield* [];
					},
				};
			}

			// Default empty result
			return {
				next: () => ({ done: true, value: undefined }),
				toArray: () => [],
				one: () => undefined,
				[Symbol.iterator]: function* () {
					yield* [];
				},
			};
		});

		dbServer = new DatabaseServer(
			testConfig as any,
			() => ({}) as any, // Mock ws
			mockCtx,
			mockEnv,
		);
	});

	it('should initialize and create tables', () => {
		// Verify table creation logic in constructor
		const createTableQuery = executedQueries.find((q) =>
			q.sql.includes('CREATE TABLE IF NOT EXISTS users'),
		);
		expect(createTableQuery).toBeDefined();
		expect(createTableQuery?.sql).toContain('id TEXT PRIMARY KEY');
		expect(createTableQuery?.sql).toContain('name TEXT');
	});

	it('should fetch an entity', () => {
		const mockUser = { id: '123', name: 'Test User' };

		mockSql.exec.mockImplementation((sql: string, ...args) => {
			executedQueries.push({ sql, args });
			if (sql.includes('SELECT * FROM users WHERE id = ?')) {
				return {
					next: () => ({
						done: false,
						value: { ...mockUser },
					}),
					toArray: () => [mockUser],
					one: () => mockUser,
					[Symbol.iterator]: function* () {
						yield mockUser;
					},
				};
			}
			return {
				next: () => ({ done: true, value: undefined }),
				toArray: () => [],
				one: () => undefined,
				[Symbol.iterator]: function* () {
					yield* [];
				},
			};
		});

		const result = dbServer.get('users', '123');
		expect(result).toEqual(mockUser);
		expect(
			executedQueries.some(
				(q) => q.sql.includes('SELECT * FROM users WHERE id = ?') && q.args[0] === '123',
			),
		).toBe(true);
	});

	it('should create an entity', () => {
		const newUser = { name: 'New User', email: 'test@example.com' };
		const createdUser = {
			...newUser,
			id: 'generated-id',
			created_at: 'now',
			updated_at: 'now',
		};

		mockSql.exec.mockImplementation((sql: string, ...args) => {
			executedQueries.push({ sql, args });
			if (sql.startsWith('INSERT INTO users')) {
				return {
					next: () => ({ done: false, value: createdUser }),
					toArray: () => [createdUser],
					one: () => createdUser, // RETURNING * behavior mock
					[Symbol.iterator]: function* () {
						yield createdUser;
					},
				};
			}
			// Default for other queries (rebuildIndex)
			return {
				next: () => ({ done: true, value: undefined }),
				toArray: () => [],
				one: () => undefined,
				[Symbol.iterator]: function* () {
					yield* [];
				},
			};
		});

		const result = dbServer.create('users', newUser);

		expect(result).toEqual(createdUser);
		const insertQuery = executedQueries.find((q) =>
			q.sql.startsWith('INSERT INTO users'),
		);
		expect(insertQuery).toBeDefined();
		expect(insertQuery?.sql).toContain('name, email');
	});

	it('should update an entity', () => {
		const existingUser = {
			id: '123',
			name: 'Old Name',
			created_at: 'then',
			updated_at: 'then',
		};
		const updateData = { name: 'New Name' };
		const updatedUser = { ...existingUser, ...updateData, updated_at: 'now' };

		mockSql.exec.mockImplementation((sql: string, ...args) => {
			executedQueries.push({ sql, args });
			if (sql.includes('SELECT * FROM users WHERE id = ?')) {
				return {
					next: () => ({ done: false, value: existingUser }),
					toArray: () => [existingUser],
					one: () => existingUser,
					[Symbol.iterator]: function* () {
						yield existingUser;
					},
				};
			}
			if (sql.startsWith('UPDATE users')) {
				return {
					next: () => ({ done: false, value: updatedUser }),
					toArray: () => [updatedUser],
					one: () => updatedUser,
					[Symbol.iterator]: function* () {
						yield updatedUser;
					},
				};
			}
			return {
				next: () => ({ done: true, value: undefined }),
				toArray: () => [],
				one: () => undefined,
				[Symbol.iterator]: function* () {
					yield* [];
				},
			};
		});

		const result = dbServer.update('users', '123', updateData);

		expect(result).toEqual(updatedUser);
		const updateQuery = executedQueries.find((q) => q.sql.startsWith('UPDATE users'));
		expect(updateQuery).toBeDefined();
		expect(updateQuery?.sql).toContain('name = ?');
		expect(updateQuery?.args).toContain('New Name');
	});

	it('should delete an entity', () => {
		mockSql.exec.mockImplementation((sql: string, ...args) => {
			executedQueries.push({ sql, args });
			return {
				next: () => ({ done: true, value: undefined }),
				toArray: () => [],
				one: () => undefined,
				[Symbol.iterator]: function* () {
					yield* [];
				},
			};
		});

		dbServer.delete('users', '123');

		const deleteQuery = executedQueries.find((q) =>
			q.sql.startsWith('DELETE FROM users'),
		);
		expect(deleteQuery).toBeDefined();
		expect(deleteQuery?.args).toContain('123');
	});

	it('should list entities with default query', () => {
		mockSql.exec.mockImplementation((sql, ...args) => {
			// Mock loading of search_index chunks if requested
			if (sql.startsWith('SELECT * FROM search_index')) {
				return {
					toArray: () => [],
					next: () => ({ done: true }),
					[Symbol.iterator]: function* () {
						yield* [];
					},
				};
			}
			if (sql.startsWith('SELECT * FROM users')) {
				const item = { id: '1', name: 'User 1', updated_at: 100 };
				return {
					toArray: () => [item],
					next: () => ({ done: true }),
					[Symbol.iterator]: function* () {
						yield item;
					},
				};
			}
			return {
				toArray: () => [],
				next: () => ({ done: true }),
				[Symbol.iterator]: function* () {
					yield* [];
				},
			};
		});

		const result = dbServer.list('users', {});
		expect(result).toBeDefined();
		// Since searchOrama mock returns empty hits, actual result logic might differ,
		// but we verify the method runs without error.
	});
});
