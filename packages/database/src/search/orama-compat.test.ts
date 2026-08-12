import { describe, expect, it } from 'vitest';
import { normalizeWhere } from '../search-query';
import { toOramaSearchParams, toOramaWhere } from './orama-compat';

const SCHEMA = {
	folder: 'enum',
	label_ids: 'enum[]',
	subject: 'string',
} as Record<string, unknown>;

describe('toOramaWhere', () => {
	it('translates the renamed array operators back to Orama spellings', () => {
		expect(
			toOramaWhere({ label_ids: { contains_all: ['a'], contains_any: ['b'] } }),
		).toEqual({ label_ids: { containsAll: ['a'], containsAny: ['b'] } });
	});

	it('translates not_in back to nin', () => {
		expect(toOramaWhere({ folder: { not_in: ['spam'] } })).toEqual({
			folder: { nin: ['spam'] },
		});
	});

	it('translates through and/or/not composites', () => {
		expect(
			toOramaWhere({
				and: [{ label_ids: { contains_any: ['a'] } }],
				not: { folder: { not_in: ['spam'] } },
			}),
		).toEqual({
			and: [{ label_ids: { containsAny: ['a'] } }],
			not: { folder: { nin: ['spam'] } },
		});
	});

	it('leaves untouched operators and operand values alone', () => {
		expect(toOramaWhere({ subject: 'hi', folder: { eq: 'inbox' } })).toEqual({
			subject: 'hi',
			folder: { eq: 'inbox' },
		});
	});
});

describe('toOramaSearchParams', () => {
	it('translates the renamed top-level query keys', () => {
		expect(
			toOramaSearchParams({
				term: 'hi',
				fields: ['subject'],
				distinct_on: 'folder',
				vector: { value: [1, 2], field: 'embedding' },
			}),
		).toEqual({
			term: 'hi',
			properties: ['subject'],
			distinctOn: 'folder',
			vector: { value: [1, 2], property: 'embedding' },
		});
	});

	it('round-trips a where clause: normalize then shim back to Orama', () => {
		const normalized = normalizeWhere({ folder: 'inbox' }, SCHEMA);
		expect(normalized).toEqual({ folder: { eq: 'inbox' } });
		expect(toOramaSearchParams({ where: normalized }).where).toEqual({
			folder: { eq: 'inbox' },
		});
	});

	it('keeps the vector similarity floor out of Orama params', () => {
		const translated = toOramaSearchParams({
			vector: { value: [1, 2], field: 'embedding', similarity: 0.9 },
		});
		expect(translated.vector).toEqual({ value: [1, 2], property: 'embedding' });
	});
});
