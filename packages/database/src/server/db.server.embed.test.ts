// @vitest-environment node
/**
 * Auto-embedding (DS-05): `schema.vector(n).embedFrom([...])` +
 * `DatabaseServer.registerEmbedder()`.
 *
 * Same harness as `db.server.test.ts` — the production class over real
 * `node:sqlite`. The embedder is a plain fake; what these tests pin down is the
 * machinery around it: the queue, the debounce, the batching, the quiet write
 * (no `updated_at` bump, no change-log row), the retry path, and the backfill.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseServer, type DatabaseEmbedder } from './db.server.js';
import { Database } from '../schema/schema.js';
import { createDurableObjectState } from '../search/__tests__/sqlite_harness.js';

vi.mock('cloudflare:workers', () => {
	class DurableObject {
		constructor(
			public ctx: unknown,
			public env: unknown,
		) {}
	}
	return { DurableObject };
});

/** `debounce_ms: 0` so a queued row is due the moment `alarm()` runs. */
const articleTable = Database.table(
	'article',
	(schema) => ({
		id: schema.primaryKey(),
		title: schema.string().searchable(),
		tags: schema.array(schema.string()).optional().searchable(),
		body: schema.string().optional().carried(),
		embedding: schema
			.vector(3)
			.embedFrom(['title', 'tags'], { debounce_ms: 0 })
			.optional(),
	}),
	{ history: true, history_retention_days: 0 },
);

const CONFIG = { article: articleTable } as unknown as Record<string, Database.Table>;

interface Fixture {
	db: DatabaseServer<Record<string, Database.Table>>;
	state: ReturnType<typeof createDurableObjectState>;
	embedder: ReturnType<typeof vi.fn>;
}

/** A deterministic 3-dim "embedding": [text length, word count, 1]. */
function fakeVector(text: string): number[] {
	return [text.length, text.split(/\s+/).length, 1];
}

function createServer(
	config: Record<string, Database.Table> = CONFIG,
	state = createDurableObjectState(),
	options?: { embedder?: DatabaseEmbedder | null },
): Fixture {
	const db = new DatabaseServer(
		config as never,
		() => undefined,
		state.ctx as never,
		{ DEV: true } as never,
	) as DatabaseServer<Record<string, Database.Table>>;
	const embedder = vi.fn(async (texts: string[]) => texts.map(fakeVector));
	if (options?.embedder === undefined) db.registerEmbedder(embedder as never);
	else if (options.embedder) db.registerEmbedder(options.embedder);
	return { db, state, embedder };
}

function queueRows(db: DatabaseServer<Record<string, Database.Table>>) {
	return db.exec(`SELECT * FROM _embed_queue ORDER BY entity_id, field;`);
}

describe('DatabaseServer auto-embedding (DS-05)', () => {
	let fixture: Fixture;

	beforeEach(() => {
		fixture = createServer();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('queues on create and embeds on the alarm, without the mutation awaiting anything', async () => {
		const { db, embedder } = fixture;
		const created = db.create('article', { title: 'Hello world' });
		// The mutation returned; nothing has embedded yet.
		expect(embedder).not.toHaveBeenCalled();
		expect(queueRows(db)).toHaveLength(1);

		await db.alarm();

		expect(embedder).toHaveBeenCalledTimes(1);
		expect(embedder).toHaveBeenCalledWith(['Hello world'], undefined);
		expect(queueRows(db)).toHaveLength(0);
		const entity = db.get('article', created.id as string) as { embedding?: number[] };
		expect(entity.embedding).toEqual(fakeVector('Hello world'));
	});

	it('includes every source field, in declared order, arrays joined with commas', async () => {
		const { db, embedder } = fixture;
		db.create('article', { title: 'Post', tags: ['a', 'b'] });
		await db.alarm();
		expect(embedder).toHaveBeenCalledWith(['Post\na, b'], undefined);
	});

	it('the quiet write bumps no updated_at and appends no change-log row', async () => {
		const { db } = fixture;
		const created = db.create('article', { title: 'Quiet' });
		const history_before = db.history('article', created.id as string).length;

		await db.alarm();

		const entity = db.get('article', created.id as string) as {
			embedding?: number[];
			updated_at: number;
		};
		expect(entity.embedding).toEqual(fakeVector('Quiet'));
		expect(entity.updated_at).toBe(created.updated_at);
		expect(db.history('article', created.id as string).length).toBe(history_before);
	});

	it('re-queues when a source field changes and stays silent when none did', async () => {
		const { db, embedder } = fixture;
		const created = db.create('article', { title: 'One' });
		await db.alarm();
		expect(embedder).toHaveBeenCalledTimes(1);

		// A non-source change queues nothing.
		db.update('article', created.id as string, { body: 'irrelevant' });
		expect(queueRows(db)).toHaveLength(0);

		// A source change re-queues and re-embeds.
		db.update('article', created.id as string, { title: 'Two' });
		expect(queueRows(db)).toHaveLength(1);
		await db.alarm();
		expect(embedder).toHaveBeenCalledTimes(2);
		expect(embedder).toHaveBeenLastCalledWith(['Two'], undefined);
	});

	it('batches every due row into one embedder call', async () => {
		const { db, embedder } = fixture;
		db.create('article', { title: 'First' });
		db.create('article', { title: 'Second' });
		db.create('article', { title: 'Third' });
		// Each write's timestamp is kept strictly increasing, so three creates in
		// the same millisecond queue at t, t+1, t+2 — up to two ms ahead of the
		// wall clock the alarm compares `due_at` against. Let the clock catch up,
		// or the last row is (correctly) left for the re-armed alarm.
		await new Promise((resolve) => setTimeout(resolve, 5));
		await db.alarm();
		expect(embedder).toHaveBeenCalledTimes(1);
		expect((embedder.mock.calls[0][0] as string[]).sort()).toEqual([
			'First',
			'Second',
			'Third',
		]);
	});

	it('a row queued with a real debounce is not embedded before it is due', async () => {
		const table = Database.table('article', (schema) => ({
			id: schema.primaryKey(),
			title: schema.string().searchable(),
			embedding: schema
				.vector(3)
				.embedFrom(['title'], { debounce_ms: 60_000 })
				.optional(),
		}));
		const { db, embedder } = createServer({
			article: table,
		} as unknown as Record<string, Database.Table>);
		db.create('article', { title: 'Later' });
		await db.alarm();
		expect(embedder).not.toHaveBeenCalled();
		expect(queueRows(db)).toHaveLength(1);
	});

	it('an embedder failure retries with backoff and never loses the row it embeds for', async () => {
		const failing = vi.fn(async () => {
			throw new Error('model unavailable');
		});
		const { db } = createServer(CONFIG, createDurableObjectState(), {
			embedder: failing as never,
		});
		const created = db.create('article', { title: 'Fragile' });
		await db.alarm();

		const rows = queueRows(db) as { attempts: number; due_at: number }[];
		expect(rows).toHaveLength(1);
		expect(rows[0].attempts).toBe(1);
		expect(rows[0].due_at).toBeGreaterThan(Date.now());
		// The entity write itself was never at risk.
		expect(
			(db.get('article', created.id as string) as unknown as { title: string }).title,
		).toBe('Fragile');
	});

	it('a row past the attempt ceiling is dropped, loudly, and the rest keep working', async () => {
		const failing = vi.fn(async () => {
			throw new Error('still down');
		});
		const { db } = createServer(CONFIG, createDurableObjectState(), {
			embedder: failing as never,
		});
		const error_spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		db.create('article', { title: 'Doomed' });
		// Fast-forward the row to one attempt short of the ceiling, due now.
		db.exec(`UPDATE _embed_queue SET attempts = 7, due_at = ${Date.now() - 1};`);
		await db.alarm();
		expect(queueRows(db)).toHaveLength(0);
		expect(error_spy).toHaveBeenCalled();
		error_spy.mockRestore();
	});

	it('a wrong-length embedder answer is a failure, not a stored vector', async () => {
		const wrong = vi.fn(async (texts: string[]) => texts.map(() => [1, 2]));
		const { db } = createServer(CONFIG, createDurableObjectState(), {
			embedder: wrong as never,
		});
		const created = db.create('article', { title: 'Short' });
		await db.alarm();
		expect(
			(db.get('article', created.id as string) as { embedding?: number[] }).embedding,
		).toBeUndefined();
		const rows = queueRows(db) as { attempts: number }[];
		expect(rows).toHaveLength(1);
		expect(rows[0].attempts).toBe(1);
	});

	it('sources emptied after a vector existed clear the vector', async () => {
		const { db, embedder } = fixture;
		const created = db.create('article', { title: 'Present', tags: ['x'] });
		await db.alarm();
		expect(
			(db.get('article', created.id as string) as { embedding?: number[] }).embedding,
		).toEqual(fakeVector('Present\nx'));

		db.update('article', created.id as string, { title: '', tags: null as never });
		await db.alarm();
		expect(embedder).toHaveBeenCalledTimes(1); // no embedder call for a clear
		expect(
			(db.get('article', created.id as string) as { embedding?: number[] }).embedding,
		).toBeUndefined();
		expect(queueRows(db)).toHaveLength(0);
	});

	it('deleting the entity drops its queue rows', () => {
		const { db } = fixture;
		const created = db.create('article', { title: 'Gone soon' });
		expect(queueRows(db)).toHaveLength(1);
		db.delete('article', created.id as string);
		expect(queueRows(db)).toHaveLength(0);
	});

	it('without an embedder the queue waits; registerEmbedder picks it back up', async () => {
		const { db, embedder } = createServer(CONFIG, createDurableObjectState(), {
			embedder: null,
		});
		const warn_spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const created = db.create('article', { title: 'Patient' });
		await db.alarm();
		expect(queueRows(db)).toHaveLength(1);
		expect(warn_spy).toHaveBeenCalledTimes(1);

		db.registerEmbedder(embedder as never);
		await db.alarm();
		expect(queueRows(db)).toHaveLength(0);
		expect(
			(db.get('article', created.id as string) as { embedding?: number[] }).embedding,
		).toEqual(fakeVector('Patient'));
		warn_spy.mockRestore();
	});

	it('passes the declared model through to the embedder', async () => {
		const table = Database.table('article', (schema) => ({
			id: schema.primaryKey(),
			title: schema.string().searchable(),
			embedding: schema
				.vector(3)
				.embedFrom(['title'], { model: 'test-model', debounce_ms: 0 })
				.optional(),
		}));
		const { db, embedder } = createServer({
			article: table,
		} as unknown as Record<string, Database.Table>);
		db.create('article', { title: 'Named' });
		await db.alarm();
		expect(embedder).toHaveBeenCalledWith(['Named'], 'test-model');
	});

	it('backfills every existing row when embedFrom first appears (or changes)', async () => {
		// Boot 1: no embedFrom. Rows accumulate with no vectors.
		const plain = Database.table('article', (schema) => ({
			id: schema.primaryKey(),
			title: schema.string().searchable(),
			embedding: schema.vector(3).optional(),
		}));
		const state = createDurableObjectState();
		const first = createServer(
			{ article: plain } as unknown as Record<string, Database.Table>,
			state,
			{ embedder: null },
		);
		first.db.create('article', { title: 'Old A' });
		first.db.create('article', { title: 'Old B' });
		expect(() => queueRows(first.db)).toThrow(); // no queue table without a config

		// Boot 2: same database, embedFrom declared — both rows are enqueued.
		const embedded = Database.table('article', (schema) => ({
			id: schema.primaryKey(),
			title: schema.string().searchable(),
			embedding: schema.vector(3).embedFrom(['title'], { debounce_ms: 0 }).optional(),
		}));
		const second = createServer(
			{ article: embedded } as unknown as Record<string, Database.Table>,
			state,
		);
		expect(queueRows(second.db)).toHaveLength(2);
		await second.db.alarm();
		expect(second.embedder).toHaveBeenCalledTimes(1);
		expect((second.embedder.mock.calls[0][0] as string[]).sort()).toEqual([
			'Old A',
			'Old B',
		]);

		// Boot 3: unchanged config — nothing is re-enqueued.
		const third = createServer(
			{ article: embedded } as unknown as Record<string, Database.Table>,
			state,
		);
		expect(queueRows(third.db)).toHaveLength(0);
	});

	it('rejects an embedFrom source that is not a declared field', () => {
		const broken = Database.table('article', (schema) => ({
			id: schema.primaryKey(),
			title: schema.string().searchable(),
			embedding: schema.vector(3).embedFrom(['no_such_field']).optional(),
		}));
		expect(() =>
			createServer({ article: broken } as unknown as Record<string, Database.Table>),
		).toThrow(/no_such_field/);
	});

	it('rejects an embedFrom source with nothing to embed', () => {
		const broken = Database.table('article', (schema) => ({
			id: schema.primaryKey(),
			title: schema.string().searchable(),
			blob_field: schema.blob().optional(),
			embedding: schema.vector(3).embedFrom(['blob_field']).optional(),
		}));
		expect(() =>
			createServer({ article: broken } as unknown as Record<string, Database.Table>),
		).toThrow(/blob_field/);
	});

	it('a poisoned text isolates after shared failures instead of dropping its batch', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-09-01T00:00:00.000Z'));
		const error_spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const embedder = vi.fn(async (texts: string[]) => {
			if (texts.some((text) => text.includes('POISON'))) throw new Error('poison');
			return texts.map(fakeVector);
		});
		const { db } = createServer(CONFIG, createDurableObjectState(), {
			embedder: embedder as never,
		});
		const good_a = db.create('article', { title: 'Good alpha' });
		const good_b = db.create('article', { title: 'Good beta' });
		db.create('article', { title: 'POISON pill' });

		// Enough drains for: three shared failures, then singled retries in
		// which the good rows embed and the poison walks alone to the ceiling.
		for (let i = 0; i < 12; i++) {
			await db.alarm();
			vi.setSystemTime(Date.now() + 11 * 60_000);
		}

		const embedded = (id: string) =>
			(db.get('article', id) as unknown as { embedding?: number[] }).embedding;
		expect(embedded(good_a.id as string)).toEqual(fakeVector('Good alpha'));
		expect(embedded(good_b.id as string)).toEqual(fakeVector('Good beta'));
		expect(queueRows(db)).toHaveLength(0); // the poison dropped alone
		expect(error_spy).toHaveBeenCalled();
		// The good rows landed via SINGLE-text calls — the isolation, observed.
		const single_calls = embedder.mock.calls.filter(
			(call) => (call[0] as string[]).length === 1,
		);
		expect(single_calls.length).toBeGreaterThanOrEqual(3);
		error_spy.mockRestore();
	});

	it('caps the source text at 2000 chars by default, and at max_chars when given', async () => {
		const { db, embedder } = fixture;
		db.create('article', { title: `head ${'x'.repeat(3000)}` });
		await db.alarm();
		expect(embedder).toHaveBeenCalledTimes(1);
		const long_text = (embedder.mock.calls[0][0] as string[])[0];
		expect(long_text).toHaveLength(2000);
		expect(long_text.startsWith('head ')).toBe(true);

		const capped = Database.table('article', (schema) => ({
			id: schema.primaryKey(),
			title: schema.string().searchable(),
			embedding: schema
				.vector(3)
				.embedFrom(['title'], { debounce_ms: 0, max_chars: 10 })
				.optional(),
		}));
		const tight = createServer({
			article: capped,
		} as unknown as Record<string, Database.Table>);
		tight.db.create('article', { title: 'The Lighthouse Problem' });
		await tight.db.alarm();
		expect(tight.embedder).toHaveBeenCalledWith(['The Lighth'], undefined);
	});

	it('a non-finite embedder answer is a failure, not a stored vector', async () => {
		const wrong = vi.fn(async (texts: string[]) => texts.map(() => [Number.NaN, 1, 1]));
		const { db } = createServer(CONFIG, createDurableObjectState(), {
			embedder: wrong as never,
		});
		const created = db.create('article', { title: 'Almost' });
		await db.alarm();
		expect(
			(db.get('article', created.id as string) as unknown as { embedding?: number[] })
				.embedding,
		).toBeUndefined();
		const rows = queueRows(db) as { attempts: number }[];
		expect(rows).toHaveLength(1);
		expect(rows[0].attempts).toBe(1);
	});

	it('removing embedFrom clears the signatures, so re-adding it backfills again', async () => {
		const embedded_table = () =>
			Database.table('article', (schema) => ({
				id: schema.primaryKey(),
				title: schema.string().searchable(),
				embedding: schema.vector(3).embedFrom(['title'], { debounce_ms: 0 }).optional(),
			}));
		const plain_table = Database.table('article', (schema) => ({
			id: schema.primaryKey(),
			title: schema.string().searchable(),
			embedding: schema.vector(3).optional(),
		}));
		const state = createDurableObjectState();

		// Boot 1: declared. One row, embedded, queue drained, signature stored.
		const first = createServer(
			{ article: embedded_table() } as unknown as Record<string, Database.Table>,
			state,
		);
		first.db.create('article', { title: 'Survivor' });
		await first.db.alarm();
		expect(queueRows(first.db)).toHaveLength(0);

		// Boot 2: declaration removed. The stale signature must go with it —
		// left behind, boot 3's identical config would compare equal and skip
		// the backfill it owes.
		const second = createServer(
			{ article: plain_table } as unknown as Record<string, Database.Table>,
			state,
			{ embedder: null },
		);
		second.db.create('article', { title: 'Meanwhile' });
		expect(() => queueRows(second.db)).toThrow(); // queue dropped with the config

		// Boot 3: the identical declaration returns — every row backfills.
		const third = createServer(
			{ article: embedded_table() } as unknown as Record<string, Database.Table>,
			state,
		);
		expect(queueRows(third.db)).toHaveLength(2);
		await third.db.alarm();
		expect((third.embedder.mock.calls[0][0] as string[]).sort()).toEqual([
			'Meanwhile',
			'Survivor',
		]);
	});

	it('history never records the vector, and a reverted delete re-embeds', async () => {
		const { db, embedder } = fixture;
		const created = db.create('article', { title: 'Restorable' });
		await db.alarm();
		expect(
			(db.get('article', created.id as string) as unknown as { embedding?: number[] })
				.embedding,
		).toEqual(fakeVector('Restorable'));

		db.delete('article', created.id as string);
		const entries = db.history('article', created.id as string);
		const deletion = entries.find((entry) => entry.operation === 'delete');
		expect(deletion).toBeDefined();
		// The full previous row IS recorded — minus the ~10-15KB of derived
		// floats a forever-kept log must not carry.
		expect(deletion!.previous).toMatchObject({ title: 'Restorable' });
		expect(deletion!.previous).not.toHaveProperty('embedding');
		// Belt and braces: nothing about the vector reaches the raw log either.
		const raw = db.exec(
			`SELECT previous_json FROM _change_log WHERE entity_id = ? AND operation = 'delete';`,
			created.id,
		) as unknown as { previous_json: string }[];
		expect(raw[0].previous_json).not.toContain('embedding');

		// The revert restores the row without a vector — and the restore is an
		// ordinary create, so the queue regenerates it.
		db.revert(deletion!.id);
		expect(
			(db.get('article', created.id as string) as unknown as { embedding?: number[] })
				.embedding,
		).toBeUndefined();
		expect(queueRows(db)).toHaveLength(1);
		await db.alarm();
		expect(
			(db.get('article', created.id as string) as unknown as { embedding?: number[] })
				.embedding,
		).toEqual(fakeVector('Restorable'));
		expect(embedder).toHaveBeenLastCalledWith(['Restorable'], undefined);
	});

	it('the regenerated vector answers vector queries', async () => {
		const { db } = fixture;
		db.create('article', { title: 'Vector me' });
		await db.alarm();
		const results = db.list('article', {
			vector: { value: fakeVector('Vector me'), field: 'embedding', similarity: 0.5 },
		} as never) as { hits: unknown[] };
		expect(results.hits).toHaveLength(1);
	});
});
