import { describe, it, expect, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { createDatabaseHandle } from './database.handler';
import { Database } from '../schema/schema';

// Per-entity sync gating at the handler level. The database RPC is a stub —
// what is under test is which entity types reach `db.sync()` and what the
// response says about the ones that didn't. The protocol itself
// (windows, pagination, deferral) is covered by db.server.sync.test.ts.

const itemTable = Database.table('item', (s) => ({
	id: s.primaryKey(),
	name: s.string().searchable(),
}));

const secretTable = Database.table('secret', (s) => ({
	id: s.primaryKey(),
	label: s.string().searchable(),
}));

const tables = {
	item: itemTable as unknown as Database.Table,
	secret: secretTable as unknown as Database.Table,
};

type SyncQuery = { entity?: Record<string, unknown> };

/** A database stub that echoes one document per requested entity type. */
function createDatabase() {
	const sync = vi.fn((query?: unknown) => {
		const entity: Record<string, unknown> = {};
		for (const entity_type of Object.keys((query as SyncQuery)?.entity ?? {})) {
			entity[entity_type] = {
				config_version: 1,
				deleted: [],
				created: [{ id: `${entity_type}-1` }],
				updated: [],
				start_updated_at: 0,
				end_updated_at: 10,
				first_updated_at: 0,
				last_updated_at: 10,
				total_count: 1,
			};
		}
		return {
			start_updated_at: 0,
			end_updated_at: 10,
			first_updated_at: 0,
			last_updated_at: 10,
			entity,
		};
	});
	return {
		sync,
		create: vi.fn(),
		get: vi.fn(),
		list: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
	};
}

/** A POST /api/sync event with a session, and the given (optional) body. */
function syncEvent(body?: unknown): RequestEvent {
	return {
		url: new URL('http://localhost/api/sync'),
		request: new Request('http://localhost/api/sync', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
		locals: { session: { user_id: 'user_1' } },
	} as unknown as RequestEvent;
}

/** The entity map of the sync request the handler actually forwarded. */
function forwardedTypes(database: ReturnType<typeof createDatabase>): string[] {
	const query = database.sync.mock.calls.at(-1)?.[0] as SyncQuery | undefined;
	return Object.keys(query?.entity ?? {}).sort();
}

async function runSync(
	handle: ReturnType<typeof createDatabaseHandle>,
	body?: unknown,
): Promise<Record<string, any>> {
	const response = await handle({
		event: syncEvent(body),
		resolve: async () => new Response(null, { status: 404 }),
	} as never);
	expect(response.status).toBe(200);
	return (await response.json()) as Record<string, any>;
}

const denySecret = {
	secret: {
		beforeSync: () => {
			throw new Error('not your secrets');
		},
	},
};

describe('createDatabaseHandle — per-entity sync gating', () => {
	it('denies only the entity type whose beforeSync throws', async () => {
		const database = createDatabase();
		const handle = createDatabaseHandle({
			getDatabase: () => database,
			tables,
			hooks: denySecret,
		});

		const body = await runSync(handle, { entity: { item: {}, secret: {} } });

		// The denied type never reached the database …
		expect(forwardedTypes(database)).toEqual(['item']);
		// … and came back as an explicit refusal carrying no documents.
		expect(body.entity.secret.denied).toBe(true);
		expect(body.entity.secret.created).toEqual([]);
		expect(body.entity.secret.updated).toEqual([]);
		expect(body.entity.secret.deleted).toEqual([]);
		// The allowed type synced normally.
		expect(body.entity.item.denied).toBeUndefined();
		expect(body.entity.item.created).toHaveLength(1);
	});

	it('expands an omitted entity map before gating, so it cannot be bypassed', async () => {
		const database = createDatabase();
		const handle = createDatabaseHandle({
			getDatabase: () => database,
			tables,
			hooks: denySecret,
		});

		// No `entity` map at all — the documented "sync everything" request.
		const body = await runSync(handle, {});

		expect(forwardedTypes(database)).toEqual(['item']);
		expect(body.entity.secret.denied).toBe(true);
		expect(body.entity.item.created).toHaveLength(1);
	});

	it('gates an omitted body the same way', async () => {
		const database = createDatabase();
		const handle = createDatabaseHandle({
			getDatabase: () => database,
			tables,
			hooks: denySecret,
		});

		const body = await runSync(handle);

		expect(forwardedTypes(database)).toEqual(['item']);
		expect(body.entity.secret.denied).toBe(true);
	});

	it('never forwards an entity type that is not configured', async () => {
		const database = createDatabase();
		const handle = createDatabaseHandle({ getDatabase: () => database, tables });

		const body = await runSync(handle, { entity: { item: {}, ghost: {} } });

		expect(forwardedTypes(database)).toEqual(['item']);
		expect(body.entity.ghost).toBeUndefined();
	});

	it('forwards every configured type when no hook denies one', async () => {
		const database = createDatabase();
		const handle = createDatabaseHandle({ getDatabase: () => database, tables });

		const body = await runSync(handle, { entity: { item: {}, secret: {} } });

		expect(forwardedTypes(database)).toEqual(['item', 'secret']);
		expect(body.entity.item.denied).toBeUndefined();
		expect(body.entity.secret.denied).toBeUndefined();
	});

	it('preserves each type’s per-entity range and receives the request event', async () => {
		const database = createDatabase();
		const seen: unknown[] = [];
		const handle = createDatabaseHandle({
			getDatabase: () => database,
			tables,
			hooks: {
				item: {
					beforeSync: ({ event }) => {
						seen.push((event.locals as { session?: unknown }).session);
					},
				},
			},
		});

		await runSync(handle, {
			entity: { item: { start_updated_at: 42, limit: 5 }, secret: {} },
		});

		expect(seen).toEqual([{ user_id: 'user_1' }]);
		const query = database.sync.mock.calls.at(-1)?.[0] as SyncQuery;
		expect(query.entity?.item).toEqual({ start_updated_at: 42, limit: 5 });
	});

	it('a denial does not fail the request when every type is denied', async () => {
		const database = createDatabase();
		const handle = createDatabaseHandle({
			getDatabase: () => database,
			tables,
			hooks: {
				...denySecret,
				item: {
					beforeSync: () => {
						throw new Error('nope');
					},
				},
			},
		});

		const body = await runSync(handle, { entity: { item: {}, secret: {} } });

		expect(forwardedTypes(database)).toEqual([]);
		expect(body.entity.item.denied).toBe(true);
		expect(body.entity.secret.denied).toBe(true);
	});
});
