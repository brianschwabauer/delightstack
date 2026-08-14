/**
 * The client's IndexedDB postings store (plan §7.6).
 *
 * It is the async twin of `server/sqlite_store.ts`: the same four logical
 * tables (postings, term dictionary, documents, field statistics), the same
 * write-path diffing, the same dictionary cache — over IDB object stores
 * instead of SQLite rows. There is deliberately **no vector store**: vectors
 * never reach the client (§4.9), so a client query carrying one is routed to
 * the server instead (`client/engine.ts`, `requiresServer`).
 *
 * Everything that decides membership, order or a count lives in `core/*`. This
 * module only stores bytes and hands back candidate ranges.
 *
 * **The IDB rules this module is written around** (§7.6 checklist):
 * - A transaction auto-commits the moment you await a promise that is *not* an
 *   IDB request of that same transaction. Every `await` below is either a
 *   request of the live transaction or `transactionDone` — the diffing between
 *   phases is synchronous, so nothing can slip in and commit the transaction
 *   underneath it.
 * - The old document is read *inside* the write transaction, never in an
 *   earlier one: production is a SharedWorker (single writer), but a
 *   per-tab-`Worker` fallback shares one IDB, and a read-then-reopen gap lets
 *   two tabs interleave and corrupt `df`/field statistics. IDB serializes
 *   overlapping readwrite transactions — that is the whole safety mechanism.
 * - Booleans and `null` are not valid IDB keys, and a record missing a
 *   keyPath is simply absent from that index. Index-driven candidate
 *   extraction is therefore only ever a *superset* filter over positive
 *   predicates on string/number paths; `core/where` still decides membership.
 * - IDB sorts strings by UTF-16 **code unit**, which is not the core
 *   comparator's code-point order. Ranges are for candidate extraction only —
 *   every user-visible ordering is re-sorted with `core/compare`.
 */

import { DelightError } from '@delightstack/utilities';
import { compareStrings, type PrimaryKeyType } from '../core/compare';
import {
	buildCachedDictionary,
	sameLengths,
	sortedInsert,
	sortedRemove,
	type CachedDictionary,
} from '../core/dictionary';
import { ToleranceMatcher } from '../core/levenshtein';
import { resolveTextFields } from '../core/schema_fields';
import { countTokenFrequencies, tokenizeValue } from '../core/tokenizer';
import type { SearchableType } from '../core/types';
import {
	getFieldValue,
	type NormalizedLeaf,
	type NormalizedWhere,
	type WhereSchema,
} from '../core/where';

/* -------------------------------------------------------------------------- */
/* Store names                                                                */
/* -------------------------------------------------------------------------- */

/** `[entity_type, field, token, doc_id]` → `{ tf, len }` */
export const POSTINGS_STORE = 'postings';
/** `[entity_type, field, token]` → `{ df }` */
export const TOKENS_STORE = 'tokens';
/** `[entity_type, doc_id]` → `{ sparse_doc, lengths }` */
export const DOCS_STORE = 'docs';
/** `[entity_type, field]` → `{ doc_count, total_len }` */
export const FIELD_STATS_STORE = 'field_stats';

/** Every object store this module owns. */
export const SEARCH_STORE_NAMES = [
	POSTINGS_STORE,
	TOKENS_STORE,
	DOCS_STORE,
	FIELD_STATS_STORE,
] as const;

/** The by-document postings index — the analogue of `search_postings_by_doc`. */
export const POSTINGS_BY_DOC_INDEX = 'by_doc';

/** Prefix for the `docs` store's filter/sort indexes. */
export const DOC_INDEX_PREFIX = 'by$';

/** Past this many distinct tokens a dictionary is not cached (mirrors §7.3). */
export const MAX_CACHED_DICTIONARY_TOKENS = 200_000;

/* -------------------------------------------------------------------------- */
/* Entity-type configuration                                                  */
/* -------------------------------------------------------------------------- */

/** Inputs for {@link defineClientType}. */
export interface ClientSearchTypeInput {
	entity_type: string;
	/** Flat map of dot-path → declared type. The closed set of legal paths. */
	schema: WhereSchema;
	/** @default 'id' */
	primary_key?: string;
	/** @default 'string' */
	primary_key_type?: PrimaryKeyType;
}

/** A prepared entity-type configuration (field lists resolved once). */
export interface ClientSearchType {
	entity_type: string;
	schema: WhereSchema;
	primary_key: string;
	primary_key_type: PrimaryKeyType;
	/** Searchable text fields, ascending — the deterministic accumulation order. */
	text_fields: string[];
}

/** Resolve an entity type's field lists once, ascending. */
export function defineClientType(input: ClientSearchTypeInput): ClientSearchType {
	return {
		entity_type: input.entity_type,
		schema: input.schema,
		primary_key: input.primary_key ?? 'id',
		primary_key_type: input.primary_key_type ?? 'string',
		text_fields: resolveTextFields(input.schema),
	};
}

/* -------------------------------------------------------------------------- */
/* Row shapes                                                                 */
/* -------------------------------------------------------------------------- */

/** One posting: a document's term frequency plus its field length (§7.1). */
export interface ClientPosting {
	doc_id: string;
	/** Occurrences of the token in this document's field. */
	tf: number;
	/** The document's token count for the field — denormalized so BM25 needs no
	 * document read. */
	len: number;
}

/** A stored posting record. */
export interface PostingRow extends ClientPosting {
	entity_type: string;
	field: string;
	token: string;
}

/** A stored dictionary record. */
export interface TokenRow {
	entity_type: string;
	field: string;
	token: string;
	/** Documents containing the token in the field. */
	df: number;
}

/** A stored document record. */
export interface DocRow {
	entity_type: string;
	doc_id: string;
	/** The server's sparse document, vector fields already stripped (§7.0). */
	sparse_doc: Record<string, unknown>;
	/** Token count per present text field. */
	lengths: Record<string, number>;
}

/** Aggregate statistics for one field. */
export interface FieldStats {
	/** `N(field)` — documents containing the field. */
	doc_count: number;
	/** `Σ` token counts, so `avgLen = total_len / doc_count`. */
	total_len: number;
}

/** A stored field-statistics record. */
export interface FieldStatsRow extends FieldStats {
	entity_type: string;
	field: string;
}

/** The tokenized projection of one document (no vectors — §4.9). */
export interface ClientDocumentProjection {
	/** field → token → tf */
	postings: Map<string, Map<string, number>>;
	/** field → token count (present fields only, zero-length included) */
	lengths: Map<string, number>;
}

/* -------------------------------------------------------------------------- */
/* Write inputs                                                               */
/* -------------------------------------------------------------------------- */

/** One document write. A `null` document is a deletion. */
export interface DocWrite {
	entity_type: string;
	doc_id: string;
	/** The sparse document, or `null` to remove it from the index. */
	sparse_doc: Record<string, unknown> | null;
}

/**
 * An operation on a store this module does not own, carried into the same
 * transaction as the index writes.
 *
 * This is the atomicity seam the worker needs (§7.6): the `sync_meta` update
 * and the postings it accounts for commit or abort together, so the synced
 * window can never outrun the persisted index.
 *
 * `key` is required for out-of-line stores (`sync_meta` is keyed by entity
 * type) and must be omitted for stores with a `keyPath`.
 */
export interface ExtraStoreOp {
	store: string;
	action: 'put' | 'delete';
	value?: unknown;
	key?: IDBValidKey;
}

/** Options for {@link IdbSearchStore.applyWrites}. */
export interface ApplyWritesOptions {
	/** Operations on other stores, committed in the same transaction. */
	extra_ops?: readonly ExtraStoreOp[];
	/** Extra store names to include in the transaction scope, even with no ops. */
	extra_stores?: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Database open / upgrade                                                    */
/* -------------------------------------------------------------------------- */

/** One `docs` index declaration. */
export interface DocIndexPath {
	/** The dot path, as declared in the schema (`address.city`). */
	path: string;
	/** Array-typed path → a `multiEntry` index (native array containment). */
	multi_entry?: boolean;
}

/** A store this module does not own but must exist in the database. */
export interface ExtraStoreDefinition {
	name: string;
	/** Omit for out-of-line keys (what `sync_meta`/`entities` use today). */
	key_path?: string;
}

/** Options for {@link openSearchDatabase}. */
export interface OpenSearchDatabaseOptions {
	name: string;
	/**
	 * The IDB version. Derive it from the entity types' `config_version` so a
	 * schema change re-creates the indexes and triggers a full local rebuild
	 * through the machinery that already handles config bumps (§7.6).
	 *
	 * Omit it to open the database at whatever version it already has (and to
	 * create it at version 1 when it does not exist yet) — the probe open the
	 * worker uses to read its `sync_meta` *before* it knows which version the
	 * persisted `config_version`s ask for.
	 */
	version?: number;
	/** Sortable/filterable string & number paths to index on `docs`. */
	index_paths?: readonly DocIndexPath[];
	/** Stores owned by the worker that must survive/appear in this database. */
	extra_stores?: readonly ExtraStoreDefinition[];
	/**
	 * Stores to drop if present — the migration seam for stores this design
	 * replaced (the legacy `search_index` blob store). Only applied when a
	 * version upgrade actually runs.
	 */
	delete_stores?: readonly string[];
	/** Injectable factory (tests pass `fake-indexeddb`). */
	factory?: IDBFactory;
	/**
	 * How long a blocked upgrade waits for the other connections to close
	 * before giving up (ms). A `versionchange` event usually makes the blocking
	 * tab release its connection within a frame; a tab that never does (an old
	 * build, a frozen background tab) would otherwise leave the open pending
	 * forever. On timeout the open rejects with a 503 the caller can turn into
	 * a server-only fallback rather than a dead client.
	 * @default 3000
	 */
	blocked_timeout_ms?: number;
}

/** The index name for a declared path. */
export function docIndexName(path: string): string {
	return `${DOC_INDEX_PREFIX}${path}`;
}

/**
 * Whether a live `docs` index has the physical shape its declaration asks for.
 *
 * Names alone are not enough: a path whose declared arity flips
 * (`'string'` → `'string[]'`, or the "multiEntry wins" merge changing its
 * mind) keeps the same index name but needs a different keyPath shape — a bare
 * `multiEntry` index for arrays, a compound `[entity_type, value]` index for
 * scalars. A stale index of the wrong shape returns zero rows from every
 * probe, which silently *excludes* documents (§7.6: a probe must always be a
 * superset). Comparing the shape here is what lets the upgrade machinery
 * detect the drift and rebuild the index.
 */
export function docIndexShapeMatches(
	index: IDBIndex,
	declaration: DocIndexPath,
): boolean {
	const value_path = `sparse_doc.${declaration.path}`;
	if (declaration.multi_entry) {
		return index.multiEntry === true && index.keyPath === value_path;
	}
	return (
		index.multiEntry !== true &&
		Array.isArray(index.keyPath) &&
		index.keyPath.length === 2 &&
		index.keyPath[0] === 'entity_type' &&
		index.keyPath[1] === value_path
	);
}

/**
 * Open (and upgrade) the client search database.
 *
 * The four search stores are created if missing, and the `docs` store's
 * filter/sort indexes are reconciled against `index_paths` — created when new,
 * dropped when they disappear from the declaration.
 *
 * Compound `[entity_type, value]` indexes are used for scalar paths so a range
 * scan never leaks another entity type's documents. `multiEntry` indexes
 * cannot be compound (the IDB spec throws), so array paths get a bare index and
 * the entity type is filtered off the returned primary keys, which are
 * `[entity_type, doc_id]` pairs and therefore carry it for free.
 */
export function openSearchDatabase(
	options: OpenSearchDatabaseOptions,
): Promise<IDBDatabase> {
	const factory = options.factory ?? indexedDB;
	return new Promise((resolve, reject) => {
		const open_request =
			options.version === undefined
				? factory.open(options.name)
				: factory.open(options.name, options.version);
		open_request.onupgradeneeded = () => {
			const db = open_request.result;
			const txn = open_request.transaction;
			if (!txn) return;
			for (const name of options.delete_stores ?? []) {
				if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
			}
			for (const store of options.extra_stores ?? []) {
				if (db.objectStoreNames.contains(store.name)) continue;
				db.createObjectStore(
					store.name,
					store.key_path ? { keyPath: store.key_path } : undefined,
				);
			}
			if (!db.objectStoreNames.contains(POSTINGS_STORE)) {
				const postings = db.createObjectStore(POSTINGS_STORE, {
					keyPath: ['entity_type', 'field', 'token', 'doc_id'],
				});
				postings.createIndex(POSTINGS_BY_DOC_INDEX, ['entity_type', 'doc_id']);
			}
			if (!db.objectStoreNames.contains(TOKENS_STORE)) {
				db.createObjectStore(TOKENS_STORE, {
					keyPath: ['entity_type', 'field', 'token'],
				});
			}
			if (!db.objectStoreNames.contains(DOCS_STORE)) {
				db.createObjectStore(DOCS_STORE, { keyPath: ['entity_type', 'doc_id'] });
			}
			if (!db.objectStoreNames.contains(FIELD_STATS_STORE)) {
				db.createObjectStore(FIELD_STATS_STORE, { keyPath: ['entity_type', 'field'] });
			}
			const docs = txn.objectStore(DOCS_STORE);
			const wanted = new Map<string, DocIndexPath>();
			for (const declaration of options.index_paths ?? []) {
				wanted.set(docIndexName(declaration.path), declaration);
			}
			for (const name of Array.from(docs.indexNames)) {
				if (!wanted.has(name)) docs.deleteIndex(name);
			}
			for (const [name, declaration] of wanted) {
				if (docs.indexNames.contains(name)) {
					// A same-named index whose physical shape drifted (a scalar path
					// re-declared as an array, or vice versa) would silently return zero
					// rows from every probe — delete and recreate it. `createIndex`
					// re-populates from the existing records, so no data rebuild is
					// needed beyond this.
					if (docIndexShapeMatches(docs.index(name), declaration)) continue;
					docs.deleteIndex(name);
				}
				const value_path = `sparse_doc.${declaration.path}`;
				if (declaration.multi_entry) {
					docs.createIndex(name, value_path, { multiEntry: true });
				} else {
					docs.createIndex(name, ['entity_type', value_path]);
				}
			}
		};
		// `blocked` is not terminal: the other connections get a `versionchange`
		// event and normally close within a frame, after which the upgrade
		// proceeds and `onsuccess` still fires. Only reject when the block
		// out-lives a generous timeout (a connection that will never close), so
		// the caller can fall back to server-only mode instead of dying on a
		// transient handoff.
		let blocked_timer: ReturnType<typeof setTimeout> | undefined;
		let timed_out = false;
		const clearBlockedTimer = (): void => {
			if (blocked_timer !== undefined) clearTimeout(blocked_timer);
			blocked_timer = undefined;
		};
		open_request.onsuccess = () => {
			clearBlockedTimer();
			if (timed_out) {
				// The caller already gave up on this open — do not leak a connection
				// that would in turn block the next upgrade.
				open_request.result.close();
				return;
			}
			resolve(open_request.result);
		};
		open_request.onerror = () => {
			clearBlockedTimer();
			reject(open_request.error ?? new Error('Failed to open the search database.'));
		};
		open_request.onblocked = () => {
			if (blocked_timer !== undefined) return;
			blocked_timer = setTimeout(() => {
				blocked_timer = undefined;
				timed_out = true;
				reject(
					new DelightError({
						message: 'The search database upgrade is blocked by another connection.',
						status: 503,
						code: 'search_db_blocked',
					}),
				);
			}, options.blocked_timeout_ms ?? 3000);
		};
	});
}

/* -------------------------------------------------------------------------- */
/* IDB helpers                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Await one IDB request.
 *
 * Safe inside a live transaction: the promise settles from the request's own
 * success event, so the continuation runs as a microtask of that event's task
 * — before the transaction can auto-commit. Awaiting anything else (a fetch, a
 * timer, another transaction's promise) inside a transaction is the bug this
 * module exists to avoid.
 */
export function request<T>(idb_request: IDBRequest<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		idb_request.onsuccess = () => resolve(idb_request.result);
		idb_request.onerror = () =>
			reject(idb_request.error ?? new Error('IndexedDB request failed.'));
	});
}

/** Resolve when the transaction commits; reject when it aborts or errors. */
export function transactionDone(txn: IDBTransaction): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		txn.oncomplete = () => resolve();
		txn.onabort = () => reject(txn.error ?? new Error('IndexedDB transaction aborted.'));
		txn.onerror = () => reject(txn.error ?? new Error('IndexedDB transaction failed.'));
	});
}

/**
 * A key that sorts above every string, number, date and binary key.
 *
 * IDB's type ordering puts arrays last, so `[]` is the canonical open upper
 * bound for "every value of any other type" — which is how a whole entity
 * type's slice of a compound key is selected.
 */
export const KEY_ABOVE_ALL: IDBValidKey = [];

/**
 * The **exclusive** upper bound of a string prefix in IDB key order.
 *
 * IDB compares strings by UTF-16 code unit, so the bound is built in code-unit
 * space: increment the last code unit. `'abc'` → `'abd'`, and every string
 * starting with `'abc'` sorts below it — including the astral ones, whose
 * surrogate pairs the plan's `prefix + '\u{10FFFF}'` sketch would have handled
 * for a single following character but not for a longer token
 * (`prefix + '\u{10FFFF}' + 'x'` sorts *above* `prefix + '\u{10FFFF}'`).
 *
 * A trailing `U+FFFF` has no successor code unit, so it is dropped and the
 * preceding unit is incremented instead. Returns `undefined` when no bound
 * exists (an empty prefix, or one made entirely of `U+FFFF`); the caller then
 * uses {@link KEY_ABOVE_ALL}.
 */
export function codeUnitUpperBound(prefix: string): string | undefined {
	let end = prefix.length;
	while (end > 0) {
		const last = prefix.charCodeAt(end - 1);
		if (last === 0xffff) {
			end -= 1;
			continue;
		}
		return prefix.slice(0, end - 1) + String.fromCharCode(last + 1);
	}
	return undefined;
}

/** The key range covering every posting of one `(entity_type, field, token)`. */
export function postingRange(
	entity_type: string,
	field: string,
	token: string,
): IDBKeyRange {
	return IDBKeyRange.bound(
		[entity_type, field, token],
		[entity_type, field, token, KEY_ABOVE_ALL],
		false,
		true,
	);
}

/** The key range covering every token of one `(entity_type, field)`. */
export function tokenRange(entity_type: string, field: string): IDBKeyRange {
	return IDBKeyRange.bound(
		[entity_type, field],
		[entity_type, field, KEY_ABOVE_ALL],
		false,
		true,
	);
}

/** The key range covering every token starting with `prefix`. */
export function tokenPrefixRange(
	entity_type: string,
	field: string,
	prefix: string,
): IDBKeyRange {
	const upper = codeUnitUpperBound(prefix);
	return IDBKeyRange.bound(
		[entity_type, field, prefix],
		upper === undefined
			? [entity_type, field, KEY_ABOVE_ALL]
			: [entity_type, field, upper],
		false,
		true,
	);
}

/** The key range covering every document of one entity type. */
export function entityRange(entity_type: string): IDBKeyRange {
	return IDBKeyRange.bound([entity_type], [entity_type, KEY_ABOVE_ALL], false, true);
}

/* -------------------------------------------------------------------------- */
/* Candidate probes                                                           */
/* -------------------------------------------------------------------------- */

/** One value range to look up in a `docs` index. */
export interface ValueBound {
	lower?: IDBValidKey;
	upper?: IDBValidKey;
	lower_open?: boolean;
	upper_open?: boolean;
}

/**
 * An index-driven candidate extraction: every document that can satisfy one
 * positive predicate.
 *
 * A probe is always a **superset** of the predicate's true matched set (values
 * are never coerced, missing fields are simply absent), and `core/where`
 * re-decides membership over whatever it returns. That is what makes it safe
 * to skip a probe for any predicate whose index semantics are not obviously a
 * superset — booleans, `not`, `not_in`, `or` branches.
 */
export interface CandidateProbe {
	path: string;
	multi_entry: boolean;
	bounds: ValueBound[];
}

/** Whether a value is usable as an IDB key (booleans and `null` are not). */
function isValidKey(value: unknown): value is string | number {
	return (
		typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
	);
}

/** Whether a declared type's values can be index keys at all. */
function isIndexableType(type: SearchableType): boolean {
	return (
		type === 'string' ||
		type === 'string[]' ||
		type === 'number' ||
		type === 'number[]' ||
		type === 'enum' ||
		type === 'enum[]'
	);
}

/** Whether a declared type stores numbers, the only ordered index probe. */
function isNumericType(type: SearchableType): boolean {
	return type === 'number' || type === 'number[]';
}

/**
 * The bounds one operator contributes, or `null` when it is not index-safe.
 *
 * Equality-shaped operators (`eq`, `in`, `contains_any`, `contains_all`) probe
 * exact keys, and `core/where` compares strictly (`'5' !== 5`), so an index
 * lookup and the predicate agree by construction whatever the operand's type.
 *
 * Ordered operators are restricted to numeric fields with numeric operands:
 * IDB's cross-type key ordering (number < date < string < binary < array) is
 * not `core/compare`'s, so a mistyped operand could make a range *exclude*
 * documents the predicate would match — the one way an index probe stops being
 * a superset.
 */
function boundsForOperator(
	operator: string,
	operand: unknown,
	type: SearchableType,
): ValueBound[] | null {
	if (
		(operator === 'gt' ||
			operator === 'gte' ||
			operator === 'lt' ||
			operator === 'lte' ||
			operator === 'between') &&
		!isNumericType(type)
	) {
		return null;
	}
	switch (operator) {
		case 'eq':
			return isValidKey(operand) ? [{ lower: operand, upper: operand }] : null;
		case 'in':
		case 'contains_any': {
			if (!Array.isArray(operand) || operand.length === 0) return null;
			const bounds: ValueBound[] = [];
			for (const value of operand) {
				if (!isValidKey(value)) return null;
				bounds.push({ lower: value, upper: value });
			}
			return bounds;
		}
		case 'contains_all': {
			// Every listed value must be present, so the documents holding any one of
			// them are already a superset — the first usable value is enough.
			if (!Array.isArray(operand)) return null;
			for (const value of operand) {
				if (isValidKey(value)) return [{ lower: value, upper: value }];
			}
			return null;
		}
		case 'gt':
			return isValidKey(operand) ? [{ lower: operand, lower_open: true }] : null;
		case 'gte':
			return isValidKey(operand) ? [{ lower: operand }] : null;
		case 'lt':
			return isValidKey(operand) ? [{ upper: operand, upper_open: true }] : null;
		case 'lte':
			return isValidKey(operand) ? [{ upper: operand }] : null;
		case 'between': {
			if (!Array.isArray(operand) || operand.length !== 2) return null;
			const [min, max] = operand;
			if (typeof min !== 'number' || typeof max !== 'number') return null;
			if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
			// A reversed pair makes `IDBKeyRange.bound` throw `DataError`. It also
			// matches nothing, but "no probe" is the honest answer — `core/where`
			// says so, not this module.
			if (min > max) return null;
			return [{ lower: min, upper: max }];
		}
		default:
			// `not_in` and the geo operators never drive an index: `not_in` must match
			// documents the index cannot see, and geo membership is `core/geo`'s.
			return null;
	}
}

/** The probe one leaf offers, or `undefined` when none is index-safe. */
function probeForLeaf(
	leaf: NormalizedLeaf,
	indexed: ReadonlyMap<string, DocIndexPath>,
): CandidateProbe | undefined {
	const declaration = indexed.get(leaf.field);
	if (!declaration) return undefined;
	if (!isIndexableType(leaf.type)) return undefined;
	for (const [operator, operand] of leaf.operators) {
		const bounds = boundsForOperator(operator, operand, leaf.type);
		if (bounds) {
			return {
				path: leaf.field,
				multi_entry: declaration.multi_entry === true,
				bounds,
			};
		}
	}
	return undefined;
}

/**
 * Collect every index probe a normalized `where` offers.
 *
 * Only the **conjunctive** context is walked — the root's leaves and the leaves
 * of every `and` branch. An `or` branch is not a constraint on the result set
 * on its own, and `not` inverts one, so neither can narrow candidates. Each
 * returned probe is independently a superset of the whole filter's matched set,
 * so a caller picks whichever is cheapest and lets `core/where` do the rest.
 */
export function collectProbes(
	where: NormalizedWhere | undefined,
	indexed: ReadonlyMap<string, DocIndexPath>,
): CandidateProbe[] {
	if (!where) return [];
	const probes: CandidateProbe[] = [];
	for (const leaf of where.leaves) {
		const probe = probeForLeaf(leaf, indexed);
		if (probe) probes.push(probe);
	}
	for (const branch of where.and ?? []) {
		probes.push(...collectProbes(branch, indexed));
	}
	return probes;
}

/** Turn a value bound into the key range for the probe's index kind. */
function probeRange(
	entity_type: string,
	bound: ValueBound,
	multi_entry: boolean,
): IDBKeyRange {
	if (multi_entry) {
		if (bound.lower !== undefined && bound.upper !== undefined) {
			return IDBKeyRange.bound(
				bound.lower,
				bound.upper,
				bound.lower_open === true,
				bound.upper_open === true,
			);
		}
		if (bound.lower !== undefined) {
			return IDBKeyRange.lowerBound(bound.lower, bound.lower_open === true);
		}
		return IDBKeyRange.upperBound(bound.upper as IDBValidKey, bound.upper_open === true);
	}
	const lower =
		bound.lower === undefined ? [entity_type] : [entity_type, bound.lower as IDBValidKey];
	const upper =
		bound.upper === undefined
			? [entity_type, KEY_ABOVE_ALL]
			: [entity_type, bound.upper as IDBValidKey];
	return IDBKeyRange.bound(
		lower,
		upper,
		bound.lower !== undefined && bound.lower_open === true,
		bound.upper === undefined ? true : bound.upper_open === true,
	);
}

/* -------------------------------------------------------------------------- */
/* Projection                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Tokenize a sparse document into postings and per-field lengths.
 *
 * Mirrors the memory reference store and the server store exactly: a present
 * field always contributes a length entry (an empty string is a zero-length
 * field, not an absent one). Vector fields are ignored — they do not exist on
 * the client.
 */
export function projectDocument(
	config: ClientSearchType,
	sparse_doc: Record<string, unknown>,
): ClientDocumentProjection {
	const postings = new Map<string, Map<string, number>>();
	const lengths = new Map<string, number>();
	for (const field of config.text_fields) {
		const value = getFieldValue(sparse_doc, field);
		if (value === null || value === undefined) continue;
		const tokens = tokenizeValue(value);
		lengths.set(field, tokens.length);
		postings.set(field, countTokenFrequencies(tokens));
	}
	return { postings, lengths };
}

/* -------------------------------------------------------------------------- */
/* Internal write-plan shapes                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The accumulator/cache key separator.
 *
 * A NUL cannot appear in an entity type, a field path or a token (the tokenizer
 * never emits one), so these composite keys are unambiguous to split.
 */
const KEY_SEPARATOR = '\u0000';

/** A `(entity_type, field, token)` cache/accumulator key. */
function tokenKey(entity_type: string, field: string, token: string): string {
	return `${entity_type}${KEY_SEPARATOR}${field}${KEY_SEPARATOR}${token}`;
}

/** A `(entity_type, field)` cache/accumulator key. */
function fieldKey(entity_type: string, field: string): string {
	return `${entity_type}${KEY_SEPARATOR}${field}`;
}

/** Accumulated posting writes and `df`/statistics deltas for one transaction. */
interface WritePlan {
	posting_puts: PostingRow[];
	posting_deletes: [string, string, string, string][];
	doc_puts: DocRow[];
	doc_deletes: [string, string][];
	/** token key → delta */
	df_deltas: Map<string, number>;
	/** field key → delta */
	stat_deltas: Map<string, FieldStats>;
}

/** `lengths` as a plain record, keys ascending (stable, diffable JSON). */
function lengthsToRecord(lengths: Map<string, number>): Record<string, number> {
	const record: Record<string, number> = {};
	for (const field of [...lengths.keys()].sort(compareStrings)) {
		record[field] = lengths.get(field) as number;
	}
	return record;
}

/** `lengths` back from its stored record form. */
function lengthsFromRecord(
	record: Record<string, number> | undefined,
): Map<string, number> {
	const lengths = new Map<string, number>();
	for (const field of Object.keys(record ?? {})) {
		const value = (record as Record<string, number>)[field];
		if (typeof value === 'number') lengths.set(field, value);
	}
	return lengths;
}

/* -------------------------------------------------------------------------- */
/* Store                                                                      */
/* -------------------------------------------------------------------------- */

/** Options for {@link IdbSearchStore}. */
export interface IdbSearchStoreOptions {
	/** The `docs` indexes the database was opened with. */
	index_paths?: readonly DocIndexPath[];
	/**
	 * Past this many distinct tokens a field's dictionary is not cached and
	 * expansion falls back to range scans.
	 * @default MAX_CACHED_DICTIONARY_TOKENS
	 */
	max_cached_tokens?: number;
}

/** The asynchronous IndexedDB search store. */
export class IdbSearchStore {
	readonly db: IDBDatabase;
	/** Declared `docs` index paths, by path. */
	readonly indexed_paths: Map<string, DocIndexPath>;

	/** Past this many tokens a dictionary is not cached (§7.3's mirror). */
	readonly max_cached_tokens: number;

	readonly #types = new Map<string, ClientSearchType>();
	/** `entity_type\0field` → dictionary, or `null` when oversized. */
	readonly #dictionaries = new Map<string, CachedDictionary | null>();

	constructor(db: IDBDatabase, options: IdbSearchStoreOptions = {}) {
		this.db = db;
		this.indexed_paths = new Map(
			(options.index_paths ?? []).map((declaration) => [declaration.path, declaration]),
		);
		this.max_cached_tokens = options.max_cached_tokens ?? MAX_CACHED_DICTIONARY_TOKENS;
	}

	/** Register (or replace) an entity type's configuration. */
	register(config: ClientSearchType): void {
		this.#types.set(config.entity_type, config);
	}

	/** The registered configuration for an entity type. */
	getType(entity_type: string): ClientSearchType {
		const config = this.#types.get(entity_type);
		if (!config) {
			throw new DelightError({
				message: `Entity type "${entity_type}" is not registered with the search engine.`,
				status: 500,
				code: 'unknown_entity_type',
			});
		}
		return config;
	}

	/** Drop the in-memory dictionary cache (tests, repair paths, resyncs). */
	clearDictionaryCache(): void {
		this.#dictionaries.clear();
	}

	/* ---------------------------------------------------------------------- */
	/* Write path                                                             */
	/* ---------------------------------------------------------------------- */

	/**
	 * Apply a batch of document writes in **one** readwrite transaction.
	 *
	 * The shape is the §7.6 checklist made executable:
	 *
	 * 1. open one transaction over every search store plus any caller-supplied
	 *    store (that is the `sync_meta` atomicity seam);
	 * 2. read the previous documents *inside* it;
	 * 3. diff synchronously — tokenize, compute the posting/`df`/statistics
	 *    deltas — with no foreign await anywhere in between;
	 * 4. read the `df` and field-statistics rows the deltas touch;
	 * 5. issue every write, then wait for the commit.
	 *
	 * The diffing itself mirrors `server/sqlite_store.ts`: `df` moves only for
	 * tokens that appear or disappear for a document, a `df` that reaches zero
	 * deletes its dictionary row, and every token of a field is rewritten when
	 * the field's length changes (the length rides on each posting row).
	 *
	 * Two writes to the same document in one batch are folded in order, so a
	 * create-then-update batch is exactly a single create of the final state.
	 */
	async applyWrites(
		writes: readonly DocWrite[],
		options: ApplyWritesOptions = {},
	): Promise<void> {
		const extra_ops = options.extra_ops ?? [];
		if (writes.length === 0 && extra_ops.length === 0) return;
		const scope = new Set<string>(SEARCH_STORE_NAMES);
		for (const name of options.extra_stores ?? []) scope.add(name);
		for (const op of extra_ops) scope.add(op.store);

		let txn: IDBTransaction;
		try {
			txn = this.db.transaction([...scope], 'readwrite');
		} catch (error) {
			// A store name the database does not have (a stale `extra_ops` target,
			// a version that never ran its upgrade) throws here, before anything is
			// written — surface it as a `DelightError` like every other failure.
			throw new DelightError({
				message: `Failed to open a search write transaction: ${(error as Error).message}`,
				status: 500,
				code: 'search_transaction_failed',
			});
		}
		const postings = txn.objectStore(POSTINGS_STORE);
		const tokens = txn.objectStore(TOKENS_STORE);
		const docs = txn.objectStore(DOCS_STORE);
		const field_stats = txn.objectStore(FIELD_STATS_STORE);

		let dictionary_deltas: Map<string, boolean>;
		try {
			// (2) previous documents — inside this transaction, never before it.
			const previous = await Promise.all(
				writes.map((write) =>
					request<DocRow | undefined>(
						docs.get([write.entity_type, write.doc_id]) as IDBRequest<DocRow | undefined>,
					),
				),
			);

			// A stored document whose recomputed lengths disagree with the stored
			// ones cannot be trusted to reproduce the old token set (a schema change
			// between writes, say) — fall back to the postings actually on disk, the
			// analogue of the server's `DELETE ... RETURNING` path.
			const stale: number[] = [];
			const current = new Map<string, DocRow | undefined>();
			for (let index = 0; index < writes.length; index++) {
				const write = writes[index];
				const key = `${write.entity_type}${KEY_SEPARATOR}${write.doc_id}`;
				if (!current.has(key)) current.set(key, previous[index]);
				const row = current.get(key);
				if (!row) continue;
				const config = this.getType(write.entity_type);
				const recomputed = projectDocument(config, row.sparse_doc);
				if (!sameLengths(recomputed.lengths, lengthsFromRecord(row.lengths))) {
					stale.push(index);
				}
			}
			const stale_postings = new Map<string, Map<string, Map<string, number>>>();
			if (stale.length > 0) {
				const by_doc = postings.index(POSTINGS_BY_DOC_INDEX);
				const rows = await Promise.all(
					stale.map((index) =>
						request<PostingRow[]>(
							by_doc.getAll(
								IDBKeyRange.only([writes[index].entity_type, writes[index].doc_id]),
							) as IDBRequest<PostingRow[]>,
						),
					),
				);
				for (let slot = 0; slot < stale.length; slot++) {
					const write = writes[stale[slot]];
					const by_field = new Map<string, Map<string, number>>();
					for (const row of rows[slot]) {
						let field_tokens = by_field.get(row.field);
						if (!field_tokens) {
							field_tokens = new Map();
							by_field.set(row.field, field_tokens);
						}
						field_tokens.set(row.token, row.tf);
					}
					stale_postings.set(
						`${write.entity_type}${KEY_SEPARATOR}${write.doc_id}`,
						by_field,
					);
				}
			}

			// (3) the whole diff, synchronously.
			const plan = this.#planWrites(writes, previous, stale_postings);

			// (4) the `df` and statistics rows the deltas touch.
			const df_keys = [...plan.df_deltas.keys()].sort(compareStrings);
			const stat_keys = [...plan.stat_deltas.keys()].sort(compareStrings);
			const [df_rows, stat_rows] = await Promise.all([
				Promise.all(
					df_keys.map((key) => {
						const [entity_type, field, token] = key.split(KEY_SEPARATOR);
						return request<TokenRow | undefined>(
							tokens.get([entity_type, field, token]) as IDBRequest<TokenRow | undefined>,
						);
					}),
				),
				Promise.all(
					stat_keys.map((key) => {
						const [entity_type, field] = key.split(KEY_SEPARATOR);
						return request<FieldStatsRow | undefined>(
							field_stats.get([entity_type, field]) as IDBRequest<
								FieldStatsRow | undefined
							>,
						);
					}),
				),
			]);

			// (5) every write.
			for (const row of plan.posting_puts) postings.put(row);
			for (const key of plan.posting_deletes) postings.delete(key);
			for (const row of plan.doc_puts) docs.put(row);
			for (const key of plan.doc_deletes) docs.delete(key);

			dictionary_deltas = new Map();
			for (let index = 0; index < df_keys.length; index++) {
				const key = df_keys[index];
				const [entity_type, field, token] = key.split(KEY_SEPARATOR);
				const df = (df_rows[index]?.df ?? 0) + (plan.df_deltas.get(key) as number);
				if (df <= 0) {
					tokens.delete([entity_type, field, token]);
					if (df_rows[index]) dictionary_deltas.set(key, false);
				} else {
					tokens.put({ entity_type, field, token, df });
					if (!df_rows[index]) dictionary_deltas.set(key, true);
				}
			}
			for (let index = 0; index < stat_keys.length; index++) {
				const key = stat_keys[index];
				const [entity_type, field] = key.split(KEY_SEPARATOR);
				const delta = plan.stat_deltas.get(key) as FieldStats;
				const doc_count = (stat_rows[index]?.doc_count ?? 0) + delta.doc_count;
				const total_len = (stat_rows[index]?.total_len ?? 0) + delta.total_len;
				if (doc_count <= 0) field_stats.delete([entity_type, field]);
				else field_stats.put({ entity_type, field, doc_count, total_len });
			}

			for (const op of extra_ops) {
				const store = txn.objectStore(op.store);
				if (op.action === 'put') {
					if (op.key === undefined) store.put(op.value);
					else store.put(op.value, op.key);
				} else if (op.key !== undefined) {
					store.delete(op.key);
				}
			}

			await transactionDone(txn);
		} catch (error) {
			try {
				txn.abort();
			} catch {
				// Already committed or aborted — the original failure is what matters.
			}
			throw DelightError.from(error);
		}

		// Only once the transaction has actually committed: an aborted write must
		// never be visible through the dictionary cache.
		for (const [key, added] of dictionary_deltas) {
			const separator = key.lastIndexOf(KEY_SEPARATOR);
			const dictionary = this.#dictionaries.get(key.slice(0, separator));
			if (!dictionary) continue;
			const token = key.slice(separator + KEY_SEPARATOR.length);
			if (added) sortedInsert(dictionary, token);
			else sortedRemove(dictionary, token);
		}
	}

	/**
	 * The synchronous half of {@link applyWrites}: every posting, `df` and
	 * statistics delta the batch implies, computed with no IDB access at all.
	 */
	#planWrites(
		writes: readonly DocWrite[],
		previous: readonly (DocRow | undefined)[],
		stale_postings: ReadonlyMap<string, Map<string, Map<string, number>>>,
	): WritePlan {
		const plan: WritePlan = {
			posting_puts: [],
			posting_deletes: [],
			doc_puts: [],
			doc_deletes: [],
			df_deltas: new Map(),
			stat_deltas: new Map(),
		};
		/** The document's state as of the previous write in this same batch. */
		const state = new Map<
			string,
			| { postings: Map<string, Map<string, number>>; lengths: Map<string, number> }
			| undefined
		>();

		for (let index = 0; index < writes.length; index++) {
			const write = writes[index];
			const config = this.getType(write.entity_type);
			const doc_key = `${write.entity_type}${KEY_SEPARATOR}${write.doc_id}`;
			if (!state.has(doc_key)) {
				const row = previous[index];
				if (!row) {
					state.set(doc_key, undefined);
				} else {
					const recomputed = projectDocument(config, row.sparse_doc);
					const stored_lengths = lengthsFromRecord(row.lengths);
					const fallback = stale_postings.get(doc_key);
					state.set(
						doc_key,
						fallback
							? { postings: fallback, lengths: stored_lengths }
							: { postings: recomputed.postings, lengths: recomputed.lengths },
					);
				}
			}
			const old_state = state.get(doc_key);
			const next = write.sparse_doc
				? projectDocument(config, write.sparse_doc)
				: {
						postings: new Map<string, Map<string, number>>(),
						lengths: new Map<string, number>(),
					};

			this.#planPostingDiff(plan, write, old_state, next);
			this.#planStatDiff(plan, write.entity_type, old_state?.lengths, next.lengths);

			if (write.sparse_doc) {
				plan.doc_puts.push({
					entity_type: write.entity_type,
					doc_id: write.doc_id,
					sparse_doc: write.sparse_doc,
					lengths: lengthsToRecord(next.lengths),
				});
				state.set(doc_key, { postings: next.postings, lengths: next.lengths });
			} else {
				plan.doc_deletes.push([write.entity_type, write.doc_id]);
				state.set(doc_key, undefined);
			}
		}
		return plan;
	}

	/** Posting puts/deletes and `df` deltas for one document write. */
	#planPostingDiff(
		plan: WritePlan,
		write: DocWrite,
		old_state:
			| { postings: Map<string, Map<string, number>>; lengths: Map<string, number> }
			| undefined,
		next: ClientDocumentProjection,
	): void {
		const entity_type = write.entity_type;
		const fields = [
			...new Set([...(old_state?.postings.keys() ?? []), ...next.postings.keys()]),
		].sort(compareStrings);
		for (const field of fields) {
			const previous_tokens = old_state?.postings.get(field);
			const next_tokens = next.postings.get(field);
			const length = next.lengths.get(field) ?? 0;
			// The length rides on every posting row (§7.1), so when it moves, every
			// token of the field is rewritten — not only the ones whose `tf` changed.
			const length_changed = old_state?.lengths.get(field) !== length;
			const added: string[] = [];
			const removed: string[] = [];
			for (const [token, tf] of next_tokens ?? []) {
				if (!previous_tokens?.has(token)) added.push(token);
				if (length_changed || previous_tokens?.get(token) !== tf) {
					plan.posting_puts.push({
						entity_type,
						field,
						token,
						doc_id: write.doc_id,
						tf,
						len: length,
					});
				}
			}
			for (const token of previous_tokens?.keys() ?? []) {
				if (!next_tokens?.has(token)) removed.push(token);
			}
			added.sort(compareStrings);
			removed.sort(compareStrings);
			for (const token of removed) {
				plan.posting_deletes.push([entity_type, field, token, write.doc_id]);
			}
			for (const token of added) {
				const key = tokenKey(entity_type, field, token);
				plan.df_deltas.set(key, (plan.df_deltas.get(key) ?? 0) + 1);
			}
			for (const token of removed) {
				const key = tokenKey(entity_type, field, token);
				plan.df_deltas.set(key, (plan.df_deltas.get(key) ?? 0) - 1);
			}
		}
	}

	/** `N(field)` / `Σ len` deltas for one document write. */
	#planStatDiff(
		plan: WritePlan,
		entity_type: string,
		old_lengths: Map<string, number> | undefined,
		new_lengths: Map<string, number>,
	): void {
		const bump = (field: string, doc_count: number, total_len: number): void => {
			const key = fieldKey(entity_type, field);
			const current = plan.stat_deltas.get(key) ?? { doc_count: 0, total_len: 0 };
			current.doc_count += doc_count;
			current.total_len += total_len;
			plan.stat_deltas.set(key, current);
		};
		for (const [field, length] of old_lengths ?? []) bump(field, -1, -length);
		for (const [field, length] of new_lengths) bump(field, 1, length);
	}

	/* ---------------------------------------------------------------------- */
	/* Read path                                                              */
	/* ---------------------------------------------------------------------- */

	/**
	 * One field's term dictionary, ascending by **code point**, loaded once and
	 * then maintained incrementally by {@link applyWrites} (§7.3's mirror).
	 *
	 * The parallel code-point lengths and character signatures ride along so a
	 * tolerance scan can reject a candidate without touching its characters.
	 */
	async getTokenDictionary(
		entity_type: string,
		field: string,
	): Promise<CachedDictionary | null> {
		const key = fieldKey(entity_type, field);
		const cached = this.#dictionaries.get(key);
		if (cached !== undefined) return cached;
		const txn = this.db.transaction(TOKENS_STORE, 'readonly');
		const store = txn.objectStore(TOKENS_STORE);
		const range = tokenRange(entity_type, field);
		const count = await request<number>(store.count(range));
		if (count > this.max_cached_tokens) {
			// Past the cap the dictionary is not worth holding in memory; the caller
			// expands tokens through {@link expandToken}'s range scans instead.
			this.#dictionaries.set(key, null);
			return null;
		}
		const keys = await request<IDBValidKey[]>(store.getAllKeys(range));
		const tokens = keys.map((entry) => String((entry as IDBValidKey[])[2]));
		// Sorted in JS rather than trusted from IDB: IDB orders strings by code
		// unit, and the contract is `core/compare`'s code-point order.
		tokens.sort(compareStrings);
		const dictionary = buildCachedDictionary(tokens);
		this.#dictionaries.set(key, dictionary);
		return dictionary;
	}

	/**
	 * Expand one query token without a cached dictionary — the oversized-field
	 * fallback, the mirror of the server's `#expandTokenViaSql`.
	 *
	 * A prefix expansion is a single **range scan** over the `tokens` store,
	 * which is where the astral upper-bound rule earns its keep (§7.6): IDB
	 * compares strings by code unit, so the bound is built in code-unit space by
	 * {@link codeUnitUpperBound}. A tolerance expansion has to see every token
	 * anyway, so it reads the whole field.
	 *
	 * Output — and output *order* — is identical to the cached path's, because
	 * BM25 accumulation order is part of the determinism contract.
	 *
	 * `range_memo` is a caller-owned per-query cache: a tolerance expansion has
	 * to read the field's whole token range, and without the memo N query tokens
	 * would cost N identical full-range reads. Keyed by field; the caller passes
	 * a fresh map per query execution and awaits expansions sequentially so the
	 * first read populates it for the rest.
	 */
	async expandToken(
		entity_type: string,
		field: string,
		token: string,
		exact: boolean,
		tolerance: number,
		range_memo?: Map<string, string[]>,
	): Promise<string[]> {
		if (exact) {
			const txn = this.db.transaction(TOKENS_STORE, 'readonly');
			const row = await request<TokenRow | undefined>(
				txn.objectStore(TOKENS_STORE).get([entity_type, field, token]) as IDBRequest<
					TokenRow | undefined
				>,
			);
			return row ? [token] : [];
		}
		let tokens: string[];
		const memo_key = `${entity_type}${KEY_SEPARATOR}${field}`;
		if (tolerance > 0 && range_memo?.has(memo_key)) {
			tokens = range_memo.get(memo_key) as string[];
		} else {
			const txn = this.db.transaction(TOKENS_STORE, 'readonly');
			const range =
				tolerance > 0
					? tokenRange(entity_type, field)
					: tokenPrefixRange(entity_type, field, token);
			const keys = await request<IDBValidKey[]>(
				txn.objectStore(TOKENS_STORE).getAllKeys(range),
			);
			tokens = keys.map((entry) => String((entry as IDBValidKey[])[2]));
			tokens.sort(compareStrings);
			if (tolerance > 0) range_memo?.set(memo_key, tokens);
		}
		if (tolerance <= 0) return tokens.filter((candidate) => candidate.startsWith(token));
		const matcher = new ToleranceMatcher(token, tolerance);
		return tokens.filter(
			(candidate) => candidate.startsWith(token) || matcher.matches(candidate),
		);
	}

	/**
	 * Postings and `df` for a set of tokens, in ONE readonly transaction.
	 *
	 * `getAll(range)` per token rather than cursor iteration, batched with
	 * `Promise.all`: one event-loop round trip for the whole term, which is what
	 * keeps a query's IDB cost bounded on Safari (§7.6).
	 */
	async getTerms(
		entity_type: string,
		field: string,
		tokens: readonly string[],
	): Promise<Map<string, { df: number; postings: ClientPosting[] }>> {
		const result = new Map<string, { df: number; postings: ClientPosting[] }>();
		if (tokens.length === 0) return result;
		const txn = this.db.transaction([POSTINGS_STORE, TOKENS_STORE], 'readonly');
		const postings_store = txn.objectStore(POSTINGS_STORE);
		const tokens_store = txn.objectStore(TOKENS_STORE);
		const [posting_rows, token_rows] = await Promise.all([
			Promise.all(
				tokens.map((token) =>
					request<PostingRow[]>(
						postings_store.getAll(postingRange(entity_type, field, token)) as IDBRequest<
							PostingRow[]
						>,
					),
				),
			),
			Promise.all(
				tokens.map((token) =>
					request<TokenRow | undefined>(
						tokens_store.get([entity_type, field, token]) as IDBRequest<
							TokenRow | undefined
						>,
					),
				),
			),
		]);
		for (let index = 0; index < tokens.length; index++) {
			const postings: ClientPosting[] = posting_rows[index].map((row) => ({
				doc_id: String(row.doc_id),
				tf: row.tf,
				len: row.len,
			}));
			// IDB returns them in code-unit order; the accumulation order is the
			// core comparator's, so re-sort (§3 determinism).
			postings.sort((a, b) => compareStrings(a.doc_id, b.doc_id));
			result.set(tokens[index], { df: token_rows[index]?.df ?? 0, postings });
		}
		return result;
	}

	/** `N(field)` and `Σ len` for one field, zeroed when the field is unused. */
	async getFieldStats(entity_type: string, field: string): Promise<FieldStats> {
		const txn = this.db.transaction(FIELD_STATS_STORE, 'readonly');
		const row = await request<FieldStatsRow | undefined>(
			txn.objectStore(FIELD_STATS_STORE).get([entity_type, field]) as IDBRequest<
				FieldStatsRow | undefined
			>,
		);
		return row
			? { doc_count: row.doc_count, total_len: row.total_len }
			: { doc_count: 0, total_len: 0 };
	}

	/** Documents by id, batched in one readonly transaction. */
	async getDocs(
		entity_type: string,
		doc_ids: readonly string[],
	): Promise<Map<string, DocRow>> {
		const documents = new Map<string, DocRow>();
		if (doc_ids.length === 0) return documents;
		const txn = this.db.transaction(DOCS_STORE, 'readonly');
		const store = txn.objectStore(DOCS_STORE);
		const rows = await Promise.all(
			doc_ids.map((doc_id) =>
				request<DocRow | undefined>(
					store.get([entity_type, doc_id]) as IDBRequest<DocRow | undefined>,
				),
			),
		);
		for (const row of rows) if (row) documents.set(row.doc_id, row);
		return documents;
	}

	/** Every document of an entity type — the honest fallback when no index applies. */
	async getAllDocs(entity_type: string): Promise<DocRow[]> {
		const txn = this.db.transaction(DOCS_STORE, 'readonly');
		return await request<DocRow[]>(
			txn.objectStore(DOCS_STORE).getAll(entityRange(entity_type)) as IDBRequest<
				DocRow[]
			>,
		);
	}

	/**
	 * The first `wanted` documents of an entity type, ordered by a numeric
	 * `docs` index — the browse-page fast path (no term, no filter, one order
	 * field). Returns `null` whenever the index cannot answer *exactly*:
	 *
	 * - the path has no declared scalar index (`multiEntry` indexes carry no
	 *   entity prefix and duplicate array members);
	 * - any document's value at the path is missing or non-numeric — the index
	 *   cannot see missing values at all, and IDB's cross-type key order is not
	 *   `core/compare`'s, so either would silently drop or misplace documents.
	 *
	 * Within the numbers-only slice IDB's order IS the numeric order
	 * `compareForOrder` uses. Ties are returned as a *complete* group: iteration
	 * continues past `wanted` until the order value changes, so the caller can
	 * re-sort the returned rows with the full comparator (primary-key tie-break
	 * included) and get exactly the global first-`wanted` prefix.
	 */
	async readOrderedByNumericIndex(
		entity_type: string,
		path: string,
		descending: boolean,
		wanted: number,
	): Promise<{ rows: DocRow[]; total: number } | null> {
		const declaration = this.indexed_paths.get(path);
		if (!declaration || declaration.multi_entry) return null;
		const txn = this.db.transaction(DOCS_STORE, 'readonly');
		const docs = txn.objectStore(DOCS_STORE);
		const name = docIndexName(path);
		if (!docs.indexNames.contains(name)) return null;
		const index = docs.index(name);
		// Numbers-only slice of the compound index: every non-number value type
		// sorts above `Infinity` in IDB key order, so the range excludes them —
		// along with documents missing the path, which the index cannot see.
		const numeric_range = IDBKeyRange.bound(
			[entity_type, Number.NEGATIVE_INFINITY],
			[entity_type, Number.POSITIVE_INFINITY],
		);
		const [total, covered] = await Promise.all([
			request<number>(docs.count(entityRange(entity_type))),
			request<number>(index.count(numeric_range)),
		]);
		if (covered !== total) return null;
		const rows: DocRow[] = [];
		if (wanted > 0 && total > 0) {
			await new Promise<void>((resolve, reject) => {
				let boundary: number | undefined;
				const cursor_request = index.openCursor(
					numeric_range,
					descending ? 'prev' : 'next',
				);
				cursor_request.onsuccess = () => {
					const cursor = cursor_request.result;
					if (!cursor) return resolve();
					const value = (cursor.key as [string, number])[1];
					if (rows.length >= wanted && value !== boundary) return resolve();
					rows.push(cursor.value as DocRow);
					if (rows.length === wanted) boundary = value;
					cursor.continue();
				};
				cursor_request.onerror = () =>
					reject(cursor_request.error ?? new Error('IndexedDB cursor failed.'));
			});
		}
		return { rows, total };
	}

	/** How many documents of an entity type are indexed. */
	async countDocs(entity_type: string): Promise<number> {
		const txn = this.db.transaction(DOCS_STORE, 'readonly');
		return await request<number>(
			txn.objectStore(DOCS_STORE).count(entityRange(entity_type)),
		);
	}

	/** Index entries a probe would visit — the selectivity estimate. */
	async countProbe(entity_type: string, probe: CandidateProbe): Promise<number> {
		const txn = this.db.transaction(DOCS_STORE, 'readonly');
		const index = txn.objectStore(DOCS_STORE).index(docIndexName(probe.path));
		const counts = await Promise.all(
			probe.bounds.map((bound) =>
				request<number>(index.count(probeRange(entity_type, bound, probe.multi_entry))),
			),
		);
		return counts.reduce((total, count) => total + count, 0);
	}

	/**
	 * The candidate document ids a probe admits, ascending by code point.
	 *
	 * A `multiEntry` index is not compound (the spec forbids it), so its keys
	 * carry no entity type — but the primary keys it returns are
	 * `[entity_type, doc_id]` pairs, so the filter is free.
	 */
	async getProbeDocIds(entity_type: string, probe: CandidateProbe): Promise<string[]> {
		const txn = this.db.transaction(DOCS_STORE, 'readonly');
		const index = txn.objectStore(DOCS_STORE).index(docIndexName(probe.path));
		const key_lists = await Promise.all(
			probe.bounds.map((bound) =>
				request<IDBValidKey[]>(
					index.getAllKeys(probeRange(entity_type, bound, probe.multi_entry)),
				),
			),
		);
		const doc_ids = new Set<string>();
		for (const keys of key_lists) {
			for (const key of keys) {
				const pair = key as IDBValidKey[];
				if (String(pair[0]) !== entity_type) continue;
				doc_ids.add(String(pair[1]));
			}
		}
		return [...doc_ids].sort(compareStrings);
	}
}
