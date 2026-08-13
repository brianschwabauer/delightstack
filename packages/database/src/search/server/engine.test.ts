// @vitest-environment node
/**
 * `engine.ts` driver tests (plan §7.5) — the orchestration the golden vectors
 * cannot see: which SQL path a query takes, and the write/rebuild lifecycle.
 *
 * Semantics are *not* re-asserted here — `engine.golden.test.ts` replays the
 * frozen answers for that, and duplicating them would let the two drift.
 */

import { describe, expect, it } from 'vitest';
import { DelightError } from '@delightstack/utilities';
import {
	createEntityTable,
	insertEntityRow,
	NodeSqlStorage,
} from '../__tests__/sqlite_harness';
import type { WhereSchema } from '../core/where';
import { SqliteSearchEngine, rowToDocument, type ServerSearchTable } from './engine';

const SCHEMA: WhereSchema = {
	id: 'string',
	title: 'string',
	rating: 'number',
	status: 'enum',
	is_published: 'boolean',
	tags: 'string[]',
	'address.city': 'string',
	author_name: 'string',
	location: 'geopoint',
	embedding: 'vector[3]',
	updated_at: 'number',
};

const DOCUMENTS: Record<string, unknown>[] = [
	{
		id: 'a',
		title: 'alpha data',
		rating: 3,
		status: 'published',
		is_published: true,
		tags: ['x'],
		address: { city: 'Zürich' },
		author_name: 'Ada',
		location: { lat: 47.3769, lon: 8.5417 },
		embedding: [1, 0, 0],
		updated_at: 100,
	},
	{
		id: 'b',
		title: 'beta database',
		rating: 9,
		status: 'draft',
		is_published: false,
		tags: ['y'],
		address: { city: 'Zürich' },
		author_name: 'Grace',
		embedding: [0, 1, 0],
		updated_at: 200,
	},
	{
		id: 'c',
		title: 'gamma dataset',
		rating: 3,
		status: 'published',
		is_published: true,
		tags: ['x', 'y'],
		author_name: 'Ada',
		updated_at: 300,
	},
];

/** A driver loaded with {@link DOCUMENTS}. */
function load(): {
	sql: NodeSqlStorage;
	engine: SqliteSearchEngine;
	table: ServerSearchTable;
} {
	const sql = new NodeSqlStorage();
	const engine = new SqliteSearchEngine(sql);
	engine.bootstrap();
	const table = createEntityTable(sql, {
		entity_type: 'article',
		table_name: 'articles',
		schema: SCHEMA,
		primary_key: 'id',
		primary_key_type: 'string',
		derived_fields: ['author_name'],
	});
	engine.register(table);
	for (const document of DOCUMENTS) insertEntityRow(sql, table, document);
	let after: string | number | undefined;
	for (;;) {
		const batch = engine.rebuildBatch('article', { after, batch_size: 2 });
		after = batch.last_primary_key;
		if (batch.done) break;
	}
	return { sql, engine, table };
}

describe('row round trip', () => {
	it('rebuilds the indexed document from columns, json and $derived', () => {
		const { sql, table } = load();
		const row = sql.exec('SELECT * FROM articles WHERE id = ?;', 'a').toArray()[0];
		const document = rowToDocument(table, row);
		expect(document.title).toBe('alpha data');
		expect(document.rating).toBe(3);
		expect(document.is_published).toBe(true);
		expect(document.tags).toEqual(['x']);
		expect(document.address).toEqual({ city: 'Zürich' });
		// FK-derived values are hoisted out of `$derived` and read like any field.
		expect(document.author_name).toBe('Ada');
		expect(document.$derived).toBeUndefined();
	});
});

describe('rebuild lifecycle', () => {
	it('pages the entity table by primary key until done', () => {
		const { engine } = load();
		engine.clearSearchTables('article');
		expect(engine.list('article', { term: 'data' }).count).toBe(0);
		let after: string | number | undefined;
		let total = 0;
		for (;;) {
			const batch = engine.rebuildBatch('article', { after, batch_size: 2 });
			total += batch.indexed;
			after = batch.last_primary_key;
			if (batch.done) break;
		}
		expect(total).toBe(3);
		expect(engine.list('article', { term: 'data' }).count).toBe(3);
	});

	it('reflects removals immediately', () => {
		const { engine } = load();
		expect(engine.removeDocument('article', 'b', 5)).toBe(true);
		expect(engine.list('article', { term: 'database' }).count).toBe(0);
		expect(engine.store.countTombstones('article')).toBe(1);
	});

	it('reflects an incremental re-index with the previous document in hand', () => {
		const { engine } = load();
		engine.indexDocument(
			'article',
			'a',
			{ ...DOCUMENTS[0], title: 'omega' },
			DOCUMENTS[0],
		);
		expect(engine.list('article', { term: 'alpha' }).count).toBe(0);
		expect(engine.list('article', { term: 'omega' }).hits.map((hit) => hit.id)).toEqual([
			'a',
		]);
	});

	it('refuses an unregistered entity type', () => {
		const { engine } = load();
		expect(() => engine.list('nope', {})).toThrow(DelightError);
	});
});

describe('query planning', () => {
	/** SELECT statements the driver issued for one query. */
	function statementsFor(
		sql: NodeSqlStorage,
		run: () => void,
	): { sql: string; params: unknown[] }[] {
		sql.log.length = 0;
		run();
		return sql.log.filter((entry) => entry.sql.startsWith('SELECT'));
	}

	it('takes the fast path — one SELECT plus a COUNT companion', () => {
		const { sql, engine } = load();
		const statements = statementsFor(sql, () => {
			engine.list('article', {
				where: { status: 'published' },
				order: [{ field: 'updated_at', direction: 'DESC' }],
				limit: 10,
			});
		});
		expect(statements).toHaveLength(2);
		expect(statements[0].sql).toContain('COUNT(*)');
		expect(statements[1].sql).toContain('ORDER BY');
		expect(statements[1].sql).toContain('LIMIT 10 OFFSET 0');
	});

	it('reports the full count with limit: 0 and returns no hits', () => {
		const { engine } = load();
		const result = engine.list('article', { where: { status: 'published' }, limit: 0 });
		expect(result.hits).toEqual([]);
		expect(result.count).toBe(2);
	});

	it('leaves the fast path when facets or distinct_on are requested', () => {
		const { sql, engine } = load();
		const statements = statementsFor(sql, () => {
			engine.list('article', { facets: { status: {} } });
		});
		expect(statements.every((entry) => !entry.sql.includes('COUNT(*)'))).toBe(true);
		expect(engine.list('article', { facets: { status: {} } }).facets).toEqual({
			status: { count: 2, values: { published: 2, draft: 1 } },
		});
	});

	it('leaves the fast path when the where is only a prefilter (geo)', () => {
		const { engine } = load();
		const result = engine.list('article', {
			where: {
				location: {
					radius: { coordinates: { lat: 47.3769, lon: 8.5417 }, value: 10 },
				},
			},
		});
		// The bbox admits `a`; `core/geo` is what actually decides, and the two
		// documents without a geopoint fail the null rule.
		expect(result.hits.map((hit) => hit.id)).toEqual(['a']);
	});

	it('orders by a child path through its generated column', () => {
		const { engine } = load();
		const result = engine.list('article', {
			order: [{ field: 'address.city', direction: 'ASC' }],
		});
		// Nulls last, then the primary-key tie-break.
		expect(result.hits.map((hit) => hit.id)).toEqual(['a', 'b', 'c']);
	});

	it('filters on an FK-derived field through its generated column', () => {
		const { engine } = load();
		expect(
			engine.list('article', { where: { author_name: 'Ada' } }).hits.map((h) => h.id),
		).toEqual(['a', 'c']);
	});

	it('runs vector and hybrid queries', () => {
		const { engine } = load();
		const vector_only = engine.list('article', {
			vector: { value: [1, 0, 0], field: 'embedding' },
		});
		expect(vector_only.hits.map((hit) => hit.id)).toEqual(['a']);
		const hybrid = engine.list('article', {
			term: 'data',
			vector: { value: [1, 0, 0], field: 'embedding', similarity: 0 },
		});
		expect(hybrid.hits[0].id).toBe('a');
	});

	it('never binds more than 100 parameters on the read path either', () => {
		const { sql, engine } = load();
		sql.log.length = 0;
		engine.list('article', {
			where: { status: { in: Array.from({ length: 400 }, (_, i) => `s${i}`) } },
		});
		for (const entry of sql.log) {
			expect(entry.params.length).toBeLessThanOrEqual(100);
		}
	});

	it('batches df and posting reads per token expansion, preserving scores', () => {
		const { sql, engine } = load();
		const baseline = engine.list('article', { term: 'data', tolerance: 1 });
		const statements = statementsFor(sql, () => {
			engine.list('article', { term: 'data', tolerance: 1 });
		});
		// Chunked `IN (...)` reads: no per-candidate statement proliferation.
		for (const entry of statements) {
			if (
				entry.sql.includes('FROM search_postings') ||
				(entry.sql.includes('FROM search_tokens') && entry.sql.includes('df'))
			) {
				expect(entry.sql).toContain('IN (');
				expect(entry.params.length).toBeLessThanOrEqual(100);
			}
		}
		expect(engine.list('article', { term: 'data', tolerance: 1 })).toEqual(baseline);
	});
});

describe('query hardening', () => {
	it('scores at most the first 32 tokens of the query term', () => {
		const { engine } = load();
		const junk = Array.from({ length: 40 }, (_, i) => `zz${i}`);
		// The only matching token is past the cap — it must be ignored.
		const past_cap = engine.list('article', { term: `${junk.join(' ')} data` });
		expect(past_cap.count).toBe(0);
		// Inside the cap it still matches.
		const in_cap = engine.list('article', {
			term: `data ${junk.slice(0, 20).join(' ')}`,
		});
		expect(in_cap.count).toBe(3);
	});

	it('rejects a wrong-dimension query vector before touching stored vectors', () => {
		const { sql, engine } = load();
		sql.log.length = 0;
		const huge = new Array<number>(1_000_000).fill(1);
		expect(() =>
			engine.list('article', { vector: { value: huge, field: 'embedding' } }),
		).toThrowError(
			expect.objectContaining({
				status: 400,
				message: 'Vector dimension mismatch: query has 1000000, index has 3.',
			}),
		);
		// Rejected before any per-document work: no vector rows were read.
		expect(sql.log.some((entry) => entry.sql.includes('FROM search_vectors'))).toBe(
			false,
		);
	});

	it('pushes candidate ids down into the vector read and matches the full scan', () => {
		const { sql, engine } = load();
		const full = engine.list('article', {
			vector: { value: [1, 0, 0], field: 'embedding', similarity: -1 },
		});
		sql.log.length = 0;
		const filtered = engine.list('article', {
			where: { status: { in: ['published', 'draft'] } },
			vector: { value: [1, 0, 0], field: 'embedding', similarity: -1 },
		});
		// The where admits every document, so membership and scores must be
		// identical to the unfiltered scan.
		expect(filtered.hits.map((hit) => [hit.id, hit.score])).toEqual(
			full.hits.map((hit) => [hit.id, hit.score]),
		);
		// ...but the vector read was scoped to the candidate ids.
		const vector_reads = sql.log.filter((entry) =>
			entry.sql.includes('FROM search_vectors WHERE'),
		);
		expect(vector_reads.length).toBeGreaterThan(0);
		expect(vector_reads.every((entry) => entry.sql.includes('doc_id IN ('))).toBe(true);
	});

	it('pulls the next entry forward when an entity row is missing (#pageByScore)', () => {
		const { sql, engine } = load();
		// Simulate index/table divergence: delete the entity row underneath the
		// postings (a state the write path cannot produce, which is exactly why
		// the read path must recover from it).
		sql.exec(`DELETE FROM articles WHERE id = ?;`, 'b');
		// All three documents match "dat*" and the query is deferrable (no order,
		// no facets, no distinct_on) — the #pageByScore path.
		const page = engine.list('article', { term: 'data', limit: 2 });
		expect(page.hits).toHaveLength(2);
		expect(page.hits.map((hit) => hit.id).sort()).toEqual(['a', 'c']);
		expect(page.count).toBe(2);
	});
});
