import { DelightError } from '@delightstack/utilities';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SIMILARITY, dotProduct, normalizeVector } from './vector';

describe('normalizeVector', () => {
	it('produces a unit vector', () => {
		const normalized = normalizeVector([3, 4]);
		expect(normalized).toBeInstanceOf(Float32Array);
		expect(normalized[0]).toBeCloseTo(0.6, 6);
		expect(normalized[1]).toBeCloseTo(0.8, 6);
		expect(dotProduct(normalized, normalized)).toBeCloseTo(1, 6);
	});

	it('is scale invariant, so dot product equals cosine', () => {
		const a = normalizeVector([1, 0, 0]);
		const b = normalizeVector([2, 0, 0]);
		expect(dotProduct(a, b)).toBeCloseTo(1, 6);
	});

	it('rejects zero vectors with a 400', () => {
		let thrown: unknown;
		try {
			normalizeVector([0, 0, 0]);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(DelightError);
		expect((thrown as DelightError).status).toBe(400);
	});

	it('rejects empty and non-finite vectors', () => {
		expect(() => normalizeVector([])).toThrow(DelightError);
		expect(() => normalizeVector([1, Number.NaN])).toThrow(DelightError);
		expect(() => normalizeVector([1, Infinity])).toThrow(DelightError);
	});
});

describe('dotProduct', () => {
	it('scores orthogonal vectors at 0 and opposites at -1', () => {
		const x = normalizeVector([1, 0, 0]);
		const y = normalizeVector([0, 1, 0]);
		expect(dotProduct(x, y)).toBe(0);
		expect(dotProduct(x, normalizeVector([-1, 0, 0]))).toBeCloseTo(-1, 6);
	});

	it('reproduces the cosine of a 45° pair', () => {
		const a = normalizeVector([1, 0]);
		const b = normalizeVector([1, 1]);
		expect(dotProduct(a, b)).toBeCloseTo(Math.SQRT1_2, 6);
	});

	it('throws a 400 on a dimension mismatch', () => {
		expect(() => dotProduct(normalizeVector([1, 0]), normalizeVector([1, 0, 0]))).toThrow(
			DelightError,
		);
	});
});

describe('DEFAULT_SIMILARITY', () => {
	it('is Orama’s verified 0.8 floor', () => {
		expect(DEFAULT_SIMILARITY).toBe(0.8);
	});
});
