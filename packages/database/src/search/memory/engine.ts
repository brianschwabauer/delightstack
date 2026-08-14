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
import { compareStrings } from '../core/compare';
import { buildCachedDictionary, expandCachedDictionary } from '../core/dictionary';
import { computeFacets } from '../core/facets';
import {
	applyDistinct,
	applyOrder,
	applyThreshold,
	resolveSearchFields,
	validateDistinctOn,
	validateOrder,
	type ScoredDocument,
} from '../core/pipeline';
import { isVectorFieldType } from '../core/schema_fields';
import { TokenHits } from '../core/token_hits';
import { tokenize } from '../core/tokenizer';
import type { FacetDefinition, SearchQuery, SearchQueryResults } from '../core/types';
import { evaluateWhere, normalizeWhere } from '../core/where';
import { fuseScores } from '../server/fusion';
import { DEFAULT_SIMILARITY, dotProduct, normalizeVector } from '../server/vector';
import { MemorySearchStore, type MemoryIndexConfig, type StoredDocument } from './store';

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
					store,
					text_scores,
					token_hits,
					distinct_tokens.length,
					query.threshold,
				)
			: undefined;

		// 3. vector
		const vector_scores = query.vector
			? this.#scoreVectors(query, matched_ids)
			: undefined;

		// 4. combine into the result membership + scores
		const results = this.#combine(matched, text_scores, text_ids, vector_scores);

		// 5. order
		applyOrder(store, results, query, has_term || vector_scores !== undefined);

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
			hits: page.map((entry) => ({
				id: entry.doc_id,
				score: entry.score,
				document: entry.document,
			})),
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
			const dictionary = buildCachedDictionary(store.getDictionary(field));
			for (let token_index = 0; token_index < distinct_tokens.length; token_index++) {
				const token = distinct_tokens[token_index];
				for (const candidate of expandCachedDictionary(
					dictionary,
					token,
					exact,
					tolerance,
				)) {
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
		const toEntry = (stored: StoredDocument, score: number): ScoredDocument => ({
			doc_id: stored.doc_id,
			primary_key: stored.primary_key,
			document: stored.document,
			score,
		});
		if (text_ids && vector_scores) {
			const text_subset = new Map<string, number>();
			for (const id of text_ids) text_subset.set(id, text_scores.get(id) ?? 0);
			const fused = fuseScores(text_subset, vector_scores);
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
