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

/* -------------------------------------------------------------------------- */
/* Dictionary scanning                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Bit index for a code point in a {@link ToleranceMatcher} character signature.
 *
 * Any surjection onto 32 bits is sound — collisions merge two characters into
 * one bit, which can only make the prefilter *more* permissive, never less.
 * The `^ >>> 5` fold spreads ASCII letters, digits and punctuation across the
 * word instead of piling them onto `cp & 31`.
 */
function signatureBit(code_point: number): number {
	return (code_point ^ (code_point >>> 5)) & 31;
}

/**
 * Number of Unicode code points in a string.
 *
 * `String.length` counts UTF-16 code units, which over-counts every
 * astral-plane character; edit distance is defined over code points, so this is
 * the length a tolerance prefilter has to compare.
 */
export function codePointLength(value: string): number {
	const units = value.length;
	let count = 0;
	for (let index = 0; index < units; index++) {
		if ((value.charCodeAt(index) & 0xfc00) === 0xd800 && index + 1 < units) {
			if ((value.charCodeAt(index + 1) & 0xfc00) === 0xdc00) index++;
		}
		count++;
	}
	return count;
}

/**
 * The 32-bit character-set signature of a string — one bit per distinct
 * character, hashed onto 32 buckets.
 *
 * Precompute it for a dictionary and {@link ToleranceMatcher.signatureAccepts}
 * rejects most candidates with two `AND`s and two population counts, never
 * touching the string. See the {@link ToleranceMatcher} docblock for why the
 * test is a necessary condition and therefore safe.
 */
export function characterSignature(value: string): number {
	const units = value.length;
	let signature = 0;
	for (let index = 0; index < units; index++) {
		let code = value.charCodeAt(index);
		if ((code & 0xfc00) === 0xd800 && index + 1 < units) {
			const low = value.charCodeAt(index + 1);
			if ((low & 0xfc00) === 0xdc00) {
				code = (code - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
				index++;
			}
		}
		signature |= 1 << signatureBit(code);
	}
	return signature;
}

/** Population count of a 32-bit word. */
function popcount(word: number): number {
	let value = word - ((word >>> 1) & 0x55555555);
	value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
	value = (value + (value >>> 4)) & 0x0f0f0f0f;
	return (value * 0x01010101) >>> 24;
}

/** Growable scratch buffer, reused across candidates. */
function grow(buffer: Int32Array<ArrayBuffer>, needed: number): Int32Array<ArrayBuffer> {
	if (buffer.length >= needed) return buffer;
	let size = buffer.length;
	while (size < needed) size *= 2;
	return new Int32Array(size);
}

/**
 * A reusable bounded-distance matcher for **one** query token, for scanning a
 * whole term dictionary.
 *
 * `boundedLevenshtein` is the specification and stays exactly as it is; this is
 * the same computation with the per-call garbage removed. Expanding one fuzzy
 * token over a 4k-token dictionary calls it 4k times, and the naive shape
 * allocates four arrays per call (`Array.from(a)`, `Array.from(b)` and two DP
 * rows) — which measured as ~54% of a two-token tolerance-1 search.
 *
 * Three changes, none of which can alter an answer:
 * - the query's code points, its length and its DP rows are computed once and
 *   reused, and candidates are decoded into a scratch `Int32Array`;
 * - a code-point-count *floor* prefilter runs before any decoding, and the exact
 *   length prefilter runs before the DP;
 * - a 32-bit character-set signature prefilter runs before the DP. It is a
 *   **necessary** condition, not a heuristic: one edit adds at most one distinct
 *   character to a string and removes at most one, so `k` edits give
 *   `|set(a) \ set(b)| <= k` and `|set(b) \ set(a)| <= k`. Hashing characters
 *   onto 32 bits only merges distinct characters, which shrinks both
 *   differences, so no true match is ever rejected.
 *
 * {@link matches} is therefore equal to `isWithinTolerance(query, candidate,
 * tolerance)` for every input — asserted directly in `levenshtein.test.ts`.
 */
export class ToleranceMatcher {
	readonly query: string;
	readonly tolerance: number;
	/** Code-point length of the query token, for callers that prefilter. */
	readonly query_length: number;
	/** Character signature of the query token, for callers that prefilter. */
	readonly query_signature: number;
	/** The query's code points. */
	readonly #query_points: Int32Array<ArrayBuffer>;
	/** Decoded candidate code points. */
	#candidate_points: Int32Array<ArrayBuffer> = new Int32Array(64);
	#previous_row: Int32Array<ArrayBuffer>;
	#current_row: Int32Array<ArrayBuffer>;

	constructor(query: string, tolerance: number) {
		this.query = query;
		this.tolerance = tolerance;
		const points = Array.from(query, (character) => character.codePointAt(0) as number);
		this.#query_points = Int32Array.from(points);
		this.query_length = points.length;
		let signature = 0;
		for (const point of points) signature |= 1 << signatureBit(point);
		this.query_signature = signature;
		this.#previous_row = new Int32Array(64);
		this.#current_row = new Int32Array(64);
	}

	/**
	 * Whether a candidate with this {@link characterSignature} could possibly be
	 * within tolerance — the signature prefilter, exposed so a caller holding a
	 * precomputed dictionary can apply it without touching the string.
	 */
	signatureAccepts(signature: number): boolean {
		const tolerance = this.tolerance;
		return (
			popcount(this.query_signature & ~signature) <= tolerance &&
			popcount(signature & ~this.query_signature) <= tolerance
		);
	}

	/** Whether `candidate` is within `tolerance` edits of the query token. */
	matches(candidate: string): boolean {
		const tolerance = this.tolerance;
		if (candidate === this.query) return tolerance >= 0;
		if (tolerance < 0) return false;

		// Cheap pre-decode length floor: a UTF-16 string of `units` units holds at
		// least `ceil(units / 2)` code points (every surrogate pair is two units).
		// Comparing against `units` itself would be WRONG — an astral character is
		// two units but one edit.
		const units = candidate.length;
		const query_length = this.query_length;
		if (((units + 1) >> 1) - query_length > tolerance) return false;
		if (query_length - units > tolerance) return false;

		// Count code points before decoding anything, abandoning as soon as the
		// candidate is provably too long. On a dictionary of primary keys against
		// a short query token that rejects almost everything after a handful of
		// units, and never touches the scratch buffer or the signature.
		const ceiling = query_length + tolerance;
		let target_length = 0;
		for (let index = 0; index < units; index++) {
			const unit = candidate.charCodeAt(index);
			if ((unit & 0xfc00) === 0xd800 && index + 1 < units) {
				if ((candidate.charCodeAt(index + 1) & 0xfc00) === 0xdc00) index++;
			}
			if (++target_length > ceiling) return false;
		}
		if (query_length - target_length > tolerance) return false;

		this.#candidate_points = grow(this.#candidate_points, target_length);
		const target = this.#candidate_points;
		let signature = 0;
		let position = 0;
		for (let index = 0; index < units; index++) {
			let code = candidate.charCodeAt(index);
			if ((code & 0xfc00) === 0xd800 && index + 1 < units) {
				const low = candidate.charCodeAt(index + 1);
				if ((low & 0xfc00) === 0xdc00) {
					code = (code - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
					index++;
				}
			}
			target[position++] = code;
			signature |= 1 << signatureBit(code);
		}

		if (
			popcount(this.query_signature & ~signature) > tolerance ||
			popcount(signature & ~this.query_signature) > tolerance
		) {
			return false;
		}
		if (query_length === 0) return target_length <= tolerance;
		if (target_length === 0) return query_length <= tolerance;

		let previous_row = grow(this.#previous_row, target_length + 1);
		let current_row = grow(this.#current_row, target_length + 1);
		this.#previous_row = previous_row;
		this.#current_row = current_row;
		const source = this.#query_points;
		for (let column = 0; column <= target_length; column++) previous_row[column] = column;

		for (let row = 1; row <= query_length; row++) {
			current_row[0] = row;
			let row_minimum = row;
			const source_point = source[row - 1];
			for (let column = 1; column <= target_length; column++) {
				const substitution =
					previous_row[column - 1] + (source_point === target[column - 1] ? 0 : 1);
				const insertion = current_row[column - 1] + 1;
				const deletion = previous_row[column] + 1;
				let value = substitution;
				if (insertion < value) value = insertion;
				if (deletion < value) value = deletion;
				current_row[column] = value;
				if (value < row_minimum) row_minimum = value;
			}
			if (row_minimum > tolerance) return false;
			const swap = previous_row;
			previous_row = current_row;
			current_row = swap;
		}
		return previous_row[target_length] <= tolerance;
	}
}
