/**
 * The memory-backed REFERENCE implementation of the full search pipeline.
 *
 * This is the specification made executable: the server (sync, DO SQLite) and
 * client (async, IndexedDB) drivers orchestrate storage differently but must
 * produce byte-identical membership, order and counts, enforced by golden
 * vectors generated from here. Every semantic decision lives in `core/*`; this
 * module only sequences them, in the order of
 * `plans/database/Native Search Engine Plan.md` §7.5.
 *
 * Frozen behaviors worth calling out (all deliberate deviations from Orama
 * 3.1.18, per `plans/database/orama-verification-report.md`):
 * - `threshold`'s "all tokens" is per DOCUMENT, not per field, and counts
 *   distinct query tokens (Orama lets one token's prefix expansion count
 *   several times); the fractional blend is always applied.
 * - `exact` is whole-token, case-INSENSITIVE equality and works on array fields
 *   (Orama regex-matched the original string value, case-sensitively, and
 *   silently never matched arrays).
 * - `count` is reported AFTER `distinct_on` (Orama reported the pre-distinct
 *   count, which makes pagination arithmetic wrong).
 * - Vector mode scores dot products over write-time unit-normalized vectors and
 *   hybrid fusion is max-normalized 0.5/0.5. `vector.similarity` (default
 *   `0.8`, inclusive) is the admission floor for both modes — it is part of the
 *   public typed API (decided 2026-08-12) where Orama's was unreachable.
 *
 * Determinism: no `Date.now()`, no randomness, and no reliance on Map/object
 * iteration order — `elapsed` is therefore always zero here.
 */

import { DelightError } from '@delightstack/utilities';
import { bm25Score } from '../core/bm25';
import { compareForOrder, comparePrimaryKeys, compareStrings } from '../core/compare';
import { computeFacets } from '../core/facets';
import { TokenHits } from '../core/token_hits';
import { ToleranceMatcher } from '../core/levenshtein';
import { tokenize } from '../core/tokenizer';
import type { FacetDefinition, SearchQuery, SearchQueryResults } from '../core/types';
import { evaluateWhere, getFieldValue, normalizeWhere } from '../core/where';
import { fuseScores } from '../server/fusion';
import { DEFAULT_SIMILARITY, dotProduct, normalizeVector } from '../server/vector';
import {
	isTextFieldType,
	isVectorFieldType,
	MemorySearchStore,
	type MemoryIndexConfig,
	type StoredDocument,
} from './store';

/** An indexed document as returned in hits. */
export type MemoryDocument = Record<string, unknown>;

/** A document plus the score it earned. */
interface ScoredDocument {
	stored: StoredDocument;
	score: number;
}

/** The memory reference engine. */
export class MemorySearchEngine {
	readonly store: MemorySearchStore;

	constructor(config: MemoryIndexConfig | MemorySearchStore) {
		this.store =
			config instanceof MemorySearchStore ? config : new MemorySearchStore(config);
	}

	/** Index (or re-index) one document. */
	insert(document: MemoryDocument): void {
		this.store.insert(document);
	}

	/** Index many documents. */
	insertMany(documents: readonly MemoryDocument[]): void {
		this.store.insertMany(documents);
	}

	/** Remove a document by primary key. */
	remove(id: string | number): boolean {
		return this.store.remove(id);
	}

	/** Run the full pipeline: filter → match → score → order → distinct → facet → page. */
	search(query: SearchQuery = {}): SearchQueryResults<MemoryDocument> {
		const store = this.store;
		const search_fields = this.#resolveSearchFields(query);
		this.#validateOrder(query);
		this.#validateDistinctOn(query);

		// 1. where
		const where_node = normalizeWhere(
			query.where as Record<string, unknown> | undefined,
			store.schema,
		);
		const matched = store
			.documents()
			.filter((stored) => evaluateWhere(stored.document, where_node));
		const matched_ids = new Set(matched.map((stored) => stored.doc_id));

		// 2. term matching + BM25
		const term_tokens = typeof query.term === 'string' ? tokenize(query.term) : [];
		const distinct_tokens = [...new Set(term_tokens)].sort(compareStrings);
		const has_term = distinct_tokens.length > 0;
		const text_scores = new Map<string, number>();
		const token_hits = new TokenHits(distinct_tokens.length);
		if (has_term) {
			this.#accumulateText(
				query,
				search_fields,
				distinct_tokens,
				matched_ids,
				text_scores,
				token_hits,
			);
		}
		const text_ids = has_term
			? applyThreshold(
					text_scores,
					token_hits,
					distinct_tokens.length,
					query.threshold,
					store,
				)
			: undefined;

		// 3. vector
		const vector_scores = query.vector
			? this.#scoreVectors(query, matched_ids)
			: undefined;

		// 4. combine into the result membership + scores
		const results = this.#combine(matched, text_scores, text_ids, vector_scores);

		// 5. order
		this.#applyOrder(results, query, has_term || vector_scores !== undefined);

		// 6. distinct_on (count is post-distinct — see the module docblock)
		const distinct = applyDistinct(results, query.distinct_on);

		// 7. facets over the full result set, before paging
		const facets = computeFacets(
			distinct.map((entry) => entry.stored.document),
			query.facets as Record<string, FacetDefinition> | undefined,
			store.schema,
		);

		// 8. offset/limit
		const offset = query.offset ?? 0;
		const limit = query.limit ?? distinct.length;
		const page = distinct.slice(offset, offset + Math.max(0, limit));

		return {
			count: distinct.length,
			hits: page.map((entry) => ({
				id: entry.stored.doc_id,
				score: entry.score,
				document: entry.stored.document,
			})),
			// No `Date.now()` anywhere in the engine (§3 determinism rules).
			elapsed: { raw: 0, formatted: '0ms' },
			...(facets ? { facets } : {}),
		};
	}

	/** Resolve and validate `fields` into the searched text fields, ascending. */
	#resolveSearchFields(query: SearchQuery): string[] {
		const fields = query.fields;
		if (!fields || fields === '*') return this.store.text_fields;
		if (!Array.isArray(fields)) {
			throw DelightError.badRequest(
				'`fields` must be `"*"` or an array of field names.',
				{
					code: 'invalid_search_field',
				},
			);
		}
		const resolved: string[] = [];
		for (const field of fields) {
			const type = this.store.schema[field];
			if (type === undefined) {
				throw DelightError.badRequest(`Unknown search field "${field}".`, {
					code: 'unknown_search_field',
				});
			}
			if (!isTextFieldType(type)) {
				throw DelightError.badRequest(
					`Field "${field}" is a ${type} — only string fields can be searched.`,
					{ code: 'invalid_search_field' },
				);
			}
			resolved.push(field);
		}
		return [...new Set(resolved)].sort(compareStrings);
	}

	/** Every `order[].field` must be a declared field or the primary key. */
	#validateOrder(query: SearchQuery): void {
		for (const instruction of query.order ?? []) {
			const field = instruction.field;
			if (field !== this.store.primary_key && this.store.schema[field] === undefined) {
				throw DelightError.badRequest(`Unknown order field "${field}".`, {
					code: 'unknown_order_field',
				});
			}
		}
	}

	/** `distinct_on` must name a declared field or the primary key. */
	#validateDistinctOn(query: SearchQuery): void {
		const field = query.distinct_on;
		if (field === undefined) return;
		if (field !== this.store.primary_key && this.store.schema[field] === undefined) {
			throw DelightError.badRequest(`Unknown distinct_on field "${field}".`, {
				code: 'unknown_distinct_field',
			});
		}
	}

	/**
	 * Accumulate BM25 in the deterministic order: fields ascending, then query
	 * tokens ascending, then matched index tokens ascending, then doc ids
	 * ascending — so float summation is identical on every driver.
	 */
	#accumulateText(
		query: SearchQuery,
		search_fields: readonly string[],
		distinct_tokens: readonly string[],
		matched_ids: ReadonlySet<string>,
		text_scores: Map<string, number>,
		token_hits: TokenHits,
	): void {
		const store = this.store;
		const boosts = query.boost as Record<string, number> | undefined;
		const exact = query.exact === true;
		const tolerance = exact ? 0 : (query.tolerance ?? 0);
		for (const field of search_fields) {
			const stats = store.getFieldStats(field);
			if (stats.doc_count === 0) continue;
			const average_field_length = stats.total_len / stats.doc_count;
			const boost = boosts?.[field] ?? 1;
			const dictionary = store.getDictionary(field);
			for (let token_index = 0; token_index < distinct_tokens.length; token_index++) {
				const token = distinct_tokens[token_index];
				for (const candidate of expandToken(dictionary, token, exact, tolerance)) {
					const doc_frequency = store.getDocFrequency(field, candidate);
					for (const [doc_id, tf] of store.getPostings(field, candidate)) {
						if (!matched_ids.has(doc_id)) continue;
						const stored = store.getDocument(doc_id);
						if (!stored) continue;
						const score = bm25Score({
							tf,
							field_length: stored.lengths.get(field) ?? 0,
							average_field_length,
							field_doc_count: stats.doc_count,
							doc_frequency,
						});
						text_scores.set(doc_id, (text_scores.get(doc_id) ?? 0) + boost * score);
						token_hits.add(doc_id, token_index);
					}
				}
			}
		}
	}

	/** Dot-product scoring over unit vectors, filtered by the similarity floor. */
	#scoreVectors(
		query: SearchQuery,
		matched_ids: ReadonlySet<string>,
	): Map<string, number> {
		const vector_query = query.vector;
		if (!vector_query) return new Map();
		const field = vector_query.field;
		const type = this.store.schema[field];
		if (type === undefined) {
			throw DelightError.badRequest(`Unknown vector field "${field}".`, {
				code: 'unknown_vector_field',
			});
		}
		if (!isVectorFieldType(type)) {
			throw DelightError.badRequest(`Field "${field}" is not a vector field.`, {
				code: 'invalid_vector_field',
			});
		}
		const query_vector = normalizeVector(vector_query.value);
		const minimum = vector_query.similarity ?? DEFAULT_SIMILARITY;
		const scores = new Map<string, number>();
		for (const stored of this.store.documents()) {
			if (!matched_ids.has(stored.doc_id)) continue;
			const vector = stored.vectors.get(field);
			if (!vector) continue;
			const similarity = dotProduct(query_vector, vector);
			if (similarity >= minimum) scores.set(stored.doc_id, similarity);
		}
		return scores;
	}

	/** Decide result membership and the score attached to each hit. */
	#combine(
		matched: readonly StoredDocument[],
		text_scores: ReadonlyMap<string, number>,
		text_ids: ReadonlySet<string> | undefined,
		vector_scores: ReadonlyMap<string, number> | undefined,
	): ScoredDocument[] {
		if (text_ids && vector_scores) {
			const text_subset = new Map<string, number>();
			for (const id of text_ids) text_subset.set(id, text_scores.get(id) ?? 0);
			const fused = fuseScores(text_subset, vector_scores);
			return matched
				.filter((stored) => fused.has(stored.doc_id))
				.map((stored) => ({ stored, score: fused.get(stored.doc_id) as number }));
		}
		if (text_ids) {
			return matched
				.filter((stored) => text_ids.has(stored.doc_id))
				.map((stored) => ({ stored, score: text_scores.get(stored.doc_id) ?? 0 }));
		}
		if (vector_scores) {
			return matched
				.filter((stored) => vector_scores.has(stored.doc_id))
				.map((stored) => ({ stored, score: vector_scores.get(stored.doc_id) as number }));
		}
		return matched.map((stored) => ({ stored, score: 0 }));
	}

	/**
	 * Order results: by `order[]` when given, else by score descending when the
	 * query scored anything, else by primary key ascending. Every path ends with
	 * a primary-key ascending tie-break.
	 */
	#applyOrder(results: ScoredDocument[], query: SearchQuery, is_scored: boolean): void {
		const primary_key_type = this.store.primary_key_type;
		const order = query.order ?? [];
		results.sort((a, b) => {
			for (const instruction of order) {
				const comparison = compareForOrder(
					getFieldValue(a.stored.document, instruction.field),
					getFieldValue(b.stored.document, instruction.field),
					instruction.direction ?? 'ASC',
				);
				if (comparison !== 0) return comparison;
			}
			if (order.length === 0 && is_scored && a.score !== b.score) {
				return a.score > b.score ? -1 : 1;
			}
			return comparePrimaryKeys(
				a.stored.primary_key,
				b.stored.primary_key,
				primary_key_type,
			);
		});
	}
}

/**
 * Expand one query token against a field's dictionary.
 *
 * Default: prefix matches. With `tolerance: N`: prefix matches ∪ tokens within
 * bounded Levenshtein distance N, de-duplicated, all at full weight.
 * `exact: true` is whole-token equality and suppresses tolerance entirely.
 */
export function expandToken(
	dictionary: readonly string[],
	token: string,
	exact: boolean,
	tolerance: number,
): string[] {
	if (exact) return dictionary.includes(token) ? [token] : [];
	const matches: string[] = [];
	// One matcher for the whole scan: `ToleranceMatcher` is `isWithinTolerance`
	// with the per-candidate allocations hoisted out (see `core/levenshtein.ts`).
	const matcher = tolerance > 0 ? new ToleranceMatcher(token, tolerance) : undefined;
	// The inline first-unit check keeps `startsWith` — an uninlineable call — off
	// the overwhelming majority of a dictionary scan.
	const first_unit = token.length > 0 ? token.charCodeAt(0) : -1;
	for (const candidate of dictionary) {
		if (
			((first_unit < 0 || candidate.charCodeAt(0) === first_unit) &&
				candidate.startsWith(token)) ||
			matcher?.matches(candidate) === true
		) {
			matches.push(candidate);
		}
	}
	return matches;
}

/**
 * Apply `threshold` (§4.5) with per-DOCUMENT "all tokens" semantics.
 *
 * `U` = documents matching at least one query token; `A ⊆ U` = documents
 * matching every distinct query token anywhere in the searched fields.
 * `0` → `A`; `1` (the default) → `U`; `0 < t < 1` → `A` plus the top
 * `ceil(|U \ A| * t)` of the remainder by score.
 */
function applyThreshold(
	text_scores: ReadonlyMap<string, number>,
	token_hits: TokenHits,
	token_count: number,
	threshold: number | undefined,
	store: MemorySearchStore,
): Set<string> {
	// NOT sorted: every branch below turns `union` into a `Set` or re-sorts it
	// with a *total* comparator (score, then primary key), so the walk order is
	// unobservable — and sorting tens of thousands of matched ids to then throw
	// the order away was pure cost. The caller sorts the ids it keeps.
	const union = token_hits.ids();
	const all_match = new Set(union.filter((id) => token_hits.size(id) >= token_count));
	const value = threshold ?? 1;
	if (value >= 1) return new Set(union);
	if (value <= 0) return all_match;
	const remainder = union.filter((id) => !all_match.has(id));
	remainder.sort((a, b) => {
		const score_a = text_scores.get(a) ?? 0;
		const score_b = text_scores.get(b) ?? 0;
		if (score_a !== score_b) return score_a > score_b ? -1 : 1;
		return comparePrimaryKeys(
			store.getDocument(a)?.primary_key ?? a,
			store.getDocument(b)?.primary_key ?? b,
			store.primary_key_type,
		);
	});
	const keep = Math.ceil(remainder.length * value);
	const result = new Set(all_match);
	for (const id of remainder.slice(0, keep)) result.add(id);
	return result;
}

/**
 * Keep the first result per distinct value of `distinct_on`, after ordering.
 *
 * Missing/null values form a single group like any other value, so at most one
 * document lacking the field survives.
 */
function applyDistinct(
	results: ScoredDocument[],
	field: string | undefined,
): ScoredDocument[] {
	if (!field) return results;
	const seen = new Set<string>();
	const kept: ScoredDocument[] = [];
	for (const entry of results) {
		const value = getFieldValue(entry.stored.document, field);
		// Type-prefixed so `1` and `'1'` never collapse into one group.
		const key =
			value === null || value === undefined ? 'null' : `${typeof value}:${String(value)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		kept.push(entry);
	}
	return kept;
}
