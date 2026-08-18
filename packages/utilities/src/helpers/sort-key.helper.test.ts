import { describe, expect, it } from 'vitest';
import { DelightError } from './error.helper';
import { randomNumberGenerator } from './random.helper';
import { generateSortKey } from './sort-key.helper';

/** Asserts that every key is strictly greater than the one before it */
function expectStrictlyOrdered(keys: string[]): void {
	for (let i = 1; i < keys.length; i++) {
		if (!(keys[i - 1]! < keys[i]!)) {
			throw new Error(
				`Keys out of order at index ${i}: '${keys[i - 1]}' >= '${keys[i]}'`,
			);
		}
	}
}

describe('generateSortKey', () => {
	it('should generate a first key with no neighbors', () => {
		expect(generateSortKey()).toBe('a0');
		expect(generateSortKey(null, null)).toBe('a0');
		expect(generateSortKey(undefined, undefined)).toBe('a0');
	});

	it('should generate a key after the given one', () => {
		expect(generateSortKey('a0')).toBe('a1');
		expect(generateSortKey('a1', null)).toBe('a2');
		expect(generateSortKey('az')).toBe('b00');
	});

	it('should generate a key before the given one', () => {
		expect(generateSortKey(null, 'a0')).toBe('Zz');
		expect(generateSortKey(null, 'a1')).toBe('a0');
		expect(generateSortKey(null, 'Zz')).toBe('Zy');
	});

	it('should generate a key strictly between two keys', () => {
		expect(generateSortKey('a0', 'a1')).toBe('a0V');
		const between = generateSortKey('a0', 'a1');
		expect('a0' < between).toBe(true);
		expect(between < 'a1').toBe(true);
	});

	it('should never produce a key with a trailing zero digit in the fraction', () => {
		let low = 'a0';
		const high = 'a1';
		for (let i = 0; i < 200; i++) {
			low = generateSortKey(low, high);
			expect(low.length > 2 && low.endsWith('0')).toBe(false);
		}
	});

	it('should round-trip its own output as valid input', () => {
		const first = generateSortKey();
		const second = generateSortKey(first);
		const middle = generateSortKey(first, second);
		expect(() => generateSortKey(middle, second)).not.toThrow();
		expect(() => generateSortKey(first, middle)).not.toThrow();
	});

	it('should reject an out-of-order range', () => {
		expect(() => generateSortKey('a1', 'a0')).toThrow(DelightError);
		expect(() => generateSortKey('a1', 'a1')).toThrow(DelightError);
	});

	it('should reject malformed keys', () => {
		for (const key of ['', '!', 'a', 'a0!', '0', 'zz', 'a0V0']) {
			expect(() => generateSortKey(key)).toThrow(DelightError);
		}
	});

	it('should throw a 400 DelightError with a code', () => {
		try {
			generateSortKey('a1', 'a0');
			expect.unreachable();
		} catch (error) {
			expect(DelightError.is(error)).toBe(true);
			expect((error as DelightError).status).toBe(400);
			expect((error as DelightError).code).toBe('INVALID_SORT_KEY_RANGE');
		}
	});

	it('should stay ordered over 10,000 sequential appends', () => {
		const keys: string[] = [];
		let last: string | null = null;
		for (let i = 0; i < 10_000; i++) {
			last = generateSortKey(last, null);
			keys.push(last);
		}
		expectStrictlyOrdered(keys);
		expect(new Set(keys).size).toBe(10_000);
		const max = Math.max(...keys.map((key) => key.length));
		expect(max).toBeLessThanOrEqual(8);
		console.log(`10,000 sequential appends → max key length ${max}`);
	});

	it('should stay ordered over 10,000 sequential prepends', () => {
		const keys: string[] = [];
		let first: string | null = null;
		for (let i = 0; i < 10_000; i++) {
			first = generateSortKey(null, first);
			keys.unshift(first);
		}
		expectStrictlyOrdered(keys);
		expect(new Set(keys).size).toBe(10_000);
		const max = Math.max(...keys.map((key) => key.length));
		expect(max).toBeLessThanOrEqual(8);
		console.log(`10,000 sequential prepends → max key length ${max}`);
	});

	it('should stay ordered over 10,000 random insertions', () => {
		let random = randomNumberGenerator();
		const nextRandom = () => {
			random = random.next();
			return random.value;
		};
		const keys: string[] = [generateSortKey()];
		for (let i = 0; i < 10_000; i++) {
			const index = Math.floor(nextRandom() * (keys.length + 1));
			const before = index === 0 ? null : keys[index - 1]!;
			const after = index === keys.length ? null : keys[index]!;
			keys.splice(index, 0, generateSortKey(before, after));
		}
		expect(keys).toHaveLength(10_001);
		expectStrictlyOrdered(keys);
		expect(new Set(keys).size).toBe(10_001);
		expect([...keys].sort()).toEqual(keys);
		const max = Math.max(...keys.map((key) => key.length));
		console.log(`10,000 random insertions → max key length ${max}`);
	});

	it('should stay ordered over 10,000 insertions at the same midpoint', () => {
		// The pathological case for fractional indexing: every insert lands
		// immediately after the same key, so key length grows without bound.
		const first = generateSortKey();
		const last = generateSortKey(first);
		const keys = [first, last];
		let upper = last;
		for (let i = 0; i < 10_000; i++) {
			upper = generateSortKey(first, upper);
			keys.splice(1, 0, upper);
		}
		expect(keys).toHaveLength(10_002);
		expectStrictlyOrdered(keys);
		expect(new Set(keys).size).toBe(10_002);
		const max = Math.max(...keys.map((key) => key.length));
		console.log(`10,000 insertions at the same midpoint → max key length ${max}`);
		// ~1 extra character per log2(62) ≈ 5.95 insertions
		expect(max).toBeLessThan(1800);
	});
});
