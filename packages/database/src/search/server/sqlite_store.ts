/**
 * The server postings store: DO-SQLite rows for postings, the term dictionary,
 * per-document field lengths, per-field statistics, vectors, tombstones and
 * per-entity-type sync state.
 * See `plans/database/Native Search Engine Plan.md` §7.1–§7.3.
 *
 * **Transaction contract (important).** Nothing in this module opens a
 * transaction. Every write method assumes the caller is already inside
 * `ctx.storage.transactionSync()` — that is the entire point of the design:
 * postings are written in the *same* SQLite transaction as the entity row, so
 * rollback safety is free and there is no journal, snapshot or replay. Raw
 * `BEGIN` is blocked in DO SQLite anyway, so a store-local transaction is not
 * even expressible.
 *
 * **Determinism.** No `Date.now()`, no randomness. Timestamps come from the
 * caller (and are made strictly increasing against `search_state`), and every
 * list this module returns is explicitly sorted with `core/compare`, never left
 * in SQL result order.
 *
 * **Limits this module is shaped by** (verified against DO SQLite 3.47.0):
 * 100 bound parameters and 100KB per statement — hence the ≤20-row batched
 * inserts (5 columns each) and the chunked `IN` lists.
 */

import { DelightError } from '@delightstack/utilities';
import { compareStrings, type PrimaryKeyType } from '../core/compare';
import {
	characterSignature,
	codePointLength,
	ToleranceMatcher,
} from '../core/levenshtein';
import { countTokenFrequencies, tokenizeValue } from '../core/tokenizer';
import type { SearchableType } from '../core/types';
import { getFieldValue, type WhereSchema } from '../core/where';
import { normalizeVector } from './vector';

/* -------------------------------------------------------------------------- */
/* Storage interface                                                          */
/* -------------------------------------------------------------------------- */

/** The subset of Cloudflare's `SqlStorageCursor` this module needs. */
export interface SearchSqlCursor {
	toArray(): Record<string, unknown>[];
}

/**
 * The subset of Cloudflare's `SqlStorage` this module needs.
 *
 * A real `ctx.storage.sql` is assignable to this. Keeping the surface this
 * small is what lets the golden suite replay the driver over any real SQLite.
 */
export interface SearchSqlStorage {
	exec(query: string, ...bindings: unknown[]): SearchSqlCursor;
}

/** DO SQLite caps bound parameters per statement. */
export const MAX_SQL_PARAMS = 100;

/** Rows per batched posting INSERT — 6 columns each, so 96 of the 100 params. */
export const MAX_INSERT_ROWS = 16;

/** Columns per `search_postings` row, and therefore params per batched row. */
export const POSTING_COLUMNS = 6;

/** Values per chunked `IN (...)` list, leaving room for the fixed bindings. */
export const MAX_IN_VALUES = 90;

/** Past this many distinct tokens a dictionary is not cached (§7.3). */
export const MAX_CACHED_DICTIONARY_TOKENS = 200_000;

/** Tombstones retained per entity type before pruning (today's policy). */
export const TOMBSTONE_CAP = 10_000;

/* -------------------------------------------------------------------------- */
/* Type configuration                                                         */
/* -------------------------------------------------------------------------- */

/** What the store needs to know about one indexed entity type. */
export interface SearchTypeInput {
	entity_type: string;
	/** Flat map of dot-path → declared type. The closed set of legal paths. */
	schema: WhereSchema;
	/** The primary-key field @default 'id' */
	primary_key?: string;
	/** How primary keys compare in tie-breaks @default 'string' */
	primary_key_type?: PrimaryKeyType;
}

/** A prepared entity-type configuration (field lists resolved once). */
export interface SearchTypeConfig {
	entity_type: string;
	schema: WhereSchema;
	primary_key: string;
	primary_key_type: PrimaryKeyType;
	/** Searchable text fields, ascending — the deterministic accumulation order */
	text_fields: string[];
	/** Vector fields, ascending */
	vector_fields: string[];
}

/** Whether a declared type participates in full-text term matching. */
export function isTextFieldType(type: SearchableType): boolean {
	return type === 'string' || type === 'string[]';
}

/** Whether a declared type is a vector field. */
export function isVectorFieldType(type: SearchableType): boolean {
	return typeof type === 'string' && type.startsWith('vector[');
}

/** Resolve an entity type's field lists once, ascending. */
export function defineSearchType(input: SearchTypeInput): SearchTypeConfig {
	const fields = Object.keys(input.schema);
	return {
		entity_type: input.entity_type,
		schema: input.schema,
		primary_key: input.primary_key ?? 'id',
		primary_key_type: input.primary_key_type ?? 'string',
		text_fields: fields
			.filter((f) => isTextFieldType(input.schema[f]))
			.sort(compareStrings),
		vector_fields: fields
			.filter((f) => isVectorFieldType(input.schema[f]))
			.sort(compareStrings),
	};
}

/* -------------------------------------------------------------------------- */
/* Row shapes                                                                 */
/* -------------------------------------------------------------------------- */

/** Aggregate statistics for one field. */
export interface FieldStats {
	/** `N(field)` — documents containing the field */
	doc_count: number;
	/** Σ token counts, so `avgLen = total_len / doc_count` */
	total_len: number;
}

/** One entity type's sync state row. */
export interface SearchStateRow {
	config_version: number;
	first_updated_at: number;
	last_updated_at: number;
	/**
	 * The number of indexed documents (= entity table rows for a
	 * search-indexed type). Maintained on every index/remove/clear so readers
	 * (the sync ceiling) never pay a COUNT(*) — Cloudflare bills DO SQLite by
	 * rows scanned, and a count over the big tables this serves is exactly the
	 * cost it exists to avoid.
	 */
	doc_count: number;
}

/**
 * One field's cached term dictionary.
 *
 * `lengths[i]` is `tokens[i]`'s **code-point** length, carried alongside so a
 * tolerance scan can reject a candidate on length without touching the string
 * at all. That prefilter is exact — an insert or delete moves the length by
 * exactly one, so `|len(a) - len(b)| > tolerance` cannot be within tolerance —
 * and it is what keeps a fuzzy query off the Levenshtein DP for the ~100% of a
 * high-cardinality dictionary (primary keys, slugs) that is nowhere near the
 * query token's length.
 */
interface CachedDictionary {
	/** Tokens, ascending by code point. */
	tokens: string[];
	/** Code-point length of the token at the same index. */
	lengths: number[];
	/** Character signature of the token at the same index. */
	signatures: number[];
}

/** The tokenized projection of one document. */
export interface DocumentProjection {
	/** field → token → tf */
	postings: Map<string, Map<string, number>>;
	/** field → token count (present fields only, zero-length included) */
	lengths: Map<string, number>;
	/** field → unit-normalized vector */
	vectors: Map<string, Float32Array>;
}

/* -------------------------------------------------------------------------- */
/* DDL                                                                        */
/* -------------------------------------------------------------------------- */

/** The §7.1 DDL, verbatim. Idempotent. */
export const SEARCH_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS search_postings (
	entity_type TEXT NOT NULL,
	field       TEXT NOT NULL,
	token       TEXT NOT NULL,
	doc_id      TEXT NOT NULL,
	tf          INTEGER NOT NULL,
	len         INTEGER NOT NULL,
	PRIMARY KEY (entity_type, field, token, doc_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS search_postings_by_doc ON search_postings (entity_type, doc_id);
CREATE TABLE IF NOT EXISTS search_tokens (
	entity_type TEXT NOT NULL,
	field       TEXT NOT NULL,
	token       TEXT NOT NULL,
	df          INTEGER NOT NULL,
	PRIMARY KEY (entity_type, field, token)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS search_docs (
	entity_type TEXT NOT NULL,
	doc_id      TEXT NOT NULL,
	lengths     TEXT NOT NULL,
	PRIMARY KEY (entity_type, doc_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS search_field_stats (
	entity_type TEXT NOT NULL,
	field       TEXT NOT NULL,
	doc_count   INTEGER NOT NULL,
	total_len   INTEGER NOT NULL,
	PRIMARY KEY (entity_type, field)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS search_vectors (
	entity_type TEXT NOT NULL,
	field       TEXT NOT NULL,
	doc_id      TEXT NOT NULL,
	vec         BLOB NOT NULL,
	PRIMARY KEY (entity_type, field, doc_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS search_vectors_by_doc ON search_vectors (entity_type, doc_id);
CREATE TABLE IF NOT EXISTS search_tombstones (
	entity_type TEXT NOT NULL,
	doc_id      TEXT NOT NULL,
	deleted_at  INTEGER NOT NULL,
	PRIMARY KEY (entity_type, doc_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS search_tombstones_by_time ON search_tombstones (entity_type, deleted_at);
CREATE TABLE IF NOT EXISTS search_state (
	entity_type      TEXT NOT NULL,
	config_version   INTEGER NOT NULL,
	first_updated_at INTEGER NOT NULL,
	last_updated_at  INTEGER NOT NULL,
	doc_count        INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (entity_type)
) WITHOUT ROWID;
`;

/** Every table this module owns, in drop-safe order. */
export const SEARCH_TABLE_NAMES = [
	'search_postings',
	'search_tokens',
	'search_docs',
	'search_field_stats',
	'search_vectors',
	'search_tombstones',
	'search_state',
] as const;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Split a list into chunks of at most `size`. */
export function chunk<T>(values: readonly T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size));
	}
	return chunks;
}

/** `(?, ?, ?)` placeholder groups for a batched multi-row INSERT. */
function placeholderRows(rows: number, columns: number): string {
	const group = `(${Array.from({ length: columns }, () => '?').join(', ')})`;
	return Array.from({ length: rows }, () => group).join(', ');
}

/** `?, ?, ?` for an `IN (...)` list. */
function placeholderList(count: number): string {
	return Array.from({ length: count }, () => '?').join(', ');
}

/** A field name must be a plain dot-separated identifier path (like `sql_where.ts`). */
const SAFE_FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;

/** Reject a field name that could not have come from a declared schema. */
function assertFieldNameIsSafe(field: string): void {
	if (!SAFE_FIELD_NAME.test(field)) {
		throw DelightError.badRequest(
			`Field name "${field}" is not a valid identifier path.`,
			{ code: 'invalid_search_field' },
		);
	}
}

/**
 * The exclusive upper bound of a prefix range, for the >200k-token SQL
 * fallback (§7.3).
 *
 * The last code point is incremented, **skipping the surrogate block**:
 * `U+D7FF` increments to `U+E000`, never to a lone `U+D800` (which would be
 * mangled at the JS→UTF-8 boundary — and `U+D7FF` is a Hangul letter, so it is
 * reachable in real tokens). `U+10FFFF` has no successor, so the character is
 * dropped and the preceding one is incremented instead.
 *
 * Returns `undefined` when no bound exists (an empty prefix, or a prefix made
 * entirely of `U+10FFFF`) — the caller then omits the upper bound.
 *
 * Never build the bound by concatenating a blob sentinel: `TEXT || BLOB`
 * yields a BLOB in SQLite and all TEXT sorts before all BLOB, so that range is
 * silently empty.
 */
export function prefixUpperBound(prefix: string): string | undefined {
	const code_points = [...prefix];
	while (code_points.length > 0) {
		const last = code_points[code_points.length - 1].codePointAt(0) as number;
		if (last === 0x10ffff) {
			code_points.pop();
			continue;
		}
		const next = last === 0xd7ff ? 0xe000 : last + 1;
		return code_points.slice(0, -1).join('') + String.fromCodePoint(next);
	}
	return undefined;
}

/** Binary search for the first index whose token is `>= target`. */
function lowerBound(tokens: readonly string[], target: string): number {
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
function sortedInsert(dictionary: CachedDictionary, token: string): void {
	const index = lowerBound(dictionary.tokens, token);
	if (index < dictionary.tokens.length && dictionary.tokens[index] === token) return;
	dictionary.tokens.splice(index, 0, token);
	dictionary.lengths.splice(index, 0, codePointLength(token));
	dictionary.signatures.splice(index, 0, characterSignature(token));
}

/** Remove from a cached dictionary. No-op when absent. */
function sortedRemove(dictionary: CachedDictionary, token: string): void {
	const index = lowerBound(dictionary.tokens, token);
	if (index < dictionary.tokens.length && dictionary.tokens[index] === token) {
		dictionary.tokens.splice(index, 1);
		dictionary.lengths.splice(index, 1);
		dictionary.signatures.splice(index, 1);
	}
}

/** Coerce a SQLite BLOB (`ArrayBuffer` or `Uint8Array`) to a `Float32Array`. */
function blobToVector(value: unknown): Float32Array {
	if (value instanceof Float32Array) return value;
	if (value instanceof ArrayBuffer) return new Float32Array(value.slice(0));
	if (ArrayBuffer.isView(value)) {
		const view = value as ArrayBufferView;
		const copy = view.buffer.slice(
			view.byteOffset,
			view.byteOffset + view.byteLength,
		) as ArrayBuffer;
		return new Float32Array(copy);
	}
	throw new DelightError({
		message: 'A stored vector could not be read back as a Float32Array.',
		status: 500,
		code: 'invalid_vector',
	});
}

/** The bytes of a `Float32Array`, little-endian, as SQLite wants them. */
function vectorToBlob(vector: Float32Array): Uint8Array {
	return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength).slice();
}

/** Read a number off a raw SQLite row, defaulting when absent. */
function readNumber(value: unknown, fallback = 0): number {
	if (typeof value === 'number') return value;
	if (typeof value === 'bigint') return Number(value);
	return fallback;
}

/* -------------------------------------------------------------------------- */
/* The store                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The synchronous DO-SQLite postings store.
 *
 * One instance per Durable Object; the in-memory term-dictionary cache lives
 * on it and is rebuilt lazily after an eviction (no correctness impact).
 */
export class SqliteSearchStore {
	readonly sql: SearchSqlStorage;

	/** `entity_type` + NUL + `field` → cached dictionary, or `null` when oversized. */
	readonly #dictionaries = new Map<string, CachedDictionary | null>();

	constructor(sql: SearchSqlStorage) {
		this.sql = sql;
	}

	/* ---------------------------------------------------------------------- */
	/* Bootstrap                                                              */
	/* ---------------------------------------------------------------------- */

	/** Create every search table. Idempotent; safe on every DO boot. */
	bootstrap(): void {
		this.sql.exec(SEARCH_TABLE_DDL);
	}

	/**
	 * `doc_count ± delta` for one entity type, creating the state row if the
	 * write beat `ensureState` to it. A fresh row's window bounds are 0 —
	 * "no change recorded yet" — and `allocateTimestamp` fills them in.
	 */
	#bumpDocCount(entity_type: string, delta: number): void {
		this.sql.exec(
			`INSERT INTO search_state (entity_type, config_version, first_updated_at, last_updated_at, doc_count) VALUES (?, 1, 0, 0, MAX(0, ?)) ON CONFLICT (entity_type) DO UPDATE SET doc_count = MAX(0, doc_count + ?);`,
			entity_type,
			delta,
			delta,
		);
	}

	/** Drop the in-memory dictionary cache (used by tests and repair paths). */
	clearDictionaryCache(): void {
		this.#dictionaries.clear();
	}

	/* ---------------------------------------------------------------------- */
	/* Projection                                                             */
	/* ---------------------------------------------------------------------- */

	/**
	 * Tokenize a sparse document into postings, lengths and vectors.
	 *
	 * Mirrors the memory reference store exactly: a present field always
	 * contributes a length entry (an empty string is a zero-length field, not an
	 * absent one), and vectors are L2-normalized here so a zero vector is
	 * rejected before anything is written.
	 */
	projectDocument(
		config: SearchTypeConfig,
		sparse_doc: Record<string, unknown>,
	): DocumentProjection {
		const postings = new Map<string, Map<string, number>>();
		const lengths = new Map<string, number>();
		for (const field of config.text_fields) {
			const value = getFieldValue(sparse_doc, field);
			if (value === null || value === undefined) continue;
			const tokens = tokenizeValue(value);
			lengths.set(field, tokens.length);
			postings.set(field, countTokenFrequencies(tokens));
		}
		const vectors = new Map<string, Float32Array>();
		for (const field of config.vector_fields) {
			const value = getFieldValue(sparse_doc, field);
			if (value === null || value === undefined) continue;
			if (!Array.isArray(value) && !(value instanceof Float32Array)) {
				throw DelightError.badRequest(
					`Vector field "${field}" must be an array of numbers.`,
					{ code: 'invalid_vector' },
				);
			}
			vectors.set(field, normalizeVector(value as number[]));
		}
		return { postings, lengths, vectors };
	}

	/* ---------------------------------------------------------------------- */
	/* Write path (§7.2)                                                      */
	/* ---------------------------------------------------------------------- */

	/**
	 * Index (or re-index) one document. Runs inside the caller's transaction.
	 *
	 * `previous_sparse_doc` is the update branch's fast path: it lets the old
	 * token set be recomputed instead of read back. It is **verified** against
	 * the stored per-field lengths before it is trusted — if it disagrees (a
	 * stale or wrong previous document), the store silently falls back to the
	 * authoritative `DELETE ... RETURNING` path rather than corrupting `df` and
	 * the field statistics.
	 */
	indexDocument(
		config: SearchTypeConfig,
		doc_id: string,
		sparse_doc: Record<string, unknown>,
		previous_sparse_doc?: Record<string, unknown> | null,
	): void {
		const entity_type = config.entity_type;
		const next = this.projectDocument(config, sparse_doc);
		const stored_lengths = this.#readDocLengths(entity_type, doc_id);

		let old_postings: Map<string, Map<string, number>> | undefined;
		let old_lengths: Map<string, number> | undefined;
		let postings_already_deleted = false;

		if (stored_lengths) {
			if (previous_sparse_doc) {
				const previous = this.projectDocument(config, previous_sparse_doc);
				if (sameLengths(previous.lengths, stored_lengths)) {
					old_postings = previous.postings;
					old_lengths = previous.lengths;
				}
			}
			if (!old_postings) {
				// Fallback: the previous document is unavailable (or disagreed with
				// what is actually indexed). `RETURNING` hands back the token set for
				// the `df` decrements; the stored `lengths` row supplies the field-stat
				// decrements, which `field, token` alone cannot.
				old_postings = this.#deletePostingsReturning(entity_type, doc_id);
				old_lengths = stored_lengths;
				postings_already_deleted = true;
			}
		}

		this.#applyPostingDiff(
			entity_type,
			doc_id,
			old_postings,
			next.postings,
			postings_already_deleted,
			old_lengths,
			next.lengths,
		);
		this.#applyFieldStatDiff(entity_type, old_lengths, next.lengths);
		this.#writeDocLengths(entity_type, doc_id, next.lengths);
		this.#writeVectors(entity_type, doc_id, config.vector_fields, next.vectors);
		// `stored_lengths` doubles as the existence check: absent means this is a
		// brand-new document, not a re-index.
		if (!stored_lengths) this.#bumpDocCount(entity_type, 1);
		this.sql.exec(
			`DELETE FROM search_tombstones WHERE entity_type = ? AND doc_id = ?;`,
			entity_type,
			doc_id,
		);
	}

	/**
	 * Remove a document: postings, `df`, field statistics, lengths and vectors,
	 * plus a tombstone for the sync deletion feed.
	 *
	 * `deleted_at` is supplied by the caller (determinism rule §3 — the engine
	 * never reads a clock).
	 */
	removeDocument(config: SearchTypeConfig, doc_id: string, deleted_at: number): boolean {
		const entity_type = config.entity_type;
		const stored_lengths = this.#readDocLengths(entity_type, doc_id);
		if (stored_lengths) {
			const removed = this.#deletePostingsReturning(entity_type, doc_id);
			this.#applyPostingDiff(
				entity_type,
				doc_id,
				removed,
				new Map(),
				true,
				stored_lengths,
				new Map(),
			);
			this.#applyFieldStatDiff(entity_type, stored_lengths, new Map());
			this.sql.exec(
				`DELETE FROM search_docs WHERE entity_type = ? AND doc_id = ?;`,
				entity_type,
				doc_id,
			);
			this.#bumpDocCount(entity_type, -1);
		}
		this.sql.exec(
			`DELETE FROM search_vectors INDEXED BY search_vectors_by_doc WHERE entity_type = ? AND doc_id = ?;`,
			entity_type,
			doc_id,
		);
		this.writeTombstone(entity_type, doc_id, deleted_at);
		return stored_lengths !== undefined;
	}

	/** Wipe every search row for one entity type (state and tombstones survive). */
	clearEntityType(entity_type: string): void {
		for (const table of [
			'search_postings',
			'search_tokens',
			'search_docs',
			'search_field_stats',
			'search_vectors',
		]) {
			this.sql.exec(`DELETE FROM ${table} WHERE entity_type = ?;`, entity_type);
		}
		this.sql.exec(
			`UPDATE search_state SET doc_count = 0 WHERE entity_type = ?;`,
			entity_type,
		);
		for (const key of this.#dictionaries.keys()) {
			if (key.startsWith(`${entity_type}\u0000`)) this.#dictionaries.delete(key);
		}
	}

	/** The stored per-field token counts for a document, if it is indexed. */
	#readDocLengths(entity_type: string, doc_id: string): Map<string, number> | undefined {
		const rows = this.sql
			.exec(
				`SELECT lengths FROM search_docs WHERE entity_type = ? AND doc_id = ? LIMIT 1;`,
				entity_type,
				doc_id,
			)
			.toArray();
		if (rows.length === 0) return undefined;
		return parseLengths(rows[0].lengths);
	}

	/** Delete every posting for a document and return what was removed. */
	#deletePostingsReturning(
		entity_type: string,
		doc_id: string,
	): Map<string, Map<string, number>> {
		const rows = this.sql
			.exec(
				// `INDEXED BY` is not decoration: without it SQLite ignores
				// `search_postings_by_doc` and scans the whole entity type's slice of
				// the primary key (verified with EXPLAIN QUERY PLAN — a WITHOUT ROWID
				// table makes the planner distrust a secondary index, and there are no
				// ANALYZE statistics in a DO). That turned a per-document delete into a
				// 20ms whole-partition scan at 10k documents.
				`DELETE FROM search_postings INDEXED BY search_postings_by_doc WHERE entity_type = ? AND doc_id = ? RETURNING field, token, tf;`,
				entity_type,
				doc_id,
			)
			.toArray();
		const removed = new Map<string, Map<string, number>>();
		for (const row of rows) {
			const field = String(row.field);
			let tokens = removed.get(field);
			if (!tokens) {
				tokens = new Map();
				removed.set(field, tokens);
			}
			tokens.set(String(row.token), readNumber(row.tf));
		}
		return removed;
	}

	/**
	 * Apply the posting/`df` diff between the old and new token sets.
	 *
	 * `df` moves only for tokens that *appear* or *disappear* for this document
	 * — a changed `tf` is a posting update, never a `df` change.
	 *
	 * Each posting row also carries the document's token count for that field
	 * (`len`), denormalized off `search_docs` so the read path never has to join
	 * back for it (§7.1). That makes the field's length part of every row's
	 * payload, so when the length moves, *every* token of the field is rewritten
	 * — not only the ones whose `tf` changed.
	 */
	#applyPostingDiff(
		entity_type: string,
		doc_id: string,
		old_postings: Map<string, Map<string, number>> | undefined,
		new_postings: Map<string, Map<string, number>>,
		postings_already_deleted: boolean,
		old_lengths: Map<string, number> | undefined,
		new_lengths: Map<string, number>,
	): void {
		const fields = [
			...new Set([...(old_postings?.keys() ?? []), ...new_postings.keys()]),
		].sort(compareStrings);
		for (const field of fields) {
			const previous = old_postings?.get(field);
			const next = new_postings.get(field);
			const length = new_lengths.get(field) ?? 0;
			const length_changed = old_lengths?.get(field) !== length;
			const added: string[] = [];
			const removed: string[] = [];
			const inserts: [string, number][] = [];
			for (const [token, tf] of next ?? []) {
				if (!previous?.has(token)) added.push(token);
				if (postings_already_deleted || length_changed || previous?.get(token) !== tf) {
					inserts.push([token, tf]);
				}
			}
			for (const token of previous?.keys() ?? []) {
				if (!next?.has(token)) removed.push(token);
			}
			added.sort(compareStrings);
			removed.sort(compareStrings);
			inserts.sort((a, b) => compareStrings(a[0], b[0]));

			if (!postings_already_deleted && removed.length > 0) {
				for (const batch of chunk(removed, MAX_IN_VALUES)) {
					this.sql.exec(
						`DELETE FROM search_postings WHERE entity_type = ? AND field = ? AND doc_id = ? AND token IN (${placeholderList(batch.length)});`,
						entity_type,
						field,
						doc_id,
						...batch,
					);
				}
			}
			if (inserts.length > 0) {
				for (const batch of chunk(inserts, MAX_INSERT_ROWS)) {
					const bindings: unknown[] = [];
					for (const [token, tf] of batch) {
						bindings.push(entity_type, field, token, doc_id, tf, length);
					}
					this.sql.exec(
						`INSERT INTO search_postings (entity_type, field, token, doc_id, tf, len) VALUES ${placeholderRows(batch.length, POSTING_COLUMNS)} ON CONFLICT (entity_type, field, token, doc_id) DO UPDATE SET tf = excluded.tf, len = excluded.len;`,
						...bindings,
					);
				}
			}
			if (added.length > 0) this.#incrementDocFrequencies(entity_type, field, added);
			if (removed.length > 0) this.#decrementDocFrequencies(entity_type, field, removed);
		}
	}

	/** `df + 1` per token, creating the dictionary row when it is new. */
	#incrementDocFrequencies(entity_type: string, field: string, tokens: string[]): void {
		const dictionary = this.#dictionaries.get(dictionaryKey(entity_type, field));
		for (const batch of chunk(tokens, MAX_INSERT_ROWS)) {
			const bindings: unknown[] = [];
			for (const token of batch) bindings.push(entity_type, field, token);
			const rows = this.sql
				.exec(
					`INSERT INTO search_tokens (entity_type, field, token, df) VALUES ${Array.from({ length: batch.length }, () => '(?, ?, ?, 1)').join(', ')} ON CONFLICT (entity_type, field, token) DO UPDATE SET df = df + 1 RETURNING token, df;`,
					...bindings,
				)
				.toArray();
			if (!dictionary) continue;
			// `df === 1` after the upsert means the row did not exist before.
			for (const row of rows) {
				if (readNumber(row.df) === 1) sortedInsert(dictionary, String(row.token));
			}
		}
	}

	/** `df - 1` per token, dropping dictionary rows that reach zero. */
	#decrementDocFrequencies(entity_type: string, field: string, tokens: string[]): void {
		const dictionary = this.#dictionaries.get(dictionaryKey(entity_type, field));
		for (const batch of chunk(tokens, MAX_IN_VALUES)) {
			const rows = this.sql
				.exec(
					`UPDATE search_tokens SET df = df - 1 WHERE entity_type = ? AND field = ? AND token IN (${placeholderList(batch.length)}) RETURNING token, df;`,
					entity_type,
					field,
					...batch,
				)
				.toArray();
			const empty = rows
				.filter((row) => readNumber(row.df) <= 0)
				.map((row) => String(row.token));
			if (empty.length > 0) {
				this.sql.exec(
					`DELETE FROM search_tokens WHERE entity_type = ? AND field = ? AND token IN (${placeholderList(empty.length)});`,
					entity_type,
					field,
					...empty,
				);
				if (dictionary) for (const token of empty) sortedRemove(dictionary, token);
			}
		}
	}

	/** Apply the `N(field)` / `Σ len` deltas for one document's field set. */
	#applyFieldStatDiff(
		entity_type: string,
		old_lengths: Map<string, number> | undefined,
		new_lengths: Map<string, number>,
	): void {
		const deltas = new Map<string, FieldStats>();
		const bump = (field: string, doc_count: number, total_len: number): void => {
			const current = deltas.get(field) ?? { doc_count: 0, total_len: 0 };
			current.doc_count += doc_count;
			current.total_len += total_len;
			deltas.set(field, current);
		};
		for (const [field, length] of old_lengths ?? []) bump(field, -1, -length);
		for (const [field, length] of new_lengths) bump(field, 1, length);
		for (const field of [...deltas.keys()].sort(compareStrings)) {
			const delta = deltas.get(field) as FieldStats;
			if (delta.doc_count === 0 && delta.total_len === 0) continue;
			this.sql.exec(
				`INSERT INTO search_field_stats (entity_type, field, doc_count, total_len) VALUES (?, ?, ?, ?) ON CONFLICT (entity_type, field) DO UPDATE SET doc_count = doc_count + excluded.doc_count, total_len = total_len + excluded.total_len;`,
				entity_type,
				field,
				delta.doc_count,
				delta.total_len,
			);
		}
		this.sql.exec(
			`DELETE FROM search_field_stats WHERE entity_type = ? AND doc_count <= 0;`,
			entity_type,
		);
	}

	/** Replace the document's `lengths` row. */
	#writeDocLengths(
		entity_type: string,
		doc_id: string,
		lengths: Map<string, number>,
	): void {
		const serialized: Record<string, number> = {};
		for (const field of [...lengths.keys()].sort(compareStrings)) {
			serialized[field] = lengths.get(field) as number;
		}
		this.sql.exec(
			`INSERT INTO search_docs (entity_type, doc_id, lengths) VALUES (?, ?, ?) ON CONFLICT (entity_type, doc_id) DO UPDATE SET lengths = excluded.lengths;`,
			entity_type,
			doc_id,
			JSON.stringify(serialized),
		);
	}

	/** Replace the document's vector rows. */
	#writeVectors(
		entity_type: string,
		doc_id: string,
		vector_fields: readonly string[],
		vectors: Map<string, Float32Array>,
	): void {
		if (vector_fields.length === 0 && vectors.size === 0) return;
		this.sql.exec(
			`DELETE FROM search_vectors INDEXED BY search_vectors_by_doc WHERE entity_type = ? AND doc_id = ?;`,
			entity_type,
			doc_id,
		);
		for (const field of [...vectors.keys()].sort(compareStrings)) {
			this.sql.exec(
				`INSERT INTO search_vectors (entity_type, field, doc_id, vec) VALUES (?, ?, ?, ?);`,
				entity_type,
				field,
				doc_id,
				vectorToBlob(vectors.get(field) as Float32Array),
			);
		}
	}

	/* ---------------------------------------------------------------------- */
	/* Read path                                                              */
	/* ---------------------------------------------------------------------- */

	/** `N(field)` and `Σ len` for one field, zeroed when the field is unused. */
	getFieldStats(entity_type: string, field: string): FieldStats {
		const rows = this.sql
			.exec(
				`SELECT doc_count, total_len FROM search_field_stats WHERE entity_type = ? AND field = ? LIMIT 1;`,
				entity_type,
				field,
			)
			.toArray();
		if (rows.length === 0) return { doc_count: 0, total_len: 0 };
		return {
			doc_count: readNumber(rows[0].doc_count),
			total_len: readNumber(rows[0].total_len),
		};
	}

	/** Documents containing the token in the field (`df`). */
	getDocFrequency(entity_type: string, field: string, token: string): number {
		const rows = this.sql
			.exec(
				`SELECT df FROM search_tokens WHERE entity_type = ? AND field = ? AND token = ? LIMIT 1;`,
				entity_type,
				field,
				token,
			)
			.toArray();
		return rows.length === 0 ? 0 : readNumber(rows[0].df);
	}

	/**
	 * Postings for one `(field, token)` as `[doc_id, tf, len]`, ascending by
	 * doc id.
	 *
	 * `len` is the document's token count for this field, denormalized into the
	 * posting row (§7.1). Reading it here rather than joining `search_docs` is
	 * what keeps the term path's cost proportional to the *postings* a query
	 * touches instead of to the corpus: the previous shape had to pull one
	 * `json_extract(lengths, '$.field')` row per document — 12ms of a 30ms search
	 * at 10k documents, and linear in corpus size from there.
	 */
	getPostings(
		entity_type: string,
		field: string,
		token: string,
	): [string, number, number][] {
		const rows = this.sql
			.exec(
				`SELECT doc_id, tf, len FROM search_postings WHERE entity_type = ? AND field = ? AND token = ?;`,
				entity_type,
				field,
				token,
			)
			.toArray();
		const postings: [string, number, number][] = [];
		// Never trust SQL result order for anything user-visible (§3) — but do
		// *check* it. A posting list arrives in primary-key order, which is the
		// order `compareStrings` defines, so the sort is almost always a no-op and
		// one linear verification pass is cheaper than paying for it.
		let ordered = true;
		for (let index = 0; index < rows.length; index++) {
			const row = rows[index];
			const raw = row.doc_id;
			const doc_id = typeof raw === 'string' ? raw : String(raw);
			if (ordered && index > 0 && compareStrings(postings[index - 1][0], doc_id) > 0) {
				ordered = false;
			}
			postings.push([doc_id, readNumber(row.tf), readNumber(row.len)]);
		}
		if (!ordered) postings.sort((a, b) => compareStrings(a[0], b[0]));
		return postings;
	}

	/**
	 * `df` for a batch of tokens in one field, via chunked `IN (...)` lists.
	 *
	 * Tokens absent from the map have `df = 0`. One statement per ≤90 tokens
	 * instead of one per token — the batched form of {@link getDocFrequency}.
	 */
	getDocFrequencies(
		entity_type: string,
		field: string,
		tokens: readonly string[],
	): Map<string, number> {
		const frequencies = new Map<string, number>();
		for (const batch of chunk(tokens, MAX_IN_VALUES)) {
			if (batch.length === 0) continue;
			const rows = this.sql
				.exec(
					`SELECT token, df FROM search_tokens WHERE entity_type = ? AND field = ? AND token IN (${placeholderList(batch.length)});`,
					entity_type,
					field,
					...batch,
				)
				.toArray();
			for (const row of rows) frequencies.set(String(row.token), readNumber(row.df));
		}
		return frequencies;
	}

	/**
	 * Postings for a batch of tokens in one field, grouped by token.
	 *
	 * The batched form of {@link getPostings}: each token's posting list is
	 * `[doc_id, tf, len][]` ascending by doc id (verified, then sorted only when
	 * SQL returned them out of order — same policy as the singular read).
	 * Tokens with no postings are absent from the map.
	 */
	getPostingsForTokens(
		entity_type: string,
		field: string,
		tokens: readonly string[],
	): Map<string, [string, number, number][]> {
		const by_token = new Map<string, [string, number, number][]>();
		for (const batch of chunk(tokens, MAX_IN_VALUES)) {
			if (batch.length === 0) continue;
			const rows = this.sql
				.exec(
					`SELECT token, doc_id, tf, len FROM search_postings WHERE entity_type = ? AND field = ? AND token IN (${placeholderList(batch.length)});`,
					entity_type,
					field,
					...batch,
				)
				.toArray();
			for (const row of rows) {
				const token = String(row.token);
				const raw = row.doc_id;
				const doc_id = typeof raw === 'string' ? raw : String(raw);
				let postings = by_token.get(token);
				if (!postings) {
					postings = [];
					by_token.set(token, postings);
				}
				postings.push([doc_id, readNumber(row.tf), readNumber(row.len)]);
			}
		}
		for (const postings of by_token.values()) {
			let ordered = true;
			for (let index = 1; index < postings.length; index++) {
				if (compareStrings(postings[index - 1][0], postings[index][0]) > 0) {
					ordered = false;
					break;
				}
			}
			if (!ordered) postings.sort((a, b) => compareStrings(a[0], b[0]));
		}
		return by_token;
	}

	/** Per-field token counts for a batch of documents. */
	getDocLengths(
		entity_type: string,
		doc_ids: readonly string[],
	): Map<string, Map<string, number>> {
		const lengths = new Map<string, Map<string, number>>();
		for (const batch of chunk(doc_ids, MAX_IN_VALUES)) {
			if (batch.length === 0) continue;
			const rows = this.sql
				.exec(
					`SELECT doc_id, lengths FROM search_docs WHERE entity_type = ? AND doc_id IN (${placeholderList(batch.length)});`,
					entity_type,
					...batch,
				)
				.toArray();
			for (const row of rows) {
				lengths.set(String(row.doc_id), parseLengths(row.lengths));
			}
		}
		return lengths;
	}

	/**
	 * One field's token count per document, extracted in SQL.
	 *
	 * BM25 needs a single number per document per field, and `search_docs`
	 * stores a JSON map — so `json_extract` does the work in SQLite rather than
	 * making JS parse one object per document (which dominated the term path at
	 * 10k documents). Presence in the returned map means the document is
	 * indexed; a document with no content for the field maps to `0`.
	 *
	 * Pass `doc_ids` to restrict the read, or omit it to read the whole entity
	 * type in one statement (cheaper past a few hundred documents).
	 */
	getFieldLengths(
		entity_type: string,
		field: string,
		doc_ids?: readonly string[],
	): Map<string, number> {
		// The field name is interpolated into the statement text (a bound JSON
		// path would work too, but statement shapes are cached per text) — so it
		// must be a plain identifier path, same rule as `sql_where.ts`.
		assertFieldNameIsSafe(field);
		const path = `$."${field.replaceAll('"', '""')}"`;
		const lengths = new Map<string, number>();
		const collect = (rows: Record<string, unknown>[]): void => {
			for (const row of rows) lengths.set(String(row.doc_id), readNumber(row.len));
		};
		if (doc_ids === undefined) {
			collect(
				this.sql
					.exec(
						`SELECT doc_id, json_extract(lengths, '${path}') AS len FROM search_docs WHERE entity_type = ?;`,
						entity_type,
					)
					.toArray(),
			);
			return lengths;
		}
		for (const batch of chunk(doc_ids, MAX_IN_VALUES)) {
			if (batch.length === 0) continue;
			collect(
				this.sql
					.exec(
						`SELECT doc_id, json_extract(lengths, '${path}') AS len FROM search_docs WHERE entity_type = ? AND doc_id IN (${placeholderList(batch.length)});`,
						entity_type,
						...batch,
					)
					.toArray(),
			);
		}
		return lengths;
	}

	/**
	 * Stored vectors for a field, ascending by doc id.
	 *
	 * Pass `doc_ids` to read only those documents' vectors via chunked
	 * `IN (...)` lists (the candidate-pushdown path); omit it to scan the whole
	 * field. Membership in the result is identical either way for any doc id
	 * present in `doc_ids`.
	 */
	getVectors(
		entity_type: string,
		field: string,
		doc_ids?: readonly string[],
	): [string, Float32Array][] {
		const rows: Record<string, unknown>[] = [];
		if (doc_ids === undefined) {
			rows.push(
				...this.sql
					.exec(
						`SELECT doc_id, vec FROM search_vectors WHERE entity_type = ? AND field = ?;`,
						entity_type,
						field,
					)
					.toArray(),
			);
		} else {
			for (const batch of chunk(doc_ids, MAX_IN_VALUES)) {
				if (batch.length === 0) continue;
				rows.push(
					...this.sql
						.exec(
							`SELECT doc_id, vec FROM search_vectors WHERE entity_type = ? AND field = ? AND doc_id IN (${placeholderList(batch.length)});`,
							entity_type,
							field,
							...batch,
						)
						.toArray(),
				);
			}
		}
		const vectors: [string, Float32Array][] = rows.map((row) => [
			String(row.doc_id),
			blobToVector(row.vec),
		]);
		vectors.sort((a, b) => compareStrings(a[0], b[0]));
		return vectors;
	}

	/* ---------------------------------------------------------------------- */
	/* Term dictionary (§7.3)                                                 */
	/* ---------------------------------------------------------------------- */

	/**
	 * The field's sorted token dictionary, lazily loaded and then maintained
	 * incrementally on every write.
	 *
	 * Returns `null` when the dictionary exceeds
	 * `MAX_CACHED_DICTIONARY_TOKENS` — the caller then uses the SQL fallback.
	 */
	getDictionary(entity_type: string, field: string): string[] | null {
		return this.#cachedDictionary(entity_type, field)?.tokens ?? null;
	}

	/** {@link getDictionary}, with the parallel code-point lengths attached. */
	#cachedDictionary(entity_type: string, field: string): CachedDictionary | null {
		const key = dictionaryKey(entity_type, field);
		const cached = this.#dictionaries.get(key);
		if (cached !== undefined) return cached;
		const count = readNumber(
			this.sql
				.exec(
					`SELECT COUNT(*) AS count FROM search_tokens WHERE entity_type = ? AND field = ?;`,
					entity_type,
					field,
				)
				.toArray()[0]?.count,
		);
		if (count > MAX_CACHED_DICTIONARY_TOKENS) {
			this.#dictionaries.set(key, null);
			return null;
		}
		const tokens = this.sql
			.exec(
				`SELECT token FROM search_tokens WHERE entity_type = ? AND field = ?;`,
				entity_type,
				field,
			)
			.toArray()
			.map((row) => String(row.token));
		// Sorted in JS rather than trusting `ORDER BY`: the comparator is the
		// contract, and it must be the same one the client driver uses.
		tokens.sort(compareStrings);
		const dictionary: CachedDictionary = {
			tokens,
			lengths: tokens.map(codePointLength),
			signatures: tokens.map(characterSignature),
		};
		this.#dictionaries.set(key, dictionary);
		return dictionary;
	}

	/**
	 * Expand one query token into the index tokens it matches, ascending.
	 *
	 * `exact` is whole-token equality (and suppresses tolerance entirely);
	 * otherwise the candidate set is *prefix matches ∪ tolerance matches*,
	 * de-duplicated — exactly the memory reference's `expandToken`, including
	 * its output order, because BM25 accumulation order is part of the
	 * determinism contract.
	 */
	expandToken(
		entity_type: string,
		field: string,
		token: string,
		exact: boolean,
		tolerance: number,
	): string[] {
		const dictionary = this.getDictionary(entity_type, field);
		if (dictionary === null) {
			return this.#expandTokenViaSql(entity_type, field, token, exact, tolerance);
		}
		if (exact) {
			const index = lowerBound(dictionary, token);
			return index < dictionary.length && dictionary[index] === token ? [token] : [];
		}
		if (tolerance > 0) {
			// A tolerance scan has to see the whole dictionary anyway, so the prefix
			// range is not worth computing separately. One matcher for the whole
			// scan, and the cached code-point lengths in front of it: on a
			// high-cardinality field (primary keys, slugs) the length band rejects
			// effectively everything without touching a single character.
			const matcher = new ToleranceMatcher(token, tolerance);
			const query_length = matcher.query_length;
			const cached = this.#dictionaries.get(dictionaryKey(entity_type, field));
			// Normally the cache's own parallel arrays; recomputed only if something
			// handed back a dictionary the cache does not own (a test double, say).
			const owned =
				cached !== undefined && cached !== null && cached.tokens === dictionary;
			const lengths = owned
				? (cached as CachedDictionary).lengths
				: dictionary.map(codePointLength);
			const signatures = owned
				? (cached as CachedDictionary).signatures
				: dictionary.map(characterSignature);
			const matches: string[] = [];
			// `startsWith` is a call V8 will not inline, and this loop runs once per
			// dictionary token — so the first code unit is checked inline first, and
			// only a candidate that can possibly be a prefix match pays for it.
			const first_unit = token.length > 0 ? token.charCodeAt(0) : -1;
			for (let index = 0; index < dictionary.length; index++) {
				const candidate = dictionary[index];
				if (
					(first_unit < 0 || candidate.charCodeAt(0) === first_unit) &&
					candidate.startsWith(token)
				) {
					matches.push(candidate);
					continue;
				}
				// Both prefilters run off the precomputed arrays, so the Levenshtein
				// DP — and even reading the candidate's characters — is reached only
				// by the handful of tokens that could actually be within tolerance.
				const delta = lengths[index] - query_length;
				if (delta > tolerance || -delta > tolerance) continue;
				if (!matcher.signatureAccepts(signatures[index])) continue;
				if (matcher.matches(candidate)) matches.push(candidate);
			}
			return matches;
		}
		const matches: string[] = [];
		for (let index = lowerBound(dictionary, token); index < dictionary.length; index++) {
			if (!dictionary[index].startsWith(token)) break;
			matches.push(dictionary[index]);
		}
		return matches;
	}

	/** The >200k-token fallback: range queries instead of an in-memory array. */
	#expandTokenViaSql(
		entity_type: string,
		field: string,
		token: string,
		exact: boolean,
		tolerance: number,
	): string[] {
		if (exact) {
			const rows = this.sql
				.exec(
					`SELECT token FROM search_tokens WHERE entity_type = ? AND field = ? AND token = ? LIMIT 1;`,
					entity_type,
					field,
					token,
				)
				.toArray();
			return rows.map((row) => String(row.token));
		}
		if (tolerance > 0) {
			const rows = this.sql
				.exec(
					`SELECT token FROM search_tokens WHERE entity_type = ? AND field = ?;`,
					entity_type,
					field,
				)
				.toArray()
				.map((row) => String(row.token));
			rows.sort(compareStrings);
			const matcher = new ToleranceMatcher(token, tolerance);
			return rows.filter(
				(candidate) => candidate.startsWith(token) || matcher.matches(candidate),
			);
		}
		const upper = prefixUpperBound(token);
		const rows = (
			upper === undefined
				? this.sql.exec(
						`SELECT token FROM search_tokens WHERE entity_type = ? AND field = ? AND token >= ?;`,
						entity_type,
						field,
						token,
					)
				: this.sql.exec(
						`SELECT token FROM search_tokens WHERE entity_type = ? AND field = ? AND token >= ? AND token < ?;`,
						entity_type,
						field,
						token,
						upper,
					)
		)
			.toArray()
			.map((row) => String(row.token));
		rows.sort(compareStrings);
		// The range is a superset only in pathological cases; filter anyway so the
		// SQL fallback and the cached path can never disagree.
		return rows.filter((candidate) => candidate.startsWith(token));
	}

	/* ---------------------------------------------------------------------- */
	/* State + tombstones (§7.1)                                              */
	/* ---------------------------------------------------------------------- */

	/** The entity type's sync state, if it has one. */
	getState(entity_type: string): SearchStateRow | undefined {
		const rows = this.sql
			.exec(
				`SELECT config_version, first_updated_at, last_updated_at, doc_count FROM search_state WHERE entity_type = ? LIMIT 1;`,
				entity_type,
			)
			.toArray();
		if (rows.length === 0) return undefined;
		return {
			config_version: readNumber(rows[0].config_version),
			first_updated_at: readNumber(rows[0].first_updated_at),
			last_updated_at: readNumber(rows[0].last_updated_at),
			doc_count: readNumber(rows[0].doc_count),
		};
	}

	/** Create the state row if it is missing, seeding both window bounds. */
	ensureState(entity_type: string, now: number): SearchStateRow {
		const existing = this.getState(entity_type);
		if (existing) return existing;
		const state: SearchStateRow = {
			config_version: 1,
			first_updated_at: now,
			last_updated_at: now,
			doc_count: 0,
		};
		this.sql.exec(
			`INSERT INTO search_state (entity_type, config_version, first_updated_at, last_updated_at, doc_count) VALUES (?, ?, ?, ?, 0) ON CONFLICT (entity_type) DO NOTHING;`,
			entity_type,
			state.config_version,
			state.first_updated_at,
			state.last_updated_at,
		);
		return this.getState(entity_type) ?? state;
	}

	/**
	 * Allocate a strictly-increasing write timestamp.
	 *
	 * The clock is the caller's (`proposed`) — the engine never reads one. The
	 * result is `max(proposed, last_updated_at + 1)`, persisted in the same
	 * transaction, which is exactly today's `ensureMonotonicTimestamp`.
	 */
	allocateTimestamp(entity_type: string, proposed: number): number {
		const existing = this.getState(entity_type);
		if (!existing) {
			// The very first write of an entity type keeps the caller's clock: the
			// window's lower bound is that timestamp, not one past it.
			this.ensureState(entity_type, proposed);
			return proposed;
		}
		const allocated = Math.max(proposed, existing.last_updated_at + 1);
		// `first_updated_at = 0` means "no change has ever been recorded" (a state
		// row created by a rebuild of an empty table, or migrated from an index
		// that had never been written). Taking MIN against it would pin the lower
		// window bound at 0 forever, and a descending-backfilling client reads that
		// as "you have reached the beginning" after its very first page.
		this.sql.exec(
			`UPDATE search_state SET last_updated_at = ?, first_updated_at = CASE WHEN first_updated_at = 0 THEN ? ELSE MIN(first_updated_at, ?) END WHERE entity_type = ?;`,
			allocated,
			allocated,
			allocated,
			entity_type,
		);
		return allocated;
	}

	/** Bump `config_version` — the signal that forces affected clients to resync. */
	bumpConfigVersion(entity_type: string): number {
		this.ensureState(entity_type, 0);
		const rows = this.sql
			.exec(
				`UPDATE search_state SET config_version = config_version + 1 WHERE entity_type = ? RETURNING config_version;`,
				entity_type,
			)
			.toArray();
		return readNumber(rows[0]?.config_version, 1);
	}

	/** Record a deletion in the sync deletion feed. */
	writeTombstone(entity_type: string, doc_id: string, deleted_at: number): void {
		this.sql.exec(
			`INSERT INTO search_tombstones (entity_type, doc_id, deleted_at) VALUES (?, ?, ?) ON CONFLICT (entity_type, doc_id) DO UPDATE SET deleted_at = excluded.deleted_at;`,
			entity_type,
			doc_id,
			deleted_at,
		);
	}

	/** How many tombstones an entity type currently holds. */
	countTombstones(entity_type: string): number {
		return readNumber(
			this.sql
				.exec(
					`SELECT COUNT(*) AS count FROM search_tombstones WHERE entity_type = ?;`,
					entity_type,
				)
				.toArray()[0]?.count,
		);
	}

	/**
	 * Today's retention policy, verbatim: past `TOMBSTONE_CAP` tombstones for a
	 * type, delete the oldest half by `deleted_at` and bump `config_version`, so
	 * clients that might have missed a deletion full-resync.
	 *
	 * @returns whether pruning happened (and therefore whether the version moved)
	 */
	pruneTombstones(entity_type: string): boolean {
		const count = this.countTombstones(entity_type);
		if (count <= TOMBSTONE_CAP) return false;
		const remove = Math.floor(count / 2);
		this.sql.exec(
			`DELETE FROM search_tombstones WHERE entity_type = ? AND doc_id IN (SELECT doc_id FROM search_tombstones WHERE entity_type = ? ORDER BY deleted_at ASC, doc_id ASC LIMIT ?);`,
			entity_type,
			entity_type,
			remove,
		);
		this.bumpConfigVersion(entity_type);
		return true;
	}
}

/* -------------------------------------------------------------------------- */
/* Module-local helpers                                                       */
/* -------------------------------------------------------------------------- */

/** The dictionary cache key. `\0` can never appear in an identifier. */
function dictionaryKey(entity_type: string, field: string): string {
	return `${entity_type}\u0000${field}`;
}

/** Parse a `search_docs.lengths` JSON blob. */
function parseLengths(value: unknown): Map<string, number> {
	const lengths = new Map<string, number>();
	if (typeof value !== 'string') return lengths;
	const parsed = JSON.parse(value) as Record<string, unknown>;
	for (const field of Object.keys(parsed)) {
		lengths.set(field, readNumber(parsed[field]));
	}
	return lengths;
}

/** Whether two per-field length maps agree exactly. */
function sameLengths(a: Map<string, number>, b: Map<string, number>): boolean {
	if (a.size !== b.size) return false;
	for (const [field, length] of a) if (b.get(field) !== length) return false;
	return true;
}
