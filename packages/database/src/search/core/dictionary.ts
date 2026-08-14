/**
 * The cached term dictionary shared by all three drivers (§7.3).
 *
 * A dictionary is three parallel arrays: the tokens themselves ascending by
 * **code point** (`core/compare`, never SQL or IDB order), plus each token's
 * code-point length and 32-bit character signature so a tolerance scan can
 * reject a candidate without touching a single character.
 *
 * Both prefilters are exact, not heuristics:
 * - an insert or delete moves the length by exactly one, so
 *   `|len(a) - len(b)| > tolerance` cannot be within tolerance;
 * - one edit adds at most one distinct character and removes at most one, so
 *   `k` edits bound both signature set-differences by `k` (see
 *   {@link ToleranceMatcher}).
 *
 * {@link expandCachedDictionary} is the one expansion scan every driver runs —
 * its output *and output order* are part of the determinism contract, because
 * BM25 accumulation order follows it.
 */

import { compareStrings } from './compare';
import { characterSignature, codePointLength, ToleranceMatcher } from './levenshtein';

/** One field's cached term dictionary. */
export interface CachedDictionary {
	/** Tokens, ascending by code point. */
	tokens: string[];
	/** Code-point length of the token at the same index. */
	lengths: number[];
	/** Character signature of the token at the same index. */
	signatures: number[];
}

/** Build a dictionary from tokens already sorted ascending by code point. */
export function buildCachedDictionary(tokens: string[]): CachedDictionary {
	return {
		tokens,
		lengths: tokens.map(codePointLength),
		signatures: tokens.map(characterSignature),
	};
}

/** Binary search for the first index whose token is `>= target`. */
export function lowerBound(tokens: readonly string[], target: string): number {
	let low = 0;
	let high = tokens.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (compareStrings(tokens[middle], target) < 0) low = middle + 1;
		else high = middle;
	}
	return low;
}

/** Insert into a cached dictionary, keeping it sorted. No-op when present. */
export function sortedInsert(dictionary: CachedDictionary, token: string): void {
	const index = lowerBound(dictionary.tokens, token);
	if (index < dictionary.tokens.length && dictionary.tokens[index] === token) return;
	dictionary.tokens.splice(index, 0, token);
	dictionary.lengths.splice(index, 0, codePointLength(token));
	dictionary.signatures.splice(index, 0, characterSignature(token));
}

/** Remove from a cached dictionary. No-op when absent. */
export function sortedRemove(dictionary: CachedDictionary, token: string): void {
	const index = lowerBound(dictionary.tokens, token);
	if (index < dictionary.tokens.length && dictionary.tokens[index] === token) {
		dictionary.tokens.splice(index, 1);
		dictionary.lengths.splice(index, 1);
		dictionary.signatures.splice(index, 1);
	}
}

/** Whether two per-field length maps agree exactly. */
export function sameLengths(a: Map<string, number>, b: Map<string, number>): boolean {
	if (a.size !== b.size) return false;
	for (const [field, length] of a) if (b.get(field) !== length) return false;
	return true;
}

/**
 * Expand one query token against a field's cached dictionary.
 *
 * Default: prefix matches. With `tolerance: N`: prefix matches ∪ tokens within
 * bounded Levenshtein distance N, de-duplicated, all at full weight. `exact`
 * is whole-token equality and suppresses tolerance entirely.
 *
 * A tolerance scan has to see the whole dictionary anyway, so the prefix range
 * is not worth computing separately. One matcher for the whole scan, and the
 * precomputed lengths/signatures in front of it: the Levenshtein DP — and even
 * reading a candidate's characters — is reached only by the handful of tokens
 * that could actually be within tolerance. The inline first-unit check keeps
 * `startsWith` — an uninlineable call — off the overwhelming majority of the
 * scan.
 */
export function expandCachedDictionary(
	dictionary: CachedDictionary,
	token: string,
	exact: boolean,
	tolerance: number,
): string[] {
	const tokens = dictionary.tokens;
	if (exact) {
		const index = lowerBound(tokens, token);
		return index < tokens.length && tokens[index] === token ? [token] : [];
	}
	if (tolerance <= 0) {
		const matches: string[] = [];
		for (let index = lowerBound(tokens, token); index < tokens.length; index++) {
			if (!tokens[index].startsWith(token)) break;
			matches.push(tokens[index]);
		}
		return matches;
	}
	const matcher = new ToleranceMatcher(token, tolerance);
	const query_length = matcher.query_length;
	const matches: string[] = [];
	const first_unit = token.length > 0 ? token.charCodeAt(0) : -1;
	for (let index = 0; index < tokens.length; index++) {
		const candidate = tokens[index];
		if (
			(first_unit < 0 || candidate.charCodeAt(0) === first_unit) &&
			candidate.startsWith(token)
		) {
			matches.push(candidate);
			continue;
		}
		const delta = dictionary.lengths[index] - query_length;
		if (delta > tolerance || -delta > tolerance) continue;
		if (!matcher.signatureAccepts(dictionary.signatures[index])) continue;
		if (matcher.matches(candidate)) matches.push(candidate);
	}
	return matches;
}
