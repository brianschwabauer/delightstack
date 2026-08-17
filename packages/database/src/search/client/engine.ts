/**
 * The asynchronous IndexedDB client search driver (plan §7.6).
 *
 * It is the same pipeline as `memory/engine.ts` and `server/engine.ts` —
 * where → term matching → BM25 → threshold → order → `distinct_on` → facets →
 * page — with awaits at the storage boundaries and nothing else changed. Every
 * decision about membership, order or a count is made by `core/*`, in the same
 * sequence and the same accumulation order, so the golden vectors produce
 * byte-identical answers on all three drivers.
 *
 * **No vector path exists here.** Vectors never reach the client (§4.9): a
 * query carrying one is the routing layer's job to send to the server, and
 * reaching this driver with one is a programming error, not a fallback — hence
 * the descriptive `DelightError` and the pure {@link requiresServer} predicate
 * the router uses instead.
 *
 * **Coverage, not correctness.** Identical results are guaranteed only when the
 * corpora match. A synced window that is a strict subset of the server's corpus
 * legitimately differs in membership *and* in BM25 statistics; when the window
 * is partial, the server's answer is the authoritative one (§7.6).
 *
 * **Determinism.** No `Date.now()`, no randomness, no reliance on IDB's key
 * order for anything user-visible. `elapsed` is zero unless a clock is
 * injected.
 */

import { DelightError } from '@delightstack/utilities';
import { bm25Score } from '../core/bm25';
import { comparePrimaryKeys, compareStrings } from '../core/compare';
import { expandCachedDictionary } from '../core/dictionary';
import { computeFacets } from '../core/facets';
import {
	applyDistinct,
	applyOrder,
	applyThreshold,
	elapsedSince,
	resolveSearchFields,
	validateDistinctOn,
	validateOrder,
	type ScoredDocument,
} from '../core/pipeline';
import { TokenHits } from '../core/token_hits';
import { MAX_QUERY_TOKENS, tokenize } from '../core/tokenizer';
import type { FacetDefinition, SearchQuery, SearchQueryResults } from '../core/types';
import {
	evaluateWhere,
	getFieldValue,
	normalizeWhere,
	type NormalizedWhere,
} from '../core/where';
import {
	collectProbes,
	type CandidateProbe,
	type ClientSearchType,
	type DocRow,
	type IdbSearchStore,
} from './idb_store';

/** An indexed document as returned in hits. */
export type ClientDocument = Record<string, unknown>;

/** Options for {@link IdbSearchEngine}. */
export interface IdbSearchEngineOptions {
	/**
	 * A caller-supplied clock for `elapsed`, in milliseconds. The engine never
	 * reads one itself (determinism rule §3); omit it and `elapsed` is zero.
	 */
	now?: () => number;
	/**
	 * Whether `where` may drive candidate extraction off the `docs` indexes.
	 * Disable it to force a full document scan (`core/where` decides either way,
	 * so this only ever changes cost). @default true
	 */
	use_index_candidates?: boolean;
	/**
	 * Past this fraction of the entity type's documents, an index probe is not
	 * worth its round trips and the scan wins. @default 0.5
	 */
	index_candidate_ratio?: number;
}

/**
 * Whether a query must be answered by the server.
 *
 * Rule (1) of the §7.6 routing policy, and the only part of it this module can
 * decide on its own: vectors — including hybrid — do not exist on the client.
 * Rule (2), the coverage decision, needs the sync state and lives in the
 * worker.
 */
export function requiresServer(query: SearchQuery | undefined): boolean {
	return query?.vector !== undefined;
}

/** The asynchronous IndexedDB search driver. */
export class IdbSearchEngine {
	readonly store: IdbSearchStore;
	readonly #now: (() => number) | undefined;
	readonly #use_index_candidates: boolean;
	readonly #index_candidate_ratio: number;

	constructor(store: IdbSearchStore, options: IdbSearchEngineOptions = {}) {
		this.store = store;
		this.#now = options.now;
		this.#use_index_candidates = options.use_index_candidates !== false;
		this.#index_candidate_ratio = options.index_candidate_ratio ?? 0.5;
	}

	/** Run the full pipeline: filter → match → score → order → distinct → facet → page. */
	async list(
		entity_type: string,
		query: SearchQuery = {},
	): Promise<SearchQueryResults<ClientDocument>> {
		const started = this.#now?.() ?? 0;
		const config = this.store.getType(entity_type);
		if (requiresServer(query)) {
			throw DelightError.badRequest(
				'Vector search is server-only — the client index holds no vectors. Route the query to the server (`requiresServer`).',
				{ code: 'vector_search_unavailable' },
			);
		}
		// Validation order mirrors the other two drivers exactly: a query with two
		// problems must fail with the same one everywhere.
		const search_fields = resolveSearchFields(config, query);
		validateOrder(config, query);
		validateDistinctOn(config, query);

		const where_node = normalizeWhere(
			query.where as Record<string, unknown> | undefined,
			config.schema,
		);

		// DoS clamp: only the first MAX_QUERY_TOKENS tokens of the query term are
		// used — identical to the server's slice, so both drivers score the same
		// token set for the same term.
		const term_tokens =
			typeof query.term === 'string'
				? tokenize(query.term).slice(0, MAX_QUERY_TOKENS)
				: [];
		const distinct_tokens = [...new Set(term_tokens)].sort(compareStrings);
		const has_term = distinct_tokens.length > 0;

		// The browse fast path: no term, no filter, a single-field order with a
		// limit — the default subscription query — walks the order field's index
		// with a cursor and stops at `offset + limit` rows instead of
		// materializing and sorting the whole corpus. Falls through to the
		// ordinary pipeline whenever the index cannot answer exactly.
		if (
			!has_term &&
			!where_node &&
			query.facets === undefined &&
			query.distinct_on === undefined &&
			(query.order?.length ?? 0) === 1 &&
			query.limit !== undefined
		) {
			const paged = await this.#pageByIndex(config, query, started);
			if (paged) return paged;
		}

		// With no term, every matched document is read anyway (it is the result),
		// so the filter runs over documents. With a term, the filter only has to
		// produce the candidate id set — the postings carry everything scoring
		// needs, and only the returned page is hydrated.
		const matched = where_node
			? await this.#fetchMatched(config, where_node)
			: has_term
				? undefined
				: (await this.store.getAllDocs(entity_type)).map(toScored(config)).sort(byDocId);

		let results: ScoredDocument[];
		if (has_term) {
			const candidate_ids = matched
				? new Set(matched.map((entry) => entry.doc_id))
				: null;
			const text_scores = new Map<string, number>();
			const token_hits = new TokenHits(distinct_tokens.length);
			await this.#accumulateText(
				config,
				query,
				search_fields,
				distinct_tokens,
				candidate_ids,
				text_scores,
				token_hits,
			);
			const text_ids = applyThreshold(
				config,
				text_scores,
				token_hits,
				distinct_tokens.length,
				query.threshold,
			);
			const scores = new Map<string, number>();
			for (const id of text_ids) scores.set(id, text_scores.get(id) ?? 0);

			// Score ordering needs a score and a primary key, nothing else — so when
			// nothing downstream reads the whole matched set as *documents*
			// (`order[]` reads their fields, `distinct_on` groups by one, facets
			// count over all of them), only the page is read back. Membership,
			// `count` and order are unchanged.
			const deferrable =
				query.facets === undefined &&
				query.distinct_on === undefined &&
				(query.order?.length ?? 0) === 0;
			const known = matched
				? new Map(matched.map((entry) => [entry.doc_id, entry] as const))
				: undefined;
			if (deferrable) {
				return await this.#pageByScore(config, query, scores, known, started);
			}
			results = await this.#materialize(config, scores, known);
		} else {
			results = matched ?? [];
		}

		applyOrder(config, results, query, has_term);
		const distinct = applyDistinct(results, query.distinct_on);
		const facets = computeFacets(
			distinct.map((entry) => entry.document),
			query.facets as Record<string, FacetDefinition> | undefined,
			config.schema,
		);
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
			elapsed: elapsedSince(started, this.#now),
			...(facets ? { facets } : {}),
		};
	}

	/**
	 * The index-cursor page for a no-term, no-filter, single-order query.
	 *
	 * Returns `null` when the order field's index cannot answer *exactly* —
	 * non-numeric declared type, no scalar index, or any document whose value at
	 * the path is missing or mistyped (the store checks coverage by count). The
	 * store hands back a prefix of the value order with the boundary tie group
	 * complete, and {@link applyOrder} re-sorts it with the full comparator —
	 * primary-key tie-break included — so the page is byte-identical to the
	 * scan path's (the golden vectors are the referee).
	 */
	async #pageByIndex(
		config: ClientSearchType,
		query: SearchQuery,
		started: number,
	): Promise<SearchQueryResults<ClientDocument> | null> {
		const instruction = (
			query.order as { field: string; direction?: 'ASC' | 'DESC' }[]
		)[0];
		// Numbers only: within a numeric slice IDB's key order IS
		// `compareForOrder`'s numeric order. String order would diverge (code
		// unit vs code point), so strings take the scan path.
		if (config.schema[instruction.field] !== 'number') return null;
		const offset = query.offset ?? 0;
		const limit = Math.max(0, query.limit as number);
		const page = await this.store.readOrderedByNumericIndex(
			config.entity_type,
			instruction.field,
			(instruction.direction ?? 'ASC') === 'DESC',
			offset + limit,
		);
		if (!page) return null;
		const results = page.rows.map(toScored(config));
		applyOrder(config, results, query, false);
		return {
			count: page.total,
			hits: results.slice(offset, offset + limit).map((entry) => ({
				id: entry.doc_id,
				score: entry.score,
				document: entry.document,
			})),
			elapsed: elapsedSince(started, this.#now),
		};
	}

	/**
	 * The `where`-matched documents, ascending by doc id.
	 *
	 * Candidate extraction is an optimization and nothing more: an index probe
	 * returns a superset, `core/where` decides membership over whatever arrives,
	 * and when no probe is eligible (booleans, `not`, `not_in`, `or`, a
	 * non-indexed path) or none is selective enough, the entity type's documents
	 * are scanned. Correctness never depends on which branch runs.
	 */
	async #fetchMatched(
		config: ClientSearchType,
		where_node: NormalizedWhere,
	): Promise<ScoredDocument[]> {
		const rows = await this.#candidateRows(config, where_node);
		const matched: ScoredDocument[] = [];
		for (const row of rows) {
			if (!evaluateWhere(row.sparse_doc, where_node)) continue;
			matched.push(toScored(config)(row));
		}
		matched.sort(byDocId);
		return matched;
	}

	/** The documents a `where` could possibly match — a superset, always. */
	async #candidateRows(
		config: ClientSearchType,
		where_node: NormalizedWhere,
	): Promise<DocRow[]> {
		const entity_type = config.entity_type;
		if (!this.#use_index_candidates) return await this.store.getAllDocs(entity_type);
		const probes = collectProbes(where_node, this.store.indexed_paths);
		if (probes.length === 0) return await this.store.getAllDocs(entity_type);
		const [total, counts] = await Promise.all([
			this.store.countDocs(entity_type),
			Promise.all(probes.map((probe) => this.store.countProbe(entity_type, probe))),
		]);
		let best: CandidateProbe | undefined;
		let best_count = Number.POSITIVE_INFINITY;
		for (let index = 0; index < probes.length; index++) {
			if (counts[index] >= best_count) continue;
			best = probes[index];
			best_count = counts[index];
		}
		if (!best || best_count > total * this.#index_candidate_ratio) {
			return await this.store.getAllDocs(entity_type);
		}
		const doc_ids = await this.store.getProbeDocIds(entity_type, best);
		const documents = await this.store.getDocs(entity_type, doc_ids);
		return [...documents.values()];
	}

	/**
	 * Accumulate BM25 in the deterministic order: fields ascending, then query
	 * tokens ascending, then matched index tokens ascending, then doc ids
	 * ascending — so float summation is identical on every driver.
	 *
	 * One batched IDB read per field covers every token the field's expansions
	 * touch; the accumulation itself then runs entirely in memory, in the
	 * reference engine's exact loop order.
	 */
	async #accumulateText(
		config: ClientSearchType,
		query: SearchQuery,
		search_fields: readonly string[],
		distinct_tokens: readonly string[],
		candidate_ids: ReadonlySet<string> | null,
		text_scores: Map<string, number>,
		token_hits: TokenHits,
	): Promise<void> {
		const entity_type = config.entity_type;
		const boosts = query.boost as Record<string, number> | undefined;
		const exact = query.exact === true;
		const tolerance = exact ? 0 : (query.tolerance ?? 0);
		/** Per-query cache for the oversized-dictionary full-range fallback. */
		const expansion_memo = new Map<string, string[]>();
		for (const field of search_fields) {
			const stats = await this.store.getFieldStats(entity_type, field);
			if (stats.doc_count === 0) continue;
			const average_field_length = stats.total_len / stats.doc_count;
			const boost = boosts?.[field] ?? 1;
			const dictionary = await this.store.getTokenDictionary(entity_type, field);
			// A field whose dictionary is too large to cache expands through range
			// scans instead — same candidates, same order (§7.3's mirror). The
			// expansions run sequentially so the per-query memo turns N identical
			// full-range tolerance reads into one.
			let expansions: string[][];
			if (dictionary) {
				expansions = distinct_tokens.map((token) =>
					expandCachedDictionary(dictionary, token, exact, tolerance),
				);
			} else {
				expansions = [];
				for (const token of distinct_tokens) {
					expansions.push(
						await this.store.expandToken(
							entity_type,
							field,
							token,
							exact,
							tolerance,
							expansion_memo,
						),
					);
				}
			}
			const wanted = [...new Set(expansions.flat())].sort(compareStrings);
			const terms = await this.store.getTerms(entity_type, field, wanted);
			for (let token_index = 0; token_index < distinct_tokens.length; token_index++) {
				for (const candidate of expansions[token_index]) {
					const term = terms.get(candidate);
					if (!term) continue;
					for (const posting of term.postings) {
						if (candidate_ids && !candidate_ids.has(posting.doc_id)) continue;
						const score = bm25Score({
							tf: posting.tf,
							field_length: posting.len,
							average_field_length,
							field_doc_count: stats.doc_count,
							doc_frequency: term.df,
						});
						text_scores.set(
							posting.doc_id,
							(text_scores.get(posting.doc_id) ?? 0) + boost * score,
						);
						token_hits.add(posting.doc_id, token_index);
					}
				}
			}
		}
	}

	/** Read every matched document back. */
	async #materialize(
		config: ClientSearchType,
		scores: ReadonlyMap<string, number>,
		known: ReadonlyMap<string, ScoredDocument> | undefined,
	): Promise<ScoredDocument[]> {
		const ids = [...scores.keys()];
		const hydrated = known ?? (await this.#hydrate(config, ids));
		const results: ScoredDocument[] = [];
		for (const id of ids) {
			const entry = hydrated.get(id);
			if (!entry) continue;
			results.push({ ...entry, score: scores.get(id) as number });
		}
		return results;
	}

	/**
	 * The score-ordered page, hydrating only the documents that are returned.
	 *
	 * The sort key — score descending, then primary key ascending — is exactly
	 * {@link applyOrder}'s empty-`order[]` branch, and `doc_id` stands in for the
	 * primary key (it is `String(primary_key)` by construction, and
	 * `comparePrimaryKeys` coerces both forms identically). A scored id whose
	 * document cannot be read back is skipped — dropped from the page *and* from
	 * `count` — the same choice the server driver makes, and unreachable in
	 * practice because postings and documents are written in one transaction.
	 */
	async #pageByScore(
		config: ClientSearchType,
		query: SearchQuery,
		scores: ReadonlyMap<string, number>,
		known: ReadonlyMap<string, ScoredDocument> | undefined,
		started: number,
	): Promise<SearchQueryResults<ClientDocument>> {
		const entries = [...scores.entries()].map(([doc_id, score]) => ({ doc_id, score }));
		entries.sort((a, b) => {
			if (a.score !== b.score) return a.score > b.score ? -1 : 1;
			return comparePrimaryKeys(a.doc_id, b.doc_id, config.primary_key_type);
		});
		const offset = query.offset ?? 0;
		const limit = query.limit ?? entries.length;
		const wanted = offset + Math.max(0, limit);
		const hits: SearchQueryResults<ClientDocument>['hits'] = [];
		let cursor = 0;
		let missing = 0;
		// Each pass hydrates exactly the entries still needed; a missing document
		// is skipped and the next entry fills its place on a later pass.
		while (cursor < entries.length && hits.length < wanted) {
			const window = entries.slice(cursor, cursor + (wanted - hits.length));
			cursor += window.length;
			const hydrated =
				known ??
				(await this.#hydrate(
					config,
					window.map((entry) => entry.doc_id),
				));
			for (const entry of window) {
				const document = hydrated.get(entry.doc_id);
				if (!document) {
					missing++;
					continue;
				}
				hits.push({ id: entry.doc_id, score: entry.score, document: document.document });
			}
		}
		return {
			count: entries.length - missing,
			hits: hits.slice(offset),
			elapsed: elapsedSince(started, this.#now),
		};
	}

	/** Read documents back for a set of `String(primary key)` ids. */
	async #hydrate(
		config: ClientSearchType,
		doc_ids: readonly string[],
	): Promise<Map<string, ScoredDocument>> {
		const rows = await this.store.getDocs(config.entity_type, doc_ids);
		const documents = new Map<string, ScoredDocument>();
		for (const [doc_id, row] of rows) documents.set(doc_id, toScored(config)(row));
		return documents;
	}
}

/* -------------------------------------------------------------------------- */
/* Pipeline helpers (shared shape with `memory/engine.ts`)                    */
/* -------------------------------------------------------------------------- */

/** Turn a stored row into a zero-scored result entry. */
function toScored(config: ClientSearchType): (row: DocRow) => ScoredDocument {
	return (row) => {
		const primary_key = getFieldValue(row.sparse_doc, config.primary_key);
		return {
			doc_id: row.doc_id,
			primary_key:
				typeof primary_key === 'string' || typeof primary_key === 'number'
					? primary_key
					: row.doc_id,
			document: row.sparse_doc,
			score: 0,
		};
	};
}

/** Ascending by doc id, by the core comparator (never IDB's). */
function byDocId(a: ScoredDocument, b: ScoredDocument): number {
	return compareStrings(a.doc_id, b.doc_id);
}
