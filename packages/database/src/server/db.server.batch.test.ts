// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseServer } from './db.server';
import { Database } from '../schema/schema';
import { createDurableObjectState } from '../search/__tests__/sqlite_harness';

// batch(): many imperative writes → ONE SQLite transaction, atomic commit
// (entity rows AND their search rows together), and websocket broadcasts held
// until the batch commits. Driven against real SQLite.

vi.mock('cloudflare:workers', () => {
	class DurableObject {
		constructor(
			public ctx: any,
			public env: any,
		) {}
	}
	return { DurableObject };
});

const itemTable = Database.table('item', (s) => ({
	id: s.primaryKey(),
	name: s.string().searchable(),
}));

/** Every server built by a test, closed after it. */
const open_states: ReturnType<typeof createDurableObjectState>[] = [];

function createServer(ws?: { entityChanged: ReturnType<typeof vi.fn> }) {
	const state = createDurableObjectState();
	open_states.push(state);
	const db = new DatabaseServer(
		{ item: itemTable as unknown as Database.Table },
		() => ws,
		state.ctx as any,
		{ DEV: true } as any,
	);
	return { db, state };
}

afterEach(() => {
	while (open_states.length) open_states.pop()?.close();
});

const T0 = 1_750_000_000_000;

describe('DatabaseServer.batch()', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(T0);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('writes the search rows inline, with no post-commit index work', () => {
		const { db, state } = createServer();
		db.create('item', { name: 'warmup' }); // creates the table
		state.log.length = 0;

		db.batch(() => {
			for (let i = 0; i < 25; i++) db.create('item', { name: `item ${i}` });
		});

		// The postings are written by the same transaction as the entity rows —
		// nothing is serialized, snapshotted or journaled anywhere.
		expect(state.log.some((entry) => /search_postings/.test(entry.sql))).toBe(true);
		expect(
			state.log.some((entry) => /search_index|search_journal/.test(entry.sql)),
		).toBe(false);
		// All rows searchable.
		const res = db.list('item', { limit: 100 });
		expect((res as { count: number }).count).toBe(26);
	});

	it('rolls the entity rows and their search rows back together', () => {
		const { db, state } = createServer();
		db.create('item', { name: 'survivor' });
		expect(() =>
			db.batch(() => {
				db.create('item', { name: 'doomed' });
				throw new Error('boom');
			}),
		).toThrow('boom');

		expect((db.list('item', { limit: 100 }) as { count: number }).count).toBe(1);
		const postings = state.db
			.prepare(`SELECT DISTINCT doc_id FROM search_postings WHERE entity_type = 'item'`)
			.all();
		expect(postings).toHaveLength(1);
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
		expect(entityChanged.mock.calls[0][4]).toMatchObject({ name: 'a' });
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
