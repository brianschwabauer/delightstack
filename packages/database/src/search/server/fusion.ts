/**
 * Hybrid text+vector score fusion — pure, but **server-only** (fusion needs
 * both score sets in one place, and vectors are server-only).
 * See `plans/database/Native Search Engine Plan.md` §4.9 and
 * `plans/database/orama-verification-report.md` §12.
 *
 * **Max-normalization, not min-max.** Orama's `minMaxScoreNormalization` is a
 * misnomer: it divides by the maximum with no minimum subtraction, and the plan
 * text promising min-max was wrong about it. Max-normalization is also the
 * better rule — min-max maps the worst candidate of each set to exactly 0,
 * which is unstable for one- or two-member sets and throws away the information
 * that a weak-but-nonzero match is still a match.
 *
 * Weights are Orama's fixed 0.5/0.5 (`getQueryWeights()` is a stub returning
 * them, and `hybridWeights` was never reachable through this package's API), so
 * they are not configurable in v1. Two deliberate additions over Orama: the
 * empty/zero-maximum guards (Orama produces `-0`/`NaN` there) and a
 * primary-key-ascending tie-break, applied by the caller.
 */

import { compareStrings } from '../core/compare';

/** Relative contribution of each score set to the fused score. */
export interface FusionWeights {
	text: number;
	vector: number;
}

/** Orama's fixed weights. */
export const DEFAULT_FUSION_WEIGHTS: FusionWeights = { text: 0.5, vector: 0.5 };

/**
 * Divide every score by the set's maximum.
 *
 * Returns all-zero scores when the set is empty or its maximum is not positive
 * — guards Orama lacks.
 */
export function maxNormalize(scores: ReadonlyMap<string, number>): Map<string, number> {
	const normalized = new Map<string, number>();
	let maximum = 0;
	for (const score of scores.values()) {
		if (score > maximum) maximum = score;
	}
	for (const [id, score] of scores) {
		normalized.set(id, maximum > 0 ? score / maximum : 0);
	}
	return normalized;
}

/**
 * Fuse text and vector score sets into `0.5 * text + 0.5 * vector` over
 * max-normalized inputs.
 *
 * A document present in only one set contributes 0 from the other. The result
 * is unordered — the caller sorts by fused score descending, then primary key
 * ascending.
 */
export function fuseScores(
	text_scores: ReadonlyMap<string, number>,
	vector_scores: ReadonlyMap<string, number>,
	weights: FusionWeights = DEFAULT_FUSION_WEIGHTS,
): Map<string, number> {
	const text = maxNormalize(text_scores);
	const vector = maxNormalize(vector_scores);
	const fused = new Map<string, number>();
	// Sorted ids keep the accumulation order identical on every driver.
	const ids = [...new Set([...text.keys(), ...vector.keys()])].sort(compareStrings);
	for (const id of ids) {
		fused.set(
			id,
			(text.get(id) ?? 0) * weights.text + (vector.get(id) ?? 0) * weights.vector,
		);
	}
	return fused;
}
