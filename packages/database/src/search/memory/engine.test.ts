import { DelightError } from '@delightstack/utilities';
import { describe, expect, it } from 'vitest';
import type { SearchableType } from '../core/types';
import type { WhereSchema } from '../core/where';
import { MemorySearchEngine } from './engine';
import type { SearchQuery } from '../core/types';

const SCHEMA: WhereSchema = {
	title: 'string',
	body: 'string',
	tags: 'string[]',
	folder: 'enum',
	count: 'number',
	active: 'boolean',
	place: 'geopoint',
	embedding: 'vector[3]' as SearchableType,
};

const DOCS = [
	{
		id: 'a',
		title: 'database engine',
		body: 'a fast search database for data',
		tags: ['search', 'db'],
		folder: 'inbox',
		count: 10,
		active: true,
		place: { lat: 0, lon: 0 },
	},
	{
		id: 'b',
		title: 'data structures',
		body: 'trees and tries',
		tags: ['db'],
		folder: 'inbox',
		count: 5,
		active: false,
		place: { lat: 40, lon: -105 },
	},
	{
		id: 'c',
		title: 'cooking',
		body: 'how to bake bread',
		tags: ['food'],
		folder: 'archive',
		count: 20,
		active: true,
	},
];

/** A fresh engine over the fixture corpus. */
function makeEngine(
	documents: readonly Record<string, unknown>[] = DOCS,
): MemorySearchEngine {
	const engine = new MemorySearchEngine({ schema: SCHEMA });
	engine.insertMany(documents);
	return engine;
}

/** The ids a query returns, in order. */
function ids(engine: MemorySearchEngine, query: SearchQuery): string[] {
	return engine.search(query).hits.map((hit) => hit.id);
}

describe('filter-only queries', () => {
	it('returns everything in primary-key order with no term and no order', () => {
		const results = makeEngine().search({});
		expect(results.hits.map((hit) => hit.id)).toEqual(['a', 'b', 'c']);
		expect(results.count).toBe(3);
		expect(results.hits.every((hit) => hit.score === 0)).toBe(true);
	});

	it('applies the where filter and reports the matched count', () => {
		const results = makeEngine().search({ where: { folder: 'inbox' } });
		expect(results.hits.map((hit) => hit.id)).toEqual(['a', 'b']);
		expect(results.count).toBe(2);
	});

	it('reports a deterministic zero elapsed time (no Date.now in the engine)', () => {
		expect(makeEngine().search({}).elapsed).toEqual({ raw: 0, formatted: '0ms' });
	});

	it('omits facets when none were requested', () => {
		expect(makeEngine().search({}).facets).toBeUndefined();
	});
});

describe('term matching', () => {
	it('matches by prefix across every searchable field', () => {
		expect(ids(makeEngine(), { term: 'data' }).sort()).toEqual(['a', 'b']);
	});

	it('orders by score descending then primary key ascending', () => {
		const engine = makeEngine();
		const results = engine.search({ term: 'data' });
		expect(results.hits[0].score).toBeGreaterThanOrEqual(results.hits[1].score);
	});

	it('breaks equal scores by primary key ascending', () => {
		const engine = new MemorySearchEngine({ schema: SCHEMA });
		engine.insertMany([
			{ id: 'z', title: 'same words here' },
			{ id: 'm', title: 'same words here' },
			{ id: 'a', title: 'same words here' },
		]);
		expect(ids(engine, { term: 'same' })).toEqual(['a', 'm', 'z']);
	});

	it('never matches enum fields (they are not tokenized)', () => {
		expect(ids(makeEngine(), { term: 'archive' })).toEqual([]);
	});

	it('scores repeated terms higher (real tf, unlike Orama de-duplication)', () => {
		const engine = new MemorySearchEngine({ schema: SCHEMA });
		engine.insertMany([
			{ id: 'many', title: 'cat cat cat cat' },
			{ id: 'one', title: 'cat dog bird fish' },
		]);
		const results = engine.search({ term: 'cat' });
		expect(results.hits.map((hit) => hit.id)).toEqual(['many', 'one']);
		expect(results.hits[0].score).toBeGreaterThan(results.hits[1].score);
	});

	it('sums each prefix expansion rather than taking the maximum', () => {
		const engine = new MemorySearchEngine({ schema: SCHEMA });
		engine.insertMany([
			{ id: 'A', title: 'aa ab ac ad' },
			{ id: 'B', title: 'aa zz yy xx' },
		]);
		const results = engine.search({ term: 'a' });
		expect(results.hits[0].id).toBe('A');
		expect(results.hits[0].score).toBeGreaterThan(results.hits[1].score * 4);
	});

	it('restricts matching with `fields`', () => {
		expect(ids(makeEngine(), { term: 'trees', fields: ['title'] })).toEqual([]);
		expect(ids(makeEngine(), { term: 'trees', fields: ['body'] })).toEqual(['b']);
	});

	it('applies per-field boost multipliers', () => {
		const engine = new MemorySearchEngine({ schema: SCHEMA });
		engine.insertMany([
			{ id: 'title_hit', title: 'alpha', body: 'nothing' },
			{ id: 'body_hit', title: 'nothing', body: 'alpha' },
		]);
		expect(ids(engine, { term: 'alpha', boost: { title: 5 } })).toEqual([
			'title_hit',
			'body_hit',
		]);
		expect(ids(engine, { term: 'alpha', boost: { body: 5 } })).toEqual([
			'body_hit',
			'title_hit',
		]);
	});

	it('intersects term matches with the where filter', () => {
		expect(
			ids(makeEngine(), { term: 'data', where: { folder: 'inbox', count: 5 } }),
		).toEqual(['b']);
	});

	it('matches array fields element-wise', () => {
		expect(ids(makeEngine(), { term: 'food' })).toEqual(['c']);
	});
});

describe('exact', () => {
	it('requires whole-token equality instead of a prefix', () => {
		expect(ids(makeEngine(), { term: 'dat' })).toEqual(
			expect.arrayContaining(['a', 'b']),
		);
		expect(ids(makeEngine(), { term: 'dat', exact: true })).toEqual([]);
		expect(ids(makeEngine(), { term: 'data', exact: true }).sort()).toEqual(['a', 'b']);
	});

	it('is case-insensitive (deliberate Orama deviation)', () => {
		const engine = new MemorySearchEngine({ schema: SCHEMA });
		engine.insertMany([
			{ id: 'upper', title: 'Cat sat' },
			{ id: 'lower', title: 'cat ran' },
		]);
		expect(ids(engine, { term: 'cat', exact: true }).sort()).toEqual(['lower', 'upper']);
		expect(ids(engine, { term: 'Cat', exact: true }).sort()).toEqual(['lower', 'upper']);
	});

	it('works on array fields (Orama silently never matched them)', () => {
		expect(ids(makeEngine(), { term: 'search', exact: true })).toEqual(['a']);
	});

	it('suppresses tolerance entirely', () => {
		expect(ids(makeEngine(), { term: 'databse', tolerance: 1, exact: true })).toEqual([]);
	});
});

describe('tolerance', () => {
	it('admits tokens within the edit distance at full weight', () => {
		const engine = new MemorySearchEngine({ schema: SCHEMA });
		engine.insertMany([
			{ id: 'exactword', title: 'hello world one two' },
			{ id: 'fuzzyword', title: 'hallo world one two' },
		]);
		const results = engine.search({ term: 'hello', tolerance: 1 });
		expect(results.hits.map((hit) => hit.id)).toEqual(['exactword', 'fuzzyword']);
		expect(results.hits[0].score).toBe(results.hits[1].score);
	});

	it('is a union with prefix matching, not a replacement', () => {
		const engine = new MemorySearchEngine({ schema: SCHEMA });
		engine.insertMany([
			{ id: 'p', title: 'hello' },
			{ id: 'f', title: 'hallo' },
		]);
		// 'hell' prefix-matches 'hello'; 'hallo' is distance 2 away.
		expect(ids(engine, { term: 'hell', tolerance: 1 })).toEqual(['p']);
		expect(ids(engine, { term: 'hell', tolerance: 2 }).sort()).toEqual(['f', 'p']);
	});
});

describe('threshold', () => {
	/** alpha in one field, beta in another — the per-document/per-field divergence. */
	const CORPUS = [
		{ id: 'both_same_field', title: 'alpha beta' },
		{ id: 'split_fields', title: 'alpha', body: 'beta' },
		{ id: 'alpha_only', title: 'alpha' },
		{ id: 'beta_only', title: 'beta' },
		{ id: 'neither', title: 'gamma' },
	];

	it('returns the union by default', () => {
		expect(ids(makeEngine(CORPUS), { term: 'alpha beta' }).sort()).toEqual([
			'alpha_only',
			'beta_only',
			'both_same_field',
			'split_fields',
		]);
	});

	it('requires all tokens per DOCUMENT at threshold 0, not per field', () => {
		// Orama excludes `split_fields` here; we include it deliberately.
		expect(ids(makeEngine(CORPUS), { term: 'alpha beta', threshold: 0 }).sort()).toEqual([
			'both_same_field',
			'split_fields',
		]);
	});

	it('counts distinct query tokens, so prefix expansion cannot fake a full match', () => {
		const engine = makeEngine([{ id: 'quirk', title: 'alp alpine' }]);
		expect(ids(engine, { term: 'al be', threshold: 0 })).toEqual([]);
	});

	it('always applies the fractional filter, even when nothing matches everything', () => {
		// Orama skips the filter entirely when the all-match set is empty.
		const engine = makeEngine(CORPUS);
		const all = ids(engine, { term: 'alpha qqqqqq' });
		expect(all.length).toBe(3);
		expect(ids(engine, { term: 'alpha qqqqqq', threshold: 0.5 })).toHaveLength(2);
	});

	it('adds the top fraction of partial matches by score', () => {
		const engine = makeEngine(CORPUS);
		const partial = ids(engine, { term: 'alpha beta', threshold: 0.5 });
		expect(partial).toContain('both_same_field');
		expect(partial).toContain('split_fields');
		expect(partial).toHaveLength(3); // 2 full + ceil(2 * 0.5)
	});

	it('returns nothing at threshold 0 when a token matches nothing', () => {
		expect(ids(makeEngine(CORPUS), { term: 'alpha qqqqqq', threshold: 0 })).toEqual([]);
	});
});

describe('ordering', () => {
	it('sorts by order[] through the core comparator', () => {
		expect(ids(makeEngine(), { order: [{ field: 'count', direction: 'DESC' }] })).toEqual(
			['c', 'a', 'b'],
		);
		expect(ids(makeEngine(), { order: [{ field: 'count' }] })).toEqual(['b', 'a', 'c']);
	});

	it('sorts null/missing last in both directions', () => {
		const engine = makeEngine([
			{ id: '1', count: 2 },
			{ id: '2' },
			{ id: '3', count: 1 },
		]);
		expect(ids(engine, { order: [{ field: 'count' }] })).toEqual(['3', '1', '2']);
		expect(ids(engine, { order: [{ field: 'count', direction: 'DESC' }] })).toEqual([
			'1',
			'3',
			'2',
		]);
	});

	it('falls back to the primary key on ties', () => {
		const engine = makeEngine([
			{ id: 'z', count: 1 },
			{ id: 'a', count: 1 },
		]);
		expect(ids(engine, { order: [{ field: 'count' }] })).toEqual(['a', 'z']);
	});

	it('applies multiple orderings in sequence', () => {
		const engine = makeEngine([
			{ id: '1', folder: 'a', count: 2 },
			{ id: '2', folder: 'a', count: 1 },
			{ id: '3', folder: 'b', count: 9 },
		]);
		expect(
			ids(engine, {
				order: [{ field: 'folder' }, { field: 'count', direction: 'DESC' }],
			}),
		).toEqual(['1', '2', '3']);
	});

	it('lets order[] override score ordering', () => {
		expect(ids(makeEngine(), { term: 'data', order: [{ field: 'count' }] })).toEqual([
			'b',
			'a',
		]);
	});

	it('compares numeric primary keys as numbers', () => {
		const engine = new MemorySearchEngine({
			schema: SCHEMA,
			primary_key_type: 'number',
		});
		engine.insertMany([{ id: 10 }, { id: 2 }, { id: 1 }]);
		expect(ids(engine, {})).toEqual(['1', '2', '10']);
		const string_engine = new MemorySearchEngine({ schema: SCHEMA });
		string_engine.insertMany([{ id: 10 }, { id: 2 }, { id: 1 }]);
		expect(ids(string_engine, {})).toEqual(['1', '10', '2']);
	});
});

describe('distinct_on', () => {
	it('keeps the first hit per distinct value after ordering', () => {
		expect(ids(makeEngine(), { distinct_on: 'folder' })).toEqual(['a', 'c']);
	});

	it('reports a POST-distinct count (Orama reported the pre-distinct one)', () => {
		const results = makeEngine().search({ distinct_on: 'folder' });
		expect(results.count).toBe(2);
	});

	it('groups missing values together', () => {
		const engine = makeEngine([{ id: '1', folder: 'x' }, { id: '2' }, { id: '3' }]);
		expect(ids(engine, { distinct_on: 'folder' })).toEqual(['1', '2']);
	});

	it('respects the ordering when choosing the survivor', () => {
		expect(
			ids(makeEngine(), { distinct_on: 'folder', order: [{ field: 'count' }] }),
		).toEqual(['b', 'c']);
	});
});

describe('facets', () => {
	it('counts over the full matched set, before limit/offset', () => {
		const results = makeEngine().search({ facets: { folder: {} }, limit: 1 });
		expect(results.hits).toHaveLength(1);
		expect(results.facets?.folder).toEqual({
			count: 2,
			values: { inbox: 2, archive: 1 },
		});
	});

	it('counts only the filtered set', () => {
		const results = makeEngine().search({
			where: { folder: 'inbox' },
			facets: { tags: {} },
		});
		expect(results.facets?.tags).toEqual({ count: 2, values: { db: 2, search: 1 } });
	});
});

describe('limit and offset', () => {
	it('pages after ordering while keeping the full count', () => {
		const results = makeEngine().search({ limit: 2, offset: 1 });
		expect(results.hits.map((hit) => hit.id)).toEqual(['b', 'c']);
		expect(results.count).toBe(3);
	});

	it('returns everything when no limit is given', () => {
		expect(makeEngine().search({}).hits).toHaveLength(3);
	});
});

describe('vector mode', () => {
	const VECTOR_DOCS = [
		{ id: 'x', embedding: [1, 0, 0], title: 'alpha' },
		{ id: 'y', embedding: [10, 1, 0], title: 'alpha' },
		{ id: 'w', embedding: [1, 1, 0], title: 'alpha beta gamma' },
		{ id: 'z', embedding: [0, 1, 0] },
	];

	it('scores by dot product over unit vectors and applies the 0.8 default floor', () => {
		const results = makeEngine(VECTOR_DOCS).search({
			vector: { value: [1, 0, 0], field: 'embedding' },
		});
		expect(results.hits.map((hit) => hit.id)).toEqual(['x', 'y']);
		expect(results.hits[0].score).toBeCloseTo(1, 6);
	});

	it('is scale invariant (dot product over unit vectors IS cosine)', () => {
		const engine = makeEngine(VECTOR_DOCS);
		const one = engine.search({ vector: { value: [1, 0, 0], field: 'embedding' } });
		const two = engine.search({ vector: { value: [2, 0, 0], field: 'embedding' } });
		expect(one.hits.map((hit) => hit.score)).toEqual(two.hits.map((hit) => hit.score));
	});

	it('honours an explicit similarity floor inside the vector object', () => {
		const engine = makeEngine(VECTOR_DOCS);
		expect(
			ids(engine, {
				vector: { value: [1, 0, 0], field: 'embedding', similarity: 0 },
			}),
		).toEqual(['x', 'y', 'w', 'z']);
		expect(
			ids(engine, {
				vector: { value: [1, 0, 0], field: 'embedding', similarity: 0.999 },
			}),
		).toEqual(['x']);
	});

	it('orders by similarity descending then primary key ascending', () => {
		const engine = makeEngine([
			{ id: 'b', embedding: [1, 0, 0] },
			{ id: 'a', embedding: [1, 0, 0] },
		]);
		expect(ids(engine, { vector: { value: [1, 0, 0], field: 'embedding' } })).toEqual([
			'a',
			'b',
		]);
	});

	it('intersects with the where filter', () => {
		const engine = makeEngine([
			{ id: 'x', embedding: [1, 0, 0], folder: 'inbox' },
			{ id: 'y', embedding: [1, 0, 0], folder: 'spam' },
		]);
		expect(
			ids(engine, {
				vector: { value: [1, 0, 0], field: 'embedding' },
				where: { folder: 'inbox' },
			}),
		).toEqual(['x']);
	});

	it('rejects zero vectors at write and at query time', () => {
		expect(() => makeEngine([{ id: 'zero', embedding: [0, 0, 0] }])).toThrow(
			DelightError,
		);
		expect(() =>
			makeEngine(VECTOR_DOCS).search({
				vector: { value: [0, 0, 0], field: 'embedding' },
			}),
		).toThrow(DelightError);
	});

	it('throws a 400 for an unknown or non-vector field', () => {
		expect(() =>
			makeEngine(VECTOR_DOCS).search({ vector: { value: [1, 0, 0], field: 'nope' } }),
		).toThrow(DelightError);
		expect(() =>
			makeEngine(VECTOR_DOCS).search({ vector: { value: [1, 0, 0], field: 'title' } }),
		).toThrow(DelightError);
	});

	it('runs hybrid mode as a max-normalized 0.5/0.5 fusion over the union', () => {
		const results = makeEngine(VECTOR_DOCS).search({
			term: 'alpha',
			vector: { value: [1, 0, 0], field: 'embedding' },
		});
		// `w` matches text only; `x`/`y` match both.
		expect(results.hits.map((hit) => hit.id)).toEqual(['x', 'y', 'w']);
		expect(results.hits.every((hit) => hit.score > 0 && hit.score <= 1)).toBe(true);
	});
});

describe('validation', () => {
	function expectBadRequest(query: SearchQuery): void {
		let thrown: unknown;
		try {
			makeEngine().search(query);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(DelightError);
		expect((thrown as DelightError).status).toBe(400);
	}

	it('rejects an unknown search field', () => {
		expectBadRequest({ term: 'x', fields: ['nope'] });
	});

	it('rejects an enum named in `fields` (enums are never term-matched)', () => {
		expectBadRequest({ term: 'x', fields: ['folder'] });
	});

	it('rejects an unknown order field', () => {
		expectBadRequest({ order: [{ field: 'nope' }] });
	});

	it('rejects an unknown distinct_on field', () => {
		expectBadRequest({ distinct_on: 'nope' });
	});

	it('rejects an unknown filter field', () => {
		expectBadRequest({ where: { nope: 1 } });
	});

	it('accepts the primary key in order[] and distinct_on', () => {
		expect(ids(makeEngine(), { order: [{ field: 'id', direction: 'DESC' }] })).toEqual([
			'c',
			'b',
			'a',
		]);
	});
});

describe('write path', () => {
	it('re-indexes a document in place on re-insert', () => {
		const engine = makeEngine();
		expect(ids(engine, { term: 'cooking' })).toEqual(['c']);
		engine.insert({ ...DOCS[2], title: 'gardening' });
		expect(ids(engine, { term: 'cooking' })).toEqual([]);
		expect(ids(engine, { term: 'gardening' })).toEqual(['c']);
		expect(engine.search({}).count).toBe(3);
	});

	it('removes a document and its postings', () => {
		const engine = makeEngine();
		expect(engine.remove('a')).toBe(true);
		expect(engine.remove('a')).toBe(false);
		expect(ids(engine, { term: 'database' })).toEqual([]);
		expect(engine.search({}).count).toBe(2);
	});

	it('keeps field statistics correct across removals', () => {
		const engine = makeEngine();
		const before = engine.store.getFieldStats('title');
		engine.remove('c');
		const after = engine.store.getFieldStats('title');
		expect(after.doc_count).toBe(before.doc_count - 1);
		expect(after.total_len).toBe(before.total_len - 1);
	});

	it('requires a primary key', () => {
		expect(() => makeEngine([{ title: 'no id' }])).toThrow(DelightError);
	});
});

describe('determinism', () => {
	it('produces identical output for repeated identical queries', () => {
		const engine = makeEngine();
		const query: SearchQuery = {
			term: 'data',
			facets: { folder: {} },
			order: [{ field: 'count' }],
		};
		expect(engine.search(query)).toEqual(engine.search(query));
	});

	it('is independent of insertion order', () => {
		const forwards = makeEngine(DOCS);
		const backwards = makeEngine([...DOCS].reverse());
		const query: SearchQuery = { term: 'data', facets: { folder: {} } };
		expect(forwards.search(query).hits.map((hit) => hit.id)).toEqual(
			backwards.search(query).hits.map((hit) => hit.id),
		);
		expect(forwards.search(query).hits.map((hit) => hit.score)).toEqual(
			backwards.search(query).hits.map((hit) => hit.score),
		);
	});
});
