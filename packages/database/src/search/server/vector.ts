/**
 * Vector math — pure, but **server-only**: vectors never reach the client
 * (`plans/database/Native Search Engine Plan.md` §4.9, §7.0). The memory
 * reference engine imports it so golden vectors can cover vector/hybrid mode.
 *
 * Vectors are L2-normalized once at write time and once at query time, so the
 * score is a plain dot product — identical ranking to cosine at roughly half
 * the per-document cost and with no divide in the hot loop. Orama instead
 * stored magnitudes and divided at query time; the ranking is the same, and the
 * `similarity` threshold transfers unchanged because a unit-vector dot product
 * *is* cosine similarity.
 *
 * Zero vectors are rejected at write: cosine is undefined for them.
 */

import { DelightError } from '@delightstack/utilities';

/** Orama's `DEFAULT_SIMILARITY`, verified against 3.1.18. */
export const DEFAULT_SIMILARITY = 0.8;

/**
 * L2-normalize a vector into a `Float32Array`.
 *
 * @throws DelightError 400 when the vector is empty, contains a non-finite
 *   value, or has zero magnitude.
 */
export function normalizeVector(values: readonly number[] | Float32Array): Float32Array {
	const length = values.length;
	if (length === 0) {
		throw DelightError.badRequest('A vector value cannot be empty.', {
			code: 'invalid_vector',
		});
	}
	let sum_of_squares = 0;
	for (let index = 0; index < length; index++) {
		const component = values[index];
		if (typeof component !== 'number' || !Number.isFinite(component)) {
			throw DelightError.badRequest('A vector must contain only finite numbers.', {
				code: 'invalid_vector',
			});
		}
		sum_of_squares += component * component;
	}
	if (sum_of_squares === 0) {
		throw DelightError.badRequest(
			'A zero vector cannot be indexed — cosine similarity is undefined for it.',
			{ code: 'invalid_vector' },
		);
	}
	const magnitude = Math.sqrt(sum_of_squares);
	const normalized = new Float32Array(length);
	for (let index = 0; index < length; index++)
		normalized[index] = values[index] / magnitude;
	return normalized;
}

/**
 * Dot product of two equal-length unit vectors, accumulated in float64.
 *
 * @throws DelightError 400 on a dimension mismatch.
 */
export function dotProduct(a: Float32Array, b: Float32Array): number {
	if (a.length !== b.length) {
		throw DelightError.badRequest(
			`Vector dimension mismatch: query has ${a.length}, index has ${b.length}.`,
			{ code: 'invalid_vector' },
		);
	}
	let total = 0;
	for (let index = 0; index < a.length; index++) total += a[index] * b[index];
	return total;
}
