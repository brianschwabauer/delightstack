import { expose } from 'comlink';
import {
	idbGet,
	idbPut,
	idbDelete,
	idbDeleteByPrefix,
	idbBatch,
	deleteDatabase,
	type SyncMeta,
	type CachedEntity,
} from './database.idb';
import { DelightError } from '@delightstack/utilities';
import { IdbSearchEngine, requiresServer } from '../search/client/engine';
import {
	defineClientType,
	docIndexName,
	docIndexShapeMatches,
	IdbSearchStore,
	openSearchDatabase,
	DOCS_STORE,
	SEARCH_STORE_NAMES,
	type ClientSearchType,
	type DocIndexPath,
	type DocWrite,
	type ExtraStoreOp,
} from '../search/client/idb_store';
import type {
	SearchableType,
	SearchQuery,
	SearchQueryResults,
} from '../search/core/types';
import type { WhereSchema } from '../search/core/where';
import { type SearchQueryInput, encodeSearchQuery } from '../search-query';

/** Inline sync response type to avoid importing server module in worker context. */
interface SyncEntityResult {
	config?: Record<string, unknown>;
	config_version: number;
	deleted: (string | number)[];
	created: Record<string, unknown>[];
	updated: Record<string, unknown>[];
	start_updated_at: number;
	end_updated_at: number;
	first_updated_at: number;
	last_updated_at: number;
	/** The total number of rows in this entity's table on the server. */
	total_count?: number;
	/**
	 * The server withheld the page because `total_count` exceeded the request's
	 * `defer_over` — no rows shipped, no cursor advanced.
	 */
	deferred?: true;
	/**
	 * The server refused this entity type outright (a permission decision).
	 * Nothing shipped, and re-asking cannot change the answer.
	 */
	denied?: true;
}

interface SyncResponse {
	start_updated_at: number;
	end_updated_at: number;
	first_updated_at: number;
	last_updated_at: number;
	entity: Record<string, SyncEntityResult | undefined>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkerInitConfig {
	/** Serializable search configs extracted from table definitions */
	tables: Record<
		string,
		{
			index_schema: Record<string, unknown>;
			primary_key: string;
			primary_key_type?: 'string' | 'number';
		}
	>;
	/** Per-entity overrides */
	entities?: Record<
		string,
		{
			search_mode?: 'client' | 'server';
			cache?: boolean;
			/** Per-entity sync ceiling; overrides the global `max_synced_docs`. */
			max_synced_docs?: number | false;
		}
	>;
	/** IndexedDB database name */
	db_name: string;
	/**
	 * Backfill ceiling: an entity whose server table holds more rows than this
	 * is not mirrored locally — its backfill is deferred (count-only sync
	 * probes) and its queries answer from the server. `false` disables the
	 * ceiling. Defaults to 50 000. Entities explicitly forced
	 * `search_mode: 'client'` ignore this default (an explicit per-entity
	 * `max_synced_docs` still applies to them).
	 */
	max_synced_docs?: number | false;
	/** Injectable IDB factory (tests). Defaults to the worker's `indexedDB`. */
	idb_factory?: IDBFactory;
}

/** A transferable DelightError parsed from a failed API response body. */
async function transferableFromResponse(response: Response, fallback_message: string) {
	const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
	return DelightError.transferable({
		message: (body.message as string) || fallback_message,
		status: response.status,
		code: body.code as string | undefined,
		detail: body.detail as string | undefined,
	});
}

export interface WorkerSearchResult {
	hits: { id: string; document: Record<string, unknown>; score: number }[];
	count: number;
	/** Which side answered this result — the live routing decision, per result. */
	mode: 'client' | 'server';
	/**
	 * The client-issued query sequence token this result answers (echoed from
	 * `subscribe`/`updateSubscription`). The client discards a result whose
	 * token is older than the newest one it has already applied, so a slow
	 * query can never overwrite a newer one's results.
	 */
	token?: number;
	/**
	 * Set when the query failed. `hits`/`count` are then placeholders — the
	 * client keeps its last-known-good results displayed and surfaces this
	 * through its error state instead of blanking the list.
	 */
	error?: { message: string; status: number; code?: string; detail?: string };
}

interface EntitySyncState {
	/** `'server'` only when the app forced it — never an automatic downgrade. */
	search_mode: 'client' | 'server';
	config_version: number;
	last_synced_at: number;
	start_updated_at: number | undefined;
	end_updated_at: number | undefined;
	synced: boolean;
	cache_enabled: boolean;
	/** The resolved backfill ceiling; `undefined` means no ceiling. */
	max_synced_docs: number | undefined;
	/**
	 * The server declined the backfill because the table exceeds
	 * `max_synced_docs`. Re-probed (count-only, cheap) on every sync run, so it
	 * clears by itself when the table shrinks or the ceiling is raised.
	 */
	deferred: boolean;
	/**
	 * The server refused to sync this entity type. Unlike `deferred` it is NOT
	 * re-probed: a permission answer cannot change without a new request
	 * context, so the type is dropped from every later sync request and its
	 * queries route to the server. Persisted, so a reload does not re-attempt
	 * the backfill; the sign-out wipe is what clears it.
	 */
	denied: boolean;
	/** The server's last reported total row count for this entity's table. */
	server_total: number | undefined;
	primary_key: string;
	/** The flattened `dot.path → type` schema the client search engine works from. */
	schema: WhereSchema;
	/** The `docs` indexes this type's schema asks for. */
	index_paths: DocIndexPath[];
	/** The registered search config (primary key, text fields). */
	client_type: ClientSearchType;
}

type SearchSubscriber = {
	id: string;
	entity_type: string;
	query: SearchQueryInput;
	/** The sequence token of the query currently stored (echoed in results). */
	query_token: number;
	callback: (result: WorkerSearchResult) => void;
	/**
	 * Liveness probe registered by the client alongside `callback`. A Comlink
	 * call into a closed MessagePort never settles (SharedWorker ports have no
	 * close event), so the sweep drops subscribers whose ping times out.
	 * Optional for wire compatibility with clients that don't send one — those
	 * are never swept.
	 */
	ping?: () => unknown;
};

/** Cache entries fresher than this are not background-refreshed (ms) */
const REFRESH_STALE_MS = 30_000;

/**
 * The default backfill ceiling (`max_synced_docs`). Above this many rows, a
 * table is not mirrored into the client index — the download and the index
 * build both stop being worth it, and the server answers instead.
 */
const DEFAULT_MAX_SYNCED_DOCS = 50_000;

/**
 * How long a server-search result may answer an identical subscription query
 * again. Deliberately short: it exists to absorb rapid query oscillation
 * (typing, then backspacing to a term already answered) — and it only guards
 * against changes this worker never heard about, because any known change
 * bumps the entity's cache generation and invalidates everything at once.
 */
const SERVER_SEARCH_CACHE_TTL_MS = 10_000;

/** Max cached server-search results (LRU). */
const SERVER_SEARCH_CACHE_MAX = 50;

/** How often the subscriber liveness sweep runs (only while subscribers exist). */
const SUBSCRIBER_SWEEP_MS = 60_000;

/** How long a subscriber's ping may take before it is presumed dead. */
const SUBSCRIBER_PING_TIMEOUT_MS = 5_000;

/** The legacy index blob store, dropped on the first search-store upgrade. */
const LEGACY_SEARCH_INDEX_STORE = 'search_index';

/** The worker-owned stores that live in the same database as the search stores. */
const WORKER_STORES = [{ name: 'entities' }, { name: 'sync_meta' }] as const;

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

/** Every declared type the flattener recognizes as a leaf. */
function isSearchableType(value: unknown): value is SearchableType {
	if (typeof value !== 'string') return false;
	return (
		value === 'string' ||
		value === 'number' ||
		value === 'boolean' ||
		value === 'enum' ||
		value === 'geopoint' ||
		value === 'string[]' ||
		value === 'number[]' ||
		value === 'boolean[]' ||
		value === 'enum[]' ||
		value.startsWith('vector[')
	);
}

/**
 * Flatten the nested table schema into the engine's `dot.path → type` map.
 *
 * The same derivation `search/server/table_config.ts` does for the server
 * driver, duplicated here rather than imported so the worker bundle never pulls
 * in the server engine. `{ address: { city: 'string' } }` becomes
 * `{ 'address.city': 'string' }` — and `toSparse` builds genuinely nested
 * objects for exactly those paths, which is what makes the `docs` index
 * keyPath `sparse_doc.address.city` resolve. Derived fields are top-level field
 * names, so they are ordinary top-level keys in the synced document.
 */
function flattenSearchSchema(schema: unknown, prefix = ''): WhereSchema {
	const flat: WhereSchema = {};
	if (!schema || typeof schema !== 'object') return flat;
	for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (isSearchableType(value)) {
			flat[path] = value;
			continue;
		}
		Object.assign(flat, flattenSearchSchema(value, path));
	}
	return flat;
}

/** Whether a declared type's values can be IDB index keys at all. */
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

/** Whether a declared type holds a list of values (a `multiEntry` index). */
function isArrayType(type: SearchableType): boolean {
	return type === 'string[]' || type === 'number[]' || type === 'enum[]';
}

/**
 * The `docs` indexes a schema deserves: every string/number/enum path, with
 * `multiEntry` on the array ones. Booleans get none (not valid IDB keys), and
 * neither do geopoints or vectors. An index is only ever a candidate-range
 * optimization — `core/where` decides membership either way — so a missing one
 * costs a scan, never a wrong answer.
 */
function indexPathsFor(schema: WhereSchema): DocIndexPath[] {
	return Object.keys(schema)
		.filter((path) => isIndexableType(schema[path]))
		.sort()
		.map((path) => ({ path, multi_entry: isArrayType(schema[path]) }));
}

/**
 * JSON.stringify with object keys sorted at every depth, so two structurally
 * equal queries produce one string regardless of property insertion order.
 * Used to coalesce identical subscriber queries into a single execution.
 */
function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(',')}]`;
	}
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
		return `{${entries.join(',')}}`;
	}
	return JSON.stringify(value) ?? 'null';
}

/** Read a `dot.path` off a document. */
function readPath(doc: Record<string, unknown>, path: string): unknown {
	let current: unknown = doc;
	for (const segment of path.split('.')) {
		if (!current || typeof current !== 'object' || Array.isArray(current))
			return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

/** Write a `dot.path` into a document, creating the intermediate objects. */
function writePath(doc: Record<string, unknown>, path: string, value: unknown): void {
	const segments = path.split('.');
	let container = doc;
	for (let index = 0; index < segments.length - 1; index++) {
		const next = container[segments[index]];
		if (!next || typeof next !== 'object' || Array.isArray(next)) {
			const created: Record<string, unknown> = {};
			container[segments[index]] = created;
			container = created;
		} else {
			container = next as Record<string, unknown>;
		}
	}
	container[segments[segments.length - 1]] = value;
}

/**
 * The local stand-in for the server's `toSparse` — the *optimistic* projection.
 *
 * Synced documents are indexed verbatim (§7.0: the wire is the projection). A
 * document that originates in this tab — a create/update response, a websocket
 * event carrying the full entity, a local patch — has no sparse form yet, so it
 * is reshaped the same way `toSparse` does: keep exactly the declared searchable
 * paths, drop null/undefined, keep every value **as it is** (no type guarding —
 * a mistyped value can only mis-tokenize, never throw). FK-derived fields cannot
 * be computed here and simply arrive with the server echo, which overwrites this
 * document wholesale.
 */
function toSparseLike(
	schema: WhereSchema,
	entity: Record<string, unknown>,
): Record<string, unknown> {
	const sparse: Record<string, unknown> = {};
	for (const path of Object.keys(schema)) {
		const value = readPath(entity, path);
		if (value === null || value === undefined) continue;
		writePath(sparse, path, value);
	}
	return sparse;
}

/** The 400 an unknown entity type earns, encoded to survive Comlink. */
function unknownEntityType(entity_type: string): DelightError {
	return DelightError.transferable({
		message: `Unknown entity type: ${entity_type}`,
		status: 400,
		code: 'unknown_entity_type',
	});
}

/** A structured-cloneable error payload for a subscription callback. */
function searchErrorPayload(error: unknown): NonNullable<WorkerSearchResult['error']> {
	// A transferable error carries a JSON envelope as its message; decode it so
	// the payload's message is the human one, not the envelope.
	const decoded = DelightError.fromWorker(error) ?? DelightError.from(error);
	return {
		message: decoded.message,
		status: decoded.status,
		...(decoded.code ? { code: decoded.code } : {}),
		...(decoded.detail ? { detail: decoded.detail } : {}),
	};
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export class DatabaseWorker {
	#db: IDBDatabase | null = null;
	#entities: Record<string, EntitySyncState> = {};
	#tables: WorkerInitConfig['tables'] = {};
	#search_subscribers: SearchSubscriber[] = [];
	#subscriber_counter = 0;
	/**
	 * The liveness-sweep interval. Running only while subscribers exist, so an
	 * otherwise-idle worker holds no live timer.
	 */
	#liveness_timer: ReturnType<typeof setInterval> | null = null;
	#pending_notify = new Set<string>();
	#notify_scheduled = false;
	#pending_refreshes = new Set<string>();
	#db_name: string | undefined;
	#sync_in_flight: Promise<void> | null = null;
	/** The IndexedDB postings store — the whole client search index (§7.6). */
	#store: IdbSearchStore | null = null;
	/** Entity types the app explicitly marked client-side (§7.6 rule 2). */
	#forced_client = new Set<string>();
	/** The async driver over {@link #store}. */
	#engine: IdbSearchEngine | null = null;
	#idb_factory: IDBFactory | undefined;
	/**
	 * IndexedDB could not be opened at all (private browsing, storage blocked).
	 * The worker then runs in server-only mode: reads via server search,
	 * writes via the server, no local index or cache.
	 */
	#idb_unavailable = false;
	/** Single-flight guard for the lazy post-`versionchange` reopen. */
	#reopen_promise: Promise<void> | null = null;
	/** When the last lazy reopen failed — throttles retry loops. */
	#reopen_failed_at = 0;
	/**
	 * Server-search result cache: `entity_type?query-string` → result. Read
	 * only by subscription paths (never one-shot `list` or a manual refresh),
	 * TTL-bounded, and generation-busted per entity on every known change.
	 */
	#server_search_cache = new Map<
		string,
		{ result: WorkerSearchResult; at: number; generation: number }
	>();
	/** Per-entity cache generation; bumped whenever the entity's data changes. */
	#server_search_generation = new Map<string, number>();
	/**
	 * Sign-out wipe in progress / completed. While set, subscriber
	 * notifications are suppressed, in-flight sync loops bail at their next
	 * checkpoint, and the lazy reopen never resurrects the deleted database.
	 * Cleared by the next `init()` (fresh sign-in).
	 */
	#wiped = false;
	/** Cross-worker invalidation channel (dedicated-Worker fallback, §7.6). */
	#channel: BroadcastChannel | null = null;
	/** Identifies this worker instance on {@link #channel}. */
	readonly #instance_id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	async init(config: WorkerInitConfig): Promise<void> {
		// A fresh init un-wipes: after a sign-out wipe, the next sign-in
		// re-initializes and the worker must come back to life normally.
		this.#wiped = false;

		// A SharedWorker is initialized by EVERY connecting tab. Re-running init
		// for the same database would discard in-memory sync state (and any
		// un-persisted cursor state) while another tab's sync loop is mid-flight.
		// A server-only worker (IDB unavailable) is initialized too — retrying
		// the open on every connecting tab buys nothing.
		if ((this.#db || this.#idb_unavailable) && this.#db_name === config.db_name) return;

		// Switching scope (different db_name): tear down the previous state
		// cleanly. This applies to ALL tabs sharing the worker — a scope switch
		// (e.g. changing orgs) is a global decision, not a per-tab one.
		if (this.#db) {
			this.#db.close();
			this.#db = null;
			this.#store = null;
			this.#engine = null;
			this.#entities = {};
			this.#pending_refreshes.clear();
			this.#server_search_cache.clear();
			this.#server_search_generation.clear();
		}
		this.#idb_unavailable = false;

		this.#tables = config.tables;
		this.#forced_client = new Set(
			Object.entries(config.entities ?? {})
				.filter(([, overrides]) => overrides?.search_mode === 'client')
				.map(([entity_type]) => entity_type),
		);
		this.#idb_factory = config.idb_factory;
		this.#db_name = config.db_name;

		// The search stores live in the SAME database as `entities`/`sync_meta`,
		// so an index write and the sync cursor that accounts for it can commit in
		// one transaction (§7.6). Opening it needs the persisted `config_version`s
		// (they decide the IDB version), and those live inside it — so open at
		// whatever version exists, read the metas, then upgrade if needed.
		//
		// When IndexedDB itself is unavailable (private browsing, storage
		// blocked, a permanently blocked upgrade) the worker must still come up:
		// every entity is registered regardless, `#routesToClient` answers false
		// with no engine, so reads go to server search and writes to the server —
		// degraded, never dead.
		try {
			this.#db = await openSearchDatabase({
				name: config.db_name,
				extra_stores: WORKER_STORES,
				factory: this.#idb_factory,
			});
			this.#attachVersionChange(this.#db);
		} catch (error) {
			this.#idb_unavailable = true;
			console.error(
				'[database] IndexedDB is unavailable — continuing in server-only mode (no local search index or entity cache)',
				error,
			);
		}

		this.#openChannel(config.db_name);

		// Initialize per-entity state
		for (const [entity_type, table] of Object.entries(config.tables)) {
			const overrides = config.entities?.[entity_type];
			const forced_mode = overrides?.search_mode;

			// The backfill ceiling, resolved: an explicit per-entity value always
			// wins (false = no ceiling); otherwise a forced-'client' entity is
			// exempt (the app asserted local-first for it); otherwise the global
			// config, defaulting to DEFAULT_MAX_SYNCED_DOCS.
			const explicit_ceiling = overrides?.max_synced_docs;
			const global_ceiling = config.max_synced_docs;
			const max_synced_docs =
				explicit_ceiling !== undefined
					? explicit_ceiling === false
						? undefined
						: explicit_ceiling
					: forced_mode === 'client'
						? undefined
						: global_ceiling === false
							? undefined
							: (global_ceiling ?? DEFAULT_MAX_SYNCED_DOCS);

			// Load persisted sync meta
			const meta = this.#db
				? await idbGet<SyncMeta>(this.#db, 'sync_meta', entity_type).catch(
						() => undefined,
					)
				: undefined;

			const schema = flattenSearchSchema(table.index_schema);
			this.#entities[entity_type] = {
				search_mode: forced_mode ?? meta?.search_mode ?? 'client',
				config_version: meta?.config_version ?? 0,
				last_synced_at: meta?.last_synced_at ?? 0,
				start_updated_at: meta?.start_updated_at,
				end_updated_at: meta?.end_updated_at,
				synced: false,
				cache_enabled: overrides?.cache !== false,
				max_synced_docs,
				// Deferral is a live decision, re-probed on every sync run; the
				// persisted total just carries the last known answer across reloads.
				deferred:
					max_synced_docs !== undefined &&
					meta?.server_total !== undefined &&
					meta.server_total > max_synced_docs,
				// Denial IS restored: re-asking would only earn the same refusal,
				// and a re-attempted backfill is exactly what it forbids.
				denied: meta?.denied === true,
				server_total: meta?.server_total,
				primary_key: table.primary_key,
				schema,
				index_paths: indexPathsFor(schema),
				client_type: defineClientType({
					entity_type,
					schema,
					primary_key: table.primary_key,
					primary_key_type: table.primary_key_type,
				}),
			};
		}

		await this.#reconcileSearchDatabase();

		// Sync is NOT awaited here — the main thread controls sync lifecycle
	}

	/**
	 * Bring the database up to the version the current `config_version`s and
	 * index declarations ask for, and (re)build the store + driver over it.
	 *
	 * The version is `1 + Σ config_version` (§7.6: derived from `config_version`,
	 * so a schema change re-creates the indexes through the machinery that already
	 * handles config bumps). Two things can still ask for an upgrade at an
	 * unchanged sum — a database created before this design (no search stores, a
	 * leftover `search_index` blob store) and a code deploy that changes a table's
	 * indexable paths — so the declared indexes are compared against the live ones
	 * and an upgrade is forced on any mismatch.
	 */
	async #reconcileSearchDatabase(): Promise<void> {
		if (!this.#db || !this.#db_name) return;
		const index_paths = this.#allIndexPaths();
		let wanted = 1;
		for (const state of Object.values(this.#entities)) wanted += state.config_version;

		if (wanted > this.#db.version || this.#indexesDiffer(this.#db, index_paths)) {
			const version = Math.max(wanted, this.#db.version + 1);
			this.#db.close();
			try {
				this.#db = await openSearchDatabase({
					name: this.#db_name,
					version,
					index_paths,
					extra_stores: WORKER_STORES,
					delete_stores: [LEGACY_SEARCH_INDEX_STORE],
					factory: this.#idb_factory,
				});
			} catch (error) {
				// The upgrade could not run (another connection blocking past the
				// timeout, storage revoked mid-session). Fall back to server-only
				// mode rather than killing init — a later use retries the reopen.
				this.#db = null;
				this.#store = null;
				this.#engine = null;
				console.error(
					'[database] failed to upgrade the search database — continuing in server-only mode',
					error,
				);
				return;
			}
			this.#attachVersionChange(this.#db);
		}

		this.#store = new IdbSearchStore(this.#db, { index_paths });
		for (const state of Object.values(this.#entities)) {
			this.#store.register(state.client_type);
		}
		this.#engine = new IdbSearchEngine(this.#store);
	}

	/** Every declared `docs` index across every entity type, de-duplicated. */
	#allIndexPaths(): DocIndexPath[] {
		const paths = new Map<string, DocIndexPath>();
		for (const state of Object.values(this.#entities)) {
			for (const declaration of state.index_paths) {
				const existing = paths.get(declaration.path);
				// Two types declaring the same path with different arity is a schema
				// conflict IDB cannot express (one index, one keyPath). `multiEntry`
				// wins: it indexes scalars too, so the range scan stays a superset.
				if (!existing || (declaration.multi_entry && !existing.multi_entry)) {
					paths.set(declaration.path, declaration);
				}
			}
		}
		return [...paths.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
	}

	/**
	 * Whether the live `docs` indexes are not exactly the declared ones —
	 * by name AND by physical shape. A path whose declared arity flips
	 * (`'string'` → `'string[]'`, or the "multiEntry wins" merge changing its
	 * pick) keeps its index name but needs a different keyPath/multiEntry
	 * shape; a stale index of the wrong shape returns zero rows from every
	 * probe, silently excluding documents. Shape drift therefore forces the
	 * same version bump a name change does.
	 */
	#indexesDiffer(db: IDBDatabase, index_paths: readonly DocIndexPath[]): boolean {
		for (const name of SEARCH_STORE_NAMES) {
			if (!db.objectStoreNames.contains(name)) return true;
		}
		for (const store of WORKER_STORES) {
			if (!db.objectStoreNames.contains(store.name)) return true;
		}
		if (db.objectStoreNames.contains(LEGACY_SEARCH_INDEX_STORE)) return true;
		const txn = db.transaction(DOCS_STORE, 'readonly');
		try {
			const docs = txn.objectStore(DOCS_STORE);
			const live = new Set(Array.from(docs.indexNames));
			if (live.size !== index_paths.length) return true;
			for (const declaration of index_paths) {
				const name = docIndexName(declaration.path);
				if (!live.has(name)) return true;
				if (!docIndexShapeMatches(docs.index(name), declaration)) return true;
			}
			return false;
		} finally {
			txn.abort();
		}
	}

	/**
	 * Release the connection when another tab needs to upgrade.
	 *
	 * Production is a SharedWorker (one connection), but the per-tab `Worker`
	 * fallback gives every tab its own connection to one database — without this,
	 * the tab that upgrades gets `onblocked` (a 503) forever.
	 */
	#attachVersionChange(db: IDBDatabase): void {
		db.onversionchange = () => {
			db.close();
			if (this.#db === db) {
				this.#db = null;
				this.#store = null;
				this.#engine = null;
			}
		};
	}

	/**
	 * Lazily reopen the database after `versionchange` released it (item: a
	 * closed connection must degrade one call, not the whole session). Single-
	 * flighted, and failure is throttled so a broken environment does not retry
	 * on every call. No-op when the store is live or IDB was never available.
	 */
	async #ensureStore(): Promise<void> {
		if (this.#wiped || this.#engine || !this.#db_name || this.#idb_unavailable) return;
		if (Date.now() - this.#reopen_failed_at < 5_000) return;
		this.#reopen_promise ??= (async () => {
			const db = await openSearchDatabase({
				name: this.#db_name as string,
				extra_stores: WORKER_STORES,
				factory: this.#idb_factory,
			});
			this.#db = db;
			this.#attachVersionChange(db);
			await this.#reconcileSearchDatabase();
		})();
		try {
			await this.#reopen_promise;
			this.#reopen_failed_at = 0;
		} catch (error) {
			this.#reopen_failed_at = Date.now();
			this.#db = null;
			this.#store = null;
			this.#engine = null;
			console.error('[database] failed to reopen the search database', error);
		} finally {
			this.#reopen_promise = null;
		}
	}

	// -----------------------------------------------------------------------
	// Cross-worker invalidation (dedicated-Worker fallback)
	// -----------------------------------------------------------------------

	/**
	 * Under the per-tab `Worker` fallback (no SharedWorker — Chrome Android),
	 * every tab runs its own worker over ONE shared IndexedDB. Without a
	 * channel, tab B's in-memory dictionary cache never learns tab A's tokens,
	 * its subscriptions never re-run for A's writes, and both tabs run sync
	 * loops. A `BroadcastChannel` named after the database carries commit
	 * invalidations; harmless under a SharedWorker (one instance, no peers).
	 */
	#openChannel(db_name: string): void {
		if (typeof BroadcastChannel === 'undefined') return;
		this.#channel?.close();
		const channel = new BroadcastChannel(`delight-db-${db_name}`);
		// Node exposes `unref` — never keep a process alive for this channel.
		(channel as unknown as { unref?: () => void }).unref?.();
		channel.onmessage = (event: MessageEvent) => {
			const data = event.data as {
				type?: string;
				source?: string;
				entity_types?: string[];
			} | null;
			if (!data || data.source === this.#instance_id) return;
			// A peer wiped the database (sign-out). Drop everything silently —
			// this tab is signing out too, so its subscribers must NOT be
			// notified (no UI flash between the wipe and the app's navigation).
			if (data.type === 'wiped') {
				this.#applyRemoteWipe();
				return;
			}
			if (data.type !== 'invalidate') return;
			void this.#applyRemoteInvalidation(data.entity_types ?? []).catch(() => {});
		};
		this.#channel = channel;
	}

	/** Tell peer workers over the same database that these types changed. */
	#broadcastInvalidation(entity_types: readonly string[]): void {
		if (this.#wiped || !this.#channel || entity_types.length === 0) return;
		try {
			this.#channel.postMessage({
				type: 'invalidate',
				source: this.#instance_id,
				entity_types: [...entity_types],
			});
		} catch {
			// A closed channel (tear-down race) — nothing to invalidate anymore.
		}
	}

	/** A peer worker committed writes: refresh caches and re-run subscribers. */
	async #applyRemoteInvalidation(entity_types: string[]): Promise<void> {
		const known = entity_types.filter((entity_type) => this.#entities[entity_type]);
		if (known.length === 0) return;
		// Cheap full drop: the peer's writes may have added/removed dictionary
		// tokens this instance cached in memory. The next query reloads from IDB.
		this.#store?.clearDictionaryCache();
		// Adopt the peer's persisted sync window when it is newer than ours, so
		// routing (start_updated_at === 0) reflects the sync the peer ran.
		if (this.#db) {
			for (const entity_type of known) {
				const meta = await idbGet<SyncMeta>(this.#db, 'sync_meta', entity_type).catch(
					() => undefined,
				);
				const state = this.#entities[entity_type];
				if (!meta || !state || meta.last_synced_at <= state.last_synced_at) continue;
				state.start_updated_at = meta.start_updated_at;
				state.end_updated_at = meta.end_updated_at;
				state.last_synced_at = meta.last_synced_at;
			}
		}
		this.#notifySubscribers(known);
	}

	/**
	 * Sign-out data wipe: silence first, then delete everything persisted.
	 *
	 * Order matters for the no-flash guarantee:
	 * 1. Clear `#search_subscribers` and set `#wiped` synchronously — from this
	 *    line on, no subscriber notification can fire (`#notifySubscribers` is a
	 *    no-op) and no new sync can start.
	 * 2. Wait for an in-flight sync to observe the flag and stop — its loop
	 *    bails at the next await boundary instead of writing into (or notifying
	 *    about) a database that is about to disappear.
	 * 3. Close this worker's IDB connection, tell peer workers (dedicated-Worker
	 *    fallback) to silently drop theirs, then `deleteDatabase`. Peers that
	 *    have not processed the broadcast yet are released by the
	 *    `versionchange` event the deletion fires (their `#attachVersionChange`
	 *    handler closes on it), so the deletion cannot block forever.
	 *
	 * The worker stays alive but inert; the next `init()` (fresh sign-in)
	 * clears the wiped flag and rebuilds from scratch. Under a SharedWorker
	 * this wipes for every tab of the origin by design — sign-out is
	 * account-level.
	 */
	async wipe(): Promise<void> {
		// 1. Silence — synchronously, before any await.
		this.#wiped = true;
		this.#search_subscribers = [];
		this.#stopLivenessSweep();
		this.#pending_notify.clear();
		this.#pending_refreshes.clear();
		this.#server_search_cache.clear();
		this.#server_search_generation.clear();

		// 2. Let an in-flight sync run into the wiped flag and stop. This also
		//    honors the single-flight lock: no sync loop survives this await.
		if (this.#sync_in_flight) await this.#sync_in_flight.catch(() => {});

		// 3. Tell peers to silently drop, close our connection, delete the db.
		if (this.#channel) {
			try {
				this.#channel.postMessage({ type: 'wiped', source: this.#instance_id });
			} catch {
				// A closed channel (tear-down race) — no peers to tell.
			}
		}
		if (this.#db) {
			this.#db.close();
			this.#db = null;
		}
		this.#store = null;
		this.#engine = null;
		this.#entities = {};
		this.#reopen_promise = null;
		this.#reopen_failed_at = 0;

		if (this.#db_name && !this.#idb_unavailable) {
			await deleteDatabase(this.#db_name, this.#idb_factory);
		}
	}

	/**
	 * A peer worker wiped the shared database (sign-out in another tab). Drop
	 * every in-memory trace WITHOUT notifying subscribers — this tab is signing
	 * out too, and its displayed UI must stay frozen until the app navigates.
	 */
	#applyRemoteWipe(): void {
		this.#wiped = true;
		this.#search_subscribers = [];
		this.#stopLivenessSweep();
		this.#pending_notify.clear();
		this.#pending_refreshes.clear();
		this.#server_search_cache.clear();
		this.#server_search_generation.clear();
		if (this.#db) {
			this.#db.close();
			this.#db = null;
		}
		this.#store = null;
		this.#engine = null;
		this.#entities = {};
		this.#reopen_promise = null;
		this.#reopen_failed_at = 0;
	}

	async destroy(): Promise<void> {
		this.#search_subscribers = [];
		this.#stopLivenessSweep();
		this.#store = null;
		this.#engine = null;
		if (this.#db) {
			this.#db.close();
			this.#db = null;
		}
		this.#channel?.close();
		this.#channel = null;
		this.#db_name = undefined;
		this.#entities = {};
		this.#pending_refreshes.clear();
	}

	// -----------------------------------------------------------------------
	// Sync
	// -----------------------------------------------------------------------

	async sync(entity_types?: string[]): Promise<void> {
		if (this.#wiped) return;
		// Single-flight: concurrent sync calls (e.g. several tabs sharing this
		// worker) would interleave cursor updates and corrupt pagination state.
		if (this.#sync_in_flight) return this.#sync_in_flight;
		this.#sync_in_flight = this.#syncSingleFlight(entity_types).finally(() => {
			this.#sync_in_flight = null;
		});
		return this.#sync_in_flight;
	}

	/**
	 * Cross-TAB single flight, on top of the in-instance one above: under the
	 * dedicated-Worker fallback every tab has its own worker over one shared
	 * database, and two concurrent sync loops would interleave cursor writes.
	 * Web Locks arbitrates; when another tab already holds the lock this run is
	 * skipped — that tab's commit broadcast invalidates us when it lands.
	 * Harmless under a SharedWorker (one instance, the lock is always free).
	 */
	async #syncSingleFlight(entity_types?: string[]): Promise<void> {
		const locks =
			typeof navigator !== 'undefined'
				? (navigator as { locks?: LockManager }).locks
				: undefined;
		if (!locks || !this.#db_name) return this.#runSync(entity_types);
		await locks.request(
			`delight-db-sync-${this.#db_name}`,
			{ ifAvailable: true },
			async (lock) => {
				if (!lock) return;
				await this.#runSync(entity_types);
			},
		);
	}

	/**
	 * Pages through the server's sync endpoint until every entity is caught up.
	 *
	 * Each entity tracks a synced window [start_updated_at, end_updated_at]:
	 * - `start_updated_at === undefined` — never synced. Request with no range:
	 *   the server returns the NEWEST page first (descending).
	 * - `start_updated_at > 0` — backfill in progress. Request the page of
	 *   history older than our window (`end_updated_at: state.start_updated_at`,
	 *   descending) until we reach the server's first_updated_at.
	 * - `start_updated_at === 0` — backfill complete. Request changes newer than
	 *   our window (`start_updated_at: state.end_updated_at`, ascending).
	 *
	 * The range for each entity is sent in the per-entity body fields (which the
	 * server treats as authoritative range overrides) — never in both the body
	 * and URL params, which previously made the cursor echo back as a range and
	 * re-fetched the same page forever.
	 */
	async #runSync(entity_types?: string[]): Promise<void> {
		// A `versionchange` may have released the connection — try to reopen
		// before giving up on the run.
		await this.#ensureStore();
		if (!this.#db) return;

		const types = entity_types ?? Object.keys(this.#entities);
		if (types.length === 0) return;

		/** Entities that need no further pages this run */
		const done = new Set<string>();
		/** Entities that are confirmed fully caught up with the server */
		const caught_up = new Set<string>();
		/** Entities whose local index this run changed — broadcast to peers. */
		const changed = new Set<string>();
		/**
		 * Entities whose routing decision flipped THIS run: the backfill hit the
		 * `start_updated_at === 0` sentinel, so subscriptions that were answering
		 * from the server may now route client-side. They need a re-run even when
		 * no document changed.
		 */
		const routing_flipped = new Set<string>();

		let num_requests = 0;
		let pages_without_changes = 0;
		while (num_requests++ < 50) {
			// A denied type is dropped from the request entirely — asking again
			// only earns the same refusal, and an empty per-entity result would
			// otherwise read as "the server doesn't know this type".
			const client_types = types.filter(
				(t) =>
					this.#entities[t]?.search_mode === 'client' &&
					!this.#entities[t]?.denied &&
					!done.has(t),
			);
			if (client_types.length === 0) break;

			// Build the per-entity sync ranges for this page
			const entity_request: Record<string, unknown> = {};
			const descending_request = new Set<string>();
			for (const entity_type of client_types) {
				const state = this.#entities[entity_type];
				// The backfill ceiling rides only on backfill-phase (descending)
				// requests: a table the client already fully mirrors keeps syncing
				// incrementally however large it grows — the download was already
				// paid for, and ascending pages are cheap. The ceiling exists to
				// prevent the big download, not to evict a finished index.
				const defer_over =
					state.max_synced_docs !== undefined
						? { defer_over: state.max_synced_docs }
						: undefined;
				if (state.start_updated_at === undefined) {
					// Never synced — newest page first
					entity_request[entity_type] = {
						config_version: state.config_version,
						...defer_over,
					};
					descending_request.add(entity_type);
				} else if (state.start_updated_at > 0) {
					// Backfilling — the page of history just older than our window
					entity_request[entity_type] = {
						config_version: state.config_version,
						end_updated_at: state.start_updated_at,
						...defer_over,
					};
					descending_request.add(entity_type);
				} else {
					// Backfill complete — changes newer than our window
					entity_request[entity_type] = {
						config_version: state.config_version,
						start_updated_at: state.end_updated_at ?? 0,
					};
				}
			}

			let body: SyncResponse | undefined;
			try {
				const response = await fetch(`/api/sync`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ entity: entity_request }),
				});
				if (!response.ok) return; // leave state resumable; do NOT mark synced
				body = (await response.json().catch(() => undefined)) as SyncResponse | undefined;
			} catch {
				return; // network error — leave state resumable; do NOT mark synced
			}
			if (!body) return;
			// A wipe landed while the request was in flight — nothing this page
			// carries may be written or notified about.
			if (this.#wiped) return;

			let any_changes = false;

			for (const entity_type of client_types) {
				const state = this.#entities[entity_type];
				const entity_result = body.entity[entity_type];
				if (!entity_result) {
					// The server doesn't know this entity type — nothing more to do,
					// but don't mark it as successfully synced either
					done.add(entity_type);
					continue;
				}

				// Handle schema changes — wipe the local index and restart this
				// entity's sync from scratch (the old window refers to documents
				// shaped by the old schema), and drop the cached entities
				if (
					entity_result.config &&
					entity_result.config_version !== state.config_version
				) {
					await this.#applyConfigBump(
						entity_type,
						entity_result.config,
						entity_result.config_version,
					);
					descending_request.add(entity_type);
					changed.add(entity_type);
				}

				if (entity_result.total_count !== undefined) {
					state.server_total = entity_result.total_count;
				}
				if (entity_result.denied) {
					// A permission refusal, not a size one: no re-probe, ever. The
					// type leaves the sync request for good (the flag is persisted,
					// so a reload doesn't re-attempt the backfill either) and its
					// queries route to the server — which may still answer them,
					// under its own per-request rules.
					const newly_denied = !state.denied;
					state.denied = true;
					done.add(entity_type);
					// The routing decision changed for a type that may have been
					// answering locally a moment ago.
					routing_flipped.add(entity_type);
					// Only the TRANSITION purges: a denied type is dropped from
					// every later request, and a reload restores the flag before
					// the first one, so this runs at most once per revocation.
					if (newly_denied) {
						await this.#purgeDeniedEntity(entity_type);
						if (this.#wiped) return;
						changed.add(entity_type);
					}
					continue;
				}

				if (entity_result.deferred) {
					// The table exceeds this entity's `max_synced_docs` — the server
					// withheld the page. No cursor moved; queries keep routing to the
					// server (the window stays incomplete). The next sync run re-probes
					// (count-only), so shrinking below the ceiling resumes the
					// backfill by itself.
					state.deferred = true;
					done.add(entity_type);
					continue;
				}
				state.deferred = false;

				if (!this.#store) {
					done.add(entity_type);
					continue;
				}

				// One transaction per entity per page: the documents this page
				// delivers, the entity-cache rows a delete invalidates, and the sync
				// cursor that accounts for all of it commit or abort together. That
				// is the §7.6 invariant — the synced window can never outrun the
				// persisted index — and it now holds per page rather than on a
				// doubling save schedule, because there is no snapshot to serialize.
				const writes: DocWrite[] = [];
				const extra_ops: ExtraStoreOp[] = [];
				for (const id of entity_result.deleted ?? []) {
					writes.push({ entity_type, doc_id: String(id), sparse_doc: null });
					// A row deleted on another device must not keep being served by get()
					if (state.cache_enabled) {
						extra_ops.push({
							store: 'entities',
							action: 'delete',
							key: `${entity_type}/${id}`,
						});
					}
				}
				// Created and updated are the same operation for the index. The wire's
				// document is indexed VERBATIM (§7.0) — no client-side re-projection,
				// no type guarding, nothing that can throw and drop a page's tail.
				const inserts = [
					...(entity_result.created ?? []),
					...(entity_result.updated ?? []),
				] as Record<string, unknown>[];
				for (const doc of inserts) {
					const doc_id = doc[state.primary_key];
					if (doc_id === undefined || doc_id === null) {
						console.error(
							`[database] sync page for ${entity_type} contained a document with no ${state.primary_key} — skipped`,
						);
						continue;
					}
					writes.push({ entity_type, doc_id: String(doc_id), sparse_doc: doc });
				}

				const had_changes =
					inserts.length > 0 || (entity_result.deleted?.length ?? 0) > 0;
				if (had_changes) {
					any_changes = true;
					changed.add(entity_type);
				}

				// The window this page grows to — computed, not yet adopted. It is
				// only true once the transaction below commits.
				const next_start = entity_result.start_updated_at
					? Math.min(entity_result.start_updated_at, state.start_updated_at ?? Infinity)
					: state.start_updated_at;
				const next_end = entity_result.end_updated_at
					? Math.max(entity_result.end_updated_at, state.end_updated_at ?? 0)
					: state.end_updated_at;
				const next_synced_at = Date.now();
				extra_ops.push({
					store: 'sync_meta',
					action: 'put',
					key: entity_type,
					value: this.#syncMetaFor(entity_type, state, {
						last_synced_at: next_synced_at,
						start_updated_at: next_start,
						end_updated_at: next_end,
					}),
				});

				// Re-check at every await boundary: a wipe mid-page must stop the
				// loop before the next write or notification.
				if (this.#wiped) return;
				try {
					await this.#store.applyWrites(writes, { extra_ops });
				} catch (error) {
					// The page did not land. The in-memory window is still the persisted
					// one, so the next run re-requests exactly this page.
					console.error(
						`[database] failed to apply a sync page for ${entity_type}`,
						error,
					);
					return;
				}

				state.start_updated_at = next_start;
				state.end_updated_at = next_end;
				state.last_synced_at = next_synced_at;

				if (descending_request.has(entity_type)) {
					// Backfill page: done when we've reached the oldest change the
					// server knows about (or there was nothing left to return)
					const reached_oldest =
						!entity_result.first_updated_at ||
						!had_changes ||
						(state.start_updated_at !== undefined &&
							state.start_updated_at <= entity_result.first_updated_at);
					if (reached_oldest) {
						state.start_updated_at = 0; // sentinel: full history synced
						routing_flipped.add(entity_type);
						// Changes may have landed while we were backfilling — only fully
						// caught up if the server's newest change is inside our window
						if ((entity_result.last_updated_at || 0) <= (state.end_updated_at ?? 0)) {
							done.add(entity_type);
							caught_up.add(entity_type);
						}
					}
				} else {
					// Ascending page: done when the server has nothing newer
					if ((entity_result.last_updated_at || 0) <= (state.end_updated_at ?? 0)) {
						done.add(entity_type);
						caught_up.add(entity_type);
					}
				}
			}

			// (No index snapshot to persist here any more: each page above already
			// committed its documents and its cursor in one transaction.)

			// Safety valve: two consecutive pages with no changes at all means the
			// server isn't giving us anything new — stop rather than spin. (One
			// empty page is normal when transitioning from backfill to ascending.)
			pages_without_changes = any_changes ? 0 : pages_without_changes + 1;
			if (pages_without_changes >= 2) break;
		}

		if (this.#wiped) return;

		// Only entities that are confirmed caught up are marked as synced
		for (const t of caught_up) {
			this.#entities[t].synced = true;
		}

		// Final cursor persist: the in-memory window can be one step ahead of the
		// last committed page (the backfill-complete sentinel above), never behind.
		const persist_types = types.filter((t) => this.#entities[t]);
		await this.#persistSyncState(persist_types);

		// Peer workers over the same database (dedicated-Worker fallback) must
		// drop their dictionary caches and re-run their subscribers too.
		this.#broadcastInvalidation([...changed]);

		// Notify active search subscribers — only for entities whose data changed
		// or whose routing just flipped. Notifying every requested type would bump
		// `#server_search_generation` on a quiet poll and force server-routed
		// subscriptions to refetch over the network for nothing.
		const notify_types = [...new Set([...changed, ...routing_flipped])];
		if (notify_types.length > 0) this.#notifySubscribers(notify_types);
	}

	// -----------------------------------------------------------------------
	// CRUD
	// -----------------------------------------------------------------------

	/** Create — no optimistic insert, POST to server first */
	async create(
		entity_type: string,
		data: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		const state = this.#entities[entity_type];
		if (!state) throw unknownEntityType(entity_type);

		const response = await fetch(`/api/${entity_type}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(data),
		});
		if (!response.ok) {
			throw await transferableFromResponse(response, `Create ${entity_type} failed`);
		}
		const server_entity = (await response.json()) as Record<string, unknown>;

		// Index the new row optimistically (the sync echo replaces this document
		// with the server's own sparse projection). The server has already
		// confirmed the row, so a failed local write must trigger the same
		// window-rollback + resync recovery an external change uses — otherwise
		// the row is invisible to local search until the next app-driven sync.
		if (this.#acceptsLocalWrites(entity_type)) {
			const applied = await this.#indexEntity(entity_type, server_entity);
			if (!applied) this.#recoverDroppedIndexWrite(entity_type, server_entity);
			this.#notifySubscribers([entity_type]);
		}

		// Cache in IDB
		if (this.#cachesEntities(entity_type) && this.#db) {
			const id = server_entity[state.primary_key] as string | number;
			await idbPut(this.#db, 'entities', `${entity_type}/${id}`, {
				entity_type,
				id,
				data: server_entity,
				updated_at: Date.now(),
			} satisfies CachedEntity);
		}

		return server_entity;
	}

	/**
	 * Get — returns IDB cache with background refresh.
	 *
	 * Pass `skip_background_refresh: true` when the caller trusts that its
	 * IDB is being kept current through another channel (e.g. a live
	 * websocket). In that mode we still return the cached row immediately
	 * but don't spawn the safety-net refetch for stale entries. Defaults
	 * to `false` so callers without a push channel keep the refresh-if-
	 * stale behavior.
	 */
	async get(
		entity_type: string,
		id: string | number,
		force_refresh?: boolean,
		on_refresh?: (data: Record<string, unknown>) => void,
		skip_background_refresh?: boolean,
	): Promise<Record<string, unknown> | undefined> {
		const state = this.#entities[entity_type];
		if (!state) throw unknownEntityType(entity_type);

		// Try IDB cache first (unless force_refresh)
		if (!force_refresh && state.cache_enabled && this.#db) {
			const cached = await idbGet<CachedEntity>(
				this.#db,
				'entities',
				`${entity_type}/${id}`,
			);
			if (cached?.data) {
				// Only background refresh if stale and not already in-flight,
				// and only when the caller hasn't opted out.
				if (!skip_background_refresh) {
					const key = `${entity_type}/${id}`;
					const stale = Date.now() - (cached.updated_at ?? 0) > REFRESH_STALE_MS;
					if (stale && !this.#pending_refreshes.has(key)) {
						this.#pending_refreshes.add(key);
						this.#backgroundRefresh(entity_type, id, on_refresh)
							.catch(() => {})
							.finally(() => this.#pending_refreshes.delete(key));
					}
				}
				return cached.data;
			}
		}

		return this.#fetchAndCache(entity_type, id);
	}

	async update(
		entity_type: string,
		id: string | number,
		data: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		const state = this.#entities[entity_type];
		if (!state) throw unknownEntityType(entity_type);

		// Store the pre-update document for rollback — the indexed sparse doc,
		// read straight out of the `docs` store by primary key.
		let prev_doc: Record<string, unknown> | undefined;
		if (this.#acceptsLocalWrites(entity_type)) {
			prev_doc = await this.#indexedDocument(entity_type, id);

			// Optimistic update
			if (prev_doc) {
				const optimistic = { ...prev_doc, ...data, updated_at: Date.now() };
				await this.#indexEntity(entity_type, optimistic);
				this.#notifySubscribers([entity_type]);
			}
		}

		// PATCH to server
		let server_entity: Record<string, unknown>;
		try {
			const response = await fetch(`/api/${entity_type}/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data),
			});
			if (!response.ok) {
				await this.#rollbackIndex(entity_type, id, prev_doc);
				throw await transferableFromResponse(
					response,
					`Update ${entity_type}/${id} failed`,
				);
			}
			server_entity = (await response.json()) as Record<string, unknown>;
		} catch (error) {
			if (DelightError.is(error)) throw error;
			await this.#rollbackIndex(entity_type, id, prev_doc);
			throw error;
		}

		// Replace the optimistic overlay with the server's own data. A failed
		// local write here leaves the STALE optimistic document in local search —
		// recover the same way applyExternalChange does.
		if (this.#acceptsLocalWrites(entity_type)) {
			const applied = await this.#indexEntity(entity_type, server_entity);
			if (!applied) this.#recoverDroppedIndexWrite(entity_type, server_entity);
			this.#notifySubscribers([entity_type]);
		}

		// Update IDB cache
		if (this.#cachesEntities(entity_type) && this.#db) {
			await idbPut(this.#db, 'entities', `${entity_type}/${id}`, {
				entity_type,
				id,
				data: server_entity,
				updated_at: Date.now(),
			} satisfies CachedEntity);
		}

		return server_entity;
	}

	async delete(entity_type: string, id: string | number): Promise<void> {
		const state = this.#entities[entity_type];
		if (!state) throw unknownEntityType(entity_type);

		// Store for rollback, then remove optimistically
		let prev_doc: Record<string, unknown> | undefined;
		if (state.search_mode === 'client') {
			prev_doc = await this.#indexedDocument(entity_type, id);
			await this.#removeFromIndex(entity_type, id);
			this.#notifySubscribers([entity_type]);
		}

		// DELETE on server
		try {
			const response = await fetch(`/api/${entity_type}/${id}`, {
				method: 'DELETE',
			});
			if (!response.ok) {
				await this.#rollbackIndex(entity_type, id, prev_doc);
				throw await transferableFromResponse(
					response,
					`Delete ${entity_type}/${id} failed`,
				);
			}
		} catch (error) {
			if (DelightError.is(error)) throw error;
			await this.#rollbackIndex(entity_type, id, prev_doc);
			throw error;
		}

		// Remove from IDB cache
		if (state.cache_enabled && this.#db) {
			await idbDelete(this.#db, 'entities', `${entity_type}/${id}`);
		}
	}

	/**
	 * Apply a change that originated outside this tab (e.g. a websocket
	 * event). Upserts/removes the single entity in the index + IDB and notifies
	 * search subscribers — much cheaper than a full `sync([entity_type])`.
	 *
	 * If `data` is omitted for a create/update event, fetches just that
	 * entity from the server. Returns the applied entity (or `undefined`
	 * for deletes / when a fetch fails).
	 */
	async applyExternalChange(
		entity_type: string,
		event_type: 'create' | 'update' | 'delete',
		id: string | number,
		data?: Record<string, unknown>,
		sparse?: Record<string, unknown>,
	): Promise<Record<string, unknown> | undefined> {
		const state = this.#entities[entity_type];
		if (!state) return undefined;

		if (event_type === 'delete') {
			if (state.search_mode === 'client') {
				await this.#removeFromIndex(entity_type, id);
			}
			if (state.cache_enabled && this.#db) {
				await idbDelete(this.#db, 'entities', `${entity_type}/${id}`);
			}
			this.#notifySubscribers([entity_type]);
			return undefined;
		}

		// create / update — need the entity data
		let entity = data;
		if (!entity && !sparse) {
			// Fall back to a single-entity fetch rather than a full-type sync
			entity = await this.#fetchAndCache(entity_type, id);
			// #fetchAndCache already updates the index + IDB + notifies
			return entity;
		}

		if (entity && this.#cachesEntities(entity_type) && this.#db) {
			await idbPut(this.#db, 'entities', `${entity_type}/${id}`, {
				entity_type,
				id,
				data: entity,
				updated_at: Date.now(),
			} satisfies CachedEntity);
		}

		if (this.#acceptsLocalWrites(entity_type)) {
			// Index the server's sparse projection when the event carries it —
			// that is exactly the document a sync page would deliver, so it is
			// indexed verbatim. The full entity is the fallback for servers that
			// don't send `sparse` yet, and is reshaped like `toSparse` would.
			const index_doc = sparse ?? entity!;
			const applied = sparse
				? await this.#indexDocuments(entity_type, [
						{ entity_type, doc_id: String(id), sparse_doc: sparse },
					])
				: await this.#indexEntity(entity_type, index_doc);
			if (!applied) this.#recoverDroppedIndexWrite(entity_type, index_doc);
		}

		this.#notifySubscribers([entity_type]);
		return entity;
	}

	/**
	 * Optimistically patch a document in the LOCAL index only — no server
	 * write, no IDB entity-cache change. Live search subscribers re-run
	 * immediately, so the UI reflects the change within a frame. The caller
	 * owns making the authoritative server write through some other channel
	 * (whose websocket echo/sync then replaces this overlay with real data).
	 * Returns false when the entity isn't in a patchable client index.
	 */
	async applyLocalPatch(
		entity_type: string,
		id: string | number,
		patch: Record<string, unknown>,
	): Promise<boolean> {
		if (!this.#acceptsLocalWrites(entity_type)) return false;
		const current = await this.#indexedDocument(entity_type, id);
		if (!current) return false;
		const applied = await this.#indexEntity(entity_type, { ...current, ...patch });
		this.#notifySubscribers([entity_type]);
		return applied;
	}

	// -----------------------------------------------------------------------
	// List
	// -----------------------------------------------------------------------

	/**
	 * List/search one entity type, locally or on the server (§7.6 routing
	 * policy).
	 *
	 * The client answer and the server answer are identical **only when the
	 * corpora match**. A partial window is a different corpus — different
	 * membership, different global BM25 statistics — so a query is only answered
	 * locally when the local index is known to hold the whole table.
	 * `query.source` forces the decision per query.
	 *
	 * `allow_cached` is internal, passed only by the subscription paths: a
	 * server-routed result may then answer from the short-TTL cache. One-shot
	 * calls and manual refreshes never set it — "refresh" must mean the
	 * network.
	 */
	async list(
		entity_type: string,
		query: SearchQueryInput,
		allow_cached = false,
	): Promise<WorkerSearchResult> {
		const state = this.#entities[entity_type];
		if (!state) throw unknownEntityType(entity_type);

		// A `versionchange` may have released the database — reopen before
		// routing so one upgrade in another tab degrades one call at most.
		await this.#ensureStore();
		if (!this.#routesToClient(state, query)) {
			return this.#serverSearch(entity_type, query, allow_cached);
		}
		// Capture ONCE: `#engine` can be nulled by a `versionchange` between the
		// routing check and the call (the TOCTOU `this.#engine!` used to hide).
		const engine = this.#engine;
		if (!engine) return this.#serverSearch(entity_type, query, allow_cached);

		let results: SearchQueryResults<Record<string, unknown>>;
		try {
			results = await engine.list(entity_type, query as SearchQuery);
		} catch (error) {
			// A malformed query fails the same way on both drivers (`core/*` throws
			// the same `DelightError`); make it survive the Comlink boundary rather
			// than arriving as a bare `Error` with no status.
			if (DelightError.is(error)) {
				throw DelightError.transferable({
					message: error.message,
					status: error.status,
					code: error.code,
					detail: error.detail,
				});
			}
			throw error;
		}
		return {
			hits: results.hits.map((hit) => ({
				id: String(hit.id),
				document: hit.document,
				score: hit.score,
			})),
			count: results.count,
			mode: 'client',
		};
	}

	/**
	 * The routing decision, in the plan's order.
	 *
	 * 1. **Vector (and hybrid) queries always go to the server.** No embeddings
	 *    exist on the client at all (§4.9, and the §7.0 sync strip). Forcing
	 *    `source: 'client'` on one is a caller error (also a type error at the
	 *    public API), not a silent server fallback.
	 * 2. **`query.source`** overrides everything else per query. `'client'` on
	 *    a `search_mode: 'server'` entity is a caller error — that type never
	 *    syncs, so no local index exists to answer from.
	 * 3. **Coverage.** The local index is authoritative only when the synced
	 *    window covers the whole table: `start_updated_at === 0` is the
	 *    backfill-complete sentinel. `search_mode: 'server'` opts a type out
	 *    entirely; `search_mode: 'client'` opts it in regardless of coverage
	 *    (the app is asserting local-first semantics — as does a per-query
	 *    `source: 'client'`).
	 *
	 * An unavailable engine (IDB blocked, `versionchange` in flight) always
	 * answers `false` — even under `source: 'client'`, the server is the only
	 * degraded-mode fallback that can answer at all.
	 */
	#routesToClient(state: EntitySyncState, query: SearchQueryInput): boolean {
		const source = query.source;
		if (requiresServer(query as SearchQuery)) {
			if (source === 'client') {
				throw DelightError.transferable({
					message:
						"source: 'client' cannot be combined with `vector` — vector search is server-only",
					status: 400,
					code: 'invalid_search_source',
				});
			}
			return false;
		}
		if (source === 'client' && state.search_mode === 'server') {
			throw DelightError.transferable({
				message:
					`source: 'client' is not available for '${state.client_type.entity_type}' — ` +
					"the entity is configured search_mode: 'server' and has no local index",
				status: 400,
				code: 'invalid_search_source',
			});
		}
		// `sparse: false` asks for FULL entities, which only the server has —
		// the local index stores sparse documents. Combining it with an explicit
		// `source: 'client'` is a caller error (also a type error at the public
		// API via `ValidSearchQuery`), same treatment as `vector`.
		if ((query as { sparse?: boolean }).sparse === false) {
			if (source === 'client') {
				throw DelightError.transferable({
					message:
						"source: 'client' cannot be combined with `sparse: false` — full entities only exist on the server",
					status: 400,
					code: 'invalid_search_source',
				});
			}
			return false;
		}
		if (!this.#engine || !this.#store) return false;
		// A denied type has no trustworthy local corpus and never will — it
		// routes to the server exactly like `search_mode: 'server'`, overriding
		// a forced-client config and a per-query `source: 'client'` alike.
		// Unlike the configured case this is NOT a caller error: the refusal
		// arrives at runtime, long after the query was written.
		if (state.denied) return false;
		if (source === 'server') return false;
		if (source === 'client') return true;
		if (state.search_mode === 'server') return false;
		const forced_client = this.#forced_client.has(state.client_type.entity_type);
		return forced_client || state.start_updated_at === 0;
	}

	/**
	 * Subscribe to search results that auto-update when the index changes.
	 *
	 * `token` is the client's query sequence number; every result delivered to
	 * `callback` echoes the token of the query it answered, so the client can
	 * discard a slow result that a newer push has already overtaken. A failed
	 * search is delivered as `{ error }` rather than silently as empty results.
	 */
	async subscribe(
		entity_type: string,
		query: SearchQueryInput,
		callback: (result: WorkerSearchResult) => void,
		token = 0,
		ping?: () => unknown,
	): Promise<string> {
		const id = `sub_${++this.#subscriber_counter}`;
		// A subscribe that lands after a sign-out wipe (an in-flight Comlink
		// message) must neither register nor call back — the tab is signing out.
		if (this.#wiped) return id;
		this.#search_subscribers.push({
			id,
			entity_type,
			query,
			query_token: token,
			callback,
			ping,
		});
		this.#startLivenessSweep();

		let result: WorkerSearchResult;
		try {
			result = { ...(await this.list(entity_type, query, true)), token };
		} catch (error) {
			result = {
				hits: [],
				count: 0,
				mode: 'server',
				token,
				error: searchErrorPayload(error),
			};
		}
		try {
			callback(result);
		} catch {
			// ignore callback errors
		}

		return id;
	}

	/** Update the query for an existing subscription. */
	async updateSubscription(
		subscriber_id: string,
		query: SearchQueryInput,
		token?: number,
	): Promise<void> {
		const sub = this.#search_subscribers.find((s) => s.id === subscriber_id);
		if (!sub) return;
		sub.query = query;
		if (token !== undefined) sub.query_token = token;
		const echo = sub.query_token;

		let result: WorkerSearchResult;
		try {
			result = { ...(await this.list(sub.entity_type, query, true)), token: echo };
		} catch (error) {
			result = {
				hits: [],
				count: 0,
				mode: 'server',
				token: echo,
				error: searchErrorPayload(error),
			};
		}
		try {
			sub.callback(result);
		} catch {
			// ignore
		}
	}

	/** Unsubscribe from search updates. */
	async unsubscribe(subscriber_id: string): Promise<void> {
		this.#search_subscribers = this.#search_subscribers.filter(
			(s) => s.id !== subscriber_id,
		);
		if (this.#search_subscribers.length === 0) this.#stopLivenessSweep();
	}

	/**
	 * Start the dead-tab sweep. A tab that crashes or navigates without
	 * `unsubscribe()` leaves a subscriber whose Comlink callback posts into a
	 * closed MessagePort forever — its query keeps executing on every
	 * notification and the entry never goes away (SharedWorker ports have no
	 * close event). The sweep pings each subscriber's dedicated ping proxy; a
	 * ping into a dead port never settles, so a timeout means the tab is gone.
	 */
	#startLivenessSweep(): void {
		if (this.#liveness_timer !== null || this.#search_subscribers.length === 0) return;
		const timer = setInterval(() => {
			void this.#sweepDeadSubscribers();
		}, SUBSCRIBER_SWEEP_MS);
		// Node exposes `unref` — never keep a process alive for the sweep.
		(timer as unknown as { unref?: () => void }).unref?.();
		this.#liveness_timer = timer;
	}

	#stopLivenessSweep(): void {
		if (this.#liveness_timer === null) return;
		clearInterval(this.#liveness_timer);
		this.#liveness_timer = null;
	}

	async #sweepDeadSubscribers(): Promise<void> {
		if (this.#wiped || this.#search_subscribers.length === 0) {
			this.#stopLivenessSweep();
			return;
		}
		// Subscribers without a ping proxy (older clients) cannot be probed and
		// are never dropped — the pre-sweep behavior for them, no worse.
		const probed = this.#search_subscribers.filter((sub) => sub.ping);
		const dead = new Set<string>();
		await Promise.all(
			probed.map(async (sub) => {
				// Settling AT ALL (even rejecting) proves the port is alive; only a
				// ping that never comes back marks the subscriber dead.
				const alive = await Promise.race([
					Promise.resolve()
						.then(() => sub.ping!())
						.then(
							() => true,
							() => true,
						),
					new Promise<boolean>((resolve) => {
						setTimeout(() => resolve(false), SUBSCRIBER_PING_TIMEOUT_MS);
					}),
				]);
				if (!alive) dead.add(sub.id);
			}),
		);
		if (dead.size > 0) {
			this.#search_subscribers = this.#search_subscribers.filter(
				(sub) => !dead.has(sub.id),
			);
		}
		if (this.#search_subscribers.length === 0) this.#stopLivenessSweep();
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	/** Undo an optimistic index change by rewriting the previous document. */
	async #rollbackIndex(
		entity_type: string,
		id: string | number,
		prev_doc: Record<string, unknown> | undefined,
	): Promise<void> {
		if (!prev_doc || !this.#acceptsLocalWrites(entity_type)) return;
		await this.#indexDocuments(entity_type, [
			{ entity_type, doc_id: String(id), sparse_doc: prev_doc },
		]);
		this.#notifySubscribers([entity_type]);
	}

	/**
	 * Server-side search. Always throws on an error response — masking one as
	 * `{ hits: [], count: 0 }` used to blank live result lists silently. The
	 * subscription paths catch and deliver the error to their callback; one-shot
	 * callers let it cross the Comlink boundary with its status intact.
	 */
	async #serverSearch(
		entity_type: string,
		query: SearchQueryInput,
		allow_cached = false,
	): Promise<WorkerSearchResult> {
		const params = encodeSearchQuery({ sparse: true, ...query });
		const qs = params.toString();
		const cache_key = `${entity_type}?${qs}`;
		const generation = this.#server_search_generation.get(entity_type) ?? 0;
		if (allow_cached) {
			const cached = this.#server_search_cache.get(cache_key);
			if (
				cached &&
				cached.generation === generation &&
				Date.now() - cached.at < SERVER_SEARCH_CACHE_TTL_MS
			) {
				// Re-insert to mark as recently used (Map preserves insertion order).
				this.#server_search_cache.delete(cache_key);
				this.#server_search_cache.set(cache_key, cached);
				return cached.result;
			}
		}
		const response = await fetch(`/api/${entity_type}${qs ? '?' : ''}${qs}`);
		if (!response.ok) {
			throw await transferableFromResponse(response, `List ${entity_type} failed`);
		}

		const body = (await response.json()) as {
			hits?: { id: string; document: Record<string, unknown>; score: number }[];
			count?: number;
		};
		const result: WorkerSearchResult = {
			hits: body.hits ?? [],
			count: body.count ?? 0,
			mode: 'server',
		};
		// Store under the generation read BEFORE the fetch: if a change landed
		// while the request was in flight, the bumped generation makes this
		// entry unservable rather than a stale hit.
		this.#server_search_cache.set(cache_key, {
			result,
			at: Date.now(),
			generation,
		});
		if (this.#server_search_cache.size > SERVER_SEARCH_CACHE_MAX) {
			const oldest = this.#server_search_cache.keys().next().value;
			if (oldest !== undefined) this.#server_search_cache.delete(oldest);
		}
		return result;
	}

	/** Fetch from server and cache in IDB. */
	async #fetchAndCache(
		entity_type: string,
		id: string | number,
	): Promise<Record<string, unknown> | undefined> {
		const state = this.#entities[entity_type];
		if (!state) return undefined;

		const response = await fetch(`/api/${entity_type}/${id}`);
		if (!response.ok) {
			// The entity no longer exists on the server — purge the stale cache
			// entry so get() stops resurrecting it
			if (response.status === 404) {
				if (state.cache_enabled && this.#db) {
					await idbDelete(this.#db, 'entities', `${entity_type}/${id}`);
				}
				if (state.search_mode === 'client') {
					await this.#removeFromIndex(entity_type, id);
					this.#notifySubscribers([entity_type]);
				}
			}
			return undefined;
		}
		const data = (await response.json()) as Record<string, unknown>;

		if (this.#cachesEntities(entity_type) && this.#db) {
			await idbPut(this.#db, 'entities', `${entity_type}/${id}`, {
				entity_type,
				id,
				data,
				updated_at: Date.now(),
			} satisfies CachedEntity);
		}

		// Refresh the local index too (reshaped like `toSparse` — a full entity
		// carries fields the index has no business tokenizing)
		if (this.#acceptsLocalWrites(entity_type)) {
			await this.#indexEntity(entity_type, data);
			this.#notifySubscribers([entity_type]);
		}

		return data;
	}

	/** Background refresh: fetches fresh data from server, updates IDB, notifies caller */
	async #backgroundRefresh(
		entity_type: string,
		id: string | number,
		on_refresh?: (data: Record<string, unknown>) => void,
	): Promise<void> {
		const fresh = await this.#fetchAndCache(entity_type, id);
		// A refresh that resolves after a sign-out wipe must not reach the
		// client — its handles are frozen and nothing may repaint.
		if (fresh && on_refresh && !this.#wiped) {
			try {
				on_refresh(fresh);
			} catch {
				// ignore
			}
		}
	}

	/**
	 * Write one document into the index, reshaped like `toSparse` would.
	 *
	 * For documents that came off the wire use {@link #indexDocuments} instead —
	 * those are already the server's projection and are indexed verbatim (§7.0).
	 */
	async #indexEntity(
		entity_type: string,
		entity: Record<string, unknown>,
	): Promise<boolean> {
		const state = this.#entities[entity_type];
		if (!state) return false;
		const id = entity[state.primary_key];
		if (id === undefined || id === null || id === '') return false;
		return this.#indexDocuments(entity_type, [
			{
				entity_type,
				doc_id: String(id),
				sparse_doc: toSparseLike(state.schema, entity),
			},
		]);
	}

	/** Remove one document from the index. */
	async #removeFromIndex(entity_type: string, id: string | number): Promise<boolean> {
		return this.#indexDocuments(entity_type, [
			{ entity_type, doc_id: String(id), sparse_doc: null },
		]);
	}

	/**
	 * Apply document writes in one transaction. Never throws; returns false when
	 * the batch could not be written, which the caller turns into a resync (an
	 * external change) or a logged loss (a local optimistic write).
	 */
	async #indexDocuments(entity_type: string, writes: DocWrite[]): Promise<boolean> {
		await this.#ensureStore();
		if (!this.#store) return false;
		try {
			await this.#store.applyWrites(writes);
			this.#broadcastInvalidation([entity_type]);
			return true;
		} catch (error) {
			console.error(
				`[database] failed to index ${writes.length} ${entity_type} document(s)`,
				error,
			);
			return false;
		}
	}

	/**
	 * A server-confirmed change could not be written to the local index. Roll
	 * the synced window back to just before the change and resync, otherwise
	 * the row stays stale/absent in local search until a full rebuild — the
	 * same recovery {@link applyExternalChange} has always used. Skipped in
	 * server-only mode (no store means no local index to be stale).
	 */
	#recoverDroppedIndexWrite(entity_type: string, doc: Record<string, unknown>): void {
		const state = this.#entities[entity_type];
		if (!state || !this.#store) return;
		const changed_at = typeof doc.updated_at === 'number' ? doc.updated_at : undefined;
		if (changed_at && state.end_updated_at && state.end_updated_at >= changed_at) {
			state.end_updated_at = changed_at - 1;
		}
		state.synced = false;
		this.sync([entity_type]).catch(() => {});
	}

	/** The indexed sparse document for one primary key, if it is indexed. */
	async #indexedDocument(
		entity_type: string,
		id: string | number,
	): Promise<Record<string, unknown> | undefined> {
		if (!this.#store) return undefined;
		const rows = await this.#store.getDocs(entity_type, [String(id)]);
		return rows.get(String(id))?.sparse_doc;
	}

	/**
	 * A server-side schema change: drop everything local for the type and resync.
	 *
	 * The persisted window described documents shaped by the old schema, so it is
	 * reset to "never synced" and the backfill starts over. The `docs` indexes are
	 * re-derived too, which is a *database* change — hence the version bump and
	 * reopen (§7.6).
	 */
	async #applyConfigBump(
		entity_type: string,
		config: Record<string, unknown>,
		config_version: number,
	): Promise<void> {
		const state = this.#entities[entity_type];
		if (!state || !this.#db) return;

		// Purge the local index for this type BEFORE the reopen — the old
		// documents were tokenized against the old schema.
		await this.#purgeEntityIndex(entity_type);
		await idbDeleteByPrefix(this.#db, 'entities', `${entity_type}/`);

		const table = this.#tables[entity_type];
		const schema = flattenSearchSchema(config ?? table?.index_schema);
		state.schema = schema;
		state.index_paths = indexPathsFor(schema);
		state.client_type = defineClientType({
			entity_type,
			schema,
			primary_key: state.primary_key,
			primary_key_type: table?.primary_key_type,
		});
		state.config_version = config_version;
		state.start_updated_at = undefined;
		state.end_updated_at = undefined;
		state.synced = false;

		// Reopen at the version the new `config_version` asks for, reconciling the
		// `docs` indexes, and drop the dictionary cache built from the old tokens.
		await this.#reconcileSearchDatabase();
		this.#store?.clearDictionaryCache();

		if (this.#db) {
			await idbPut(
				this.#db,
				'sync_meta',
				entity_type,
				this.#syncMetaFor(entity_type, state),
			);
		}
	}

	/** Delete every indexed document of one entity type. */
	async #purgeEntityIndex(entity_type: string): Promise<void> {
		if (!this.#store) return;
		const docs = await this.#store.getAllDocs(entity_type);
		if (docs.length === 0) return;
		const batch = 500;
		for (let index = 0; index < docs.length; index += batch) {
			await this.#store.applyWrites(
				docs.slice(index, index + batch).map((row) => ({
					entity_type,
					doc_id: row.doc_id,
					sparse_doc: null,
				})),
			);
		}
	}

	/**
	 * The server revoked this entity type: drop everything local for it.
	 *
	 * A denial is a permission decision, and the documents synced before it
	 * arrived are exactly what that permission was protecting — so the indexed
	 * documents and the cached entity rows both go, not just the future pages.
	 * The window is reset to "never synced" so a later re-grant backfills from
	 * scratch instead of resuming from a cursor describing documents nothing
	 * kept.
	 *
	 * Called only on the transition into denial, and cheap/idempotent anyway:
	 * both purges are single ranged operations that no-op on an empty type.
	 */
	async #purgeDeniedEntity(entity_type: string): Promise<void> {
		const state = this.#entities[entity_type];
		if (!state) return;

		await this.#purgeEntityIndex(entity_type);
		// Re-check at every await boundary, exactly as the sync loop does: a
		// wipe mid-purge has already deleted the database out from under us.
		if (this.#wiped) return;
		if (this.#db) {
			await idbDeleteByPrefix(this.#db, 'entities', `${entity_type}/`);
			if (this.#wiped) return;
		}

		state.start_updated_at = undefined;
		state.end_updated_at = undefined;
		state.synced = false;
		if (this.#db) {
			await idbPut(
				this.#db,
				'sync_meta',
				entity_type,
				this.#syncMetaFor(entity_type, state),
			);
		}
	}

	/**
	 * Whether a document may be written into this type's local mirror.
	 *
	 * False in server mode (there is no local index to write to) and false for
	 * a denied type — inserting into a mirror the server just revoked is
	 * exactly what {@link #purgeDeniedEntity} undid. REMOVALS are deliberately
	 * not gated on this: dropping a stale row from a denied mirror is always
	 * the right move.
	 */
	#acceptsLocalWrites(entity_type: string): boolean {
		const state = this.#entities[entity_type];
		return !!state && state.search_mode === 'client' && !state.denied;
	}

	/**
	 * Whether an entity row may be written to the IDB cache. Denial revokes
	 * the cache too — `get()` still answers a denied type, straight from the
	 * server, it just leaves nothing behind on disk.
	 */
	#cachesEntities(entity_type: string): boolean {
		const state = this.#entities[entity_type];
		return !!state && state.cache_enabled && !state.denied && !!this.#db;
	}

	/**
	 * The persisted `sync_meta` row for one entity type, from its in-memory
	 * state (with optional not-yet-adopted overrides for mid-page persists).
	 *
	 * IMPORTANT: start/end are persisted as-is. Coercing a never-synced
	 * `undefined` to 0 would make the next load believe the full history was
	 * already backfilled (0 is the "backfill complete" sentinel).
	 */
	#syncMetaFor(
		entity_type: string,
		state: EntitySyncState,
		overrides?: Partial<SyncMeta>,
	): SyncMeta {
		return {
			entity_type,
			search_mode: state.search_mode,
			config_version: state.config_version,
			last_synced_at: state.last_synced_at,
			start_updated_at: state.start_updated_at,
			end_updated_at: state.end_updated_at,
			server_total: state.server_total,
			...(state.denied ? { denied: true as const } : {}),
			...overrides,
		};
	}

	/**
	 * Persist the synced-window meta.
	 *
	 * The index itself needs no persisting — every document write already went
	 * through a transaction that carried its cursor with it (see `#runSync`), so
	 * this only records the in-memory refinements the page loop makes after a
	 * commit (the backfill-complete sentinel, the search mode).
	 */
	async #persistSyncState(entity_types: string[]): Promise<void> {
		if (!this.#db) return;

		const ops: {
			store: 'sync_meta';
			type: 'put';
			key: string;
			value: SyncMeta;
		}[] = [];

		for (const entity_type of entity_types) {
			const state = this.#entities[entity_type];
			if (!state) continue;

			ops.push({
				store: 'sync_meta',
				type: 'put',
				key: entity_type,
				value: this.#syncMetaFor(entity_type, state),
			});
		}

		await idbBatch(this.#db, ops);
	}

	/** Microtask-batched subscriber notification */
	#notifySubscribers(entity_types: string[]): void {
		// A wiped worker must stay silent: nothing may repaint between a
		// sign-out and the app's navigation away.
		if (this.#wiped) return;
		// Every caller is a data change (CRUD, a sync page, an external push):
		// bump the cache generation FIRST, synchronously, so the re-queries this
		// notification triggers can never be answered by a pre-change entry.
		for (const t of entity_types) {
			this.#server_search_generation.set(
				t,
				(this.#server_search_generation.get(t) ?? 0) + 1,
			);
		}
		for (const t of entity_types) this.#pending_notify.add(t);
		if (this.#notify_scheduled) return;
		this.#notify_scheduled = true;
		queueMicrotask(() => {
			this.#notify_scheduled = false;
			const types = new Set(this.#pending_notify);
			this.#pending_notify.clear();
			// Coalesce identical queries: N components watching the same list is
			// common, and running the query N times costs N IDB executions — or N
			// server round trips for a server-routed entity. One execution per
			// distinct (entity_type, query) fans out to every subscriber with its
			// own echoed token.
			const groups = new Map<string, SearchSubscriber[]>();
			for (const sub of this.#search_subscribers) {
				if (!types.has(sub.entity_type)) continue;
				const key = `${sub.entity_type}\u0000${stableStringify(sub.query)}`;
				const group = groups.get(key);
				if (group) group.push(sub);
				else groups.set(key, [sub]);
			}
			for (const subs of groups.values()) {
				// Capture the tokens BEFORE the async search: each result answers
				// the query stored right now, and the client uses the echoed token
				// to discard it if a newer push lands first.
				const tokens = subs.map((sub) => sub.query_token);
				this.list(subs[0].entity_type, subs[0].query, true).then(
					(result) => {
						subs.forEach((sub, index) => {
							try {
								sub.callback({ ...result, token: tokens[index] });
							} catch {
								// ignore
							}
						});
					},
					(error) => {
						// Surface the failure instead of leaving the subscribers silently
						// frozen; the client keeps its last-known-good results.
						const payload = searchErrorPayload(error);
						subs.forEach((sub, index) => {
							try {
								sub.callback({
									hits: [],
									count: 0,
									mode: 'server',
									token: tokens[index],
									error: payload,
								});
							} catch {
								// ignore
							}
						});
					},
				);
			}
		});
	}
}

// ---------------------------------------------------------------------------
// Expose via comlink (supports both SharedWorker and Worker)
// ---------------------------------------------------------------------------

const worker = new DatabaseWorker();
expose(worker);

// SharedWorker support
self.addEventListener('connect', (event) => {
	const port = (event as MessageEvent)?.ports?.[0];
	if (port) expose(worker, port);
});
