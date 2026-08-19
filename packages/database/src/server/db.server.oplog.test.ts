// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseServer, BLOB_OMITTED } from './db.server';
import { Database } from '../schema/schema';
import { createDurableObjectState } from '../search/__tests__/sqlite_harness';

// `{ op_id }` dedupe, against real SQLite. What is under test is that a
// replayed mutation writes nothing and returns what the first one returned —
// the contract the offline outbox is built on.

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
	count: s.number().optional(),
}));

const fileTable = Database.table('doc', (s) => ({
	id: s.primaryKey(),
	title: s.string().searchable(),
	bytes: s.blob({ max_bytes: 1_000_000 }).optional(),
}));

const tables = {
	item: itemTable as unknown as Database.Table,
	doc: fileTable as unknown as Database.Table,
};

const open_states: ReturnType<typeof createDurableObjectState>[] = [];

function createServer(state?: ReturnType<typeof createDurableObjectState>) {
	const durable = state ?? createDurableObjectState();
	if (!state) open_states.push(durable);
	const db = new DatabaseServer(
		tables,
		() => undefined,
		durable.ctx as any,
		{
			DEV: true,
		} as any,
	);
	return { db, state: durable };
}

/** Every row currently in the internal dedupe table. */
function opLogRows(state: ReturnType<typeof createDurableObjectState>) {
	try {
		return state.db.prepare('SELECT * FROM _op_log ORDER BY created_at').all() as Record<
			string,
			unknown
		>[];
	} catch {
		return [];
	}
}

function tableExists(
	state: ReturnType<typeof createDurableObjectState>,
	name: string,
): boolean {
	return (
		(
			state.db
				.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`)
				.all(name) as unknown[]
		).length > 0
	);
}

afterEach(() => {
	while (open_states.length) open_states.pop()?.close();
});

const T0 = 1_750_000_000_000;

describe('op_id dedupe', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(T0);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('does not create the op log at all until a write carries an op_id', () => {
		const { db, state } = createServer();
		db.create('item', { name: 'plain' });
		expect(tableExists(state, '_op_log')).toBe(false);

		db.create('item', { name: 'tracked' }, { op_id: 'op-1' });
		expect(tableExists(state, '_op_log')).toBe(true);
	});

	it('applies a create once and returns the original entity on replay', () => {
		const { db, state } = createServer();
		const first = db.create('item', { name: 'hello' }, { op_id: 'op-create' });
		const second = db.create('item', { name: 'hello' }, { op_id: 'op-create' });

		expect(second).toEqual(first);
		expect(db.list('item', { limit: 10 }).count).toBe(1);
		expect(opLogRows(state).length).toBe(1);
	});

	it('applies an update once — a replay does not re-apply the patch', () => {
		const { db } = createServer();
		const created = db.create('item', { name: 'a', count: 1 });
		const id = created.id as string;

		const first = db.update('item', id, { count: 5 }, { op_id: 'op-update' });
		// Something else moved the row in between; the replay must not clobber it.
		db.update('item', id, { count: 9 });
		const replay = db.update('item', id, { count: 5 }, { op_id: 'op-update' });

		expect(first.count).toBe(5);
		expect(replay).toEqual(first);
		expect(db.get('item', id).count).toBe(9);
	});

	it('replays a delete as a no-op instead of a 404', () => {
		const { db } = createServer();
		const created = db.create('item', { name: 'doomed' });
		const id = created.id as string;

		db.delete('item', id, { op_id: 'op-delete' });
		// Without dedupe this throws 404 and the outbox row fails forever.
		expect(() => db.delete('item', id, { op_id: 'op-delete' })).not.toThrow();
		expect(db.list('item', { limit: 10 }).count).toBe(0);

		// A DIFFERENT op_id against the same missing row still 404s — dedupe is
		// keyed on the operation, not on the row's absence.
		expect(() => db.delete('item', id, { op_id: 'op-other' })).toThrow();
	});

	it('deduplicates a transaction and returns its original results', () => {
		const { db } = createServer();
		const first = db.transaction(
			[
				{ create: { type: 'item', data: { name: 'one' } } },
				{ create: { type: 'item', data: { name: 'two' } } },
			],
			{ op_id: 'op-txn' },
		);
		const second = db.transaction(
			[
				{ create: { type: 'item', data: { name: 'one' } } },
				{ create: { type: 'item', data: { name: 'two' } } },
			],
			{ op_id: 'op-txn' },
		);

		expect(db.list('item', { limit: 10 }).count).toBe(2);
		expect(second).toEqual(first);
	});

	it('records nothing when the write throws, so a real retry still applies', () => {
		const { db, state } = createServer();
		expect(() =>
			db.update('item', 'does-not-exist', { name: 'x' }, { op_id: 'op-fail' }),
		).toThrow();
		expect(opLogRows(state).length).toBe(0);

		const created = db.create('item', { name: 'now-exists' });
		// Same op_id, now against a row that exists — it must actually apply.
		const applied = db.update(
			'item',
			created.id as string,
			{ name: 'retried' },
			{ op_id: 'op-fail' },
		);
		expect(applied.name).toBe('retried');
	});

	it('honours a client-supplied primary key, and rejects a second one', () => {
		const { db } = createServer();
		const created = db.create('item', { id: 'client-minted', name: 'offline' } as never, {
			preserve_id: true,
		});
		expect(created.id).toBe('client-minted');

		expect(() =>
			db.create('item', { id: 'client-minted', name: 'again' } as never, {
				preserve_id: true,
			}),
		).toThrowError(/already exists/);
	});

	it('records blob columns as omitted rather than as JSON-expanded bytes', () => {
		const { db, state } = createServer();
		const bytes = new Uint8Array([1, 2, 3, 4, 5]);
		const first = db.create('doc', { title: 'binary', bytes }, { op_id: 'op-blob' });
		expect(first.title).toBe('binary');

		const stored = opLogRows(state)[0];
		const recorded = JSON.parse(String(stored.result_json)) as Record<string, unknown>;
		expect(recorded.bytes).toEqual({ [BLOB_OMITTED]: true });
		expect(recorded.title).toBe('binary');

		// The replay therefore reports the omission rather than inventing bytes.
		const replay = db.create('doc', { title: 'binary', bytes }, { op_id: 'op-blob' });
		expect((replay as Record<string, unknown>).bytes).toEqual({ [BLOB_OMITTED]: true });
		expect(db.list('doc', { limit: 10 }).count).toBe(1);
	});

	it('refuses an op_id on batch(), whose return value cannot be recorded', () => {
		const { db } = createServer();
		expect(() =>
			db.batch(() => db.create('item', { name: 'x' }), { op_id: 'op-batch' }),
		).toThrowError(/cannot carry an .op_id./);
	});

	it('appliedOperation answers what landed, and nothing for an unknown id', () => {
		const { db } = createServer();
		const created = db.create('item', { name: 'tracked' }, { op_id: 'op-known' });

		const applied = db.appliedOperation('op-known');
		expect(applied).toMatchObject({
			op_id: 'op-known',
			kind: 'create',
			table: 'item',
			entity_id: String(created.id),
		});
		expect((applied!.result as Record<string, unknown>).name).toBe('tracked');
		expect(db.appliedOperation('never-sent')).toBeUndefined();
	});

	it('survives a Durable Object restart — the log is on disk, not in memory', () => {
		const state = createDurableObjectState();
		open_states.push(state);
		const { db: first } = createServer(state);
		const created = first.create('item', { name: 'before' }, { op_id: 'op-restart' });

		// A cold start over the same storage.
		const { db: second } = createServer(state);
		const replay = second.create('item', { name: 'before' }, { op_id: 'op-restart' });
		expect(replay).toEqual(created);
		expect(second.list('item', { limit: 10 }).count).toBe(1);
	});
});

describe('op log retention', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(T0);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('sweeps rows older than seven days and keeps newer ones', async () => {
		const { db, state } = createServer();
		db.create('item', { name: 'old' }, { op_id: 'op-old' });

		vi.setSystemTime(T0 + 8 * 24 * 60 * 60 * 1000);
		db.create('item', { name: 'new' }, { op_id: 'op-new' });

		expect(opLogRows(state).length).toBe(2);
		await db.alarm();

		expect(opLogRows(state).map((r) => r.op_id)).toEqual(['op-new']);
	});

	it('arms the sweeper on a cold start when the log already exists', async () => {
		const state = createDurableObjectState();
		open_states.push(state);
		const { db: first } = createServer(state);
		first.create('item', { name: 'old' }, { op_id: 'op-old' });

		vi.setSystemTime(T0 + 8 * 24 * 60 * 60 * 1000);
		// A restart with NO op_id write — the constructor's probe is the only
		// thing that can arm the sweep here.
		const { db: second } = createServer(state);
		await second.alarm();
		expect(opLogRows(state).length).toBe(0);
	});
});
