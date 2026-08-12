import { describe, expect, it } from 'vitest';
import { TokenHits } from './token_hits';

/**
 * The reference shape this replaces — a `Set` of token indices per document.
 * Every assertion below is really "the bitmask agrees with this".
 */
function reference(pairs: readonly [string, number][]): Map<string, Set<number>> {
	const map = new Map<string, Set<number>>();
	for (const [doc_id, token_index] of pairs) {
		let indices = map.get(doc_id);
		if (!indices) {
			indices = new Set();
			map.set(doc_id, indices);
		}
		indices.add(token_index);
	}
	return map;
}

describe('TokenHits', () => {
	it('counts DISTINCT token indices, not additions', () => {
		const hits = new TokenHits(4);
		hits.add('a', 0);
		hits.add('a', 0);
		hits.add('a', 0);
		hits.add('a', 2);
		expect(hits.size('a')).toBe(2);
	});

	it('reports zero for a document that never matched', () => {
		expect(new TokenHits(3).size('missing')).toBe(0);
	});

	it('lists every document that matched at least one token', () => {
		const hits = new TokenHits(2);
		hits.add('b', 1);
		hits.add('a', 0);
		hits.add('b', 0);
		expect([...hits.ids()].sort()).toEqual(['a', 'b']);
	});

	// 32 is the bitmask's capacity and 33 is the first size that spills to the
	// `Set` representation, so both are exercised at their boundary.
	for (const token_count of [1, 31, 32, 33, 70]) {
		it(`agrees with a Set-per-document reference at ${token_count} tokens`, () => {
			const pairs: [string, number][] = [];
			for (let doc = 0; doc < 40; doc++) {
				for (let token = 0; token < token_count; token++) {
					// A deterministic, uneven sprinkle, with deliberate repeats.
					if ((doc * 7 + token * 3) % 5 === 0) pairs.push([`doc${doc}`, token]);
					if ((doc + token) % 11 === 0) pairs.push([`doc${doc}`, token]);
				}
			}
			const hits = new TokenHits(token_count);
			for (const [doc_id, token_index] of pairs) hits.add(doc_id, token_index);
			const expected = reference(pairs);
			expect([...hits.ids()].sort()).toEqual([...expected.keys()].sort());
			for (const [doc_id, indices] of expected) {
				expect(hits.size(doc_id), doc_id).toBe(indices.size);
			}
			// And the "matched every token" test `threshold` actually asks.
			const all = [...expected.keys()].filter(
				(id) => (expected.get(id) as Set<number>).size >= token_count,
			);
			expect(
				hits
					.ids()
					.filter((id) => hits.size(id) >= token_count)
					.sort(),
			).toEqual(all.sort());
		});
	}
});
