/**
 * Second-phase ranking and highlighting, from the documents themselves.
 *
 * The index stores no word positions (they would roughly triple its size), so
 * phrase and proximity signals come from re-reading the few documents that
 * matter: the top {@link RERANK_WINDOW} by BM25 are re-tokenized, and a
 * document where the query's words appear next to each other, in order,
 * moves up. The same pass finds what to highlight.
 *
 * Pure and deterministic like the rest of `core`: every driver reranks the
 * same window the same way.
 */

import { comparePrimaryKeys, type PrimaryKeyType } from './compare.js';
import { tokenize, tokenizeField } from './tokenizer.js';
import { getFieldValue } from './where.js';

/** How many of the best-scoring documents the proximity pass re-reads. */
export const RERANK_WINDOW = 100;

/**
 * The most a document's score grows when every consecutive pair of query
 * words appears side by side, in order, in one field (`1 +` this).
 */
export const PROXIMITY_BONUS = 0.5;

/** Default length, in characters, of a highlight snippet. */
export const DEFAULT_HIGHLIGHT_LENGTH = 160;

/**
 * Which index tokens each query word matched, per field: `field → (query
 * word → tokens)`. The drivers collect it while scoring.
 */
export type MatchedTokens = Map<string, Map<string, Set<string>>>;

/** Record that `query_token` matched `index_token` in `field`. */
export function noteMatch(
	matched: MatchedTokens,
	field: string,
	query_token: string,
	index_token: string,
): void {
	let by_query = matched.get(field);
	if (!by_query) {
		by_query = new Map();
		matched.set(field, by_query);
	}
	let tokens = by_query.get(query_token);
	if (!tokens) {
		tokens = new Set();
		by_query.set(query_token, tokens);
	}
	tokens.add(index_token);
}

/**
 * The score multiplier for one document: `1 + PROXIMITY_BONUS × f`, where
 * `f` is the best field's share of consecutive query-word pairs found side
 * by side and in order. `ordered_tokens` is the query's distinct tokens in
 * the order typed. A one-word query never changes.
 */
export function proximityMultiplier(
	document: Record<string, unknown>,
	fields: readonly string[],
	ordered_tokens: readonly string[],
	matched: MatchedTokens,
	token_limit: (field: string) => number,
): number {
	const pairs = ordered_tokens.length - 1;
	if (pairs < 1) return 1;
	let best = 0;
	for (const field of fields) {
		const by_query = matched.get(field);
		if (!by_query) continue;
		const sets = ordered_tokens.map((token) => by_query.get(token));
		const value = getFieldValue(document, field);
		if (value === null || value === undefined) continue;
		const tokens = tokenizeField(value, token_limit(field));
		let adjacent = 0;
		for (let pair = 0; pair < pairs; pair++) {
			const left = sets[pair];
			const right = sets[pair + 1];
			if (!left || !right) continue;
			for (let position = 0; position + 1 < tokens.length; position++) {
				if (left.has(tokens[position]) && right.has(tokens[position + 1])) {
					adjacent++;
					break;
				}
			}
		}
		best = Math.max(best, adjacent / pairs);
		if (best === 1) break;
	}
	return 1 + PROXIMITY_BONUS * best;
}

/** A scored entry the rerank can reorder. */
export interface RerankEntry {
	doc_id: string;
	score: number;
}

/**
 * Apply {@link proximityMultiplier} to the first {@link RERANK_WINDOW}
 * entries (already sorted by score descending, then primary key) and
 * re-sort that window. Scores only grow, so the window stays ahead of the
 * rest. `documentOf` returns the hydrated document, or undefined to leave
 * the entry as is.
 */
export function rerankByProximity<Entry extends RerankEntry>(
	entries: Entry[],
	documentOf: (entry: Entry) => Record<string, unknown> | undefined,
	fields: readonly string[],
	ordered_tokens: readonly string[],
	matched: MatchedTokens,
	token_limit: (field: string) => number,
	primary_key_type: PrimaryKeyType,
	multi_match: ReadonlySet<string>,
): void {
	if (ordered_tokens.length < 2) return;
	const window = Math.min(RERANK_WINDOW, entries.length);
	for (let index = 0; index < window; index++) {
		// Only a document that matched two or more of the query's words can
		// have two of them side by side; re-reading the rest is wasted work
		// (tokenizing a hundred bodies costs ~10 ms).
		if (!multi_match.has(entries[index].doc_id)) continue;
		const document = documentOf(entries[index]);
		if (!document) continue;
		entries[index].score *= proximityMultiplier(
			document,
			fields,
			ordered_tokens,
			matched,
			token_limit,
		);
	}
	const head = entries.slice(0, window).sort((a, b) => {
		if (a.score !== b.score) return a.score > b.score ? -1 : 1;
		return comparePrimaryKeys(a.doc_id, b.doc_id, primary_key_type);
	});
	for (let index = 0; index < window; index++) entries[index] = head[index];
}

/** A snippet of one field with the matched words marked. */
export interface Highlight {
	/** The snippet: the field's text around the first match (`…` where cut). */
	text: string;
	/** `[start, end)` character offsets of each matched word in `text`. */
	ranges: [number, number][];
}

/** How a query asks for highlights. */
export type HighlightOption = boolean | { fields?: string[]; length?: number };

/** Every word run of a value, with its offsets. */
const WORD = /[\p{L}\p{N}](?:[\p{L}\p{N}'’ʼ.@-]*[\p{L}\p{N}])?/gu;

/**
 * Highlight one field value: the words whose tokens the query matched, in a
 * window of about `length` characters around the first of them. String
 * arrays are joined with `, `. Undefined when nothing in the value matched.
 */
export function highlightValue(
	value: unknown,
	matched: ReadonlySet<string>,
	length: number = DEFAULT_HIGHLIGHT_LENGTH,
): Highlight | undefined {
	const text = Array.isArray(value)
		? value.filter((item) => typeof item === 'string').join(', ')
		: typeof value === 'string'
			? value
			: undefined;
	if (!text || matched.size === 0) return undefined;
	const ranges: [number, number][] = [];
	for (const match of text.matchAll(WORD)) {
		const start = match.index ?? 0;
		if (tokenize(match[0]).some((token) => matched.has(token))) {
			ranges.push([start, start + match[0].length]);
		}
	}
	if (ranges.length === 0) return undefined;
	const limit = Math.max(20, Math.trunc(length));
	if (text.length <= limit) return { text, ranges };
	// Start a little before the first match, at a word boundary.
	let start = Math.max(0, ranges[0][0] - Math.floor(limit / 4));
	if (start > 0) {
		const space = text.lastIndexOf(' ', start);
		start = space >= 0 && ranges[0][0] - space < limit / 2 ? space + 1 : start;
	}
	let end = Math.min(text.length, start + limit);
	if (end < text.length) {
		const space = text.lastIndexOf(' ', end);
		if (space > start + limit / 2) end = space;
	}
	const prefix = start > 0 ? '…' : '';
	const suffix = end < text.length ? '…' : '';
	const shift = prefix.length - start;
	return {
		text: `${prefix}${text.slice(start, end)}${suffix}`,
		ranges: ranges
			.filter(([from, to]) => from >= start && to <= end)
			.map(([from, to]) => [from + shift, to + shift] as [number, number]),
	};
}

/**
 * Highlights for one hit: each requested (or searched) field whose value
 * matched, keyed by field.
 */
export function highlightDocument(
	document: Record<string, unknown>,
	fields: readonly string[],
	matched: MatchedTokens,
	option: HighlightOption,
): Record<string, Highlight> | undefined {
	const wanted =
		typeof option === 'object' && option.fields?.length
			? fields.filter((field) => option.fields!.includes(field))
			: fields;
	const length = typeof option === 'object' ? option.length : undefined;
	const result: Record<string, Highlight> = {};
	for (const field of wanted) {
		const by_query = matched.get(field);
		if (!by_query) continue;
		const tokens = new Set<string>();
		for (const set of by_query.values()) for (const token of set) tokens.add(token);
		const highlight = highlightValue(getFieldValue(document, field), tokens, length);
		if (highlight) result[field] = highlight;
	}
	return Object.keys(result).length ? result : undefined;
}

/** The query's distinct tokens in the order typed. */
export function orderedDistinct(tokens: readonly string[]): string[] {
	return [...new Set(tokens)];
}
