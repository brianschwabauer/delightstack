/**
 * Query planning shared by every driver: which index tokens one query token
 * matches, and how much each match counts.
 *
 * A query token can match an index token five ways, best first:
 *
 * | Match   | Example (query → index)  | Weight |
 * |---------|--------------------------|--------|
 * | exact   | `contract` → `contract`  | 1      |
 * | variant | `contracts` → `contract` | 0.9    |
 * | prefix  | `contr` → `contract`     | 0.75   |
 * | typo 1  | `contarct` → `contract`  | 0.6    |
 * | typo 2  | `contrcat` → `contract`  | 0.4    |
 *
 * Prefix and typo expansions are capped (the most frequent survive). Without
 * the cap, a one- or two-letter prefix (the first keystrokes of a type-ahead)
 * expanded to every word starting with it and scored every posting of every
 * one of them: 52,908 postings and 42 ms for "sen" over 5,000 notes.
 *
 * Typo tolerance is on by default, scaled by word length the way Algolia and
 * Meilisearch do it: none under 5 characters, 1 edit from 5, 2 from 9.
 * Tokens with a digit never fuzz (a zip code one edit from another is a
 * different place). `tolerance` on the query overrides the default;
 * `exact: true` turns off variants, prefixes and typos alike.
 *
 * Every function here is pure and every output order is total, so all three
 * drivers expand identically (the determinism contract).
 */

import { compareStrings } from './compare.js';
import { type CachedDictionary, expandCachedDictionary } from './dictionary.js';
import { boundedLevenshtein, codePointLength } from './levenshtein.js';
import type { SearchQuery } from './types.js';

/** Weight of an exact match. */
export const EXACT_WEIGHT = 1;
/** Weight of a plural/singular variant of the query token. */
export const VARIANT_WEIGHT = 0.9;
/** Weight of a token the query token is a prefix of. */
export const PREFIX_WEIGHT = 0.75;
/** Weight of a typo match, by edit distance (index 0 unused). */
export const TYPO_WEIGHTS: readonly number[] = [1, 0.6, 0.4];

/** Prefix completions kept for a query token of one or two characters. */
export const MAX_SHORT_PREFIX_EXPANSIONS = 10;
/** Prefix completions kept for a longer query token. */
export const MAX_PREFIX_EXPANSIONS = 50;
/** Typo matches kept per query token. */
export const MAX_TYPO_EXPANSIONS = 20;
/**
 * The most postings a term's prefix completions may add, in one field. A
 * count cap alone is not enough: the 50 most frequent completions of a common
 * prefix are themselves common words (`sen` over 5,000 notes: 52k postings).
 * Completions are taken most frequent first while they fit; the first is
 * always taken, so a prefix with no exact match still finds something.
 */
export const PREFIX_POSTING_BUDGET = 2000;
/** The same budget for a term's typo matches. */
export const TYPO_POSTING_BUDGET = 1000;
/**
 * Above this many distinct tokens in a field, default typo tolerance is off
 * for it (an explicit `tolerance` still applies): a typo scan reads the whole
 * dictionary, which past this size is no longer held in memory.
 */
export const MAX_AUTO_TYPO_DICTIONARY = 200_000;

/** One query token and how it may match. */
export interface QueryTerm {
	/** The query token, as tokenized. */
	token: string;
	/** Whole-token equality only: no variants, prefixes or typos. */
	exact: boolean;
	/** Edits allowed, before the per-field dictionary-size rule. */
	tolerance: number;
	/** Whether `tolerance` came from the query rather than the default. */
	explicit_tolerance: boolean;
	/** Plural/singular forms also matched at {@link VARIANT_WEIGHT}. */
	variants: string[];
}

/** An index token a query token matched, with its weight. */
export interface WeightedToken {
	token: string;
	weight: number;
}

/** The default edits allowed for a query token (see the module docblock). */
export function autoTolerance(token: string): number {
	if (/\p{N}/u.test(token)) return 0;
	const length = codePointLength(token);
	if (length >= 9) return 2;
	if (length >= 5) return 1;
	return 0;
}

/**
 * Light English plural/singular forms of a query token: `contracts` ↔
 * `contract`, `properties` ↔ `property`, `boxes` ↔ `box`. Applied at query
 * time only, so the index carries no stems. Letters-only tokens of at least
 * three characters; ascending, without the token itself.
 */
export function pluralVariants(token: string): string[] {
	if (!/^\p{L}+$/u.test(token) || codePointLength(token) < 3) return [];
	const forms = new Set<string>();
	// One singular form, by the first rule that fits: `properties` → `property`
	// (not also `propertie`), `boxes` → `box` (not also `boxe`).
	if (token.endsWith('ies') && token.length > 4) forms.add(`${token.slice(0, -3)}y`);
	else if (/(?:s|x|z|ch|sh)es$/.test(token)) forms.add(token.slice(0, -2));
	else if (token.endsWith('s') && !/(?:ss|us|is)$/.test(token) && token.length > 3) {
		forms.add(token.slice(0, -1));
	}
	if (!token.endsWith('s')) {
		if (/[^aeiou]y$/.test(token)) forms.add(`${token.slice(0, -1)}ies`);
		else if (/(?:s|x|z|ch|sh)$/.test(token)) forms.add(`${token}es`);
		else forms.add(`${token}s`);
	}
	forms.delete(token);
	return [...forms].sort(compareStrings);
}

/** Plan every distinct query token (ascending, as the drivers accumulate them). */
export function planQueryTerms(
	tokens: readonly string[],
	query: SearchQuery,
): QueryTerm[] {
	const exact = query.exact === true;
	const explicit = typeof query.tolerance === 'number';
	return tokens.map((token) => ({
		token,
		exact,
		tolerance: exact ? 0 : explicit ? (query.tolerance as number) : autoTolerance(token),
		explicit_tolerance: explicit,
		variants: exact ? [] : pluralVariants(token),
	}));
}

/** Edits allowed for a term in a field holding `dictionary_size` distinct tokens. */
export function fieldTolerance(term: QueryTerm, dictionary_size: number): number {
	if (term.exact) return 0;
	if (term.explicit_tolerance) return term.tolerance;
	return dictionary_size <= MAX_AUTO_TYPO_DICTIONARY ? term.tolerance : 0;
}

/**
 * Classify, cap and weight a term's raw candidates.
 *
 * `raw` is every index token the term could match in one field: the
 * dictionary's prefix ∪ typo expansion of the token plus whichever variants
 * exist. Exact and variant matches are always kept. Prefix completions keep
 * the most frequent ({@link MAX_PREFIX_EXPANSIONS}, or
 * {@link MAX_SHORT_PREFIX_EXPANSIONS} for a one- or two-character token),
 * typo matches the closest then most frequent ({@link MAX_TYPO_EXPANSIONS}).
 * Ties break by token, so the selection is total. Returned ascending by
 * token, the accumulation order.
 */
export function selectExpansions(
	term: QueryTerm,
	raw: readonly string[],
	tolerance: number,
	doc_frequency: (token: string) => number,
): WeightedToken[] {
	const kept: WeightedToken[] = [];
	const prefixes: string[] = [];
	const typos: { token: string; distance: number }[] = [];
	const variants = new Set(term.variants);
	for (const token of new Set(raw)) {
		if (token === term.token) {
			kept.push({ token, weight: EXACT_WEIGHT });
		} else if (term.exact) {
			continue;
		} else if (variants.has(token)) {
			kept.push({ token, weight: VARIANT_WEIGHT });
		} else if (token.startsWith(term.token)) {
			prefixes.push(token);
		} else if (tolerance > 0) {
			const { distance, is_bounded } = boundedLevenshtein(term.token, token, tolerance);
			if (is_bounded && distance > 0) typos.push({ token, distance });
		}
	}
	const by_frequency = (a: string, b: string) =>
		doc_frequency(b) - doc_frequency(a) || compareStrings(a, b);
	const prefix_cap =
		codePointLength(term.token) <= 2
			? MAX_SHORT_PREFIX_EXPANSIONS
			: MAX_PREFIX_EXPANSIONS;
	prefixes.sort(by_frequency);
	let prefix_postings = 0;
	for (const token of prefixes.slice(0, prefix_cap)) {
		const df = doc_frequency(token);
		if (prefix_postings > 0 && prefix_postings + df > PREFIX_POSTING_BUDGET) break;
		prefix_postings += df;
		kept.push({ token, weight: PREFIX_WEIGHT });
	}
	typos.sort((a, b) => a.distance - b.distance || by_frequency(a.token, b.token));
	let typo_postings = 0;
	for (const { token, distance } of typos.slice(0, MAX_TYPO_EXPANSIONS)) {
		const df = doc_frequency(token);
		if (typo_postings > 0 && typo_postings + df > TYPO_POSTING_BUDGET) break;
		typo_postings += df;
		kept.push({
			token,
			weight: TYPO_WEIGHTS[distance] ?? TYPO_WEIGHTS[TYPO_WEIGHTS.length - 1],
		});
	}
	return kept.sort((a, b) => compareStrings(a.token, b.token));
}

/** The default ranking weight of a field, from the schema's `.searchable({ weight })`. */
export function fieldBoost(
	field: string,
	query_boost: Record<string, number> | undefined,
	field_options: Readonly<Record<string, { weight?: number }>> | undefined,
): number {
	return query_boost?.[field] ?? field_options?.[field]?.weight ?? 1;
}

/**
 * Expand one term against a field's cached dictionary: the raw prefix ∪
 * typo scan plus the variants, then {@link selectExpansions}.
 */
export function expandTerm(
	dictionary: CachedDictionary,
	term: QueryTerm,
	doc_frequency: (token: string) => number,
): WeightedToken[] {
	const tolerance = fieldTolerance(term, dictionary.tokens.length);
	const raw = expandCachedDictionary(dictionary, term.token, term.exact, tolerance);
	if (!term.exact) {
		for (const variant of term.variants) {
			raw.push(...expandCachedDictionary(dictionary, variant, true, 0));
		}
	}
	return selectExpansions(term, raw, tolerance, doc_frequency);
}
