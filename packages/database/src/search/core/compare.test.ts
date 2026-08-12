import { describe, expect, it } from 'vitest';
import {
	compareForOrder,
	comparePrimaryKeys,
	compareStrings,
	compareValues,
	isNullish,
} from './compare';

/** The astral-plane pair the plan calls out: JS `<` and code-point order disagree. */
const EMOJI = '\u{1F600}';
const REPLACEMENT = '�';

describe('compareStrings', () => {
	it('orders ASCII by code point', () => {
		expect(compareStrings('a', 'b')).toBe(-1);
		expect(compareStrings('b', 'a')).toBe(1);
		expect(compareStrings('a', 'a')).toBe(0);
	});

	it('orders a prefix before its extension', () => {
		expect(compareStrings('data', 'database')).toBe(-1);
		expect(compareStrings('', 'a')).toBe(-1);
	});

	it('orders astral-plane characters AFTER the BMP, unlike naive JS comparison', () => {
		// Naive UTF-16 code-unit order gets this backwards.
		expect(EMOJI < REPLACEMENT).toBe(true);
		expect(compareStrings(EMOJI, REPLACEMENT)).toBe(1);
		expect(compareStrings(REPLACEMENT, EMOJI)).toBe(-1);
	});

	it('matches SQLite BINARY (code-point) order when sorting a mixed list', () => {
		const sorted = ['z', EMOJI, REPLACEMENT, 'a'].sort(compareStrings);
		expect(sorted).toEqual(['a', 'z', REPLACEMENT, EMOJI]);
	});

	it('handles equal astral prefixes followed by differing characters', () => {
		expect(compareStrings(`${EMOJI}a`, `${EMOJI}b`)).toBe(-1);
		expect(compareStrings(`${EMOJI}a`, EMOJI)).toBe(1);
	});

	it('is antisymmetric and transitive over a sample', () => {
		const values = ['', 'a', 'ab', 'b', 'Z', REPLACEMENT, EMOJI, '0', '9'];
		for (const a of values) {
			for (const b of values) {
				expect(compareStrings(a, b)).toBe(0 - compareStrings(b, a) || 0);
			}
		}
	});
});

describe('compareValues', () => {
	it('compares numbers numerically', () => {
		expect(compareValues(2, 10)).toBe(-1);
		expect(compareValues(10, 2)).toBe(1);
		expect(compareValues(-1, 0)).toBe(-1);
		expect(compareValues(1, 1)).toBe(0);
	});

	it('orders false before true', () => {
		expect(compareValues(false, true)).toBe(-1);
		expect(compareValues(true, false)).toBe(1);
		expect(compareValues(true, true)).toBe(0);
	});

	it('compares strings by code point', () => {
		expect(compareValues('2', '10')).toBe(1);
		expect(compareValues(EMOJI, REPLACEMENT)).toBe(1);
	});

	it('is total across mixed types (boolean < number < string)', () => {
		expect(compareValues(true, 1)).toBe(-1);
		expect(compareValues(1, '1')).toBe(-1);
		expect(compareValues('1', false)).toBe(1);
	});
});

describe('isNullish', () => {
	it('treats null, undefined and NaN as absent', () => {
		expect(isNullish(null)).toBe(true);
		expect(isNullish(undefined)).toBe(true);
		expect(isNullish(Number.NaN)).toBe(true);
		expect(isNullish(0)).toBe(false);
		expect(isNullish('')).toBe(false);
		expect(isNullish(false)).toBe(false);
	});
});

describe('compareForOrder', () => {
	it('flips present values with direction', () => {
		expect(compareForOrder(1, 2, 'ASC')).toBe(-1);
		expect(compareForOrder(1, 2, 'DESC')).toBe(1);
	});

	it('sorts null/missing LAST regardless of direction', () => {
		expect(compareForOrder(null, 1, 'ASC')).toBe(1);
		expect(compareForOrder(null, 1, 'DESC')).toBe(1);
		expect(compareForOrder(1, undefined, 'ASC')).toBe(-1);
		expect(compareForOrder(1, undefined, 'DESC')).toBe(-1);
		expect(compareForOrder(null, undefined, 'DESC')).toBe(0);
	});

	it('puts every nullish value at the end of a sorted list, both directions', () => {
		const values = [3, null, 1, undefined, 2];
		expect([...values].sort((a, b) => compareForOrder(a, b, 'ASC'))).toEqual([
			1,
			2,
			3,
			null,
			undefined,
		]);
		expect([...values].sort((a, b) => compareForOrder(a, b, 'DESC'))).toEqual([
			3,
			2,
			1,
			null,
			undefined,
		]);
	});
});

describe('comparePrimaryKeys', () => {
	it('compares numeric primary keys numerically even when stringified', () => {
		expect(comparePrimaryKeys('2', '10', 'number')).toBe(-1);
		expect(comparePrimaryKeys(2, 10, 'number')).toBe(-1);
	});

	it('compares string primary keys by code point', () => {
		expect(comparePrimaryKeys('10', '2', 'string')).toBe(-1);
		expect(comparePrimaryKeys('2', '10', 'string')).toBe(1);
	});

	it('defaults to string comparison', () => {
		expect(comparePrimaryKeys('10', '2')).toBe(-1);
	});

	it('sorts an integer-PK list in numeric order', () => {
		const ids = ['10', '2', '1', '20'];
		expect([...ids].sort((a, b) => comparePrimaryKeys(a, b, 'number'))).toEqual([
			'1',
			'2',
			'10',
			'20',
		]);
		expect([...ids].sort((a, b) => comparePrimaryKeys(a, b, 'string'))).toEqual([
			'1',
			'10',
			'2',
			'20',
		]);
	});
});
