import { describe, it, expect, vi } from 'vitest';
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

// Mock msgpack
vi.mock('@msgpack/msgpack', () => ({
	encode: (_val: any) => new Uint8Array(),
	decode: (_val: any) => ({}),
}));

// fast-equals is intentionally NOT mocked: the 2026-08-10 regression (every DO
// cold start rebuilt every index and bumped its version, forcing every client
// into a permanent full-resync loop) was invisible under the JSON-stringify
// deepEqual stand-in the other suites use — stringify drops the function member
// on both sides, real deepEqual only on the stored one.

/**
 * The orama config as Database.table() actually builds it: it always includes
 * `components.getDocumentIndexId`, a FUNCTION — which JSON.stringify drops when
 * the config is persisted alongside the index.
 */
const ORAMA_CONFIG = {
	schema: {
		id: 'string',
		name: 'string',
		updated_at: 'number',
	},
	sort: { enabled: false },
	components: {
		getDocumentIndexId: (doc: Record<string, any>) => String(doc.id),
	},
};

const testConfig = {
	users: {
		name: 'users',
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
			sortable_fields: ['updated_at', 'name'],
			searchable_fields: ['id', 'name'],
			unique_fields: [],
			orama: ORAMA_CONFIG,
		},
		parse: vi.fn((data: any) => data),
		toSparse: vi.fn((data: any) => data),
	} as unknown as Database.Table,
};

function mockCursor<T extends Record<string, any>>(rows: T[]) {
	let index = 0;
	return {
		next: () => {
			if (index < rows.length) return { done: false, value: rows[index++] };
			return { done: true, value: undefined };
		},
		toArray: () => rows,
		one: () => rows[0],
		[Symbol.iterator]: function* () {
			yield* rows;
		},
	};
}

describe('cold start with a persisted index (2026-08-10 perpetual-resync regression)', () => {
	it('does NOT rebuild or bump the version when only non-serializable config members differ', () => {
		const STORED_VERSION = 3;
		// What persistIndex wrote on the previous boot: the config JSON with the
		// function member silently dropped by JSON.stringify.
		const stored_index_config = JSON.stringify(ORAMA_CONFIG);
		const executed: { sql: string; args: any[] }[] = [];

		const mockSql = {
			exec: vi.fn((sql: string, ...args: any[]) => {
				executed.push({ sql, args });
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
					return mockCursor([
						{
							id: 'users.0',
							index_data: new TextEncoder().encode('{}').buffer,
							index_config: stored_index_config,
							index_version: STORED_VERSION,
							index_format: 'json',
							deleted_entity: '{}',
							first_updated_at: 0,
							last_updated_at: 0,
						},
					]);
				}
				return mockCursor([]);
			}),
		};
		const mockCtx = {
			id: { toString: () => 'mock-id' },
			storage: {
				sql: mockSql,
				transactionSync: vi.fn((cb: () => void) => cb()),
				getAlarm: vi.fn(),
				setAlarm: vi.fn(),
				deleteAlarm: vi.fn(),
				deleteAll: vi.fn(),
				getBookmarkForTime: vi.fn(),
				onNextSessionRestoreBookmark: vi.fn(),
			},
		};

		const dbServer = new DatabaseServer(testConfig, () => ({}) as any, mockCtx as any, {
			DEV: true,
		});

		// A client that is already on the stored version syncs after the "cold
		// start". If the loaded index kept its version, the server reports the
		// SAME version back and sends no schema config — the client keeps its
		// local index. The regression rebuilt here (stored JSON lacks the
		// function member the in-memory config carries), answered version+1 with
		// a full config, and every client discarded its index on every DO wake.
		const res = dbServer.sync({
			entity: { users: { config_version: STORED_VERSION, start_updated_at: Date.now() } },
		} as any);

		expect(res.entity.users?.config_version).toBe(STORED_VERSION);
		expect(res.entity.users?.config).toBeUndefined();
	});
});
