// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DatabaseServer } from './db.server';
import { Database } from '../schema/schema';
import { createDurableObjectState } from '../search/__tests__/sqlite_harness';

// `.searchable().serverOnly()`: indexed in the Durable Object, never on the
// wire. Driven through the public API against real SQLite.
vi.mock('cloudflare:workers', () => {
	class DurableObject {
		constructor(
			public ctx: any,
			public env: any,
		) {}
	}
	return { DurableObject };
});

const noteTable = Database.table('note', (s) => ({
	id: s.primaryKey(),
	title: s.string().searchable(),
	// The field this tier exists for: a full document body, searchable where it
	// already lives, never copied to every device.
	body: s.string().searchable().serverOnly(),
}));

const tables = { note: noteTable as unknown as Database.Table };

const open_states: ReturnType<typeof createDurableObjectState>[] = [];
afterEach(() => {
	while (open_states.length) open_states.pop()?.close();
});

function createServer() {
	const state = createDurableObjectState();
	open_states.push(state);
	return new DatabaseServer(
		tables,
		() => undefined,
		state.ctx as any,
		{ DEV: true } as any,
	);
}

describe('searchable().serverOnly()', () => {
	it('records the field as searchable AND as server-only', () => {
		const config = noteTable.config;
		// It is a normal searchable field to the server...
		expect(config.searchable_fields).toContain('body');
		expect(config.index_schema).toHaveProperty('body');
		// ...and separately marked as never leaving it.
		expect(config.server_indexed_fields).toEqual(['body']);
		// The ordinary field is untouched.
		expect(config.server_indexed_fields).not.toContain('title');
	});

	it('keeps the field out of the sync payload', () => {
		const db = createServer();
		db.create('note', { title: 'Chapter one', body: 'the whole body text' });

		const res = db.sync({ entity: { note: { start_updated_at: 0 } } });
		const [synced] = res.entity.note!.created as Record<string, unknown>[];

		expect(synced.title).toBe('Chapter one');
		expect(synced).not.toHaveProperty('body');
	});

	it('still indexes the field, so the server can search it', () => {
		const db = createServer();
		const one = db.create('note', { title: 'Chapter one', body: 'chrysanthemum' });
		db.create('note', { title: 'Chapter two', body: 'nothing notable' });

		// The word exists only in the body — the half that never syncs.
		const found = db.list('note', { term: 'chrysanthemum', fields: ['body'] });
		expect(found.hits.map((hit) => hit.id)).toEqual([one.id]);
	});

	it('keeps the field readable through a non-sparse read', () => {
		const db = createServer();
		const note = db.create('note', { title: 'Chapter one', body: 'the whole body text' });

		// Held back from the *wire*, not from the database: the server still owns
		// the value and hands it over when asked for the full entity.
		expect(db.get('note', note.id as string)?.body).toBe('the whole body text');
	});

	it('rejects a field that is both sortable and server-only', () => {
		expect(
			() =>
				Database.table('bad', (s) => ({
					id: s.primaryKey(),
					body: s.string().searchable().serverOnly().sortable(),
				})).config,
		).toThrow(/sortable and serverOnly/);
	});

	it('rejects serverOnly() without searchable()', () => {
		expect(
			() =>
				Database.table('bad', (s) => ({
					id: s.primaryKey(),
					// Neither synced nor indexed is just the default tier.
					body: s.string().serverOnly(),
				})).config,
		).toThrow(/not searchable/);
	});

	it('rejects a field that is both carried and server-only', () => {
		expect(
			() =>
				Database.table('bad', (s) => ({
					id: s.primaryKey(),
					// Carried is "client yes, index no"; serverOnly is the reverse.
					body: s.string().carried().serverOnly(),
				})).config,
		).toThrow(/carried and serverOnly/);
	});

	it('applies in either order', () => {
		const flipped = Database.table('flipped', (s) => ({
			id: s.primaryKey(),
			body: s.string().serverOnly().searchable(),
		}));
		expect(flipped.config.server_indexed_fields).toEqual(['body']);
		expect(flipped.config.searchable_fields).toContain('body');
	});
});
