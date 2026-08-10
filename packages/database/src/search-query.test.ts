import { describe, it, expect } from 'vitest';
import { normalizeWhere } from './search-query';

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
