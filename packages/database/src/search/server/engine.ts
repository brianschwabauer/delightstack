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
import { bm25Score } from '../core/bm25';
import { compareForOrder, comparePrimaryKeys, compareStrings } from '../core/compare';
import { computeFacets } from '../core/facets';
import { TokenHits } from '../core/token_hits';
import { tokenize } from '../core/tokenizer';
import type {
	FacetDefinition,
	SearchQuery,
	SearchQueryResults,
	SearchableType,
} from '../core/types';
import {
	evaluateWhere,
	getFieldValue,
	normalizeWhere,
	type NormalizedWhere,
} from '../core/where';
import { fuseScores } from './fusion';
import {
	compileOrder,
	compileWhere,
	quoteIdentifier,
	type CompiledSql,
	type SqlWhereContext,
} from './sql_where';
import {
	chunk,
	defineSearchType,
	isTextFieldType,
	isVectorFieldType,
	MAX_IN_VALUES,
	SqliteSearchStore,
	type SearchSqlStorage,
	type SearchTypeConfig,
	type SearchTypeInput,
} from './sqlite_store';
import { DEFAULT_SIMILARITY, dotProduct, normalizeVector } from './vector';

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
		inexact_fields: input.inexact_fields ? new Set(input.inexact_fields) : undefined,
		text_affinity_fields: input.text_affinity_fields
			? new Set(input.text_affinity_fields)
			: undefined,
	};
}

/** An indexed document as returned in hits. */
export type ServerDocument = Record<string, unknown>;

/** A document plus the score it earned. */
interface ScoredDocument {
	doc_id: string;
	primary_key: string | number;
	document: ServerDocument;
	score: number;
}

/** The scored matched set, before any document is read back. */
interface ScoredIds {
	/** Matched `String(primary key)` ids, ascending by code point. */
	ids: string[];
	/** id → final score. */
	scores: Map<string, number>;
	/** Documents an inexact `where` already had to read, or `null`. */
	documents: Map<string, ScoredDocument> | null;
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

	/** Index one document. Must run inside the caller's transaction. */
	indexDocument(
		entity_type: string,
		doc_id: string,
		sparse_doc: ServerDocument,
		previous_sparse_doc?: ServerDocument | null,
	): void {
		this.store.indexDocument(
			this.getTable(entity_type),
			doc_id,
			sparse_doc,
			previous_sparse_doc,
		);
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
		validateDistinctOn(table, query);

		const where_node = normalizeWhere(
			query.where as Record<string, unknown> | undefined,
			table.schema,
		);
		const ctx = whereContext(table);
		const compiled = compileWhere(where_node, ctx);

		const term_tokens = typeof query.term === 'string' ? tokenize(query.term) : [];
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
		if (has_term || has_vector) {
			const scored = this.#scoreDocuments(
				table,
				query,
				where_node,
				compiled,
				search_fields,
				distinct_tokens,
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
			if (deferrable) return this.#pageByScore(table, query, scored, started);
			results = this.#materialize(table, scored);
		} else {
			results = this.#fetchMatched(table, where_node, compiled).map((entry) => ({
				...entry,
				score: 0,
			}));
		}

		applyOrder(table, results, query, has_term || has_vector);
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
	): ScoredIds {
		const { ids: candidate_ids, documents } = this.#candidateIds(
			table,
			where_node,
			compiled,
		);
		const has_term = distinct_tokens.length > 0;
		const text_scores = new Map<string, number>();
		const token_hits = new TokenHits(distinct_tokens.length);
		if (has_term) {
			this.#accumulateText(
				table,
				query,
				search_fields,
				distinct_tokens,
				candidate_ids,
				text_scores,
				token_hits,
			);
		}
		const text_ids = has_term
			? applyThreshold(
					table,
					text_scores,
					token_hits,
					distinct_tokens.length,
					query.threshold,
				)
			: undefined;
		const vector_scores = query.vector
			? this.#scoreVectors(table, query, candidate_ids)
			: undefined;

		let final_scores: Map<string, number>;
		if (text_ids && vector_scores) {
			const text_subset = new Map<string, number>();
			for (const id of text_ids) text_subset.set(id, text_scores.get(id) ?? 0);
			final_scores = fuseScores(text_subset, vector_scores);
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
		return { ids: [...final_scores.keys()], scores: final_scores, documents };
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
	 * **The one condition.** `#materialize` drops a matched id whose entity row
	 * cannot be read back, which also removes it from `count`; this path can only
	 * see that for ids it actually reads, so the two agree exactly when the
	 * search index and the entity table agree. That is a write-path invariant,
	 * not a hope: `indexDocument` and `removeDocument` run in the *same* SQLite
	 * transaction as the entity row (§7.2), so postings for a row that does not
	 * exist are not a reachable state — and the memory reference engine, which is
	 * the specification, has no notion of the two disagreeing at all. When one
	 * does show up anyway, this path drops it from the page and from `count` (by
	 * pulling the next entry forward) instead of silently returning a hit with no
	 * document.
	 */
	#pageByScore(
		table: ServerSearchTable,
		query: SearchQuery,
		scored: ScoredIds,
		started: number,
	): SearchQueryResults<ServerDocument> {
		const entries: { doc_id: string; score: number }[] = [];
		for (const id of scored.ids) {
			entries.push({ doc_id: id, score: scored.scores.get(id) as number });
		}
		entries.sort((a, b) => {
			if (a.score !== b.score) return a.score > b.score ? -1 : 1;
			return comparePrimaryKeys(a.doc_id, b.doc_id, table.primary_key_type);
		});
		const offset = query.offset ?? 0;
		const limit = query.limit ?? entries.length;
		const wanted = offset + Math.max(0, limit);
		const hits: SearchQueryResults<ServerDocument>['hits'] = [];
		let cursor = 0;
		let missing = 0;
		// Widen the window only when a document really is unreadable, so the
		// invariant's cost is one hydration of exactly the page.
		while (cursor < entries.length && hits.length + missing < wanted) {
			const window = entries.slice(cursor, wanted + missing);
			cursor += window.length;
			const hydrated =
				scored.documents ??
				this.#hydrate(
					table,
					window.map((entry) => entry.doc_id),
				);
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
	): void {
		const entity_type = table.entity_type;
		const boosts = query.boost as Record<string, number> | undefined;
		const exact = query.exact === true;
		const tolerance = exact ? 0 : (query.tolerance ?? 0);
		for (const field of search_fields) {
			const stats = this.store.getFieldStats(entity_type, field);
			if (stats.doc_count === 0) continue;
			const average_field_length = stats.total_len / stats.doc_count;
			const boost = boosts?.[field] ?? 1;
			for (
				let token_index = 0;
				token_index < distinct_tokens.length;
				token_index++
			) {
				const token = distinct_tokens[token_index];
				const candidates = this.store.expandToken(
					entity_type,
					field,
					token,
					exact,
					tolerance,
				);
				for (const candidate of candidates) {
					const doc_frequency = this.store.getDocFrequency(entity_type, field, candidate);
					// `field_length` rides along on the posting row (§7.1), so nothing
					// here is proportional to the corpus — only to the postings the
					// query actually touches.
					for (const [doc_id, tf, field_length] of this.store.getPostings(
						entity_type,
						field,
						candidate,
					)) {
						if (candidate_ids && !candidate_ids.has(doc_id)) continue;
						const score = bm25Score({
							tf,
							field_length,
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
		table: ServerSearchTable,
		query: SearchQuery,
		candidate_ids: ReadonlySet<string> | null,
	): Map<string, number> {
		const vector_query = query.vector;
		if (!vector_query) return new Map();
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
		const query_vector = normalizeVector(vector_query.value);
		const minimum = vector_query.similarity ?? DEFAULT_SIMILARITY;
		const scores = new Map<string, number>();
		for (const [doc_id, vector] of this.store.getVectors(table.entity_type, field)) {
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
		primary_key: table.primary_key,
		inexact_fields: table.inexact_fields,
		text_affinity_fields: table.text_affinity_fields,
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
		const value = row[key];
		if (value === null || value === undefined) continue;
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

/** `elapsed`, from a caller-supplied clock only (§3 determinism rules). */
function elapsedSince(
	started: number,
	now: (() => number) | undefined,
): { raw: number; formatted: string } {
	const raw = now ? now() - started : 0;
	return { raw, formatted: `${raw}ms` };
}

/** Resolve and validate `fields` into the searched text fields, ascending. */
function resolveSearchFields(table: ServerSearchTable, query: SearchQuery): string[] {
	const fields = query.fields;
	if (!fields || fields === '*') return table.text_fields;
	if (!Array.isArray(fields)) {
		throw DelightError.badRequest('`fields` must be `"*"` or an array of field names.', {
			code: 'invalid_search_field',
		});
	}
	const resolved: string[] = [];
	for (const field of fields) {
		const type = table.schema[field];
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
function validateOrder(table: ServerSearchTable, query: SearchQuery): void {
	for (const instruction of query.order ?? []) {
		const field = instruction.field;
		if (field !== table.primary_key && table.schema[field] === undefined) {
			throw DelightError.badRequest(`Unknown order field "${field}".`, {
				code: 'unknown_order_field',
			});
		}
	}
}

/** `distinct_on` must name a declared field or the primary key. */
function validateDistinctOn(table: ServerSearchTable, query: SearchQuery): void {
	const field = query.distinct_on;
	if (field === undefined) return;
	if (field !== table.primary_key && table.schema[field] === undefined) {
		throw DelightError.badRequest(`Unknown distinct_on field "${field}".`, {
			code: 'unknown_distinct_field',
		});
	}
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
	table: ServerSearchTable,
	text_scores: ReadonlyMap<string, number>,
	token_hits: TokenHits,
	token_count: number,
	threshold: number | undefined,
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
		return comparePrimaryKeys(a, b, table.primary_key_type);
	});
	const keep = Math.ceil(remainder.length * value);
	const result = new Set(all_match);
	for (const id of remainder.slice(0, keep)) result.add(id);
	return result;
}

/**
 * Order results: by `order[]` when given, else by score descending when the
 * query scored anything, else by primary key ascending. Every path ends with a
 * primary-key ascending tie-break.
 */
function applyOrder(
	table: ServerSearchTable,
	results: ScoredDocument[],
	query: SearchQuery,
	is_scored: boolean,
): void {
	const order = query.order ?? [];
	results.sort((a, b) => {
		for (const instruction of order) {
			const comparison = compareForOrder(
				getFieldValue(a.document, instruction.field),
				getFieldValue(b.document, instruction.field),
				instruction.direction ?? 'ASC',
			);
			if (comparison !== 0) return comparison;
		}
		if (order.length === 0 && is_scored && a.score !== b.score) {
			return a.score > b.score ? -1 : 1;
		}
		return comparePrimaryKeys(a.primary_key, b.primary_key, table.primary_key_type);
	});
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
		const value = getFieldValue(entry.document, field);
		// Type-prefixed so `1` and `'1'` never collapse into one group.
		const key =
			value === null || value === undefined ? 'null' : `${typeof value}:${String(value)}`;
		if (seen.has(key)) continue;
		seen.add(key);
		kept.push(entry);
	}
	return kept;
}
