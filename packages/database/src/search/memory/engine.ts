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
 *   hybrid fusion is max-normalized at `vector.weight` (DS-08 — the vector
 *   share, default 0.5/0.5; `0`/`1` short-circuit to the pure text/vector
 *   result). `vector.similarity` (default `0.8`, inclusive) is the admission
 *   floor for both modes — it is part of the public typed API (decided
 *   2026-08-12) where Orama's was unreachable.
 *
 * Determinism: no `Date.now()`, no randomness, and no reliance on Map/object
 * iteration order — `elapsed` is therefore always zero here.
 */

import { DelightError } from '@delightstack/utilities';
import { bm25Score } from '../core/bm25.js';
import { compareStrings } from '../core/compare.js';
import { buildCachedDictionary } from '../core/dictionary.js';
import { expandTerm, fieldBoost, planQueryTerms } from '../core/expansion.js';
import { type MatchedTokens, noteMatch, orderedDistinct } from '../core/proximity.js';
import { computeFacets } from '../core/facets.js';
import {
	applyDistinct,
	applyOrder,
	applyProximity,
	applyThreshold,
	multiMatchIds,
	resolveSearchFields,
	validateDistinctOn,
	validateHighlight,
	validateOrder,
	withHighlights,
	type ScoredDocument,
} from '../core/pipeline.js';
import { isVectorFieldType } from '../core/schema_fields.js';
import { TokenHits } from '../core/token_hits.js';
import { MAX_QUERY_TOKENS, tokenize } from '../core/tokenizer.js';
import type { FacetDefinition, SearchQuery, SearchQueryResults } from '../core/types.js';
import { evaluateWhere, normalizeWhere } from '../core/where.js';
import { fuseScores, fusionWeights } from '../server/fusion.js';
import { DEFAULT_SIMILARITY, dotProduct, normalizeVector } from '../server/vector.js';
import {
	MemorySearchStore,
	type MemoryIndexConfig,
	type StoredDocument,
} from './store.js';

/** An indexed document as returned in hits. */
export type MemoryDocument = Record<string, unknown>;

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
		const search_fields = resolveSearchFields(store, query);
		validateOrder(store, query);
		validateHighlight(query, search_fields);
		validateDistinctOn(store, query);

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
		// DoS clamp: only the first MAX_QUERY_TOKENS tokens of the query term are
		// used — identical to the server's slice, so every driver scores the same
		// token set for the same term.
		const term_tokens =
			typeof query.term === 'string'
				? tokenize(query.term).slice(0, MAX_QUERY_TOKENS)
				: [];
		const distinct_tokens = [...new Set(term_tokens)].sort(compareStrings);
		const has_term = distinct_tokens.length > 0;

		// DS-08 endpoint short-circuits as *skips* — the server driver's rule,
		// restated: at weight 0 the vector scan never runs (its query shape is
		// still validated), at weight 1 the BM25 side never runs. Either skip
		// leaves one score set, and `#combine`'s single-set branches ARE the
		// endpoint results.
		const weight = query.vector?.weight;
		const skip_text = has_term && query.vector !== undefined && weight === 1;
		const skip_vector = has_term && query.vector !== undefined && weight === 0;

		const text_scores = new Map<string, number>();
		const token_hits = new TokenHits(distinct_tokens.length);
		const matched_tokens: MatchedTokens = new Map();
		if (has_term && !skip_text) {
			this.#accumulateText(
				query,
				search_fields,
				distinct_tokens,
				matched_ids,
				text_scores,
				token_hits,
				matched_tokens,
			);
		}
		const text_ids =
			has_term && !skip_text
				? applyThreshold(
						store,
						text_scores,
						token_hits,
						distinct_tokens.length,
						query.threshold,
					)
				: undefined;

		// 3. vector
		let vector_scores: Map<string, number> | undefined;
		if (query.vector) {
			if (skip_vector) this.#validateVector(query);
			else vector_scores = this.#scoreVectors(query, matched_ids);
		}

		// 4. combine into the result membership + scores
		const results = this.#combine(matched, text_scores, text_ids, vector_scores, weight);

		// 5. order
		applyOrder(store, results, query, has_term || vector_scores !== undefined);
		if (has_term && !skip_text) {
			applyProximity(
				store,
				results,
				query,
				search_fields,
				orderedDistinct(term_tokens),
				matched_tokens,
				multiMatchIds(token_hits, distinct_tokens.length),
			);
		}

		// 6. distinct_on (count is post-distinct — see the module docblock)
		const distinct = applyDistinct(results, query.distinct_on);

		// 7. facets over the full result set, before paging
		const facets = computeFacets(
			distinct.map((entry) => entry.document),
			query.facets as Record<string, FacetDefinition> | undefined,
			store.schema,
		);

		// 8. offset/limit
		const offset = query.offset ?? 0;
		const limit = query.limit ?? distinct.length;
		const page = distinct.slice(offset, offset + Math.max(0, limit));

		return {
			count: distinct.length,
			hits: withHighlights(
				page.map((entry) => ({
					id: entry.doc_id,
					score: entry.score,
					document: entry.document,
				})),
				query,
				search_fields,
				matched_tokens,
			),
			// No `Date.now()` anywhere in the engine (§3 determinism rules).
			elapsed: { raw: 0, formatted: '0ms' },
			...(facets ? { facets } : {}),
		};
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
		matched_tokens: MatchedTokens,
	): void {
		const store = this.store;
		const boosts = query.boost as Record<string, number> | undefined;
		const terms = planQueryTerms(distinct_tokens, query);
		for (const field of search_fields) {
			const stats = store.getFieldStats(field);
			if (stats.doc_count === 0) continue;
			const average_field_length = stats.total_len / stats.doc_count;
			const boost = fieldBoost(field, boosts, store.field_options);
			const dictionary = buildCachedDictionary(store.getDictionary(field));
			for (let token_index = 0; token_index < distinct_tokens.length; token_index++) {
				const term = terms[token_index];
				for (const { token: candidate, weight } of expandTerm(dictionary, term, (token) =>
					store.getDocFrequency(field, token),
				)) {
					const doc_frequency = store.getDocFrequency(field, candidate);
					if (doc_frequency > 0) noteMatch(matched_tokens, field, term.token, candidate);
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
						text_scores.set(
							doc_id,
							(text_scores.get(doc_id) ?? 0) + boost * weight * score,
						);
						token_hits.add(doc_id, token_index);
					}
				}
			}
		}
	}

	/**
	 * Validate a vector query's shape without touching any stored vector — the
	 * server driver's `#validateVector`, restated, so a `weight: 0` skip still
	 * rejects a garbage field, type, dimension or weight identically on both
	 * engines. The dimension check reuses `dotProduct`'s exact message (goldens
	 * pin it); before the skip existed this engine met a wrong dimension only
	 * inside the scan.
	 */
	#validateVector(query: SearchQuery): {
		field: string;
		query_vector: Float32Array;
		minimum: number;
	} {
		const vector_query = query.vector!;
		// Validated here — not only where fusion reads it — so a bad weight is an
		// error on every query shape, vector-only included (DS-08).
		fusionWeights(vector_query.weight);
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
		const declared_dimension = Number((type as string).slice('vector['.length, -1));
		if (
			Number.isInteger(declared_dimension) &&
			declared_dimension > 0 &&
			vector_query.value.length !== declared_dimension
		) {
			throw DelightError.badRequest(
				`Vector dimension mismatch: query has ${vector_query.value.length}, index has ${declared_dimension}.`,
				{ code: 'invalid_vector' },
			);
		}
		return {
			field,
			query_vector: normalizeVector(vector_query.value),
			minimum: vector_query.similarity ?? DEFAULT_SIMILARITY,
		};
	}

	/** Dot-product scoring over unit vectors, filtered by the similarity floor. */
	#scoreVectors(
		query: SearchQuery,
		matched_ids: ReadonlySet<string>,
	): Map<string, number> {
		if (!query.vector) return new Map();
		const { field, query_vector, minimum } = this.#validateVector(query);
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
		weight: number | undefined,
	): ScoredDocument[] {
		const toEntry = (stored: StoredDocument, score: number): ScoredDocument => ({
			doc_id: stored.doc_id,
			primary_key: stored.primary_key,
			document: stored.document,
			score,
		});
		if (text_ids && vector_scores) {
			// Both sets exist only for a genuine blend — the endpoint weights skip
			// the dead side's scoring upstream, so `0`/`1` land in the single-set
			// branches below, which ARE the pure results.
			const text_subset = new Map<string, number>();
			for (const id of text_ids) text_subset.set(id, text_scores.get(id) ?? 0);
			const fused = fuseScores(text_subset, vector_scores, fusionWeights(weight));
			return matched
				.filter((stored) => fused.has(stored.doc_id))
				.map((stored) => toEntry(stored, fused.get(stored.doc_id) as number));
		}
		if (text_ids) {
			return matched
				.filter((stored) => text_ids.has(stored.doc_id))
				.map((stored) => toEntry(stored, text_scores.get(stored.doc_id) ?? 0));
		}
		if (vector_scores) {
			return matched
				.filter((stored) => vector_scores.has(stored.doc_id))
				.map((stored) => toEntry(stored, vector_scores.get(stored.doc_id) as number));
		}
		return matched.map((stored) => toEntry(stored, 0));
	}
}
