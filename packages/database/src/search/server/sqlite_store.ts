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
import { quantizeLength } from '../core/bm25.js';
import { compareStrings, type PrimaryKeyType } from '../core/compare.js';
import {
	buildCachedDictionary,
	expandCachedDictionary,
	sameLengths,
	sortedInsert,
	sortedRemove,
	type CachedDictionary,
} from '../core/dictionary.js';
import { ToleranceMatcher } from '../core/levenshtein.js';
import { resolveTextFields, resolveVectorFields } from '../core/schema_fields.js';
import { countTokenFrequencies, fieldTokenLimit, tokenizeField } from '../core/tokenizer.js';
import type { SearchFieldOptions } from '../core/types.js';
import { getFieldValue, type WhereSchema } from '../core/where.js';
import { normalizeVector } from './vector.js';

/* -------------------------------------------------------------------------- */
/* Storage interface                                                          */
/* -------------------------------------------------------------------------- */

/** The subset of Cloudflare's `SqlStorageCursor` this module needs. */
export interface SearchSqlCursor {
	toArray(): Record<string, unknown>[];
	// A real cursor is single-pass: consume it via toArray() OR iteration, never
	// both. Iteration is what lets the full-field vector scan stay O(1) in rows.
	[Symbol.iterator](): IterableIterator<Record<string, unknown>>;
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

/** Rows per batched posting INSERT — 5 columns each, so 95 of the 100 params. */
export const MAX_INSERT_ROWS = 19;

/** Columns per `search_entries` row, and therefore params per batched row. */
export const POSTING_COLUMNS = 5;

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
	/** Per-field `.searchable({ weight, max_tokens })` options. */
	field_options?: Record<string, SearchFieldOptions>;
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
	/** Per-field schema options. */
	field_options: Record<string, SearchFieldOptions>;
}

/** Resolve an entity type's field lists once, ascending. */
export function defineSearchType(input: SearchTypeInput): SearchTypeConfig {
	return {
		entity_type: input.entity_type,
		schema: input.schema,
		primary_key: input.primary_key ?? 'id',
		primary_key_type: input.primary_key_type ?? 'string',
		text_fields: resolveTextFields(input.schema),
		vector_fields: resolveVectorFields(input.schema),
		field_options: input.field_options ?? {},
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

/**
 * The index tables. Idempotent.
 *
 * The layout is built around what a Durable Object bills and stores:
 *
 * - `search_entries` is the inverted index, one row per (field, word,
 *   document), one B-tree and no secondary index. The previous layout
 *   repeated the entity type, the field name and the 20-character document id
 *   in every posting, and again in a by-document index: several times the
 *   size, and two billed rows per posting instead of one.
 * - `search_terms` is the dictionary with each word's document frequency.
 *   A new word is one row.
 * - `search_documents` maps a document's string id to a small integer and
 *   holds its words (`{ field: { word: tf } }`) and field lengths: what an
 *   update diffs against and a delete removes, in one row, instead of a
 *   by-document index over the entries.
 * - `search_fields` gives each (entity type, field) an integer id and holds
 *   the field's statistics (`N(field)`, `Σ len`).
 *
 * `search_entries.len` is the field length rounded by `quantizeLength`, so a
 * posting is rewritten only when its document's field length crosses a step.
 */
export const SEARCH_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS search_fields (
	fid         INTEGER PRIMARY KEY,
	entity_type TEXT NOT NULL,
	field       TEXT NOT NULL,
	doc_count   INTEGER NOT NULL DEFAULT 0,
	total_len   INTEGER NOT NULL DEFAULT 0,
	UNIQUE (entity_type, field)
);
CREATE TABLE IF NOT EXISTS search_terms (
	fid   INTEGER NOT NULL,
	token TEXT NOT NULL,
	df    INTEGER NOT NULL,
	PRIMARY KEY (fid, token)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS search_entries (
	fid   INTEGER NOT NULL,
	token TEXT NOT NULL,
	doc   INTEGER NOT NULL,
	tf    INTEGER NOT NULL,
	len   INTEGER NOT NULL,
	PRIMARY KEY (fid, token, doc)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS search_documents (
	doc         INTEGER PRIMARY KEY,
	entity_type TEXT NOT NULL,
	doc_id      TEXT NOT NULL,
	lengths     TEXT NOT NULL,
	terms       TEXT NOT NULL,
	UNIQUE (entity_type, doc_id)
);
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

/**
 * The previous layout's tables, dropped on bootstrap. Every entity type's
 * search signature carries the index format, so each one rebuilds into the
 * new tables on the same wake (sliced, like any rebuild).
 */
export const LEGACY_SEARCH_TABLES = [
	'search_postings',
	'search_tokens',
	'search_docs',
	'search_field_stats',
] as const;

/** The index format version, part of every entity type's search signature. */
export const SEARCH_INDEX_FORMAT = 3;

/** Every table this module owns, in drop-safe order. */
export const SEARCH_TABLE_NAMES = [
	'search_entries',
	'search_terms',
	'search_documents',
	'search_fields',
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

/** Same fields, same tokens, same term frequencies. */
function samePostings(
	a: Map<string, Map<string, number>>,
	b: Map<string, Map<string, number>>,
): boolean {
	if (a.size !== b.size) return false;
	for (const [field, tokens] of a) {
		const other = b.get(field);
		if (!other || other.size !== tokens.size) return false;
		for (const [token, tf] of tokens) if (other.get(token) !== tf) return false;
	}
	return true;
}

/** Same vector fields with element-wise identical (normalized) values. */
function sameVectors(a: Map<string, Float32Array>, b: Map<string, Float32Array>): boolean {
	if (a.size !== b.size) return false;
	for (const [field, vector] of a) {
		const other = b.get(field);
		if (!other || other.length !== vector.length) return false;
		for (let i = 0; i < vector.length; i++) if (other[i] !== vector[i]) return false;
	}
	return true;
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

/** A document's stored words, `field → word → tf`, as JSON. */
export function encodeTerms(terms: ReadonlyMap<string, ReadonlyMap<string, number>>): string {
	const serialized: Record<string, Record<string, number>> = {};
	for (const field of [...terms.keys()].sort(compareStrings)) {
		const words = terms.get(field) as ReadonlyMap<string, number>;
		const entry: Record<string, number> = {};
		for (const token of [...words.keys()].sort(compareStrings)) {
			entry[token] = words.get(token) as number;
		}
		serialized[field] = entry;
	}
	return JSON.stringify(serialized);
}

/** Read {@link encodeTerms} back. */
export function decodeTerms(value: unknown): Map<string, Map<string, number>> {
	const terms = new Map<string, Map<string, number>>();
	if (typeof value !== 'string' || !value) return terms;
	const parsed = JSON.parse(value) as Record<string, Record<string, unknown>>;
	for (const field of Object.keys(parsed)) {
		const words = new Map<string, number>();
		for (const token of Object.keys(parsed[field] ?? {})) {
			words.set(token, readNumber(parsed[field][token]));
		}
		terms.set(field, words);
	}
	return terms;
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
	/** `entity_type` + NUL + `field` → its `search_fields.fid`. */
	readonly #field_ids = new Map<string, number>();

	constructor(sql: SearchSqlStorage) {
		this.sql = sql;
	}

	/* ---------------------------------------------------------------------- */
	/* Bootstrap                                                              */
	/* ---------------------------------------------------------------------- */

	/** Create every search table. Idempotent; safe on every DO boot. */
	bootstrap(): void {
		const legacy = this.sql
			.exec(
				`SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN (${placeholderList(LEGACY_SEARCH_TABLES.length)});`,
				...LEGACY_SEARCH_TABLES,
			)
			.toArray()
			.map((row) => String(row.name));
		for (const table of legacy) this.sql.exec(`DROP TABLE IF EXISTS ${table};`);
		this.sql.exec(SEARCH_TABLE_DDL);
	}

	/**
	 * The integer id of an (entity type, field), created on first use when
	 * `create` is set. Cached for the instance's life.
	 */
	#fieldId(entity_type: string, field: string, create: boolean): number | undefined {
		const key = dictionaryKey(entity_type, field);
		const cached = this.#field_ids.get(key);
		if (cached !== undefined) {
			// On the write path, check the cached id still names a row: a rolled-back
			// savepoint (a failed row in a catch-up drain, a create() whose error
			// was caught inside batch()) can remove the row that created it, and
			// writing under a vanished id would leave entries no field owns. One
			// primary-key read per field per write; reads trust the cache.
			if (!create) return cached;
			const alive =
				this.sql.exec(`SELECT 1 FROM search_fields WHERE fid = ? LIMIT 1;`, cached).toArray()
					.length > 0;
			if (alive) return cached;
			this.#field_ids.delete(key);
			this.#dictionaries.delete(key);
		}
		let row = this.sql
			.exec(
				`SELECT fid FROM search_fields WHERE entity_type = ? AND field = ? LIMIT 1;`,
				entity_type,
				field,
			)
			.toArray()[0];
		if (!row && create) {
			row = this.sql
				.exec(
					`INSERT INTO search_fields (entity_type, field) VALUES (?, ?) RETURNING fid;`,
					entity_type,
					field,
				)
				.toArray()[0];
		}
		if (!row) return undefined;
		const fid = readNumber(row.fid);
		this.#field_ids.set(key, fid);
		return fid;
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
		this.#field_ids.clear();
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
			const tokens = tokenizeField(value, fieldTokenLimit(field, config.field_options));
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
		// Kept for callers; the stored word list is the authoritative previous
		// state now (one row read), so a stale previous document can't mislead.
		_previous_sparse_doc?: Record<string, unknown> | null,
	): void {
		const entity_type = config.entity_type;
		const next = this.projectDocument(config, sparse_doc);
		const stored = this.#readDocument(entity_type, doc_id);
		const previous = stored?.terms ?? new Map<string, Map<string, number>>();

		// Nothing the index stores changed (an update to a column the search
		// index doesn't cover, or a no-op): every write below would rewrite a
		// row with the value it already holds, and a Durable Object bills each.
		if (
			stored &&
			samePostings(previous, next.postings) &&
			sameLengths(stored.lengths, next.lengths) &&
			(config.vector_fields.length === 0 ||
				sameVectors(this.#readVectors(entity_type, doc_id), next.vectors))
		) {
			return;
		}

		const doc = this.#writeDocument(entity_type, doc_id, stored?.doc, next.lengths, next.postings);
		const fields = [...new Set([...previous.keys(), ...next.postings.keys()])].sort(compareStrings);
		for (const field of fields) {
			const fid = this.#fieldId(entity_type, field, true) as number;
			const before = previous.get(field);
			const after = next.postings.get(field);
			const len = quantizeLength(next.lengths.get(field) ?? 0);
			const length_changed =
				quantizeLength(stored?.lengths.get(field) ?? -1) !== len;
			const added: string[] = [];
			const removed: string[] = [];
			const writes: [string, number][] = [];
			for (const [token, tf] of after ?? []) {
				const old_tf = before?.get(token);
				if (old_tf === undefined) added.push(token);
				if (old_tf === undefined || old_tf !== tf || length_changed) writes.push([token, tf]);
			}
			for (const token of before?.keys() ?? []) {
				if (!after?.has(token)) removed.push(token);
			}
			added.sort(compareStrings);
			removed.sort(compareStrings);
			writes.sort((a, b) => compareStrings(a[0], b[0]));
			this.#deleteEntries(fid, doc, removed);
			for (const batch of chunk(writes, MAX_INSERT_ROWS)) {
				const bindings: unknown[] = [];
				for (const [token, tf] of batch) bindings.push(fid, token, doc, tf, len);
				this.sql.exec(
					`INSERT INTO search_entries (fid, token, doc, tf, len) VALUES ${placeholderRows(batch.length, POSTING_COLUMNS)} ON CONFLICT (fid, token, doc) DO UPDATE SET tf = excluded.tf, len = excluded.len;`,
					...bindings,
				);
			}
			this.#incrementDocFrequencies(entity_type, field, fid, added);
			this.#decrementDocFrequencies(entity_type, field, fid, removed);
		}

		this.#applyFieldStatDiff(entity_type, stored?.lengths, next.lengths);
		this.#writeVectors(entity_type, doc_id, config.vector_fields, next.vectors);
		if (!stored) this.#bumpDocCount(entity_type, 1);
		this.sql.exec(
			`DELETE FROM search_tombstones WHERE entity_type = ? AND doc_id = ?;`,
			entity_type,
			doc_id,
		);
	}

	/**
	 * Remove a document: entries, `df`, field statistics, its document row and
	 * vectors, plus a tombstone for the sync deletion feed.
	 *
	 * `deleted_at` is supplied by the caller (determinism rule §3 — the engine
	 * never reads a clock).
	 */
	removeDocument(config: SearchTypeConfig, doc_id: string, deleted_at: number): boolean {
		const entity_type = config.entity_type;
		const stored = this.#readDocument(entity_type, doc_id);
		if (stored) {
			for (const field of [...stored.terms.keys()].sort(compareStrings)) {
				const fid = this.#fieldId(entity_type, field, true) as number;
				const tokens = [...(stored.terms.get(field)?.keys() ?? [])].sort(compareStrings);
				this.#deleteEntries(fid, stored.doc, tokens);
				this.#decrementDocFrequencies(entity_type, field, fid, tokens);
			}
			this.#applyFieldStatDiff(entity_type, stored.lengths, new Map());
			this.sql.exec(`DELETE FROM search_documents WHERE doc = ?;`, stored.doc);
			this.#bumpDocCount(entity_type, -1);
		}
		this.sql.exec(
			`DELETE FROM search_vectors INDEXED BY search_vectors_by_doc WHERE entity_type = ? AND doc_id = ?;`,
			entity_type,
			doc_id,
		);
		this.writeTombstone(entity_type, doc_id, deleted_at);
		return stored !== undefined;
	}

	/** Wipe every search row for one entity type (state and tombstones survive). */
	clearEntityType(entity_type: string): void {
		this.sql.exec(
			`DELETE FROM search_entries WHERE fid IN (SELECT fid FROM search_fields WHERE entity_type = ?);`,
			entity_type,
		);
		this.sql.exec(
			`DELETE FROM search_terms WHERE fid IN (SELECT fid FROM search_fields WHERE entity_type = ?);`,
			entity_type,
		);
		this.sql.exec(`DELETE FROM search_documents WHERE entity_type = ?;`, entity_type);
		this.sql.exec(`DELETE FROM search_fields WHERE entity_type = ?;`, entity_type);
		this.sql.exec(`DELETE FROM search_vectors WHERE entity_type = ?;`, entity_type);
		this.sql.exec(
			`UPDATE search_state SET doc_count = 0 WHERE entity_type = ?;`,
			entity_type,
		);
		for (const key of [...this.#dictionaries.keys()]) {
			if (key.startsWith(`${entity_type}\u0000`)) this.#dictionaries.delete(key);
		}
		for (const key of [...this.#field_ids.keys()]) {
			if (key.startsWith(`${entity_type}\u0000`)) this.#field_ids.delete(key);
		}
	}

	/** A document's index row: its integer id, field lengths and words. */
	#readDocument(
		entity_type: string,
		doc_id: string,
	):
		| { doc: number; lengths: Map<string, number>; terms: Map<string, Map<string, number>> }
		| undefined {
		const row = this.sql
			.exec(
				`SELECT doc, lengths, terms FROM search_documents WHERE entity_type = ? AND doc_id = ? LIMIT 1;`,
				entity_type,
				doc_id,
			)
			.toArray()[0];
		if (!row) return undefined;
		return {
			doc: readNumber(row.doc),
			lengths: parseLengths(row.lengths),
			terms: decodeTerms(row.terms),
		};
	}

	/** Insert or replace a document's index row; returns its integer id. */
	#writeDocument(
		entity_type: string,
		doc_id: string,
		doc: number | undefined,
		lengths: Map<string, number>,
		terms: Map<string, Map<string, number>>,
	): number {
		const serialized: Record<string, number> = {};
		for (const field of [...lengths.keys()].sort(compareStrings)) {
			serialized[field] = lengths.get(field) as number;
		}
		if (doc !== undefined) {
			this.sql.exec(
				`UPDATE search_documents SET lengths = ?, terms = ? WHERE doc = ?;`,
				JSON.stringify(serialized),
				encodeTerms(terms),
				doc,
			);
			return doc;
		}
		return readNumber(
			this.sql
				.exec(
					`INSERT INTO search_documents (entity_type, doc_id, lengths, terms) VALUES (?, ?, ?, ?) RETURNING doc;`,
					entity_type,
					doc_id,
					JSON.stringify(serialized),
					encodeTerms(terms),
				)
				.toArray()[0]?.doc,
		);
	}

	/** Delete one document's entries for some words of a field (primary-key lookups). */
	#deleteEntries(fid: number, doc: number, tokens: readonly string[]): void {
		for (const batch of chunk(tokens, MAX_IN_VALUES)) {
			if (batch.length === 0) continue;
			this.sql.exec(
				`DELETE FROM search_entries WHERE fid = ? AND doc = ? AND token IN (${placeholderList(batch.length)});`,
				fid,
				doc,
				...batch,
			);
		}
	}

	/** `df + 1` per word, creating the dictionary row (one row) when it is new. */
	#incrementDocFrequencies(
		entity_type: string,
		field: string,
		fid: number,
		tokens: readonly string[],
	): void {
		const dictionary = this.#dictionaries.get(dictionaryKey(entity_type, field));
		for (const batch of chunk(tokens, Math.floor(MAX_SQL_PARAMS / 2))) {
			if (batch.length === 0) continue;
			const bindings: unknown[] = [];
			for (const token of batch) bindings.push(fid, token);
			const rows = this.sql
				.exec(
					`INSERT INTO search_terms (fid, token, df) VALUES ${Array.from({ length: batch.length }, () => '(?, ?, 1)').join(', ')} ON CONFLICT (fid, token) DO UPDATE SET df = df + 1 RETURNING token, df;`,
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

	/** `df - 1` per word, dropping dictionary rows that reach zero. */
	#decrementDocFrequencies(
		entity_type: string,
		field: string,
		fid: number,
		tokens: readonly string[],
	): void {
		const dictionary = this.#dictionaries.get(dictionaryKey(entity_type, field));
		for (const batch of chunk(tokens, MAX_IN_VALUES)) {
			if (batch.length === 0) continue;
			const rows = this.sql
				.exec(
					`UPDATE search_terms SET df = df - 1 WHERE fid = ? AND token IN (${placeholderList(batch.length)}) RETURNING token, df;`,
					fid,
					...batch,
				)
				.toArray();
			const empty = rows
				.filter((row) => readNumber(row.df) <= 0)
				.map((row) => String(row.token));
			if (empty.length === 0) continue;
			this.sql.exec(
				`DELETE FROM search_terms WHERE fid = ? AND token IN (${placeholderList(empty.length)});`,
				fid,
				...empty,
			);
			if (dictionary) for (const token of empty) sortedRemove(dictionary, token);
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
			const fid = this.#fieldId(entity_type, field, true) as number;
			this.sql.exec(
				`UPDATE search_fields SET doc_count = MAX(0, doc_count + ?), total_len = MAX(0, total_len + ?) WHERE fid = ?;`,
				delta.doc_count,
				delta.total_len,
				fid,
			);
		}
	}

	/** A document's stored vectors, by field. */
	#readVectors(entity_type: string, doc_id: string): Map<string, Float32Array> {
		const vectors = new Map<string, Float32Array>();
		for (const row of this.sql
			.exec(
				`SELECT field, vec FROM search_vectors INDEXED BY search_vectors_by_doc WHERE entity_type = ? AND doc_id = ?;`,
				entity_type,
				doc_id,
			)
			.toArray()) {
			vectors.set(String(row.field), blobToVector(row.vec));
		}
		return vectors;
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
				`SELECT doc_count, total_len FROM search_fields WHERE entity_type = ? AND field = ? LIMIT 1;`,
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

	/**
	 * `df` for a batch of tokens in one field, via chunked `IN (...)` lists.
	 *
	 * Tokens absent from the map have `df = 0`. One statement per ≤90 tokens.
	 */
	getDocFrequencies(
		entity_type: string,
		field: string,
		tokens: readonly string[],
	): Map<string, number> {
		const frequencies = new Map<string, number>();
		const fid = this.#fieldId(entity_type, field, false);
		if (fid === undefined) return frequencies;
		for (const batch of chunk([...new Set(tokens)], MAX_IN_VALUES)) {
			if (batch.length === 0) continue;
			const rows = this.sql
				.exec(
					`SELECT token, df FROM search_terms WHERE fid = ? AND token IN (${placeholderList(batch.length)});`,
					fid,
					...batch,
				)
				.toArray();
			for (const row of rows) frequencies.set(String(row.token), readNumber(row.df));
		}
		return frequencies;
	}

	/**
	 * {@link getDocFrequencies} for one term's raw candidates. Prefix
	 * completions all sit in one key range, so past one `IN` list's worth they
	 * are read with a single range scan instead of a statement per 90 (a
	 * one-letter prefix over a large dictionary was dozens of statements).
	 */
	getDocFrequenciesForTerm(
		entity_type: string,
		field: string,
		prefix: string | null,
		tokens: readonly string[],
	): Map<string, number> {
		const upper = prefix ? prefixUpperBound(prefix) : undefined;
		const in_range = prefix ? tokens.filter((token) => token.startsWith(prefix)) : [];
		if (!prefix || in_range.length <= MAX_IN_VALUES) {
			return this.getDocFrequencies(entity_type, field, tokens);
		}
		const frequencies = new Map<string, number>();
		const fid = this.#fieldId(entity_type, field, false);
		if (fid === undefined) return frequencies;
		const rows =
			upper === undefined
				? this.sql
						.exec(`SELECT token, df FROM search_terms WHERE fid = ? AND token >= ?;`, fid, prefix)
						.toArray()
				: this.sql
						.exec(
							`SELECT token, df FROM search_terms WHERE fid = ? AND token >= ? AND token < ?;`,
							fid,
							prefix,
							upper,
						)
						.toArray();
		for (const row of rows) frequencies.set(String(row.token), readNumber(row.df));
		const rest = tokens.filter((token) => !token.startsWith(prefix));
		for (const [token, df] of this.getDocFrequencies(entity_type, field, rest)) {
			frequencies.set(token, df);
		}
		return frequencies;
	}

	/**
	 * Postings for a batch of tokens in one field, grouped by token.
	 *
	 * Each token's posting list is `[doc_id, tf, len][]` ascending by doc id.
	 * `len` is the document's token count for the field, denormalized into the
	 * posting row (§7.1) so the term path never reads `search_documents.lengths` —
	 * its cost stays proportional to the postings a query touches, not to the
	 * corpus. Never trust SQL result order for anything user-visible (§3) — but
	 * do *check* it: posting lists arrive in primary-key order, which is the
	 * order `compareStrings` defines, so the sort is almost always a no-op and
	 * one linear verification pass is cheaper than paying for it. Tokens with no
	 * postings are absent from the map.
	 */
	getPostingsForTokens(
		entity_type: string,
		field: string,
		tokens: readonly string[],
	): Map<string, [string, number, number][]> {
		const by_token = new Map<string, [string, number, number][]>();
		const fid = this.#fieldId(entity_type, field, false);
		if (fid === undefined) return by_token;
		for (const batch of chunk(tokens, MAX_IN_VALUES)) {
			if (batch.length === 0) continue;
			const rows = this.sql
				.exec(
					`SELECT e.token AS token, d.doc_id AS doc_id, e.tf AS tf, e.len AS len FROM search_entries e JOIN search_documents d ON d.doc = e.doc WHERE e.fid = ? AND e.token IN (${placeholderList(batch.length)});`,
					fid,
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

	/**
	 * The listed documents' stored vectors, ascending by doc id, read via
	 * chunked `IN (...)` lists — the candidate-pushdown path.
	 */
	getVectors(
		entity_type: string,
		field: string,
		doc_ids: readonly string[],
	): [string, Float32Array][] {
		const rows: Record<string, unknown>[] = [];
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
		const vectors: [string, Float32Array][] = rows.map((row) => [
			String(row.doc_id),
			blobToVector(row.vec),
		]);
		vectors.sort((a, b) => compareStrings(a[0], b[0]));
		return vectors;
	}

	/**
	 * Every stored vector for a field, streamed off the SQL cursor one row at a
	 * time — never materialized, so a corpus-sized scan stays O(1) in rows
	 * (the DO's 128MB heap is the constraint). Yield order is the cursor's, not
	 * sorted: the only consumer accumulates scores into a Map and re-orders with
	 * a total comparator, so scan order is unobservable.
	 */
	*scanVectors(
		entity_type: string,
		field: string,
	): IterableIterator<[string, Float32Array]> {
		const cursor = this.sql.exec(
			`SELECT doc_id, vec FROM search_vectors WHERE entity_type = ? AND field = ?;`,
			entity_type,
			field,
		);
		for (const row of cursor) {
			yield [String(row.doc_id), blobToVector(row.vec)];
		}
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
	/** The field's cached dictionary with lengths and signatures, or null past the cap. */
	getCachedDictionary(entity_type: string, field: string): CachedDictionary | null {
		return this.#cachedDictionary(entity_type, field);
	}

	getDictionary(entity_type: string, field: string): string[] | null {
		return this.#cachedDictionary(entity_type, field)?.tokens ?? null;
	}

	/** {@link getDictionary}, with the parallel code-point lengths attached. */
	#cachedDictionary(entity_type: string, field: string): CachedDictionary | null {
		const key = dictionaryKey(entity_type, field);
		const cached = this.#dictionaries.get(key);
		if (cached !== undefined) return cached;
		const fid = this.#fieldId(entity_type, field, false);
		const count =
			fid === undefined
				? 0
				: readNumber(
						this.sql
							.exec(`SELECT COUNT(*) AS count FROM search_terms WHERE fid = ?;`, fid)
							.toArray()[0]?.count,
					);
		if (count > MAX_CACHED_DICTIONARY_TOKENS) {
			this.#dictionaries.set(key, null);
			return null;
		}
		const tokens =
			fid === undefined
				? []
				: this.sql
						.exec(`SELECT token FROM search_terms WHERE fid = ?;`, fid)
						.toArray()
						.map((row) => String(row.token));
		// Sorted in JS rather than trusting `ORDER BY`: the comparator is the
		// contract, and it must be the same one the client driver uses.
		tokens.sort(compareStrings);
		const dictionary = buildCachedDictionary(tokens);
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
		range_memo?: Map<string, string[]>,
	): string[] {
		const tokens = this.getDictionary(entity_type, field);
		if (tokens === null) {
			return this.#expandTokenViaSql(
				entity_type,
				field,
				token,
				exact,
				tolerance,
				range_memo,
			);
		}
		const cached = this.#dictionaries.get(dictionaryKey(entity_type, field));
		// Normally the cache's own parallel arrays; rebuilt only if something
		// handed back a dictionary the cache does not own (a test double, say).
		const dictionary =
			cached && cached.tokens === tokens ? cached : buildCachedDictionary(tokens);
		return expandCachedDictionary(dictionary, token, exact, tolerance);
	}

	/**
	 * The >200k-token fallback: range queries instead of an in-memory array.
	 *
	 * `range_memo` is a caller-owned per-query cache (the mirror of the client
	 * driver's): a tolerance expansion has to read the field's whole token
	 * table, and without the memo N query tokens would cost N identical
	 * full-table reads and sorts. Keyed by field.
	 */
	#expandTokenViaSql(
		entity_type: string,
		field: string,
		token: string,
		exact: boolean,
		tolerance: number,
		range_memo?: Map<string, string[]>,
	): string[] {
		const fid = this.#fieldId(entity_type, field, false);
		if (fid === undefined) return [];
		if (exact) {
			const rows = this.sql
				.exec(`SELECT token FROM search_terms WHERE fid = ? AND token = ? LIMIT 1;`, fid, token)
				.toArray();
			return rows.map((row) => String(row.token));
		}
		if (tolerance > 0) {
			const memo_key = dictionaryKey(entity_type, field);
			let rows = range_memo?.get(memo_key);
			if (!rows) {
				rows = this.sql
					.exec(`SELECT token FROM search_terms WHERE fid = ?;`, fid)
					.toArray()
					.map((row) => String(row.token));
				rows.sort(compareStrings);
				range_memo?.set(memo_key, rows);
			}
			const matcher = new ToleranceMatcher(token, tolerance);
			return rows.filter(
				(candidate) => candidate.startsWith(token) || matcher.matches(candidate),
			);
		}
		const upper = prefixUpperBound(token);
		const rows = (
			upper === undefined
				? this.sql.exec(`SELECT token FROM search_terms WHERE fid = ? AND token >= ?;`, fid, token)
				: this.sql.exec(
						`SELECT token FROM search_terms WHERE fid = ? AND token >= ? AND token < ?;`,
						fid,
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

	/**
	 * Index size per field of one entity type, for `searchReport()`. Scans the
	 * type's entries, terms and document rows once (reads only, so cheap in
	 * billing, but proportional to the index: an admin call, not a hot path).
	 */
	fieldReport(
		entity_type: string,
		caps: (field: string) => number,
	): {
		field: string;
		documents: number;
		words: number;
		single_use_words: number;
		entries: number;
		entry_bytes: number;
		capped_documents: number;
	}[] {
		const fields = this.sql
			.exec(
				`SELECT fid, field, doc_count FROM search_fields WHERE entity_type = ? ORDER BY field;`,
				entity_type,
			)
			.toArray();
		const capped = new Map<string, number>();
		for (const row of this.sql
			.exec(`SELECT terms FROM search_documents WHERE entity_type = ?;`, entity_type)) {
			for (const [field, words] of decodeTerms(row.terms)) {
				if (words.size >= caps(field)) capped.set(field, (capped.get(field) ?? 0) + 1);
			}
		}
		return fields.map((row) => {
			const fid = readNumber(row.fid);
			const field = String(row.field);
			const terms = this.sql
				.exec(
					`SELECT COUNT(*) AS words, IFNULL(SUM(df = 1), 0) AS single FROM search_terms WHERE fid = ?;`,
					fid,
				)
				.toArray()[0];
			const entries = this.sql
				.exec(
					`SELECT COUNT(*) AS entries, IFNULL(SUM(length(token)), 0) AS bytes FROM search_entries WHERE fid = ?;`,
					fid,
				)
				.toArray()[0];
			const count = readNumber(entries?.entries);
			return {
				field,
				documents: readNumber(row.doc_count),
				words: readNumber(terms?.words),
				single_use_words: readNumber(terms?.single),
				entries: count,
				// Key bytes plus the integer columns and record overhead (~12 bytes a row):
				// an estimate, since DO SQLite has no `dbstat`.
				entry_bytes: readNumber(entries?.bytes) + count * 12,
				capped_documents: capped.get(field) ?? 0,
			};
		});
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

/** Parse a `search_documents.lengths` JSON blob. */
function parseLengths(value: unknown): Map<string, number> {
	const lengths = new Map<string, number>();
	if (typeof value !== 'string') return lengths;
	const parsed = JSON.parse(value) as Record<string, unknown>;
	for (const field of Object.keys(parsed)) {
		lengths.set(field, readNumber(parsed[field]));
	}
	return lengths;
}
