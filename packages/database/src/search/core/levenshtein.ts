/**
 * Bounded Levenshtein distance for tolerance (fuzzy) matching.
 * See `plans/database/Native Search Engine Plan.md` §4.3 and
 * `plans/database/orama-verification-report.md` §3.
 *
 * Tolerance is a UNION with prefix matching, never a replacement, and fuzzy
 * matches contribute at FULL BM25 weight (verified against Orama 3.1.18 —
 * byte-identical scores for exact and distance-1 matches). `exact: true`
 * suppresses tolerance entirely.
 *
 * Distance is computed over Unicode **code points**, not UTF-16 code units, so
 * a single astral-plane character counts as one edit.
 */

/** The result of a bounded distance computation. */
export interface BoundedDistance {
	/** The edit distance, or `tolerance + 1` when the bound was exceeded. */
	distance: number;
	/** Whether the distance is within the requested tolerance. */
	is_bounded: boolean;
}

/**
 * Levenshtein distance between two strings, abandoned as soon as every cell in
 * the current row exceeds `tolerance`.
 *
 * The length prefilter (`|len(a) − len(b)| > tolerance` ⇒ unbounded) is exact,
 * not a heuristic: each insert/delete changes the length by one.
 */
export function boundedLevenshtein(
	a: string,
	b: string,
	tolerance: number,
): BoundedDistance {
	if (a === b) return { distance: 0, is_bounded: tolerance >= 0 };
	const source = Array.from(a);
	const target = Array.from(b);
	const source_length = source.length;
	const target_length = target.length;
	const over = tolerance + 1;

	if (Math.abs(source_length - target_length) > tolerance) {
		return { distance: over, is_bounded: false };
	}
	if (source_length === 0) {
		return { distance: target_length, is_bounded: target_length <= tolerance };
	}
	if (target_length === 0) {
		return { distance: source_length, is_bounded: source_length <= tolerance };
	}

	let previous_row = Array.from({ length: target_length + 1 }, (_, column) => column);
	let current_row = Array.from({ length: target_length + 1 }, () => 0);

	for (let row = 1; row <= source_length; row++) {
		current_row[0] = row;
		let row_minimum = current_row[0];
		const source_char = source[row - 1];
		for (let column = 1; column <= target_length; column++) {
			const substitution_cost = source_char === target[column - 1] ? 0 : 1;
			const value = Math.min(
				current_row[column - 1] + 1,
				previous_row[column] + 1,
				previous_row[column - 1] + substitution_cost,
			);
			current_row[column] = value;
			if (value < row_minimum) row_minimum = value;
		}
		// Early exit: distances never decrease as rows advance, so once the whole
		// row is over the bound the final cell must be too.
		if (row_minimum > tolerance) return { distance: over, is_bounded: false };
		const swap = previous_row;
		previous_row = current_row;
		current_row = swap;
	}

	const distance = previous_row[target_length];
	return { distance, is_bounded: distance <= tolerance };
}

/** Whether two strings are within `tolerance` edits of each other. */
export function isWithinTolerance(a: string, b: string, tolerance: number): boolean {
	if (tolerance <= 0) return a === b;
	return boundedLevenshtein(a, b, tolerance).is_bounded;
}
