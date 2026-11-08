/**
 * The synchronous server search driver (plan §7.5).
 *
 * DO SQLite is synchronous by design, so this driver is synchronous end to end.
 * It is one of two implementations of a single specification — the other being
 * the async IndexedDB client driver — and the mechanism that keeps them
 * honest is that **every decision about membership, order or a count is made
 * by `core/*`**, never here and never by SQL. This module orchestrates: it
 * pushes down what SQL can decide *exactly* (`sql_where.ts` says when that is),
 * reads postings from `sqlite_store.ts`, and then sequences the same core
 * modules the memory reference engine sequences, in the same order, so float
 * accumulation is bit-identical.
 *
 * The golden-vector suite replays the frozen answers through this driver over
 * real SQLite; any divergence from `memory/engine.ts` is a bug here, not a new
 * behavior.
 *
 * **Transactions.** Read paths need none. Write paths (`indexDocument`,
 * `removeDocument`, `rebuildBatch`) must be called inside the caller's
 * `ctx.storage.transactionSync()` — see `sqlite_store.ts`.
 *
 * **Determinism.** No `Date.now()`, no randomness. `elapsed` is zero unless the
 * caller supplies a clock.
 */

import { DelightError } from '@delightstack/utilities';
import { bm25Score } from '../core/bm25.js';
import { comparePrimaryKeys, compareStrings } from '../core/compare.js';
import { expandCachedDictionary } from '../core/dictionary.js';
import {
	fieldBoost,
	fieldTolerance,
	planQueryTerms,
	selectExpansions,
} from '../core/expansion.js';
import { computeFacets } from '../core/facets.js';
import {
	type MatchedTokens,
	noteMatch,
	orderedDistinct,
	RERANK_WINDOW,
	rerankByProximity,
} from '../core/proximity.js';
import {
	applyDistinct,
	applyOrder,
	applyProximity,
	applyThreshold,
	elapsedSince,
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
import { fieldTokenLimit, MAX_QUERY_TOKENS, tokenize } from '../core/tokenizer.js';
import type {
	FacetDefinition,
	SearchQuery,
	SearchQueryResults,
	SearchableType,
} from '../core/types.js';
import { evaluateWhere, normalizeWhere, type NormalizedWhere } from '../core/where.js';
import { fuseScores, fusionWeights } from './fusion.js';
import {
	compileOrder,
	compileWhere,
	quoteIdentifier,
	type CompiledSql,
	type SqlWhereContext,
} from './sql_where.js';
import {
	chunk,
	defineSearchType,
	indexesNothing,
	MAX_IN_VALUES,
	SqliteSearchStore,
	type SearchSqlStorage,
	type SearchTypeConfig,
	type SearchTypeInput,
} from './sqlite_store.js';
import { DEFAULT_SIMILARITY, dotProduct, normalizeVector } from './vector.js';

/* -------------------------------------------------------------------------- */
/* Table configuration                                                        */
/* -------------------------------------------------------------------------- */

/** An indexed entity type plus where its values live in SQLite. */
export interface ServerSearchTable extends SearchTypeConfig {
	/** The entity table's name. */
	table_name: string;
	/** Real column names on the entity table. */
	columns: ReadonlySet<string>;
	/** FK-derived paths, persisted under the `$derived` sub-object of `json`. */
	derived_fields?: ReadonlySet<string>;
	/** The overflow column holding non-scalars @default 'json' */
	json_column?: string;
	/** Top-level fields stored as JSON text in their own column. */
	json_fields?: ReadonlySet<string>;
	/** Paths whose SQL form is lossy — `core/where` decides those. */
	inexact_fields?: ReadonlySet<string>;
	/** Real columns declared `TEXT`, whose affinity coerces non-string operands. */
	text_affinity_fields?: ReadonlySet<string>;
}

/** Inputs for {@link defineServerTable}. */
export interface ServerSearchTableInput extends SearchTypeInput {
	table_name: string;
	columns: Iterable<string>;
	derived_fields?: Iterable<string>;
	json_column?: string;
	json_fields?: Iterable<string>;
	inexact_fields?: Iterable<string>;
	text_affinity_fields?: Iterable<string>;
}

/** Resolve an entity type's field lists and SQL placement once. */
export function defineServerTable(input: ServerSearchTableInput): ServerSearchTable {
	return {
		...defineSearchType(input),
		table_name: input.table_name,
		columns: new Set(input.columns),
		derived_fields: input.derived_fields ? new Set(input.derived_fields) : undefined,
		json_column: input.json_column ?? 'json',
		json_fields: input.json_fields ? new Set(input.json_fields) : undefined,
		inexact_fields: input.inexact_fields ? new Set(input.inexact_fields) : undefined,
		text_affinity_fields: input.text_affinity_fields
			? new Set(input.text_affinity_fields)
			: undefined,
	};
}

/** An indexed document as returned in hits. */
export type ServerDocument = Record<string, unknown>;

/** The scored matched set, before any document is read back. */
interface ScoredIds {
	/** Matched `String(primary key)` ids, ascending by code point. */
	ids: string[];
	/** id → final score. */
	scores: Map<string, number>;
	/** Documents an inexact `where` already had to read, or `null`. */
	documents: Map<string, ScoredDocument> | null;
	/** Ids that matched two or more distinct query tokens (proximity candidates). */
	multi_match: Set<string>;
}

/** Options for {@link SqliteSearchEngine}. */
export interface SqliteSearchEngineOptions {
	/**
	 * A caller-supplied clock for `elapsed`, in milliseconds. The engine never
	 * reads one itself (determinism rule §3); omit it and `elapsed` is zero.
	 */
	now?: () => number;
}

/** Progress from one {@link SqliteSearchEngine.rebuildBatch} call. */
export interface RebuildBatchResult {
	/** Documents indexed by this batch. */
	indexed: number;
	/** The last primary key indexed — pass it back as `after` to continue. */
	last_primary_key: string | number | undefined;
	/** Whether the scan reached the end of the entity table. */
	done: boolean;
}

/* -------------------------------------------------------------------------- */
/* Engine                                                                     */
/* -------------------------------------------------------------------------- */

// Re-exported from `core/tokenizer` (the clamp is shared by all three drivers).
export { MAX_QUERY_TOKENS };

/**
 * When a `where` admits at most this many candidate ids, vectors are fetched
 * with chunked `doc_id IN (...)` reads instead of scanning every stored vector
 * for the field.
 */
const VECTOR_PUSHDOWN_MAX_CANDIDATES = 5000;

/** The synchronous DO-SQLite search driver. */
export class SqliteSearchEngine {
	readonly sql: SearchSqlStorage;
	readonly store: SqliteSearchStore;
	readonly #tables = new Map<string, ServerSearchTable>();
	readonly #now: (() => number) | undefined;

	constructor(
		sql: SearchSqlStorage,
		options: SqliteSearchEngineOptions & { store?: SqliteSearchStore } = {},
	) {
		this.sql = sql;
		this.store = options.store ?? new SqliteSearchStore(sql);
		this.#now = options.now;
	}

	/** Create the search tables. Idempotent. */
	bootstrap(): void {
		this.store.bootstrap();
	}

	/** Register (or replace) an entity type's configuration. */
	register(table: ServerSearchTable): void {
		this.#tables.set(table.entity_type, table);
	}

	/** The registered configuration for an entity type. */
	getTable(entity_type: string): ServerSearchTable {
		const table = this.#tables.get(entity_type);
		if (!table) {
			throw new DelightError({
				message: `Entity type "${entity_type}" is not registered with the search engine.`,
				status: 500,
				code: 'unknown_entity_type',
			});
		}
		return table;
	}

	/* ---------------------------------------------------------------------- */
	/* Write path                                                             */
	/* ---------------------------------------------------------------------- */

	/**
	 * Index one document. Must run inside the caller's transaction. `counted`:
	 * the caller already added a new document to `doc_count` (see
	 * {@link SqliteSearchStore.indexDocument}).
	 */
	indexDocument(
		entity_type: string,
		doc_id: string,
		sparse_doc: ServerDocument,
		previous_sparse_doc?: ServerDocument | null,
		counted = false,
	): void {
		this.store.indexDocument(
			this.getTable(entity_type),
			doc_id,
			sparse_doc,
			previous_sparse_doc,
			counted,
		);
	}

	/** Whether an entity type keeps nothing in the index (see {@link indexesNothing}). */
	indexesNothing(entity_type: string): boolean {
		return indexesNothing(this.getTable(entity_type));
	}

	/** Remove one document. Must run inside the caller's transaction. */
	removeDocument(entity_type: string, doc_id: string, deleted_at: number): boolean {
		return this.store.removeDocument(this.getTable(entity_type), doc_id, deleted_at);
	}

	/**
	 * Wipe an entity type's search rows.
	 *
	 * The first half of `rebuildSearchTables` — the migration/repair path that
	 * replaces the old `rebuildIndex`. Run it, then call {@link rebuildBatch}
	 * until it reports `done`, one transaction per batch.
	 */
	clearSearchTables(entity_type: string): void {
		this.store.clearEntityType(entity_type);
	}

	/**
	 * Index the next slice of the entity table, keyed off the primary key.
	 *
	 * Paging by primary key (rather than `OFFSET`) keeps every batch a bounded,
	 * index-driven scan and makes the walk resumable across transactions.
	 */
	rebuildBatch(
		entity_type: string,
		options: { after?: string | number; batch_size?: number } = {},
	): RebuildBatchResult {
		const table = this.getTable(entity_type);
		const batch_size = Math.max(1, options.batch_size ?? 200);
		const primary_key = quoteIdentifier(table.primary_key);
		const rows =
			options.after === undefined
				? this.sql
						.exec(
							`SELECT * FROM ${quoteIdentifier(table.table_name)} ORDER BY ${primary_key} ASC LIMIT ${batch_size};`,
						)
						.toArray()
				: this.sql
						.exec(
							`SELECT * FROM ${quoteIdentifier(table.table_name)} WHERE ${primary_key} > ? ORDER BY ${primary_key} ASC LIMIT ${batch_size};`,
							options.after,
						)
						.toArray();
		let last_primary_key: string | number | undefined;
		for (const row of rows) {
			const document = rowToDocument(table, row);
			const primary_value = document[table.primary_key] as string | number;
			last_primary_key = primary_value;
			this.store.indexDocument(table, String(primary_value), document);
		}
		// Nothing was stored to count from; the rebuild counts the rows itself.
		if (indexesNothing(table)) this.store.adjustDocCount(entity_type, rows.length);
		return {
			indexed: rows.length,
			last_primary_key,
			done: rows.length < batch_size,
		};
	}

	/* ---------------------------------------------------------------------- */
	/* Search pipeline (§7.5)                                                 */
	/* ---------------------------------------------------------------------- */

	/** Run the full pipeline: filter → match → score → order → distinct → facet → page. */
	list(entity_type: string, query: SearchQuery = {}): SearchQueryResults<ServerDocument> {
		const started = this.#now?.() ?? 0;
		const table = this.getTable(entity_type);
		// Validation order mirrors the memory reference exactly: a query with two
		// problems must fail with the same one on both drivers.
		const search_fields = resolveSearchFields(table, query);
		validateOrder(table, query);
		validateHighlight(query, search_fields);
		validateDistinctOn(table, query);

		const where_node = normalizeWhere(
			query.where as Record<string, unknown> | undefined,
			table.schema,
		);
		const ctx = whereContext(table);
		const compiled = compileWhere(where_node, ctx);

		// DoS clamp: only the first MAX_QUERY_TOKENS tokens of the *query* term are
		// used. Index-side tokenization is untouched — this caps the number of
		// dictionary expansions and posting reads a single query can force.
		const term_tokens =
			typeof query.term === 'string'
				? tokenize(query.term).slice(0, MAX_QUERY_TOKENS)
				: [];
		const distinct_tokens = [...new Set(term_tokens)].sort(compareStrings);
		const has_term = distinct_tokens.length > 0;
		const has_vector = query.vector !== undefined;
		const has_facets = query.facets !== undefined;
		const has_distinct = query.distinct_on !== undefined;

		if (!has_term && !has_vector && !has_facets && !has_distinct && compiled.exact) {
			const order = compileOrder(query.order, ctx);
			if (order.supported) {
				return this.#listFastPath(table, query, compiled, order.sql, started);
			}
		}

		let results: ScoredDocument[];
		const matched_tokens: MatchedTokens = new Map();
		const ordered_tokens = orderedDistinct(term_tokens);
		let multi_match = new Set<string>();
		if (has_term || has_vector) {
			const scored = this.#scoreDocuments(
				table,
				query,
				where_node,
				compiled,
				search_fields,
				distinct_tokens,
				matched_tokens,
			);
			// Score ordering needs a score and a primary key, nothing else — so when
			// nothing downstream needs the whole matched set as *documents*
			// (`order[]` reads their fields, `distinct_on` groups by one, facets
			// count over all of them), only the page is read back. Membership,
			// `count` and order are unchanged: the full matched set is still scored,
			// and every id is still checked against the entity table.
			const deferrable =
				!has_facets &&
				!has_distinct &&
				(query.order?.length ?? 0) === 0 &&
				(query.offset ?? 0) >= 0;
			if (deferrable) {
				return this.#pageByScore(
					table,
					query,
					scored,
					started,
					search_fields,
					has_term ? ordered_tokens : [],
					matched_tokens,
				);
			}
			multi_match = scored.multi_match;
			results = this.#materialize(table, scored);
		} else {
			results = this.#fetchMatched(table, where_node, compiled).map((entry) => ({
				...entry,
				score: 0,
			}));
		}

		applyOrder(table, results, query, has_term || has_vector);
		if (has_term) {
			applyProximity(
				table,
				results,
				query,
				search_fields,
				ordered_tokens,
				matched_tokens,
				multi_match,
			);
		}
		const distinct = applyDistinct(results, query.distinct_on);
		const facets = computeFacets(
			distinct.map((entry) => entry.document),
			query.facets as Record<string, FacetDefinition> | undefined,
			table.schema,
		);
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
			elapsed: elapsedSince(started, this.#now),
			...(facets ? { facets } : {}),
		};
	}

	/**
	 * The dominant query: no term, no vector, no facets, no `distinct_on`, and a
	 * `where` SQL can decide exactly — one indexed SELECT plus a COUNT companion.
	 */
	#listFastPath(
		table: ServerSearchTable,
		query: SearchQuery,
		compiled: CompiledSql,
		order_sql: string,
		started: number,
	): SearchQueryResults<ServerDocument> {
		const from = `FROM ${quoteIdentifier(table.table_name)} WHERE ${compiled.sql}`;
		const count = Number(
			this.sql.exec(`SELECT COUNT(*) AS count ${from};`, ...compiled.params).toArray()[0]
				?.count ?? 0,
		);
		const offset = Math.max(0, Math.trunc(query.offset ?? 0));
		const limit = Math.max(0, Math.trunc(query.limit ?? count));
		// `limit`/`offset` are validated integers, so they are safe to inline —
		// which keeps them out of the 100-bound-parameter budget.
		const rows =
			limit === 0
				? []
				: this.sql
						.exec(
							`SELECT * ${from} ORDER BY ${order_sql} LIMIT ${limit} OFFSET ${offset};`,
							...compiled.params,
						)
						.toArray();
		return {
			count,
			hits: rows.map((row) => {
				const document = rowToDocument(table, row);
				return {
					id: String(document[table.primary_key]),
					score: 0,
					document,
				};
			}),
			elapsed: elapsedSince(started, this.#now),
		};
	}

	/** Fetch the full `where`-matched set as documents, `core/where`-verified. */
	#fetchMatched(
		table: ServerSearchTable,
		where_node: NormalizedWhere | undefined,
		compiled: CompiledSql,
	): Omit<ScoredDocument, 'score'>[] {
		const rows = this.sql
			.exec(
				`SELECT * FROM ${quoteIdentifier(table.table_name)} WHERE ${compiled.sql};`,
				...compiled.params,
			)
			.toArray();
		const matched: Omit<ScoredDocument, 'score'>[] = [];
		for (const row of rows) {
			const document = rowToDocument(table, row);
			// The SQL is a prefilter unless it says otherwise — `core/where` is the
			// authority on membership either way when it is not exact.
			if (!compiled.exact && !evaluateWhere(document, where_node)) continue;
			const primary_key = document[table.primary_key] as string | number;
			matched.push({ doc_id: String(primary_key), primary_key, document });
		}
		matched.sort((a, b) => compareStrings(a.doc_id, b.doc_id));
		return matched;
	}

	/** The candidate id set a `where` admits, or `null` when there is no filter. */
	#candidateIds(
		table: ServerSearchTable,
		where_node: NormalizedWhere | undefined,
		compiled: CompiledSql,
	): { ids: Set<string> | null; documents: Map<string, ScoredDocument> | null } {
		if (!where_node) return { ids: null, documents: null };
		if (!compiled.exact) {
			const documents = new Map<string, ScoredDocument>();
			for (const entry of this.#fetchMatched(table, where_node, compiled)) {
				documents.set(entry.doc_id, { ...entry, score: 0 });
			}
			return { ids: new Set(documents.keys()), documents };
		}
		const rows = this.sql
			.exec(
				`SELECT ${quoteIdentifier(table.primary_key)} AS pk FROM ${quoteIdentifier(table.table_name)} WHERE ${compiled.sql};`,
				...compiled.params,
			)
			.toArray();
		return { ids: new Set(rows.map((row) => String(row.pk))), documents: null };
	}

	/** The term / vector / hybrid path, up to (but not including) hydration. */
	#scoreDocuments(
		table: ServerSearchTable,
		query: SearchQuery,
		where_node: NormalizedWhere | undefined,
		compiled: CompiledSql,
		search_fields: readonly string[],
		distinct_tokens: readonly string[],
		matched_tokens: MatchedTokens,
	): ScoredIds {
		const has_term = distinct_tokens.length > 0;
		// A term with an exact `where`: score the term first, then check the
		// filter only for the documents the term matched. Scoring a document
		// never depends on which others are scored, so this is the same answer
		// as filtering first, without reading every id the filter admits (57k
		// rows read for `status = open` over 5,000 notes, to keep a handful).
		const term_first =
			has_term && query.vector === undefined && !!where_node && compiled.exact;
		const { ids: candidate_ids, documents } = term_first
			? { ids: null, documents: null }
			: this.#candidateIds(table, where_node, compiled);

		// DS-08: `weight` is the vector share, and the endpoints short-circuit —
		// `0` IS the pure-text result and `1` IS the pure-vector one (fusing at a
		// zero weight would still admit the other set's documents at score 0,
		// which is a different and worse answer than "off"). Short-circuiting is
		// implemented as a *skip of the dead side's scoring*, so a slider parked
		// at an endpoint pays nothing for the mode it turned off: at `0` the
		// vector scan never runs (the vector query is still validated — a garbage
		// field or dimension must fail identically at every weight), and at `1`
		// the BM25 accumulation never runs. Either skip leaves exactly one score
		// set, so the single-set branches below ARE the endpoint results.
		const weight = query.vector?.weight;
		const skip_text = has_term && query.vector !== undefined && weight === 1;
		const skip_vector = has_term && query.vector !== undefined && weight === 0;

		const text_scores = new Map<string, number>();
		const token_hits = new TokenHits(distinct_tokens.length);
		if (has_term && !skip_text) {
			this.#accumulateText(
				table,
				query,
				search_fields,
				distinct_tokens,
				candidate_ids,
				text_scores,
				token_hits,
				matched_tokens,
			);
			if (term_first) {
				// Few matches: check just those ids. Many: one read of the
				// filter's ids beats dozens of chunked `IN` lookups.
				const matched_ids = [...text_scores.keys()];
				const admitted =
					matched_ids.length <= 900
						? this.#admittedIds(table, compiled, matched_ids)
						: (this.#candidateIds(table, where_node, compiled).ids ?? new Set<string>());
				for (const doc_id of [...text_scores.keys()]) {
					if (!admitted.has(doc_id)) text_scores.delete(doc_id);
				}
				token_hits.retain((doc_id) => admitted.has(doc_id));
			}
		}
		const text_ids =
			has_term && !skip_text
				? applyThreshold(
						table,
						text_scores,
						token_hits,
						distinct_tokens.length,
						query.threshold,
					)
				: undefined;
		let vector_scores: Map<string, number> | undefined;
		if (query.vector) {
			if (skip_vector) this.#validateVector(table, query);
			else vector_scores = this.#scoreVectors(table, query, candidate_ids);
		}

		let final_scores: Map<string, number>;
		if (text_ids && vector_scores) {
			const text_subset = new Map<string, number>();
			for (const id of text_ids) text_subset.set(id, text_scores.get(id) ?? 0);
			final_scores = fuseScores(text_subset, vector_scores, fusionWeights(weight));
		} else if (text_ids) {
			final_scores = new Map();
			for (const id of text_ids) final_scores.set(id, text_scores.get(id) ?? 0);
		} else if (vector_scores) {
			final_scores = vector_scores;
		} else {
			final_scores = new Map();
		}

		// Deliberately UNSORTED. Both consumers re-order with a total comparator
		// that ends in the primary key, so this walk order is unobservable — and
		// `final_scores` holds the whole matched set, which is tens of thousands of
		// ids on a head-term query. Scores are already fully accumulated by the
		// time anything reads this, so ordering here cannot affect a float sum.
		return {
			ids: [...final_scores.keys()],
			scores: final_scores,
			documents,
			multi_match: multiMatchIds(token_hits, distinct_tokens.length),
		};
	}

	/** Read every matched document back. */
	#materialize(table: ServerSearchTable, scored: ScoredIds): ScoredDocument[] {
		const hydrated = scored.documents ?? this.#hydrate(table, scored.ids);
		const results: ScoredDocument[] = [];
		for (const id of scored.ids) {
			const entry = hydrated.get(id);
			if (!entry) continue;
			results.push({ ...entry, score: scored.scores.get(id) as number });
		}
		return results;
	}

	/**
	 * The score-ordered page, hydrating only the documents that are returned.
	 *
	 * The sort key — score descending, then primary key ascending — is exactly
	 * {@link applyOrder}'s empty-`order[]` branch, and `doc_id` stands in for the
	 * primary key: it is `String(primary_key)` by construction, and
	 * `comparePrimaryKeys` coerces both forms identically. So membership, order
	 * and `count` are the fully-hydrated path's, with the reads it does not need
	 * removed.
	 *
	 * Index/table divergence is not a reachable state (`indexDocument` and
	 * `removeDocument` run in the *same* SQLite transaction as the entity row,
	 * §7.2), but should an id fail to read back anyway it is skipped — dropped
	 * from the page and from `count`, the same choice `#materialize` makes.
	 */
	#pageByScore(
		table: ServerSearchTable,
		query: SearchQuery,
		scored: ScoredIds,
		started: number,
		search_fields: readonly string[],
		ordered_tokens: readonly string[],
		matched_tokens: MatchedTokens,
	): SearchQueryResults<ServerDocument> {
		let entries: { doc_id: string; score: number }[] = [];
		for (const id of scored.ids) {
			entries.push({ doc_id: id, score: scored.scores.get(id) as number });
		}
		entries.sort((a, b) => {
			if (a.score !== b.score) return a.score > b.score ? -1 : 1;
			return comparePrimaryKeys(a.doc_id, b.doc_id, table.primary_key_type);
		});
		// The proximity pass re-reads the top of the ranking. A document that
		// can't be read is dropped first, as the paging loop below would.
		let head: Map<string, ScoredDocument> | undefined;
		const rerank_ids =
			ordered_tokens.length >= 2
				? entries
						.slice(0, RERANK_WINDOW)
						.map((entry) => entry.doc_id)
						.filter((doc_id) => scored.multi_match.has(doc_id))
				: [];
		if (rerank_ids.length > 0) {
			const window = rerank_ids;
			head = scored.documents ?? this.#hydrate(table, window);
			const gone = new Set(window.filter((doc_id) => !head!.has(doc_id)));
			if (gone.size) entries = entries.filter((entry) => !gone.has(entry.doc_id));
			rerankByProximity(
				entries,
				(entry) => head!.get(entry.doc_id)?.document,
				search_fields,
				ordered_tokens,
				matched_tokens,
				(field) => fieldTokenLimit(field, table.field_options),
				table.primary_key_type,
				scored.multi_match,
			);
		}
		const offset = query.offset ?? 0;
		const limit = query.limit ?? entries.length;
		const wanted = offset + Math.max(0, limit);
		const hits: SearchQueryResults<ServerDocument>['hits'] = [];
		let cursor = 0;
		let missing = 0;
		// Each pass hydrates exactly the entries still needed; a missing document
		// is skipped and the next entry fills its place on a later pass. `count`
		// only subtracts misses actually observed — entries past the page are
		// never hydrated.
		while (cursor < entries.length && hits.length < wanted) {
			const window = entries.slice(cursor, cursor + (wanted - hits.length));
			cursor += window.length;
			// Documents the rerank already read are reused; only the rest are read.
			let hydrated: Map<string, ScoredDocument>;
			if (scored.documents) hydrated = scored.documents;
			else {
				const need = window.filter((entry) => !head?.has(entry.doc_id));
				hydrated = need.length
					? this.#hydrate(
							table,
							need.map((entry) => entry.doc_id),
						)
					: new Map();
				if (head) for (const [doc_id, document] of head) hydrated.set(doc_id, document);
			}
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
			hits: withHighlights(hits.slice(offset), query, search_fields, matched_tokens),
			elapsed: elapsedSince(started, this.#now),
		};
	}

	/**
	 * Accumulate BM25 in the deterministic order: fields ascending, then query
	 * tokens ascending, then matched index tokens ascending, then doc ids
	 * ascending — so float summation is identical on every driver.
	 */
	#accumulateText(
		table: ServerSearchTable,
		query: SearchQuery,
		search_fields: readonly string[],
		distinct_tokens: readonly string[],
		candidate_ids: ReadonlySet<string> | null,
		text_scores: Map<string, number>,
		token_hits: TokenHits,
		matched_tokens: MatchedTokens,
	): void {
		const entity_type = table.entity_type;
		const boosts = query.boost as Record<string, number> | undefined;
		const plan = planQueryTerms(distinct_tokens, query);
		/** Per-query cache for the oversized-dictionary full-table fallback. */
		const expansion_memo = new Map<string, string[]>();
		for (const field of search_fields) {
			const stats = this.store.getFieldStats(entity_type, field);
			if (stats.doc_count === 0) continue;
			const average_field_length = stats.total_len / stats.doc_count;
			const boost = fieldBoost(field, boosts, table.field_options);
			const dictionary = this.store.getCachedDictionary(entity_type, field);
			for (let token_index = 0; token_index < distinct_tokens.length; token_index++) {
				const term = plan[token_index];
				const tolerance = fieldTolerance(
					term,
					dictionary ? dictionary.tokens.length : Infinity,
				);
				const raw = dictionary
					? expandCachedDictionary(dictionary, term.token, term.exact, tolerance)
					: this.store.expandToken(
							entity_type,
							field,
							term.token,
							term.exact,
							tolerance,
							expansion_memo,
						);
				for (const variant of term.variants) {
					raw.push(...this.store.expandToken(entity_type, field, variant, true, 0));
				}
				// The capped, weighted selection needs each raw candidate's
				// frequency; the postings are then read for the survivors only.
				const doc_frequencies = this.store.getDocFrequenciesForTerm(
					entity_type,
					field,
					term.exact ? null : term.token,
					raw,
				);
				const expansions = selectExpansions(
					term,
					raw,
					tolerance,
					(token) => doc_frequencies.get(token) ?? 0,
				);
				const candidates = expansions.map((expansion) => expansion.token);
				const postings_by_token = this.store.getPostingsForTokens(
					entity_type,
					field,
					candidates,
				);
				for (const { token: candidate, weight } of expansions) {
					const doc_frequency = doc_frequencies.get(candidate) ?? 0;
					if (doc_frequency > 0) noteMatch(matched_tokens, field, term.token, candidate);
					// `field_length` rides along on the posting row (§7.1), so nothing
					// here is proportional to the corpus — only to the postings the
					// query actually touches.
					for (const [doc_id, tf, field_length] of postings_by_token.get(candidate) ??
						[]) {
						if (candidate_ids && !candidate_ids.has(doc_id)) continue;
						const score = bm25Score({
							tf,
							field_length,
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

	/** Which of `doc_ids` an exact compiled `where` admits. */
	#admittedIds(
		table: ServerSearchTable,
		compiled: CompiledSql,
		doc_ids: readonly string[],
	): Set<string> {
		const admitted = new Set<string>();
		const primary_key = quoteIdentifier(table.primary_key);
		// Leaves room in the 100-parameter budget for the filter's own bindings.
		const size = Math.max(1, MAX_IN_VALUES - compiled.params.length);
		for (const batch of chunk(doc_ids, size)) {
			if (batch.length === 0) continue;
			const keys = batch.map((doc_id) =>
				table.primary_key_type === 'number' ? Number(doc_id) : doc_id,
			);
			const rows = this.sql
				.exec(
					`SELECT ${primary_key} AS pk FROM ${quoteIdentifier(table.table_name)} WHERE ${primary_key} IN (${Array.from({ length: batch.length }, () => '?').join(', ')}) AND (${compiled.sql});`,
					...keys,
					...compiled.params,
				)
				.toArray();
			for (const row of rows) admitted.add(String(row.pk));
		}
		return admitted;
	}

	/**
	 * Validate a vector query's shape without touching any stored vector — the
	 * whole refusal surface, split from the scan (DS-08) so a `weight: 0` skip
	 * still rejects a garbage field, type, dimension or weight identically.
	 * Returns what the scan needs; the skip path discards it.
	 */
	#validateVector(
		table: ServerSearchTable,
		query: SearchQuery,
	): { field: string; query_vector: Float32Array; minimum: number } {
		const vector_query = query.vector!;
		// Validated here — not only where fusion reads it — so a bad weight is an
		// error on every query shape, vector-only included (DS-08).
		fusionWeights(vector_query.weight);
		const field = vector_query.field;
		const type = table.schema[field];
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
		// DoS clamp: reject a wrong-dimension query vector against the schema's
		// declared dimension BEFORE normalizing it or touching any stored vector —
		// a 1M-element value must cost O(1), not a normalize pass plus a stored
		// read. The message matches `dotProduct`'s exactly (goldens pin it), which
		// is truthful because write-time indexing normalizes against the same
		// declared schema.
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
		table: ServerSearchTable,
		query: SearchQuery,
		candidate_ids: ReadonlySet<string> | null,
	): Map<string, number> {
		if (!query.vector) return new Map();
		const { field, query_vector, minimum } = this.#validateVector(table, query);
		const scores = new Map<string, number>();
		// Pushdown: with a small enough `where`-admitted candidate set, read only
		// those documents' vectors (chunked `IN (...)`); otherwise stream the
		// whole field's vectors off the cursor, scoring row-at-a-time so the scan
		// never holds the corpus in memory. Membership and scores are identical
		// either way — the candidate check below still applies.
		const vectors: Iterable<[string, Float32Array]> =
			candidate_ids && candidate_ids.size <= VECTOR_PUSHDOWN_MAX_CANDIDATES
				? this.store.getVectors(table.entity_type, field, [...candidate_ids])
				: this.store.scanVectors(table.entity_type, field);
		for (const [doc_id, vector] of vectors) {
			if (candidate_ids && !candidate_ids.has(doc_id)) continue;
			const similarity = dotProduct(query_vector, vector);
			if (similarity >= minimum) scores.set(doc_id, similarity);
		}
		return scores;
	}

	/** Read documents back for a set of `String(primary key)` ids. */
	#hydrate(
		table: ServerSearchTable,
		doc_ids: readonly string[],
	): Map<string, ScoredDocument> {
		const documents = new Map<string, ScoredDocument>();
		const primary_key = quoteIdentifier(table.primary_key);
		for (const batch of chunk(doc_ids, MAX_IN_VALUES)) {
			if (batch.length === 0) continue;
			const keys = batch.map((doc_id) =>
				table.primary_key_type === 'number' ? Number(doc_id) : doc_id,
			);
			const rows = this.sql
				.exec(
					`SELECT * FROM ${quoteIdentifier(table.table_name)} WHERE ${primary_key} IN (${Array.from({ length: batch.length }, () => '?').join(', ')});`,
					...keys,
				)
				.toArray();
			for (const row of rows) {
				const document = rowToDocument(table, row);
				const key = document[table.primary_key] as string | number;
				documents.set(String(key), {
					doc_id: String(key),
					primary_key: key,
					document,
					score: 0,
				});
			}
		}
		return documents;
	}
}

/* -------------------------------------------------------------------------- */
/* Pipeline helpers (shared shape with `memory/engine.ts`)                    */
/* -------------------------------------------------------------------------- */

/** The compiler context for one table. */
export function whereContext(table: ServerSearchTable): SqlWhereContext {
	return {
		table_name: table.table_name,
		schema: table.schema,
		columns: table.columns,
		derived_fields: table.derived_fields,
		json_column: table.json_column,
		json_fields: table.json_fields,
		primary_key: table.primary_key,
		inexact_fields: table.inexact_fields,
		text_affinity_fields: table.text_affinity_fields,
		// The reserved auto-managed columns are declared NOT NULL in every entity
		// table `db.server.ts` creates (and a primary key can never be NULL).
		// `compileOrder` uses this to omit its `(col IS NULL)` nulls-last prefix,
		// which SQLite does not fold away and which forces a full scan + temp
		// b-tree instead of the `(updated_at, pk)` index on the default order.
		non_null_fields: new Set([table.primary_key, 'created_at', 'updated_at']),
	};
}

/**
 * Rebuild the indexed (sparse) document from a raw SQLite row.
 *
 * Top-level scalars come from their real columns (booleans are stored `0`/`1`
 * and are coerced back), everything else from the `json` overflow column, and
 * the reserved `$derived` sub-object is hoisted to the top level so FK-derived
 * fields read exactly like declared ones.
 */
export function rowToDocument(
	table: ServerSearchTable,
	row: Record<string, unknown>,
): ServerDocument {
	const json_column = table.json_column ?? 'json';
	let document: ServerDocument = {};
	const raw_json = row[json_column];
	if (typeof raw_json === 'string' && raw_json.length > 0) {
		const parsed: unknown = JSON.parse(raw_json);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			document = { ...(parsed as ServerDocument) };
		}
	}
	const derived = document.$derived;
	if (derived && typeof derived === 'object' && !Array.isArray(derived)) {
		Object.assign(document, derived);
	}
	delete document.$derived;
	for (const key of Object.keys(row)) {
		if (key === json_column) continue;
		if (key.startsWith('sv$')) continue;
		// The change-capture write marker (db.server.ts) — never entity data
		if (key === '_w') continue;
		const value = row[key];
		if (value === null || value === undefined) continue;
		if (table.json_fields?.has(key) && typeof value === 'string') {
			// A JSON column (objects, arrays, geopoints). A NULL one leaves the
			// overflow blob's value in place, for rows not yet moved over.
			try {
				document[key] = JSON.parse(value);
			} catch {
				// json_valid guards the column; nothing to recover here
			}
			continue;
		}
		document[key] = coerceColumnValue(table.schema[key], value);
	}
	return document;
}

/** Coerce a raw column value back into its declared JS type. */
function coerceColumnValue(type: SearchableType | undefined, value: unknown): unknown {
	if (type === 'boolean') return value !== 0 && value !== '0' && value !== false;
	if (type === 'number' && typeof value !== 'number') return Number(value);
	return value;
}
