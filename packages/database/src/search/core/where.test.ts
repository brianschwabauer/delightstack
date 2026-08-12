import { DelightError } from '@delightstack/utilities';
import { describe, expect, it } from 'vitest';
import type { SearchableType } from './types';
import { getFieldValue, matchesWhere, normalizeWhere, type WhereSchema } from './where';

const SCHEMA: WhereSchema = {
	title: 'string',
	tags: 'string[]',
	count: 'number',
	scores: 'number[]',
	active: 'boolean',
	folder: 'enum',
	label_ids: 'enum[]',
	place: 'geopoint',
	embedding: 'vector[3]' as SearchableType,
	'address.city': 'string',
};

const FULL = {
	title: 'hello',
	tags: ['red', 'blue'],
	count: 5,
	scores: [1, 2, 3],
	active: true,
	folder: 'inbox',
	label_ids: ['x', 'y'],
	place: { lat: 0, lon: 0 },
	address: { city: 'Denver' },
};

const OTHER = {
	title: 'goodbye',
	tags: ['green'],
	count: 50,
	scores: [10],
	active: false,
	folder: 'spam',
	label_ids: ['z'],
	place: { lat: 40, lon: -105 },
	address: { city: 'Boulder' },
};

/** A document with none of the filterable fields present. */
const EMPTY: Record<string, unknown> = { title: 'nothing else' };

/** Which of the three fixture docs a filter matches. */
function matched(where: Record<string, unknown>): string[] {
	const docs: [string, Record<string, unknown>][] = [
		['full', FULL],
		['other', OTHER],
		['empty', EMPTY],
	];
	return docs.filter(([, doc]) => matchesWhere(doc, where, SCHEMA)).map(([name]) => name);
}

describe('getFieldValue', () => {
	it('prefers an exact dotted key, then walks segments', () => {
		expect(getFieldValue({ 'a.b': 1, a: { b: 2 } }, 'a.b')).toBe(1);
		expect(getFieldValue({ a: { b: 2 } }, 'a.b')).toBe(2);
	});

	it('returns undefined for missing paths and paths through arrays', () => {
		expect(getFieldValue({ a: {} }, 'a.b')).toBeUndefined();
		expect(getFieldValue({ a: [{ b: 1 }] }, 'a.b')).toBeUndefined();
		expect(getFieldValue({}, 'nope')).toBeUndefined();
	});
});

describe('normalization', () => {
	it('turns bare scalars into eq and bare arrays into in, for every type', () => {
		const normalized = normalizeWhere(
			{ title: 'hello', folder: ['inbox', 'spam'] },
			SCHEMA,
		);
		expect(normalized?.leaves).toEqual([
			{ field: 'folder', type: 'enum', operators: [['in', ['inbox', 'spam']]] },
			{ field: 'title', type: 'string', operators: [['eq', 'hello']] },
		]);
	});

	it('rejects the pre-rename operator spellings (no legacy aliases)', () => {
		expect(() => normalizeWhere({ label_ids: { containsAll: ['x'] } }, SCHEMA)).toThrow();
		expect(() => normalizeWhere({ label_ids: { containsAny: ['y'] } }, SCHEMA)).toThrow();
		expect(() => normalizeWhere({ folder: { nin: ['spam'] } }, SCHEMA)).toThrow();
	});

	it('sorts leaves and operators so evaluation order is deterministic', () => {
		const normalized = normalizeWhere({ count: { lt: 9, gt: 1 }, active: true }, SCHEMA);
		expect(normalized?.leaves.map((leaf) => leaf.field)).toEqual(['active', 'count']);
		expect(normalized?.leaves[1].operators.map(([key]) => key)).toEqual(['gt', 'lt']);
	});

	it('returns undefined for an absent filter', () => {
		expect(normalizeWhere(undefined, SCHEMA)).toBeUndefined();
	});
});

describe('scalar operators', () => {
	it('matches strict typed equality with no coercion', () => {
		expect(matched({ count: 5 })).toEqual(['full']);
		expect(matched({ count: { eq: '5' } })).toEqual([]);
		expect(matched({ title: { eq: 'hello' } })).toEqual(['full']);
		expect(matched({ active: true })).toEqual(['full']);
		expect(matched({ active: { eq: 1 } })).toEqual([]);
	});

	it('supports in / not_in with the presence rule', () => {
		expect(matched({ folder: { in: ['inbox', 'archive'] } })).toEqual(['full']);
		// not_in requires the field to be present, so `empty` is excluded.
		expect(matched({ folder: { not_in: ['spam'] } })).toEqual(['full']);
	});

	it('supports the ordering operators through the core comparator', () => {
		expect(matched({ count: { gt: 5 } })).toEqual(['other']);
		expect(matched({ count: { gte: 5 } })).toEqual(['full', 'other']);
		expect(matched({ count: { lt: 50 } })).toEqual(['full']);
		expect(matched({ count: { lte: 5 } })).toEqual(['full']);
		expect(matched({ title: { gt: 'goodbye' } })).toEqual(['full', 'empty']);
	});

	it('treats between as inclusive on both ends', () => {
		expect(matched({ count: { between: [5, 50] } })).toEqual(['full', 'other']);
		expect(matched({ count: { between: [5, 5] } })).toEqual(['full']);
		expect(matched({ count: { between: [6, 49] } })).toEqual([]);
	});

	it('composes multiple operators in one object as AND (Orama throws here)', () => {
		expect(matched({ count: { gt: 1, lt: 9 } })).toEqual(['full']);
		expect(matched({ count: { gt: 1, lt: 4 } })).toEqual([]);
	});
});

describe('array fields (uniform semantics — deliberate Orama deviation)', () => {
	it('reads a bare value and {eq} as "contains"', () => {
		expect(matched({ tags: 'red' })).toEqual(['full']);
		expect(matched({ tags: { eq: 'red' } })).toEqual(['full']);
		expect(matched({ label_ids: { eq: 'z' } })).toEqual(['other']);
	});

	it('reads a bare array and {in} as "contains any"', () => {
		expect(matched({ tags: ['red', 'green'] })).toEqual(['full', 'other']);
		expect(matched({ tags: { in: ['green'] } })).toEqual(['other']);
		expect(matched({ label_ids: { contains_any: ['x', 'z'] } })).toEqual([
			'full',
			'other',
		]);
	});

	it('supports contains_all on string[] as well as enum[]', () => {
		expect(matched({ tags: { contains_all: ['red', 'blue'] } })).toEqual(['full']);
		expect(matched({ tags: { contains_all: ['red', 'green'] } })).toEqual([]);
		expect(matched({ label_ids: { contains_all: ['x', 'y'] } })).toEqual(['full']);
	});

	it('reads not_in as "present and no element in the list"', () => {
		expect(matched({ tags: { not_in: ['red'] } })).toEqual(['other']);
		expect(matched({ tags: { not_in: ['purple'] } })).toEqual(['full', 'other']);
	});

	it('applies ordering operators per element', () => {
		expect(matched({ scores: { gt: 2 } })).toEqual(['full', 'other']);
		expect(matched({ scores: { gt: 5 } })).toEqual(['other']);
		expect(matched({ scores: { between: [2, 3] } })).toEqual(['full']);
	});

	it('matches nothing on an empty array except not_in', () => {
		const doc = { tags: [] as string[] };
		expect(matchesWhere(doc, { tags: 'red' }, SCHEMA)).toBe(false);
		expect(matchesWhere(doc, { tags: { contains_all: ['red'] } }, SCHEMA)).toBe(false);
		expect(matchesWhere(doc, { tags: { not_in: ['red'] } }, SCHEMA)).toBe(true);
	});
});

describe('the null rule', () => {
	it('makes every leaf predicate false on a missing or null field', () => {
		expect(matched({ count: { gt: -1 } })).toEqual(['full', 'other']);
		expect(matched({ active: false })).toEqual(['other']);
		expect(matched({ folder: { not_in: ['nothing'] } })).toEqual(['full', 'other']);
		expect(matchesWhere({ count: null }, { count: { gt: -1 } }, SCHEMA)).toBe(false);
	});

	it('lets missing-field documents pass `not`, which complements over the corpus', () => {
		expect(matched({ not: { folder: { eq: 'inbox' } } })).toEqual(['other', 'empty']);
		expect(matched({ not: { count: { eq: 5 } } })).toEqual(['other', 'empty']);
		expect(matched({ not: { tags: 'red' } })).toEqual(['other', 'empty']);
	});

	it('distinguishes null from absent identically (both fail leaves)', () => {
		expect(matchesWhere({ count: null }, { count: 5 }, SCHEMA)).toBe(false);
		expect(matchesWhere({}, { count: 5 }, SCHEMA)).toBe(false);
	});

	it('matches an empty string and zero, which are present values', () => {
		expect(matchesWhere({ title: '' }, { title: '' }, SCHEMA)).toBe(true);
		expect(matchesWhere({ count: 0 }, { count: 0 }, SCHEMA)).toBe(true);
	});
});

describe('composites', () => {
	it('composes and / or / not', () => {
		expect(matched({ and: [{ folder: 'inbox' }, { count: 5 }] })).toEqual(['full']);
		expect(matched({ or: [{ folder: 'inbox' }, { folder: 'spam' }] })).toEqual([
			'full',
			'other',
		]);
		expect(matched({ and: [{ folder: 'inbox' }, { not: { active: true } }] })).toEqual(
			[],
		);
	});

	it('evaluates `and: []` and `or: []` to the empty set', () => {
		expect(matched({ and: [] })).toEqual([]);
		expect(matched({ or: [] })).toEqual([]);
	});

	it('ANDs sibling composites with field predicates', () => {
		expect(matched({ folder: 'inbox', or: [{ count: 5 }, { count: 50 }] })).toEqual([
			'full',
		]);
	});

	it('matches everything for an empty filter object', () => {
		expect(matched({})).toEqual(['full', 'other', 'empty']);
	});

	it('nests to arbitrary depth', () => {
		expect(
			matched({
				or: [{ and: [{ folder: 'inbox' }, { tags: 'blue' }] }, { and: [{ count: 50 }] }],
			}),
		).toEqual(['full', 'other']);
	});
});

describe('child key paths', () => {
	it('filters on a declared dot path', () => {
		expect(matched({ 'address.city': 'Denver' })).toEqual(['full']);
		expect(matched({ 'address.city': { in: ['Denver', 'Boulder'] } })).toEqual([
			'full',
			'other',
		]);
	});
});

describe('geo operators', () => {
	it('filters geopoint fields by radius and polygon', () => {
		expect(
			matched({ place: { radius: { coordinates: { lat: 0, lon: 0 }, value: 1000 } } }),
		).toEqual(['full']);
		expect(
			matched({
				place: {
					polygon: {
						coordinates: [
							{ lat: -1, lon: -1 },
							{ lat: -1, lon: 1 },
							{ lat: 1, lon: 1 },
							{ lat: 1, lon: -1 },
						],
					},
				},
			}),
		).toEqual(['full']);
	});

	it('fails a missing geopoint in both directions but passes it through `not`', () => {
		const operation = {
			place: { radius: { coordinates: { lat: 0, lon: 0 }, value: 1000, inside: false } },
		};
		expect(matched(operation)).toEqual(['other']);
		expect(matched({ not: operation })).toEqual(['full', 'empty']);
	});
});

describe('error surface (never a silent empty result)', () => {
	function expectBadRequest(where: Record<string, unknown>): void {
		let thrown: unknown;
		try {
			normalizeWhere(where, SCHEMA);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(DelightError);
		expect((thrown as DelightError).status).toBe(400);
	}

	it('rejects unknown fields', () => {
		expectBadRequest({ nope: 'x' });
	});

	it('rejects unknown operators', () => {
		expectBadRequest({ count: { approximately: 5 } });
	});

	it('rejects array-only operators on scalar fields', () => {
		expectBadRequest({ folder: { contains_all: ['a'] } });
		expectBadRequest({ title: { contains_any: ['a'] } });
	});

	it('rejects geo operators off geopoint fields and vice versa', () => {
		expectBadRequest({
			count: { radius: { coordinates: { lat: 0, lon: 0 }, value: 1 } },
		});
		expectBadRequest({ place: { eq: 'x' } });
	});

	it('rejects filters on vector fields', () => {
		expectBadRequest({ embedding: [1, 2, 3] });
	});

	it('rejects malformed operands', () => {
		expectBadRequest({ folder: { in: 'inbox' } });
		expectBadRequest({ count: { between: [1] } });
		expectBadRequest({ count: {} });
		expectBadRequest({ and: { folder: 'inbox' } });
	});
});
