import { describe, expect, it } from 'vitest';
import { DEFAULT_FUSION_WEIGHTS, fuseScores, maxNormalize } from './fusion';

describe('maxNormalize', () => {
	it('divides by the maximum WITHOUT subtracting the minimum', () => {
		const normalized = maxNormalize(
			new Map([
				['a', 2],
				['b', 1],
			]),
		);
		expect(normalized.get('a')).toBe(1);
		// Min-max normalization would make this 0; max-normalization keeps the
		// information that a weak match is still a match.
		expect(normalized.get('b')).toBe(0.5);
	});

	it('guards the empty set (Orama yields -Infinity/-0 here)', () => {
		expect([...maxNormalize(new Map())]).toEqual([]);
	});

	it('guards an all-zero set (Orama yields NaN here)', () => {
		const normalized = maxNormalize(
			new Map([
				['a', 0],
				['b', 0],
			]),
		);
		expect(normalized.get('a')).toBe(0);
		expect(normalized.get('b')).toBe(0);
	});

	it('leaves a single-member set at 1', () => {
		expect(maxNormalize(new Map([['only', 0.001]])).get('only')).toBe(1);
	});
});

describe('fuseScores', () => {
	it('uses fixed 0.5 / 0.5 weights', () => {
		expect(DEFAULT_FUSION_WEIGHTS).toEqual({ text: 0.5, vector: 0.5 });
	});

	it('reproduces the verified Orama hybrid arithmetic', () => {
		// From the verification report: text {w: 0.5068…, x: 0.2853…, y: 0.2853…},
		// vector {x: 1, y: 0.99388…}.
		const text = new Map([
			['w', 0.5068538677024093],
			['x', 0.2853399551509859],
			['y', 0.2853399551509859],
		]);
		const vector = new Map([
			['x', 1],
			['y', 0.9938837341719244],
		]);
		const fused = fuseScores(text, vector);
		expect(fused.get('x')).toBeCloseTo(0.7814814814814814, 12);
		expect(fused.get('y')).toBeCloseTo(0.7784233485674437, 12);
		expect(fused.get('w')).toBe(0.5);
	});

	it('gives a document present in only one set zero from the other', () => {
		const fused = fuseScores(new Map([['a', 10]]), new Map([['b', 1]]));
		expect(fused.get('a')).toBe(0.5);
		expect(fused.get('b')).toBe(0.5);
	});

	it('returns the union of both id sets', () => {
		const fused = fuseScores(new Map([['a', 1]]), new Map([['b', 1]]));
		expect([...fused.keys()].sort()).toEqual(['a', 'b']);
	});

	it('handles an empty side', () => {
		const fused = fuseScores(new Map([['a', 4]]), new Map());
		expect(fused.get('a')).toBe(0.5);
		expect(fuseScores(new Map(), new Map()).size).toBe(0);
	});

	it('honours custom weights', () => {
		const fused = fuseScores(new Map([['a', 1]]), new Map([['a', 1]]), {
			text: 0.9,
			vector: 0.1,
		});
		expect(fused.get('a')).toBeCloseTo(1, 12);
	});
});
