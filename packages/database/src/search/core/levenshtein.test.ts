import { describe, expect, it } from 'vitest';
import { boundedLevenshtein, isWithinTolerance, ToleranceMatcher } from './levenshtein';

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

describe('ToleranceMatcher', () => {
	/**
	 * The matcher is the dictionary-scan form of `isWithinTolerance`, and the
	 * *only* thing that makes it safe is that it answers identically for every
	 * input — a divergence would silently change which index tokens a fuzzy query
	 * expands to, and therefore BM25 scores, membership and counts.
	 *
	 * The alphabet is deliberately nasty: it shares characters (so the signature
	 * prefilter cannot trivially reject), repeats them (so distinct-character
	 * sets differ from the strings), and includes an astral-plane character
	 * (`U+1F600`, two UTF-16 units but one edit) plus a lone combining mark.
	 */
	const ALPHABET = [...'abcz', '\u{1f600}', '́', '9', ''];

	function* words(depth: number, prefix = ''): Generator<string> {
		yield prefix;
		if (depth === 0) return;
		for (const character of ALPHABET) {
			yield* words(depth - 1, prefix + character);
		}
	}

	it('answers identically to isWithinTolerance for every generated pair', () => {
		const vocabulary = [...new Set(words(3))];
		expect(vocabulary.length).toBeGreaterThan(300);
		let checked = 0;
		let agreed_true = 0;
		for (const tolerance of [0, 1, 2, 3]) {
			for (const query of vocabulary) {
				const matcher = new ToleranceMatcher(query, tolerance);
				for (const candidate of vocabulary) {
					const expected = isWithinTolerance(query, candidate, tolerance);
					const actual = matcher.matches(candidate);
					if (actual !== expected) {
						throw new Error(
							`ToleranceMatcher disagreed for ${JSON.stringify(query)} vs ${JSON.stringify(candidate)} at tolerance ${tolerance}: ${actual} !== ${expected}`,
						);
					}
					checked++;
					if (expected) agreed_true++;
				}
			}
		}
		expect(checked).toBeGreaterThan(500_000);
		// A guard against a vacuous pass: the prefilters must not be rejecting
		// everything, or agreement would be meaningless.
		expect(agreed_true).toBeGreaterThan(1000);
	});

	it('reuses its buffers across candidates of growing length', () => {
		const matcher = new ToleranceMatcher('abc', 2);
		for (const length of [1, 4, 16, 64, 300, 8]) {
			const candidate = 'x'.repeat(length);
			expect(matcher.matches(candidate)).toBe(isWithinTolerance('abc', candidate, 2));
		}
	});
});
