import { DelightError } from '@delightstack/utilities';
import { describe, expect, it } from 'vitest';
import { computeFacets, DEFAULT_STRING_FACET_LIMIT } from './facets';
import type { WhereSchema } from './where';

const SCHEMA: WhereSchema = {
	folder: 'enum',
	tags: 'string[]',
	count: 'number',
	active: 'boolean',
	place: 'geopoint',
	'address.city': 'string',
};

const DOCS = [
	{
		folder: 'inbox',
		tags: ['red', 'blue'],
		count: 1,
		active: true,
		address: { city: 'Denver' },
	},
	{
		folder: 'inbox',
		tags: ['red'],
		count: 12,
		active: false,
		address: { city: 'Denver' },
	},
	{
		folder: 'spam',
		tags: ['green'],
		count: 40,
		active: true,
		address: { city: 'Boulder' },
	},
	{ folder: 'archive', count: 99, active: true },
];

describe('string facets', () => {
	it('counts values, ordered count descending then value ascending', () => {
		const facets = computeFacets(DOCS, { folder: {} }, SCHEMA);
		expect(facets?.folder.count).toBe(3);
		expect(Object.entries(facets?.folder.values ?? {})).toEqual([
			['inbox', 2],
			['archive', 1],
			['spam', 1],
		]);
	});

	it('counts each element of an array field', () => {
		const facets = computeFacets(DOCS, { tags: {} }, SCHEMA);
		expect(facets?.tags.values).toEqual({ red: 2, blue: 1, green: 1 });
	});

	it('ignores documents missing the field', () => {
		const facets = computeFacets(DOCS, { 'address.city': {} }, SCHEMA);
		expect(facets?.['address.city']).toEqual({
			count: 2,
			values: { Denver: 2, Boulder: 1 },
		});
	});

	it('flips the count ordering with sort: asc, keeping the value tie-break', () => {
		const facets = computeFacets(DOCS, { folder: { sort: 'asc' } }, SCHEMA);
		expect(Object.entries(facets?.folder.values ?? {})).toEqual([
			['archive', 1],
			['spam', 1],
			['inbox', 2],
		]);
	});

	it('applies limit and offset while reporting the full distinct count', () => {
		const facets = computeFacets(DOCS, { folder: { limit: 1 } }, SCHEMA);
		expect(facets?.folder).toEqual({ count: 3, values: { inbox: 2 } });
		const offset = computeFacets(DOCS, { folder: { limit: 1, offset: 1 } }, SCHEMA);
		expect(offset?.folder).toEqual({ count: 3, values: { archive: 1 } });
	});

	it('defaults the limit to 10 values', () => {
		const many = Array.from({ length: 20 }, (_, index) => ({ folder: `f${index}` }));
		const facets = computeFacets(many, { folder: {} }, SCHEMA);
		expect(Object.keys(facets?.folder.values ?? {})).toHaveLength(
			DEFAULT_STRING_FACET_LIMIT,
		);
		expect(facets?.folder.count).toBe(20);
	});

	it('breaks count ties by code-point value order, including astral characters', () => {
		const docs = [{ folder: '\u{1F600}' }, { folder: '�' }, { folder: 'a' }];
		const facets = computeFacets(docs, { folder: {} }, SCHEMA);
		expect(Object.keys(facets?.folder.values ?? {})).toEqual(['a', '�', '\u{1F600}']);
	});
});

describe('number facets', () => {
	it('counts configured ranges, inclusive on both ends', () => {
		const facets = computeFacets(
			DOCS,
			{
				count: {
					ranges: [
						{ from: 0, to: 10 },
						{ from: 10, to: 50 },
						{ from: 100, to: 200 },
					],
				},
			},
			SCHEMA,
		);
		expect(facets?.count).toEqual({
			count: 3,
			values: { '0-10': 1, '10-50': 2, '100-200': 0 },
		});
	});

	it('throws a 400 without ranges', () => {
		expect(() => computeFacets(DOCS, { count: {} }, SCHEMA)).toThrow(DelightError);
	});
});

describe('boolean facets', () => {
	it('always reports both buckets', () => {
		const facets = computeFacets(DOCS, { active: {} }, SCHEMA);
		expect(facets?.active).toEqual({ count: 2, values: { true: 3, false: 1 } });
	});
});

describe('facet errors and edges', () => {
	it('returns undefined when no facets are requested', () => {
		expect(computeFacets(DOCS, undefined, SCHEMA)).toBeUndefined();
	});

	it('throws a 400 on unknown and unfacetable fields', () => {
		expect(() => computeFacets(DOCS, { nope: {} }, SCHEMA)).toThrow(DelightError);
		expect(() => computeFacets(DOCS, { place: {} }, SCHEMA)).toThrow(DelightError);
	});

	it('counts over an empty matched set without failing', () => {
		expect(computeFacets([], { folder: {} }, SCHEMA)).toEqual({
			folder: { count: 0, values: {} },
		});
	});

	it('computes requested facet fields in ascending field order', () => {
		const facets = computeFacets(DOCS, { tags: {}, folder: {} }, SCHEMA);
		expect(Object.keys(facets ?? {})).toEqual(['folder', 'tags']);
	});
});
