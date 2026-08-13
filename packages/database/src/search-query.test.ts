import { describe, it, expect } from 'vitest';
import { decodeSearchQuery, encodeSearchQuery, normalizeWhere } from './search-query';

const SCHEMA = {
	id: 'string',
	folder: 'enum',
	label_ids: 'enum[]',
	unread_count: 'number',
	is_read: 'boolean',
	subject: 'string',
} as Record<string, unknown>;

describe('normalizeWhere', () => {
	it('wraps a plain string on an enum property as {eq}', () => {
		expect(normalizeWhere({ folder: 'inbox' }, SCHEMA)).toEqual({
			folder: { eq: 'inbox' },
		});
	});

	it('wraps an array on an enum property as {in}', () => {
		expect(normalizeWhere({ folder: ['inbox', 'archive'] }, SCHEMA)).toEqual({
			folder: { in: ['inbox', 'archive'] },
		});
	});

	it('wraps a plain number on a number property as {eq}', () => {
		expect(normalizeWhere({ unread_count: 0 }, SCHEMA)).toEqual({
			unread_count: { eq: 0 },
		});
	});

	it('leaves string, boolean, and explicit-operator filters untouched', () => {
		expect(
			normalizeWhere(
				{
					id: 'abc',
					subject: ['a', 'b'],
					is_read: false,
					folder: { eq: 'inbox' },
					unread_count: { gt: 0 },
				},
				SCHEMA,
			),
		).toEqual({
			id: 'abc',
			subject: ['a', 'b'],
			is_read: false,
			folder: { eq: 'inbox' },
			unread_count: { gt: 0 },
		});
	});

	it('normalizes recursively through and/or/not composites', () => {
		expect(
			normalizeWhere(
				{
					and: [{ folder: 'inbox' }, { or: [{ unread_count: 1 }] }],
					not: { folder: 'spam' },
				},
				SCHEMA,
			),
		).toEqual({
			and: [{ folder: { eq: 'inbox' } }, { or: [{ unread_count: { eq: 1 } }] }],
			not: { folder: { eq: 'spam' } },
		});
	});

	it('passes through when where or schema is missing', () => {
		expect(normalizeWhere(undefined, SCHEMA)).toBeUndefined();
		expect(normalizeWhere({ folder: 'inbox' }, undefined)).toEqual({ folder: 'inbox' });
	});
});

describe('normalizeWhere without legacy aliases', () => {
	it('leaves the pre-rename operator spellings untouched (no read aliases)', () => {
		expect(normalizeWhere({ label_ids: { containsAll: ['a', 'b'] } }, SCHEMA)).toEqual({
			label_ids: { containsAll: ['a', 'b'] },
		});
		expect(normalizeWhere({ folder: { nin: ['spam'] } }, SCHEMA)).toEqual({
			folder: { nin: ['spam'] },
		});
	});

	it('leaves the current operator spellings untouched', () => {
		expect(
			normalizeWhere(
				{ label_ids: { contains_all: ['a'], contains_any: ['b'] } },
				SCHEMA,
			),
		).toEqual({ label_ids: { contains_all: ['a'], contains_any: ['b'] } });
	});
});

describe('encodeSearchQuery', () => {
	it('emits only the current key spellings', () => {
		const params = encodeSearchQuery({
			term: 'hello',
			distinct_on: 'folder',
			fields: ['subject', 'body'],
			order: [{ field: 'updated_at', direction: 'DESC' }],
			vector: { value: [0.1, 0.2], field: 'embedding' },
		});
		expect(params.get('term')).toBe('hello');
		expect(params.get('distinct_on')).toBe('folder');
		expect(params.get('fields')).toBe('subject,body');
		expect(params.get('order')).toBe('updated_at:DESC');
		expect(JSON.parse(params.get('vector')!)).toEqual({
			value: [0.1, 0.2],
			field: 'embedding',
		});
		expect(params.get('properties')).toBeNull();
		expect(params.get('q')).toBeNull();
	});
});

describe('decodeSearchQuery', () => {
	it('reads the current key spellings', () => {
		const query = decodeSearchQuery(
			new URLSearchParams(
				'term=hi&distinct_on=folder&fields=subject&order=updated_at:DESC&vector=' +
					encodeURIComponent(JSON.stringify({ value: [1], field: 'embedding' })),
			),
		);
		expect(query).toEqual({
			term: 'hi',
			distinct_on: 'folder',
			fields: ['subject'],
			order: [{ field: 'updated_at', direction: 'DESC' }],
			vector: { value: [1], field: 'embedding' },
		});
	});

	it('ignores the pre-rename key spellings entirely (no legacy aliases)', () => {
		const query = decodeSearchQuery(
			new URLSearchParams('q=hi&distinctOn=folder&properties=subject'),
		);
		expect(query).toEqual({});
	});

	it('carries the vector similarity floor through the vector param', () => {
		const query = decodeSearchQuery(
			new URLSearchParams(
				'vector=' +
					encodeURIComponent(
						JSON.stringify({ value: [1], field: 'embedding', similarity: 0.9 }),
					),
			),
		);
		expect(query.vector).toEqual({ value: [1], field: 'embedding', similarity: 0.9 });
	});

	it('round-trips through encode → decode', () => {
		const original = {
			term: 'hello',
			limit: 10,
			distinct_on: 'folder',
			fields: '*' as const,
			threshold: 0,
			order: [{ field: 'created_at', direction: 'ASC' as const }],
			where: { folder: { eq: 'inbox' } },
		};
		expect(decodeSearchQuery(encodeSearchQuery(original))).toEqual(original);
	});
});

describe('normalizeWhere depth cap (review fix 4)', () => {
	const schema = { folder: 'enum' };

	it('accepts 10 levels of composite nesting', () => {
		let where: Record<string, unknown> = { folder: 'inbox' };
		for (let i = 0; i < 10; i++) where = { not: where };
		expect(() => normalizeWhere(where, schema)).not.toThrow();
	});

	it('rejects nesting deeper than 10 levels', () => {
		let where: Record<string, unknown> = { folder: 'inbox' };
		for (let i = 0; i < 11; i++) where = { or: [where] };
		expect(() => normalizeWhere(where, schema)).toThrow();
	});
});
