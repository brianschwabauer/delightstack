// @vitest-environment node
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { Database } from '../schema/schema';

// `database.worker` reads `self` at module scope, so it is imported lazily —
// after the stub below exists.
let withoutPaths: (
	schema: Record<string, unknown>,
	paths: readonly string[],
) => Record<string, unknown>;

beforeAll(async () => {
	(globalThis as any).self = { addEventListener: vi.fn() };
	({ withoutPaths } = await import('./database.worker'));
});

// Routing and index pruning for `.serverOnly()`. The server
// half — that the field is indexed there and stripped from the wire — lives in
// `db.server.server_index.test.ts`; this file owns what the client does with a
// field it knows about but will never receive.

vi.mock('comlink', () => ({ expose: vi.fn() }));

const noteTable = Database.table('note', (s) => ({
	id: s.primaryKey(),
	title: s.string().searchable(),
	body: s.string().searchable().serverOnly(),
}));

let database_counter = 0;
let db_name = 'server-index-0';

beforeEach(() => {
	db_name = `server-index-${database_counter++}`;
});

async function createWorker() {
	(globalThis as any).self = { addEventListener: vi.fn() };
	const { DatabaseWorker } = await import('./database.worker');
	const worker = new DatabaseWorker();
	await worker.init({
		tables: {
			note: {
				index_schema: noteTable.config.index_schema as never,
				server_indexed_fields: noteTable.config.server_indexed_fields,
				primary_key: 'id',
			},
		},
		entities: { note: { search_mode: 'client' } },
		db_name,
	});
	return worker as unknown as {
		list: (type: string, query: Record<string, unknown>) => Promise<unknown>;
		destroy(): Promise<void>;
	};
}

describe('withoutPaths', () => {
	it('removes a top-level path and leaves the rest', () => {
		const pruned = withoutPaths({ title: 'string', body: 'string' }, ['body']);
		expect(pruned).toEqual({ title: 'string' });
	});

	it('removes a nested path without mutating the input', () => {
		const schema = { meta: { author: 'string', notes: 'string' } };
		const pruned = withoutPaths(schema, ['meta.notes']);
		expect(pruned).toEqual({ meta: { author: 'string' } });
		// The caller's table config must survive intact.
		expect(schema).toEqual({ meta: { author: 'string', notes: 'string' } });
	});

	it('returns the input untouched when there is nothing to remove', () => {
		const schema = { title: 'string' };
		expect(withoutPaths(schema, [])).toBe(schema);
	});
});

describe('routing a query that names a server-only field', () => {
	it("rejects source: 'client' and names the field", async () => {
		const worker = await createWorker();
		await expect(
			worker.list('note', { where: { body: 'anything' }, source: 'client' }),
		).rejects.toThrow(/body/);
		await worker.destroy();
	});

	it("rejects source: 'client' for every place a field can be named", async () => {
		const worker = await createWorker();
		const queries: Record<string, unknown>[] = [
			{ where: { body: 'x' } },
			{ order: [{ field: 'body', direction: 'asc' }] },
			{ facets: { body: {} } },
			{ boost: { body: 2 } },
			{ fields: ['body'] },
			{ distinct_on: 'body' },
		];
		for (const query of queries) {
			await expect(
				worker.list('note', { ...query, source: 'client' }),
				`query ${JSON.stringify(query)} should have been refused`,
			).rejects.toThrow(/serverOnly\(\)/);
		}
		await worker.destroy();
	});

	it("allows source: 'client' for a query that names only synced fields", async () => {
		const worker = await createWorker();
		// Must not throw — `title` is an ordinary searchable field.
		await expect(
			worker.list('note', { where: { title: 'anything' }, source: 'client' }),
		).resolves.toBeDefined();
		await worker.destroy();
	});

	it("allows a bare term search under source: 'client'", async () => {
		const worker = await createWorker();
		// `fields: '*'` means "everything indexed *here*", and on the client that
		// is legitimately a subset. This is coverage-based routing working as
		// designed, not a query the client cannot answer.
		await expect(
			worker.list('note', { term: 'alpha', source: 'client' }),
		).resolves.toBeDefined();
		await worker.destroy();
	});
});
