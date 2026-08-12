import { describe, expect, it } from 'vitest';
import { boundedLevenshtein, isWithinTolerance } from './levenshtein';

/** Unbounded reference implementation, used to cross-check the bounded one. */
function referenceDistance(a: string, b: string): number {
	const source = Array.from(a);
	const target = Array.from(b);
	let previous = target.map((_, index) => index + 1);
	previous.unshift(0);
	for (let row = 1; row <= source.length; row++) {
		const current = [row];
		for (let column = 1; column <= target.length; column++) {
			current[column] = Math.min(
				current[column - 1] + 1,
				previous[column] + 1,
				previous[column - 1] + (source[row - 1] === target[column - 1] ? 0 : 1),
			);
		}
		previous = current;
	}
	return previous[target.length];
}

describe('boundedLevenshtein', () => {
	it('reports distance 0 for identical strings', () => {
		expect(boundedLevenshtein('hello', 'hello', 0)).toEqual({
			distance: 0,
			is_bounded: true,
		});
	});

	it('reports substitutions, insertions and deletions', () => {
		expect(boundedLevenshtein('hello', 'hallo', 1).distance).toBe(1);
		expect(boundedLevenshtein('hello', 'hell', 1).distance).toBe(1);
		expect(boundedLevenshtein('hell', 'hello', 1).distance).toBe(1);
		expect(boundedLevenshtein('kitten', 'sitting', 3).distance).toBe(3);
	});

	it('abandons early once the bound is exceeded', () => {
		const result = boundedLevenshtein('kitten', 'sitting', 1);
		expect(result.is_bounded).toBe(false);
		expect(result.distance).toBe(2); // tolerance + 1, not the true distance
	});

	it('uses the length difference as an exact prefilter', () => {
		expect(boundedLevenshtein('a', 'abcd', 2).is_bounded).toBe(false);
		expect(boundedLevenshtein('a', 'abc', 2).is_bounded).toBe(true);
	});

	it('handles empty strings', () => {
		expect(boundedLevenshtein('', '', 0).distance).toBe(0);
		expect(boundedLevenshtein('', 'ab', 2)).toEqual({ distance: 2, is_bounded: true });
		expect(boundedLevenshtein('ab', '', 1).is_bounded).toBe(false);
	});

	it('counts an astral-plane character as one edit', () => {
		expect(boundedLevenshtein('a\u{1F600}', 'a\u{1F601}', 1)).toEqual({
			distance: 1,
			is_bounded: true,
		});
	});

	it('is symmetric', () => {
		expect(boundedLevenshtein('database', 'databse', 2).distance).toBe(
			boundedLevenshtein('databse', 'database', 2).distance,
		);
	});

	it('matches an unbounded reference implementation within the bound', () => {
		const words = ['cat', 'cart', 'card', 'dog', 'database', 'databse', 'data', '', 'a'];
		for (const a of words) {
			for (const b of words) {
				const expected = referenceDistance(a, b);
				const result = boundedLevenshtein(a, b, 4);
				if (expected <= 4) {
					expect(result).toEqual({ distance: expected, is_bounded: true });
				} else {
					expect(result.is_bounded).toBe(false);
				}
			}
		}
	});
});

describe('isWithinTolerance', () => {
	it('degenerates to equality at tolerance 0', () => {
		expect(isWithinTolerance('hello', 'hello', 0)).toBe(true);
		expect(isWithinTolerance('hello', 'hallo', 0)).toBe(false);
	});

	it('admits distance-1 tokens at tolerance 1 but not distance-2', () => {
		expect(isWithinTolerance('hello', 'hallo', 1)).toBe(true);
		expect(isWithinTolerance('hello', 'hallu', 1)).toBe(false);
		expect(isWithinTolerance('hello', 'hallu', 2)).toBe(true);
	});
});
