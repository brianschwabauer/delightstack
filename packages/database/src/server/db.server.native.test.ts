// @vitest-environment node
/**
 * The search driver, exercised through a **real `DatabaseServer` over real
 * SQLite** (plan §9 Phases 3 and 5).
 *
 * Every other `db.server.*.test.ts` suite hands the server a
 * `{ exec: vi.fn() }` that pattern-matches SQL strings. That is fine for
 * asserting *which* statement is emitted, and useless for asserting what it
 * does — which is the entire risk of swapping the storage engine. This suite
 * therefore drives the production class against `node:sqlite` through the
 * `DurableObjectState` façade in `search/__tests__/sqlite_harness.ts`, and only
 * ever asserts through the **public** API (`create`/`update`/`delete`/`list`/
 * `sync`), plus direct reads of the search tables where the point is that the
 * stored rows are right.
 *
 * Coverage map:
 * - entity CRUD → search rows identical to a from-scratch rebuild
 * - a golden-fixture subset replayed through `list()`
 * - cursor paging walks the whole corpus exactly once
 * - `$derived` persistence, and that it never leaks into entity data
 * - the FK-derived cascade (dependents re-derived, `updated_at` bumped, postings
 *   rewritten) inside one transaction
 * - sync window paging: ascending/descending half-open boundaries, equal
 *   timestamps, deletions from `search_tombstones`, monotonic timestamps
 * - the first wake after upgrading from the pre-1.2 in-memory engine: metadata
 *   migrated off `search_index`, rows rebuilt, legacy tables dropped
 * - a warm boot doing zero search work
 */

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseServer } from './db.server';
import { Database } from '../schema/schema';
import { createDurableObjectState } from '../search/__tests__/sqlite_harness';
import { generateCorpus } from '../search/__tests__/fixtures/corpus';
import { flattenSearchSchema } from '../search/server/table_config';

vi.mock('cloudflare:workers', () => {
	class DurableObject {
		constructor(
			public ctx: unknown,
			public env: unknown,
		) {}
	}
	return { DurableObject };
});

/* -------------------------------------------------------------------------- */
/* Fixture schema                                                             */
/* -------------------------------------------------------------------------- */

const authorTable = Database.table('author', (s) => ({
	id: s.primaryKey(),
	name: s.string().sortable(),
}));

const noteTable = Database.table('note', (s) => ({
	id: s.primaryKey(),
	title: s.string().sortable(),
	body: s.string().searchable(),
	status: s.enum(['draft', 'published', '5']).searchable(),
	priority: s.number().sortable(),
	pinned: s.boolean().searchable().optional(),
	tags: s.array(s.string()).searchable().optional(),
	meta: s
		.object({
			city: s.string().sortable().optional(),
		})
		.optional(),
	author_id: s.foreignKey({ type: 'string', table: 'author', column: 'id' }).optional(),
	/** FK-derived: lives only in the row's `$derived` sub-object. */
	author_name: s
		.string()
		.derived(['author_id'], (_data, refs) => (refs.author_id?.name ?? '') as string),
}));

/** An `enum[]` field declared through the schema builder (plan §4.1). */
const labelledTable = Database.table('labelled', (s) => ({
	id: s.primaryKey(),
	title: s.string().searchable(),
	label_ids: s
		.array(s.enum(['l_red', 'l_green', 'l_blue', 'l_yellow']))
		.searchable()
		.optional(),
}));

/** A second, plainer table — every table is indexed, none opts in. */
const legacyTable = Database.table('legacy', (s) => ({
	id: s.primaryKey(),
	name: s.string().sortable(),
}));

const CONFIG = {
	author: authorTable,
	note: noteTable,
	legacy: legacyTable,
} as unknown as Record<string, Database.Table>;

const T0 = 1_750_000_000_000;

interface Fixture {
	db: DatabaseServer<Record<string, Database.Table>>;
	state: ReturnType<typeof createDurableObjectState>;
}

function createServer(config: Record<string, Database.Table> = CONFIG): Fixture {
	const state = createDurableObjectState();
	const db = new DatabaseServer(
		config as never,
		() => undefined,
		state.ctx as never,
		{ DEV: true } as never,
	) as DatabaseServer<Record<string, Database.Table>>;
	return { db, state };
}

/** Every search row for an entity type, in a stable, comparable order. */
function dumpSearchRows(state: Fixture['state'], entity_type: string) {
	const query = (sql: string) =>
		state.db
			.prepare(sql)
			.all(entity_type)
			.map((row) => ({ ...(row as Record<string, unknown>) }));
	return {
		postings: query(
			`SELECT field, token, doc_id, tf FROM search_postings WHERE entity_type = ? ORDER BY field, token, doc_id;`,
		),
		tokens: query(
			`SELECT field, token, df FROM search_tokens WHERE entity_type = ? ORDER BY field, token;`,
		),
		docs: query(
			`SELECT doc_id, lengths FROM search_docs WHERE entity_type = ? ORDER BY doc_id;`,
		),
		field_stats: query(
			`SELECT field, doc_count, total_len FROM search_field_stats WHERE entity_type = ? ORDER BY field;`,
		),
	};
}

/** The raw `json` column of one row (the only way to observe `$derived`). */
function rawJson(state: Fixture['state'], table: string, id: string): string {
	const row = state.db.prepare(`SELECT json FROM ${table} WHERE id = ?`).get(id) as
		| { json?: string }
		| undefined;
	return row?.json ?? '';
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('native search driver — bootstrap', () => {
	let fixture: Fixture;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(T0);
		fixture = createServer();
	});
	afterEach(() => {
		fixture.state.close();
		vi.useRealTimers();
	});

	it('creates the search tables and the (updated_at, pk) index', () => {
		const tables = fixture.state.db
			.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
			.all()
			.map((row) => (row as { name: string }).name);
		expect(tables).toEqual(expect.arrayContaining(['search_postings', 'search_state']));
		const indexes = fixture.state.db
			.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`)
			.all()
			.map((row) => (row as { name: string }).name);
		expect(indexes).toContain('idx_note_updated_at');
	});

	it('adds a generated column for every child, derived and geo path', () => {
		const columns = fixture.state.db
			.prepare(`PRAGMA table_xinfo(note)`)
			.all()
			.map((row) => (row as { name: string }).name);
		expect(columns).toContain('sv$meta__city');
		expect(columns).toContain('sv$author_name');
		// A real top-level scalar never gets a generated twin.
		expect(columns).not.toContain('sv$title');
	});

	it('adds no generated columns to a table that declares no child paths', () => {
		const columns = fixture.state.db
			.prepare(`PRAGMA table_xinfo(legacy)`)
			.all()
			.map((row) => (row as { name: string }).name);
		expect(columns.some((name) => name.startsWith('sv$'))).toBe(false);
	});

	it('creates no legacy search_index / search_journal tables', () => {
		const tables = fixture.state.db
			.prepare(
				`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('search_index', 'search_journal')`,
			)
			.all();
		expect(tables).toEqual([]);
	});

	it('does no search work at all on a warm boot (§8.3: cold-start cost 0)', () => {
		const { db, state } = fixture;
		db.create('note', {
			title: 'Warm boot',
			body: 'nothing should be reindexed',
			status: 'draft',
			priority: 1,
		} as never);

		// Second wake over the same database: the schema signature is persisted, so
		// the bootstrap may create tables (IF NOT EXISTS) and read state, but it
		// must never read or write a single search row.
		state.log.length = 0;
		new DatabaseServer(
			CONFIG as never,
			() => undefined,
			state.ctx as never,
			{
				DEV: true,
			} as never,
		);
		const touched = state.log.filter((entry) =>
			/search_postings|search_tokens|search_docs|search_field_stats|search_vectors|search_tombstones/.test(
				entry.sql,
			),
		);
		const writes = touched.filter((entry) =>
			/^\s*(INSERT|UPDATE|DELETE)/i.test(entry.sql),
		);
		const reads = touched.filter((entry) => /^\s*SELECT/i.test(entry.sql));
		expect(writes).toEqual([]);
		expect(reads).toEqual([]);
		// ...and the corpus is untouched, so no client is forced to resync.
		const version = state.db
			.prepare(`SELECT config_version FROM search_state WHERE entity_type = 'note'`)
			.get() as { config_version: number };
		expect(version.config_version).toBe(1);
	});
});

describe('native search driver — write path', () => {
	let fixture: Fixture;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(T0);
		fixture = createServer();
	});
	afterEach(() => {
		fixture.state.close();
		vi.useRealTimers();
	});

	let author_ids: { a1: string; a2: string };

	function seed() {
		const { db } = fixture;
		author_ids = {
			a1: (
				db.create('author', { name: 'Ada Lovelace' } as never) as unknown as {
					id: string;
				}
			).id,
			a2: (
				db.create('author', { name: 'Grace Hopper' } as never) as unknown as {
					id: string;
				}
			).id,
		};
		const first = db.create('note', {
			title: 'alpha beta',
			body: 'the quick brown fox',
			status: 'draft',
			priority: 1,
			tags: ['red', 'blue'],
			meta: { city: 'Zurich' },
			author_id: author_ids.a1,
		} as never) as unknown as { id: string };
		vi.setSystemTime(T0 + 1000);
		const second = db.create('note', {
			title: 'beta gamma',
			body: 'jumps over the lazy dog',
			status: 'published',
			priority: 2,
			meta: { city: 'Basel' },
			author_id: author_ids.a2,
		} as never) as unknown as { id: string };
		return { first, second };
	}

	it('matches a from-scratch rebuild after a create/update/delete sequence', () => {
		const { db, state } = fixture;
		const { first, second } = seed();
		vi.setSystemTime(T0 + 2000);
		db.update('note', first.id, { body: 'a completely different body text' } as never);
		vi.setSystemTime(T0 + 3000);
		const third = db.create('note', {
			title: 'gamma delta',
			body: 'ephemeral',
			status: 'draft',
			priority: 3,
		} as never) as unknown as { id: string };
		vi.setSystemTime(T0 + 4000);
		db.delete('note', third.id);
		expect(second.id).toBeTruthy();

		const incremental = dumpSearchRows(state, 'note');
		(db as unknown as { rebuildSearchTables(type: string): void }).rebuildSearchTables(
			'note',
		);
		expect(dumpSearchRows(state, 'note')).toEqual(incremental);
	});

	it('persists $derived in the row json and never leaks it into entity data', () => {
		const { db, state } = fixture;
		const { first } = seed();
		const json = JSON.parse(rawJson(state, 'note', first.id)) as unknown as Record<
			string,
			unknown
		>;
		expect(json.$derived).toEqual({ author_name: 'Ada Lovelace' });

		const entity = db.get('note', first.id) as unknown as Record<string, unknown>;
		expect(entity.$derived).toBeUndefined();
		expect(entity.author_name).toBeUndefined();

		// ...but the search projection does carry it.
		const results = db.list('note', { term: 'Lovelace' } as never) as unknown as {
			hits: { document: Record<string, unknown> }[];
		};
		expect(results.hits.map((hit) => hit.document.author_name)).toEqual(['Ada Lovelace']);
	});

	it('rolls the postings back with the entity row when a batch throws', () => {
		const { db, state } = fixture;
		seed();
		const before = dumpSearchRows(state, 'note');
		expect(() =>
			db.batch(() => {
				db.create('note', {
					title: 'zeta',
					body: 'rolled back',
					status: 'draft',
					priority: 9,
				} as never);
				throw new Error('boom');
			}),
		).toThrow('boom');
		expect(dumpSearchRows(state, 'note')).toEqual(before);
		// The dictionary cache was mutated in place by the rolled-back write — a
		// search afterwards must not resurrect the dropped tokens.
		const results = db.list('note', { term: 'rolled' } as never) as unknown as {
			count: number;
		};
		expect(results.count).toBe(0);
	});

	it('re-derives, re-times and re-indexes dependents when an author changes', () => {
		const { db, state } = fixture;
		const { first } = seed();
		const before = db.get('note', first.id) as unknown as { updated_at: number };
		vi.setSystemTime(T0 + 10_000);
		db.update('author', author_ids.a1, { name: 'Augusta King' } as never);

		const json = JSON.parse(rawJson(state, 'note', first.id)) as unknown as Record<
			string,
			unknown
		>;
		expect(json.$derived).toEqual({ author_name: 'Augusta King' });
		const after = db.get('note', first.id) as unknown as { updated_at: number };
		expect(after.updated_at).toBeGreaterThan(before.updated_at);

		// The postings followed the derived value, in the same transaction.
		expect(
			(db.list('note', { term: 'Lovelace' } as never) as unknown as { count: number })
				.count,
		).toBe(0);
		expect(
			(db.list('note', { term: 'Augusta' } as never) as unknown as { count: number })
				.count,
		).toBe(1);
		// ...and the incremental result still equals a rebuild.
		const incremental = dumpSearchRows(state, 'note');
		(db as unknown as { rebuildSearchTables(type: string): void }).rebuildSearchTables(
			'note',
		);
		expect(dumpSearchRows(state, 'note')).toEqual(incremental);
	});

	it('indexes every configured table, not just the interesting one', () => {
		const { db } = fixture;
		db.create('legacy', { name: 'still here' } as never);
		const results = db.list('legacy', { term: 'still' } as never) as unknown as {
			count: number;
			hits: { document: { name: string } }[];
		};
		expect(results.count).toBe(1);
		expect(results.hits[0].document.name).toBe('still here');
		expect(dumpSearchRows(fixture.state, 'legacy').docs).toHaveLength(1);
	});
});

describe('native search driver — list()', () => {
	let fixture: Fixture;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(T0);
		fixture = createServer();
	});
	afterEach(() => {
		fixture.state.close();
		vi.useRealTimers();
	});

	function seedMany(count: number) {
		const ids: string[] = [];
		for (let i = 0; i < count; i++) {
			vi.setSystemTime(T0 + i * 1000);
			const note = fixture.db.create('note', {
				title: `note ${i}`,
				body: i % 2 === 0 ? 'even body' : 'odd body',
				status: i % 3 === 0 ? 'published' : 'draft',
				priority: i,
			} as never) as unknown as { id: string };
			ids.push(note.id);
		}
		return ids;
	}

	it('filters, orders and counts through the public API', () => {
		seedMany(9);
		const results = fixture.db.list('note', {
			where: { status: { eq: 'published' } },
			order: [{ field: 'priority', direction: 'ASC' }],
		} as never) as unknown as {
			count: number;
			hits: { document: { priority: number } }[];
		};
		expect(results.count).toBe(3);
		expect(results.hits.map((hit) => hit.document.priority)).toEqual([0, 3, 6]);
	});

	it('returns the sparse projection by default and full entities when asked', () => {
		const ids = seedMany(1);
		const sparse = fixture.db.list('note', { limit: 1 } as never) as unknown as {
			hits: { document: Record<string, unknown> }[];
		};
		expect(sparse.hits[0].document.json).toBeUndefined();
		expect(sparse.hits[0].document.$derived).toBeUndefined();

		const full = fixture.db.list('note', {
			limit: 1,
			sparse: false,
		} as never) as unknown as {
			hits: { document: Record<string, unknown> }[];
		};
		expect(full.hits[0].document.id).toBe(ids[0]);
		expect(full.hits[0].document.$derived).toBeUndefined();
	});

	it('walks the whole corpus exactly once through the cursor', () => {
		const ids = seedMany(11);
		const seen: string[] = [];
		let cursor: string | undefined;
		for (let guard = 0; guard < 20; guard++) {
			const page = fixture.db.list('note', { limit: 4, cursor } as never) as unknown as {
				hits: { document: { id: string } }[];
				cursor?: string;
			};
			seen.push(...page.hits.map((hit) => hit.document.id));
			cursor = page.cursor;
			if (!cursor || page.hits.length === 0) break;
		}
		expect(new Set(seen).size).toBe(seen.length);
		expect([...seen].sort()).toEqual([...ids].sort());
	});

	it('rejects an unsortable order field with a 400', () => {
		expect(() =>
			fixture.db.list('note', { order: [{ field: 'body' }] } as never),
		).toThrowError(expect.objectContaining({ status: 400 }));
	});

	it('clamps the limit to the documented sparse/hydrated ceilings', () => {
		seedMany(3);
		const sparse = fixture.db.list('note', { limit: 99_999 } as never) as unknown as {
			hits: unknown[];
		};
		expect(sparse.hits.length).toBe(3);
		const hydrated = fixture.db.list('note', {
			limit: 99_999,
			sparse: false,
		} as never) as unknown as { hits: unknown[] };
		expect(hydrated.hits.length).toBe(3);
	});

	it('decides enum equality by storage class despite the TEXT column affinity', () => {
		// `status` is an enum in a TEXT column: SQLite would coerce `= 5` into
		// `= '5'` and match. `core/where` compares by storage class and must not.
		vi.setSystemTime(T0);
		fixture.db.create('note', {
			title: 'numeric looking',
			body: 'x',
			status: '5',
			priority: 1,
		} as never);
		const as_string = fixture.db.list('note', {
			where: { status: { eq: '5' } },
		} as never) as unknown as { count: number };
		expect(as_string.count).toBe(1);
		const as_number = fixture.db.list('note', {
			where: { status: { eq: 5 } },
		} as never) as unknown as { count: number };
		expect(as_number.count).toBe(0);
	});
});

describe('native search driver — enum[] fields', () => {
	let fixture: Fixture;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(T0);
		fixture = createServer({
			labelled: labelledTable as unknown as Database.Table,
		});
		const rows: [string, string[] | undefined][] = [
			['first', ['l_red', 'l_green']],
			['second', ['l_red']],
			['third', ['l_blue', 'l_yellow']],
			['fourth', []],
			['fifth', undefined],
		];
		rows.forEach(([title, label_ids], index) => {
			vi.setSystemTime(T0 + index * 1000);
			fixture.db.create('labelled', { title, label_ids } as never);
		});
	});
	afterEach(() => {
		fixture.state.close();
		vi.useRealTimers();
	});

	/** The titles a query matched, sorted so the injected order never matters. */
	function titlesFor(query: Record<string, unknown>): string[] {
		const results = fixture.db.list('labelled', query as never) as unknown as {
			hits: { document: { title: string } }[];
		};
		return results.hits.map((hit) => hit.document.title).sort();
	}

	it('declares the field as `enum[]` in the flattened search schema', () => {
		expect(flattenSearchSchema(labelledTable.config.index_schema)).toMatchObject({
			label_ids: 'enum[]',
		});
	});

	it('filters with contains_all / contains_any', () => {
		expect(
			titlesFor({ where: { label_ids: { contains_all: ['l_red', 'l_green'] } } }),
		).toEqual(['first']);
		expect(
			titlesFor({ where: { label_ids: { contains_any: ['l_red', 'l_blue'] } } }),
		).toEqual(['first', 'second', 'third']);
		// An empty array and an absent field both match nothing
		expect(titlesFor({ where: { label_ids: { contains_any: ['l_yellow'] } } })).toEqual([
			'third',
		]);
	});

	it('treats a bare list operand as `in` (any element matches)', () => {
		// `in` is not in the typed DSL for `enum[]` (only contains_all/contains_any
		// are), but `core/where` accepts it on every array type at runtime.
		expect(titlesFor({ where: { label_ids: ['l_green', 'l_blue'] } })).toEqual([
			'first',
			'third',
		]);
		expect(titlesFor({ where: { label_ids: { in: ['l_yellow'] } } })).toEqual(['third']);
	});

	it('facets on the enum[] field, counting every element', () => {
		const results = fixture.db.list('labelled', {
			facets: { label_ids: {} },
		} as never) as unknown as {
			facets?: Record<string, { count: number; values: Record<string, number> }>;
		};
		expect(results.facets?.label_ids.values).toEqual({
			l_red: 2,
			l_green: 1,
			l_blue: 1,
			l_yellow: 1,
		});
	});

	it('never participates in full-text term matching', () => {
		// The value is filterable and facetable, but it is not term-indexed: the
		// inverted index holds no `label_ids` postings, tokens or field stats.
		const rows = dumpSearchRows(fixture.state, 'labelled');
		const fields = (list: { field: string }[]) => new Set(list.map((row) => row.field));
		expect(fields(rows.postings as { field: string }[])).toEqual(
			new Set(['id', 'title']),
		);
		expect(fields(rows.tokens as { field: string }[])).toEqual(new Set(['id', 'title']));
		expect(fields(rows.field_stats as { field: string }[])).toEqual(
			new Set(['id', 'title']),
		);
		// A term query over the text fields therefore cannot find a label value...
		expect(titlesFor({ term: 'l_red', fields: ['title'] })).toEqual([]);
		// ...while a real searchable string field still matches.
		expect(titlesFor({ term: 'first', fields: ['title'] })).toEqual(['first']);
	});

	it('keeps the incremental index equal to a from-scratch rebuild', () => {
		const { db, state } = fixture;
		const target = (
			db.list('labelled', { where: { title: 'second' } } as never) as unknown as {
				hits: { document: { id: string } }[];
			}
		).hits[0].document.id;
		vi.setSystemTime(T0 + 10_000);
		db.update('labelled', target, { label_ids: ['l_blue'] } as never);
		expect(titlesFor({ where: { label_ids: { contains_any: ['l_red'] } } })).toEqual([
			'first',
		]);
		const incremental = dumpSearchRows(state, 'labelled');
		(db as unknown as { rebuildSearchTables(type: string): void }).rebuildSearchTables(
			'labelled',
		);
		expect(dumpSearchRows(state, 'labelled')).toEqual(incremental);
	});
});

/* -------------------------------------------------------------------------- */
/* Upgrade from the pre-1.2 in-memory engine (plan §9 Phase 5)                */
/* -------------------------------------------------------------------------- */

describe('search driver — first wake after upgrading from the in-memory engine', () => {
	let fixture: Fixture;

	/**
	 * A Durable Object exactly as the in-memory engine left it: entity rows, the
	 * `search_index` metadata row (tombstones + window bounds + config version),
	 * a `search_journal`, and no search tables and no persisted schema signature.
	 */
	function seedLegacyDurableObject(): Fixture {
		const state = createDurableObjectState();
		state.db.exec(`
			CREATE TABLE state (
				id TEXT PRIMARY KEY,
				json TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
			CREATE TABLE search_index (
				id TEXT PRIMARY KEY,
				index_data BLOB NOT NULL,
				index_config TEXT NOT NULL,
				index_version INTEGER NOT NULL,
				index_format TEXT NOT NULL,
				deleted_entity TEXT NOT NULL,
				first_updated_at INTEGER NOT NULL,
				last_updated_at INTEGER NOT NULL
			);
			CREATE TABLE search_journal (
				entity_type TEXT NOT NULL,
				doc_id TEXT NOT NULL,
				op TEXT NOT NULL,
				sparse_doc BLOB,
				at INTEGER NOT NULL,
				PRIMARY KEY (entity_type, doc_id)
			);
			CREATE TABLE author (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, json TEXT);
			CREATE TABLE note (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, priority INTEGER NOT NULL, pinned INTEGER, author_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, json TEXT);
			CREATE TABLE legacy (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, json TEXT);
		`);
		// `table_config` is what makes the constructor treat the tables as existing.
		const table_config = Object.fromEntries(
			Object.entries(CONFIG).map(([name, table]) => [
				name,
				{ ...table.config.table_definition, json: 'TEXT' },
			]),
		);
		state.db
			.prepare(`INSERT INTO state (id, json, created_at, updated_at) VALUES (?, ?, ?, ?)`)
			.run('main', JSON.stringify({ meta: {}, sql_indexes: [], table_config }), T0, T0);
		state.db
			.prepare(
				`INSERT INTO author (id, name, created_at, updated_at, json) VALUES (?, ?, ?, ?, ?)`,
			)
			.run('a1', 'Ada', T0, T0, '{}');
		for (let index = 0; index < 3; index++) {
			state.db
				.prepare(
					`INSERT INTO note (id, title, body, status, priority, author_id, created_at, updated_at, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(
					`n${index}`,
					`Note ${index}`,
					`body about carbon ${index}`,
					'published',
					index,
					'a1',
					T0 + index * 1000,
					T0 + index * 1000,
					'{}',
				);
		}
		state.db
			.prepare(
				`INSERT INTO search_index (id, index_data, index_config, index_version, index_format, deleted_entity, first_updated_at, last_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				'note.0',
				new Uint8Array([1, 2, 3]),
				'{}',
				7,
				'msgpack',
				JSON.stringify({ gone_1: T0 + 500, gone_2: T0 + 900 }),
				T0,
				T0 + 2000,
			);
		state.db
			.prepare(
				`INSERT INTO search_journal (entity_type, doc_id, op, sparse_doc, at) VALUES (?, ?, ?, ?, ?)`,
			)
			.run('note', 'n0', 'upsert', null, T0);

		const db = new DatabaseServer(
			CONFIG as never,
			() => undefined,
			state.ctx as never,
			{ DEV: true } as never,
		) as DatabaseServer<Record<string, Database.Table>>;
		return { db, state };
	}

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(T0 + 10_000);
		fixture = seedLegacyDurableObject();
	});
	afterEach(() => {
		fixture.state.close();
		vi.useRealTimers();
	});

	it('rebuilds every table’s search rows from its entity rows', () => {
		const { db, state } = fixture;
		expect(
			(db.list('note', { term: 'carbon' } as never) as unknown as { count: number })
				.count,
		).toBe(3);
		// The rebuild backfills `$derived` too, so FK-derived values are searchable
		// even though the in-memory engine never persisted them.
		const rows = state.db
			.prepare(`SELECT json_extract(json, '$."$derived".author_name') AS name FROM note`)
			.all() as { name: string }[];
		expect(rows.map((row) => row.name)).toEqual(['Ada', 'Ada', 'Ada']);
		expect(dumpSearchRows(state, 'note').docs).toHaveLength(3);
	});

	it('migrates the legacy tombstones into search_tombstones', () => {
		const tombstones = fixture.state.db
			.prepare(
				`SELECT doc_id, deleted_at FROM search_tombstones WHERE entity_type = 'note' ORDER BY doc_id`,
			)
			.all() as { doc_id: string; deleted_at: number }[];
		expect(tombstones).toEqual([
			{ doc_id: 'gone_1', deleted_at: T0 + 500 },
			{ doc_id: 'gone_2', deleted_at: T0 + 900 },
		]);
		// ...and they still reach a syncing client on the deletion timeline.
		const entity = fixture.db.sync({ start_updated_at: 0 }).entity.note as {
			deleted: string[];
		};
		expect(entity.deleted.sort()).toEqual(['gone_1', 'gone_2']);
	});

	it('migrates the window bounds and bumps config_version past the legacy one', () => {
		const state = fixture.state.db
			.prepare(
				`SELECT config_version, first_updated_at, last_updated_at FROM search_state WHERE entity_type = 'note'`,
			)
			.get() as {
			config_version: number;
			first_updated_at: number;
			last_updated_at: number;
		};
		// The corpus was rebuilt from a different projection, so every client must
		// resync — which is exactly what a version past the legacy 7 forces.
		expect(state.config_version).toBeGreaterThan(7);
		expect(state.first_updated_at).toBe(T0);
		expect(state.last_updated_at).toBe(T0 + 2000);
	});

	it('drops search_index and search_journal once the migration has succeeded', () => {
		const tables = fixture.state.db
			.prepare(
				`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('search_index', 'search_journal')`,
			)
			.all();
		expect(tables).toEqual([]);
	});

	it('is idempotent: the next wake migrates nothing, drops nothing and rebuilds nothing', () => {
		const { state } = fixture;
		const before = dumpSearchRows(state, 'note');
		const version_before = (
			state.db
				.prepare(`SELECT config_version FROM search_state WHERE entity_type = 'note'`)
				.get() as { config_version: number }
		).config_version;

		state.log.length = 0;
		new DatabaseServer(
			CONFIG as never,
			() => undefined,
			state.ctx as never,
			{
				DEV: true,
			} as never,
		);

		expect(dumpSearchRows(state, 'note')).toEqual(before);
		expect(
			(
				state.db
					.prepare(`SELECT config_version FROM search_state WHERE entity_type = 'note'`)
					.get() as { config_version: number }
			).config_version,
		).toBe(version_before);
		expect(state.log.some((entry) => /DROP TABLE/i.test(entry.sql))).toBe(false);
	});
});

describe('native search driver — sync()', () => {
	let fixture: Fixture;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(T0);
		fixture = createServer();
	});
	afterEach(() => {
		fixture.state.close();
		vi.useRealTimers();
	});

	type Entity = {
		created: { id: string; updated_at: number }[];
		updated: { id: string; updated_at: number }[];
		deleted: (string | number)[];
		start_updated_at: number;
		end_updated_at: number;
		first_updated_at: number;
		last_updated_at: number;
		config_version: number;
	};

	function noteSync(query: Record<string, unknown>): Entity {
		return (fixture.db.sync(query as never) as unknown as { entity: { note?: Entity } })
			.entity.note as Entity;
	}

	function seed(count: number) {
		const ids: string[] = [];
		for (let i = 0; i < count; i++) {
			vi.setSystemTime(T0 + i * 1000);
			ids.push(
				(
					fixture.db.create('note', {
						title: `note ${i}`,
						body: 'body',
						status: 'draft',
						priority: i,
					} as never) as unknown as { id: string }
				).id,
			);
		}
		return ids;
	}

	it('returns every created entity on an initial ascending sync', () => {
		const ids = seed(5);
		const entity = noteSync({ start_updated_at: 0, entity: { note: {} } });
		expect(entity.created.map((doc) => doc.id).sort()).toEqual([...ids].sort());
		expect(entity.updated).toEqual([]);
		expect(entity.deleted).toEqual([]);
		expect(entity.end_updated_at).toBe(entity.last_updated_at);
	});

	it('pages ascending changes with no duplicates and no gaps', () => {
		const ids = seed(10);
		const seen: string[] = [];
		let start = 0;
		for (let guard = 0; guard < 20; guard++) {
			const entity = noteSync({
				start_updated_at: start,
				limit: 3,
				entity: { note: {} },
			});
			seen.push(...entity.created.map((doc) => doc.id));
			const progressed = entity.end_updated_at > start;
			const more = entity.last_updated_at > entity.end_updated_at;
			if (!progressed || !more) break;
			start = entity.end_updated_at;
		}
		expect(new Set(seen).size).toBe(seen.length);
		expect([...seen].sort()).toEqual([...ids].sort());
	});

	it('treats start_updated_at as exclusive and end_updated_at as inclusive', () => {
		const ids = seed(3);
		const first = noteSync({ start_updated_at: 0, limit: 1, entity: { note: {} } });
		expect(first.created).toHaveLength(1);
		const second = noteSync({
			start_updated_at: first.end_updated_at,
			entity: { note: {} },
		});
		expect(second.created.map((doc) => doc.id)).not.toContain(first.created[0].id);
		expect(second.created).toHaveLength(2);
		expect(ids).toHaveLength(3);
	});

	it('uses a descending [from, to) window when no start is given', () => {
		seed(3);
		const all = noteSync({ entity: { note: {} } });
		expect(all.created).toHaveLength(3);
		const page = noteSync({ end_updated_at: T0 + 2000, entity: { note: {} } });
		// Descending is half-open at the top: the T0+2000 row is excluded.
		expect(page.created.map((doc) => doc.updated_at)).toEqual([T0 + 1000, T0]);
	});

	it('never splits a run of equal timestamps across pages', () => {
		// Legacy-shaped data: rows written directly with a shared timestamp.
		for (let i = 0; i < 5; i++) {
			fixture.state.db
				.prepare(
					`INSERT INTO note (id, title, body, status, priority, created_at, updated_at, json) VALUES (?, ?, 'b', 'draft', ?, ?, ?, '{}')`,
				)
				.run(`eq${i}`, `equal ${i}`, i, T0, T0);
		}
		(
			fixture.db as unknown as { rebuildSearchTables(type: string): void }
		).rebuildSearchTables('note');
		const entity = noteSync({ start_updated_at: 0, limit: 2, entity: { note: {} } });
		// The limit is 2 but all five share T0 — the page must grow rather than cut
		// the run, because the next page's boundary is exclusive.
		expect(entity.created).toHaveLength(5);
	});

	it('ships deletions from search_tombstones on the same timeline', () => {
		const ids = seed(3);
		vi.setSystemTime(T0 + 5000);
		fixture.db.delete('note', ids[1]);
		const entity = noteSync({ start_updated_at: 0, entity: { note: {} } });
		expect(entity.deleted).toEqual([ids[1]]);
		expect(entity.created.map((doc) => doc.id)).not.toContain(ids[1]);

		// A deletion outside the window is not shipped.
		const before = noteSync({
			start_updated_at: 0,
			end_updated_at: T0 + 3000,
			entity: { note: {} },
		});
		expect(before.deleted).toEqual([]);
	});

	it('allocates strictly increasing timestamps even when the clock stands still', () => {
		vi.setSystemTime(T0);
		const a = fixture.db.create('note', {
			title: 'a',
			body: 'b',
			status: 'draft',
			priority: 1,
		} as never) as unknown as { updated_at: number };
		vi.setSystemTime(T0); // clock frozen / skewed backwards
		const b = fixture.db.create('note', {
			title: 'b',
			body: 'b',
			status: 'draft',
			priority: 2,
		} as never) as unknown as { updated_at: number };
		expect(b.updated_at).toBeGreaterThan(a.updated_at);
		const state = fixture.state.db
			.prepare(`SELECT last_updated_at FROM search_state WHERE entity_type = 'note'`)
			.get() as unknown as { last_updated_at: number };
		expect(state.last_updated_at).toBeGreaterThanOrEqual(b.updated_at);
	});

	it('forces a full resync when the client config_version is stale', () => {
		seed(3);
		const entity = noteSync({
			start_updated_at: T0 + 100_000,
			entity: { note: { config_version: -1 } },
		});
		expect(entity.created).toHaveLength(3);
		expect(entity.config_version).toBeGreaterThan(0);
	});
});

/* -------------------------------------------------------------------------- */
/* Search-lab regressions (2026-08-13)                                        */
/* -------------------------------------------------------------------------- */

/** Two searchable text fields plus a vector, for the boost / strip tests. */
const placeTable = Database.table('lab_place', (s) => ({
	id: s.primaryKey(),
	name: s.string().sortable(),
	body: s.string().searchable(),
	rating: s.number().sortable().optional(),
	embedding: s.vector(4),
}));

describe('native search driver — search-lab regressions', () => {
	let fixture: Fixture;
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(T0);
		fixture = createServer({ lab_place: placeTable } as never);
	});
	afterEach(() => {
		fixture.state.close();
		vi.useRealTimers();
	});

	function seedPlaces(count: number) {
		const ids: string[] = [];
		for (let i = 0; i < count; i++) {
			vi.setSystemTime(T0 + i * 1000);
			const row = fixture.db.create('lab_place', {
				name: `place ${String(i).padStart(2, '0')}`,
				body: 'filler body',
				rating: i % 5,
				embedding: [1, 0, 0, 0],
			} as never) as unknown as { id: string };
			ids.push(row.id);
		}
		return ids;
	}

	it('advances the offset cursor cumulatively when the order needs offsets', () => {
		// A string order field forces the offset cursor (where-based cursors are
		// number-only). The bug: every minted cursor carried offset = page size,
		// so page 3 replayed page 2 forever.
		const ids = seedPlaces(11);
		const seen: string[] = [];
		let cursor: string | undefined;
		for (let guard = 0; guard < 20; guard++) {
			const page = fixture.db.list('lab_place', {
				limit: 4,
				...(cursor
					? { cursor }
					: {
							order: [
								{ field: 'rating', direction: 'DESC' },
								{ field: 'name', direction: 'ASC' },
							],
						}),
			} as never) as unknown as {
				hits: { document: { id: string } }[];
				cursor?: string;
			};
			seen.push(...page.hits.map((hit) => hit.document.id));
			cursor = page.cursor;
			if (!cursor || page.hits.length === 0) break;
		}
		expect(new Set(seen).size).toBe(seen.length);
		expect([...seen].sort()).toEqual([...ids].sort());
	});

	it('ranks a term query by score, not the recency default, so boosts matter', () => {
		// Older doc matches the term in its (boosted) body; newer doc does not
		// match at all in text but exists. With the old updated_at-DESC default
		// injected into term queries, recency — not BM25 — ordered the hits.
		vi.setSystemTime(T0);
		const weak = fixture.db.create('lab_place', {
			name: 'a',
			body: 'coffee mentioned once amid many other unrelated words here',
			embedding: [1, 0, 0, 0],
		} as never) as unknown as { id: string };
		vi.setSystemTime(T0 + 60_000);
		const strong = fixture.db.create('lab_place', {
			name: 'b',
			body: 'coffee coffee coffee',
			embedding: [1, 0, 0, 0],
		} as never) as unknown as { id: string };
		vi.setSystemTime(T0 + 120_000);
		// Newest by far, but reverse the score order the other way with boost 0.
		fixture.db.create('lab_place', {
			name: 'c',
			body: 'nothing relevant at all',
			embedding: [1, 0, 0, 0],
		} as never);

		const by_score = fixture.db.list('lab_place', {
			term: 'coffee',
		} as never) as unknown as { hits: { id: string; score: number }[] };
		expect(by_score.hits.map((hit) => hit.id)).toEqual([strong.id, weak.id]);
		expect(by_score.hits[0].score).toBeGreaterThan(by_score.hits[1].score);

		// boost 0 zeroes the field's contribution: both hits tie at score 0 and
		// fall back to the primary-key tiebreak (creation order here).
		const boosted_off = fixture.db.list('lab_place', {
			term: 'coffee',
			boost: { body: 0 },
		} as never) as unknown as { hits: { id: string; score: number }[] };
		expect(boosted_off.hits.map((hit) => hit.id)).toEqual([weak.id, strong.id]);
		expect(boosted_off.hits.every((hit) => hit.score === 0)).toBe(true);

		// An explicit order still beats score ranking.
		const explicit = fixture.db.list('lab_place', {
			term: 'coffee',
			order: [{ field: 'updated_at', direction: 'DESC' }],
		} as never) as unknown as { hits: { id: string }[] };
		expect(explicit.hits.map((hit) => hit.id)).toEqual([strong.id, weak.id]);
	});

	it('strips vector fields from sparse list responses, like sync does', () => {
		seedPlaces(2);
		const sparse = fixture.db.list('lab_place', { limit: 2 } as never) as unknown as {
			hits: { document: Record<string, unknown> }[];
		};
		for (const hit of sparse.hits) {
			expect(hit.document.embedding).toBeUndefined();
			expect(hit.document.name).toBeDefined();
		}
		// Hydrated (sparse: false) responses still carry the stored entity as-is.
		const full = fixture.db.list('lab_place', {
			limit: 1,
			sparse: false,
		} as never) as unknown as { hits: { document: Record<string, unknown> }[] };
		expect(Array.isArray(full.hits[0].document.embedding)).toBe(true);
	});
});

/* -------------------------------------------------------------------------- */
/* Golden replay through the public list() API                                */
/* -------------------------------------------------------------------------- */

interface GoldenVectorShape {
	name: string;
	corpus_ref: { preset: string; size: string; seed: string; doc_count: number };
	query: Record<string, unknown>;
	expected_ids_in_order: (string | number)[];
	expected_counts: { total: number; returned: number };
	expected_facets?: Record<string, { count: number; values: Record<string, number> }>;
	tags: string[];
}

/** The `article` corpus preset, expressed with the real schema builder. */
const articleTable = Database.table('article', (s) => ({
	id: s.primaryKey().sortable(),
	title: s.string().sortable().optional(),
	body: s.string().searchable().optional(),
	summary: s.string().searchable().optional(),
	author_name: s.string().sortable().optional(),
	author_email: s.string().searchable().optional(),
	slug: s.string().sortable().optional(),
	code: s.string().sortable().optional(),
	status: s.enum(['draft', 'published', 'archived', 'review']).searchable().optional(),
	tier: s.enum(['free', 'pro', 'enterprise']).searchable().optional(),
	tags: s.array(s.string()).searchable().optional(),
	label_ids: s
		.array(s.enum(['l_red', 'l_green', 'l_blue', 'l_yellow']))
		.searchable()
		.optional(),
	view_count: s.number().sortable().optional(),
	rating: s.number().sortable().optional(),
	scores: s.array(s.number()).searchable().optional(),
	is_published: s.boolean().sortable().optional(),
	flags: s.array(s.boolean()).searchable().optional(),
	address: s
		.object({
			city: s.string().sortable().optional(),
			country: s.enum(['ch', 'de', 'fr', 'it', 'us']).searchable().optional(),
			postal_code: s.string().sortable().optional(),
		})
		.optional(),
	location: s.geopoint().optional(),
	embedding: s.vector(8).optional(),
}));

describe('native search driver — golden fixtures through list()', () => {
	const suite = JSON.parse(
		readFileSync(
			new URL('../search/__tests__/golden/tiny.json', import.meta.url),
			'utf8',
		),
	) as unknown as { vectors: GoldenVectorShape[] };
	const search_schema = flattenSearchSchema(articleTable.config.index_schema);
	const sortable = new Set(articleTable.config.sortable_fields as string[]);

	/** Every field path a query names, so unsupported ones can be filtered out. */
	function referencedFields(query: Record<string, unknown>): string[] {
		const fields: string[] = [];
		const walk = (node: unknown): void => {
			if (!node || typeof node !== 'object') return;
			if (Array.isArray(node)) {
				node.forEach(walk);
				return;
			}
			for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
				if (key === 'and' || key === 'or' || key === 'not') walk(value);
				else fields.push(key);
			}
		};
		walk(query.where);
		if (query.facets) fields.push(...Object.keys(query.facets as object));
		if (typeof query.distinct_on === 'string') fields.push(query.distinct_on);
		if (query.boost) fields.push(...Object.keys(query.boost as object));
		if (Array.isArray(query.fields)) fields.push(...(query.fields as string[]));
		if (query.vector) fields.push((query.vector as { field: string }).field);
		for (const instruction of (query.order ?? []) as unknown as { field: string }[]) {
			fields.push(instruction.field);
		}
		return fields;
	}

	const vectors = suite.vectors.filter((vector) => {
		if (vector.corpus_ref.preset !== 'article') return false;
		if (vector.query.offset !== undefined) return false;
		// `list()` clamps `limit` into 1..5000 by contract, so a zero-limit case is
		// not expressible through the public API on either engine.
		if (vector.query.limit === 0) return false;
		// `list()` injects `order: updated_at DESC` when a query has none, so a case
		// whose page was cut by a limit — or whose `distinct_on` representative
		// depends on the ordering — would legitimately differ. Keep only the cases
		// where the comparison is meaningful.
		const has_order = vector.query.order !== undefined;
		if (!has_order && vector.query.distinct_on !== undefined) return false;
		if (!has_order && vector.expected_counts.returned !== vector.expected_counts.total) {
			return false;
		}
		// Skip anything this table does not declare, or that `list()` rejects by
		// contract (a non-sortable `order` field).
		for (const field of referencedFields(vector.query)) {
			if (search_schema[field] === undefined) return false;
		}
		for (const instruction of (vector.query.order ?? []) as unknown as {
			field: string;
		}[]) {
			if (!sortable.has(instruction.field)) return false;
		}
		return true;
	});

	let fixture: Fixture;
	beforeEach(() => {
		fixture = createServer({ article: articleTable as unknown as Database.Table });
		const corpus = generateCorpus({
			preset: 'article',
			size: 'tiny',
			seed: 'article-tiny',
		});
		const columns = ['id', 'title', 'body', 'summary', 'author_name', 'author_email'];
		void columns;
		for (const doc of corpus.docs) {
			insertArticleRow(fixture.state, doc as Record<string, unknown>);
		}
		(
			fixture.db as unknown as { rebuildSearchTables(type: string): void }
		).rebuildSearchTables('article');
	});
	afterEach(() => fixture.state.close());

	it('replays a meaningful subset of the frozen answers', () => {
		expect(vectors.length).toBeGreaterThan(50);
		const failures: string[] = [];
		for (const vector of vectors) {
			let results: {
				count: number;
				hits: { document: Record<string, unknown> }[];
				facets?: Record<string, unknown>;
			};
			try {
				results = fixture.db.list('article', {
					...(vector.query as Record<string, unknown>),
					limit: vector.query.limit ?? 5000,
				} as never) as never;
			} catch (error) {
				failures.push(`${vector.name}: threw ${(error as Error).message}`);
				continue;
			}
			if (results.count !== vector.expected_counts.total) {
				failures.push(
					`${vector.name}: count ${results.count} !== ${vector.expected_counts.total}`,
				);
				continue;
			}
			const ids = results.hits.map((hit) => String(hit.document.id));
			const expected = vector.expected_ids_in_order.map(String);
			// Order is asserted only when the case pinned it: otherwise `list()`'s
			// injected default ordering legitimately differs from score order.
			const actual = vector.query.order ? ids : [...ids].sort();
			const wanted = vector.query.order ? expected : [...expected].sort();
			if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
				failures.push(
					`${vector.name}: ids ${JSON.stringify(actual)} !== ${JSON.stringify(wanted)}`,
				);
			}
			if (vector.expected_facets) {
				if (JSON.stringify(results.facets) !== JSON.stringify(vector.expected_facets)) {
					failures.push(`${vector.name}: facets differ`);
				}
			}
		}
		expect(failures).toEqual([]);
	});
});

/** Insert one corpus document as the entity row `db.server.ts` would write. */
function insertArticleRow(state: Fixture['state'], doc: Record<string, unknown>): void {
	const column_fields = [
		'id',
		'title',
		'body',
		'summary',
		'author_name',
		'author_email',
		'slug',
		'code',
		'status',
		'tier',
		'view_count',
		'rating',
		'is_published',
		'updated_at',
	];
	const columns: string[] = [];
	const values: unknown[] = [];
	const overflow: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(doc)) {
		if (value === null || value === undefined) continue;
		if (column_fields.includes(key)) {
			columns.push(key);
			values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
		} else {
			overflow[key] = value;
		}
	}
	if (!columns.includes('updated_at')) {
		columns.push('updated_at');
		values.push(0);
	}
	columns.push('created_at', 'json');
	values.push(0, JSON.stringify(overflow));
	state.db
		.prepare(
			`INSERT INTO article (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
		)
		.run(...(values as never[]));
}
