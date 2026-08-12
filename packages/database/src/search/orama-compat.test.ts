import { describe, expect, it } from 'vitest';
import { create, insertMultiple, search } from '@orama/orama';
import type { AnyOrama } from '@orama/orama';
import { normalizeWhere } from '../search-query';
import { Database } from '../schema/schema';
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

describe('schema-builder `enum[]` on the orama path', () => {
	/** A default-engine (orama) table declaring an enum[] field. */
	const labelledTable = Database.table('labelled', (s) => ({
		id: s.primaryKey(),
		title: s.string().searchable(),
		label_ids: s
			.array(s.enum(['l_red', 'l_green', 'l_blue']))
			.searchable()
			.optional(),
	}));

	const DOCS = [
		{ id: '1', title: 'first', label_ids: ['l_red', 'l_green'] },
		{ id: '2', title: 'second', label_ids: ['l_red'] },
		{ id: '3', title: 'third', label_ids: ['l_blue'] },
	];

	function loadIndex(): AnyOrama {
		const db = create({
			schema: labelledTable.config.orama.schema as never,
		}) as AnyOrama;
		insertMultiple(
			db,
			DOCS.map(
				(doc) =>
					labelledTable.toSparse({
						...doc,
						created_at: 1,
						updated_at: 1,
					} as never) as never,
			),
		);
		return db;
	}

	it('produces a schema orama accepts, with the field typed `enum[]`', () => {
		expect(labelledTable.config.orama.schema).toHaveProperty('label_ids', 'enum[]');
		expect(() => loadIndex()).not.toThrow();
	});

	it('filters with the translated containsAll / containsAny operators', () => {
		const db = loadIndex();
		const run = (where: Record<string, unknown>) =>
			(
				search(
					db,
					toOramaSearchParams({ term: '', where, limit: 100 }) as never,
				) as unknown as {
					hits: { document: { id: string } }[];
				}
			).hits
				.map((hit) => hit.document.id)
				.sort();
		expect(run({ label_ids: { contains_all: ['l_red', 'l_green'] } })).toEqual(['1']);
		expect(run({ label_ids: { contains_any: ['l_red', 'l_blue'] } })).toEqual([
			'1',
			'2',
			'3',
		]);
	});
});
