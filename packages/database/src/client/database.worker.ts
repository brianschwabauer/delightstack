import { expose } from 'comlink';
import {
	idbGet,
	idbPut,
	idbDelete,
	idbDeleteByPrefix,
	idbBatch,
	type SyncMeta,
	type CachedEntity,
} from './database.idb';
import { DelightError } from '@delightstack/utilities';
import { IdbSearchEngine, requiresServer } from '../search/client/engine';
import {
	defineClientType,
	docIndexName,
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
			threshold?: number;
			cache?: boolean;
		}
	>;
	/** IndexedDB database name */
	db_name: string;
	/**
	 * @deprecated Document-count ceiling above which searches are routed to the
	 * server. The client index is IndexedDB-backed now, so there is no memory
	 * ceiling to defend and routing is coverage-based (§7.6): a complete synced
	 * window searches locally, an incomplete one goes to the server. Set this
	 * only as a temporary override valve — it is removed in the next major.
	 */
	default_threshold?: number;
	/** Injectable IDB factory (tests). Defaults to the worker's `indexedDB`. */
	idb_factory?: IDBFactory;
}

export interface WorkerSearchResult {
	hits: { id: string; document: Record<string, unknown>; score: number }[];
	count: number;
	elapsed?: unknown;
}

interface EntitySyncState {
	/** `'server'` only when the app forced it — never an automatic downgrade. */
	search_mode: 'client' | 'server';
	config_version: number;
	last_synced_at: number;
	start_updated_at: number | undefined;
	end_updated_at: number | undefined;
	synced: boolean;
	/** @deprecated The override valve; `undefined` disables count-based routing. */
	threshold: number | undefined;
	cache_enabled: boolean;
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
	callback: (result: WorkerSearchResult) => void;
};

/** Cache entries fresher than this are not background-refreshed (ms) */
const REFRESH_STALE_MS = 30_000;

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

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export class DatabaseWorker {
	#db: IDBDatabase | null = null;
	#entities: Record<string, EntitySyncState> = {};
	#tables: WorkerInitConfig['tables'] = {};
	#search_subscribers: SearchSubscriber[] = [];
	#subscriber_counter = 0;
	/** @deprecated The count-based override valve (§7.6); `undefined` disables it. */
	#default_threshold: number | undefined;
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

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	async init(config: WorkerInitConfig): Promise<void> {
		// A SharedWorker is initialized by EVERY connecting tab. Re-running init
		// for the same database would discard in-memory sync state (and any
		// un-persisted cursor state) while another tab's sync loop is mid-flight.
		if (this.#db && this.#db_name === config.db_name) return;

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
		}

		this.#tables = config.tables;
		this.#default_threshold = config.default_threshold;
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
		this.#db = await openSearchDatabase({
			name: config.db_name,
			extra_stores: WORKER_STORES,
			factory: this.#idb_factory,
		});
		this.#attachVersionChange(this.#db);

		// Initialize per-entity state
		for (const [entity_type, table] of Object.entries(config.tables)) {
			const overrides = config.entities?.[entity_type];
			const forced_mode = overrides?.search_mode;

			// Load persisted sync meta
			const meta = await idbGet<SyncMeta>(this.#db, 'sync_meta', entity_type);

			const schema = flattenSearchSchema(table.index_schema);
			this.#entities[entity_type] = {
				search_mode: forced_mode ?? meta?.search_mode ?? 'client',
				config_version: meta?.config_version ?? 0,
				last_synced_at: meta?.last_synced_at ?? 0,
				start_updated_at: meta?.start_updated_at,
				end_updated_at: meta?.end_updated_at,
				synced: false,
				threshold: overrides?.threshold ?? this.#default_threshold,
				cache_enabled: overrides?.cache !== false,
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
			this.#db = await openSearchDatabase({
				name: this.#db_name,
				version,
				index_paths,
				extra_stores: WORKER_STORES,
				delete_stores: [LEGACY_SEARCH_INDEX_STORE],
				factory: this.#idb_factory,
			});
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

	/** Whether the live `docs` indexes are not exactly the declared ones. */
	#indexesDiffer(db: IDBDatabase, index_paths: readonly DocIndexPath[]): boolean {
		for (const name of SEARCH_STORE_NAMES) {
			if (!db.objectStoreNames.contains(name)) return true;
		}
		for (const store of WORKER_STORES) {
			if (!db.objectStoreNames.contains(store.name)) return true;
		}
		if (db.objectStoreNames.contains(LEGACY_SEARCH_INDEX_STORE)) return true;
		const txn = db.transaction(DOCS_STORE, 'readonly');
		const live = new Set(Array.from(txn.objectStore(DOCS_STORE).indexNames));
		txn.abort();
		if (live.size !== index_paths.length) return true;
		return index_paths.some((declaration) => !live.has(docIndexName(declaration.path)));
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

	async destroy(): Promise<void> {
		this.#search_subscribers = [];
		this.#store = null;
		this.#engine = null;
		if (this.#db) {
			this.#db.close();
			this.#db = null;
		}
		this.#db_name = undefined;
		this.#entities = {};
		this.#pending_refreshes.clear();
	}

	// -----------------------------------------------------------------------
	// Sync
	// -----------------------------------------------------------------------

	async sync(entity_types?: string[]): Promise<void> {
		// Single-flight: concurrent sync calls (e.g. several tabs sharing this
		// worker) would interleave cursor updates and corrupt pagination state.
		if (this.#sync_in_flight) return this.#sync_in_flight;
		this.#sync_in_flight = this.#runSync(entity_types).finally(() => {
			this.#sync_in_flight = null;
		});
		return this.#sync_in_flight;
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
		if (!this.#db) return;

		const types = entity_types ?? Object.keys(this.#entities);
		if (types.length === 0) return;

		/** Entities that need no further pages this run */
		const done = new Set<string>();
		/** Entities that are confirmed fully caught up with the server */
		const caught_up = new Set<string>();

		let num_requests = 0;
		let pages_without_changes = 0;
		while (num_requests++ < 50) {
			const client_types = types.filter(
				(t) => this.#entities[t]?.search_mode === 'client' && !done.has(t),
			);
			if (client_types.length === 0) break;

			// Build the per-entity sync ranges for this page
			const entity_request: Record<string, unknown> = {};
			const descending_request = new Set<string>();
			for (const entity_type of client_types) {
				const state = this.#entities[entity_type];
				if (state.start_updated_at === undefined) {
					// Never synced — newest page first
					entity_request[entity_type] = { config_version: state.config_version };
					descending_request.add(entity_type);
				} else if (state.start_updated_at > 0) {
					// Backfilling — the page of history just older than our window
					entity_request[entity_type] = {
						config_version: state.config_version,
						end_updated_at: state.start_updated_at,
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
				}

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
				if (had_changes) any_changes = true;

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
					value: {
						entity_type,
						search_mode: state.search_mode,
						config_version: state.config_version,
						last_synced_at: next_synced_at,
						start_updated_at: next_start,
						end_updated_at: next_end,
					} satisfies SyncMeta,
				});

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

		// Only entities that are confirmed caught up are marked as synced
		for (const t of caught_up) {
			this.#entities[t].synced = true;
		}

		// Final cursor persist: the in-memory window can be one step ahead of the
		// last committed page (the backfill-complete sentinel above), never behind.
		const persist_types = types.filter((t) => this.#entities[t]);
		await this.#persistSyncState(persist_types);

		// Notify active search subscribers
		this.#notifySubscribers(persist_types);
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
		if (!state) throw new Error(`Unknown entity type: ${entity_type}`);

		const response = await fetch(`/api/${entity_type}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(data),
		});
		if (!response.ok) {
			const error_body = (await response.json().catch(() => ({}))) as Record<
				string,
				unknown
			>;
			throw DelightError.transferable({
				message: (error_body.message as string) || `Create ${entity_type} failed`,
				status: response.status,
				detail: error_body.detail as string | undefined,
			});
		}
		const server_entity = (await response.json()) as Record<string, unknown>;

		// Index the new row optimistically (the sync echo replaces this document
		// with the server's own sparse projection).
		if (state.search_mode === 'client') {
			await this.#indexEntity(entity_type, server_entity);
			this.#notifySubscribers([entity_type]);
		}

		// Cache in IDB
		if (state.cache_enabled && this.#db) {
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
		if (!state) throw new Error(`Unknown entity type: ${entity_type}`);

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
		if (!state) throw new Error(`Unknown entity type: ${entity_type}`);

		// Store the pre-update document for rollback — the indexed sparse doc,
		// read straight out of the `docs` store by primary key.
		let prev_doc: Record<string, unknown> | undefined;
		if (state.search_mode === 'client') {
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
				const error_body = (await response.json().catch(() => ({}))) as Record<
					string,
					unknown
				>;
				await this.#rollbackIndex(entity_type, id, prev_doc);
				throw DelightError.transferable({
					message: (error_body.message as string) || `Update ${entity_type}/${id} failed`,
					status: response.status,
					detail: error_body.detail as string | undefined,
				});
			}
			server_entity = (await response.json()) as Record<string, unknown>;
		} catch (error) {
			if (DelightError.is(error)) throw error;
			await this.#rollbackIndex(entity_type, id, prev_doc);
			throw error;
		}

		// Replace the optimistic overlay with the server's own data
		if (state.search_mode === 'client') {
			await this.#indexEntity(entity_type, server_entity);
			this.#notifySubscribers([entity_type]);
		}

		// Update IDB cache
		if (state.cache_enabled && this.#db) {
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
		if (!state) throw new Error(`Unknown entity type: ${entity_type}`);

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
				const error_body = (await response.json().catch(() => ({}))) as Record<
					string,
					unknown
				>;
				await this.#rollbackIndex(entity_type, id, prev_doc);
				throw DelightError.transferable({
					message: (error_body.message as string) || `Delete ${entity_type}/${id} failed`,
					status: response.status,
					detail: error_body.detail as string | undefined,
				});
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

		if (entity && state.cache_enabled && this.#db) {
			await idbPut(this.#db, 'entities', `${entity_type}/${id}`, {
				entity_type,
				id,
				data: entity,
				updated_at: Date.now(),
			} satisfies CachedEntity);
		}

		if (state.search_mode === 'client') {
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
			if (!applied) {
				// The document could not be written. Roll the synced window back to
				// just before this change and resync, otherwise it is silently gone
				// from local search until a full rebuild.
				const changed_at =
					typeof index_doc.updated_at === 'number' ? index_doc.updated_at : undefined;
				if (changed_at && state.end_updated_at && state.end_updated_at >= changed_at) {
					state.end_updated_at = changed_at - 1;
				}
				state.synced = false;
				this.sync([entity_type]).catch(() => {});
			}
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
		const state = this.#entities[entity_type];
		if (!state || state.search_mode !== 'client') return false;
		const current = await this.#indexedDocument(entity_type, id);
		if (!current) return false;
		const applied = await this.#indexEntity(entity_type, { ...current, ...patch });
		this.#notifySubscribers([entity_type]);
		return applied;
	}

	// -----------------------------------------------------------------------
	// Search
	// -----------------------------------------------------------------------

	/**
	 * Search one entity type, locally or on the server (§7.6 routing policy).
	 *
	 * The client answer and the server answer are identical **only when the
	 * corpora match**. A partial window is a different corpus — different
	 * membership, different global BM25 statistics — so a query is only answered
	 * locally when the local index is known to hold the whole table.
	 */
	async search(
		entity_type: string,
		query: SearchQueryInput,
	): Promise<WorkerSearchResult> {
		const state = this.#entities[entity_type];
		if (!state) throw new Error(`Unknown entity type: ${entity_type}`);

		if (!(await this.#routesToClient(state, query))) {
			return this.#serverSearch(entity_type, query);
		}

		let results: SearchQueryResults<Record<string, unknown>>;
		try {
			results = await this.#engine!.list(entity_type, query as SearchQuery);
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
			elapsed: results.elapsed,
		};
	}

	/**
	 * The routing decision, in the plan's order.
	 *
	 * 1. **Vector (and hybrid) queries always go to the server.** No embeddings
	 *    exist on the client at all (§4.9, and the §7.0 sync strip).
	 * 2. **Coverage.** The local index is authoritative only when the synced
	 *    window covers the whole table: `start_updated_at === 0` is the
	 *    backfill-complete sentinel. `search_mode: 'server'` opts a type out
	 *    entirely; `search_mode: 'client'` opts it in regardless of coverage
	 *    (the app is asserting local-first semantics).
	 * 3. **The deprecated count valve.** A configured `threshold` still forces
	 *    the server once the local document count reaches it. Removed next major.
	 */
	async #routesToClient(
		state: EntitySyncState,
		query: SearchQueryInput,
	): Promise<boolean> {
		if (!this.#engine || !this.#store) return false;
		if (requiresServer(query as SearchQuery)) return false;
		if (state.search_mode === 'server') return false;
		const forced_client = this.#forced_client.has(state.client_type.entity_type);
		if (!forced_client && state.start_updated_at !== 0) return false;
		if (state.threshold !== undefined) {
			const count = await this.#store.countDocs(state.client_type.entity_type);
			if (count >= state.threshold) return false;
		}
		return true;
	}

	/** One-shot list that always hits the server */
	async list(entity_type: string, query: SearchQueryInput): Promise<WorkerSearchResult> {
		const state = this.#entities[entity_type];
		if (!state) throw new Error(`Unknown entity type: ${entity_type}`);
		return this.#serverSearch(entity_type, query, true);
	}

	/** Subscribe to search results that auto-update when the index changes. */
	async subscribe(
		entity_type: string,
		query: SearchQueryInput,
		callback: (result: WorkerSearchResult) => void,
	): Promise<string> {
		const id = `sub_${++this.#subscriber_counter}`;
		this.#search_subscribers.push({ id, entity_type, query, callback });

		const result = await this.search(entity_type, query);
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
	): Promise<void> {
		const sub = this.#search_subscribers.find((s) => s.id === subscriber_id);
		if (!sub) return;
		sub.query = query;

		const result = await this.search(sub.entity_type, query);
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
	}

	/**
	 * Where a plain (non-vector) query for this entity type would be answered.
	 *
	 * A live routing decision, not a stored mode: an entity type whose window is
	 * still filling reports `'server'` and flips to `'client'` when the backfill
	 * completes.
	 */
	async getSearchMode(entity_type: string): Promise<'client' | 'server'> {
		const state = this.#entities[entity_type];
		if (!state) return 'server';
		return (await this.#routesToClient(state, {})) ? 'client' : 'server';
	}

	/** Whether the entity type has completed its initial sync. */
	async isSynced(entity_type: string): Promise<boolean> {
		return this.#entities[entity_type]?.synced ?? false;
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
		const state = this.#entities[entity_type];
		if (!prev_doc || !state || state.search_mode !== 'client') return;
		await this.#indexDocuments(entity_type, [
			{ entity_type, doc_id: String(id), sparse_doc: prev_doc },
		]);
		this.#notifySubscribers([entity_type]);
	}

	/** Server-side search. Throws on error when throw_on_error is true. */
	async #serverSearch(
		entity_type: string,
		query: SearchQueryInput,
		throw_on_error = false,
	): Promise<WorkerSearchResult> {
		const params = encodeSearchQuery({ sparse: true, ...query });
		const qs = params.toString();
		const response = await fetch(`/api/${entity_type}${qs ? '?' : ''}${qs}`);
		if (!response.ok) {
			if (throw_on_error) {
				const error_body = (await response.json().catch(() => ({}))) as Record<
					string,
					unknown
				>;
				throw DelightError.transferable({
					message: (error_body.message as string) || `List ${entity_type} failed`,
					status: response.status,
					detail: error_body.detail as string | undefined,
				});
			}
			return { hits: [], count: 0 };
		}

		const body = (await response.json()) as {
			hits?: { id: string; document: Record<string, unknown>; score: number }[];
			count?: number;
		};
		return {
			hits: body.hits ?? [],
			count: body.count ?? 0,
		};
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

		if (state.cache_enabled && this.#db) {
			await idbPut(this.#db, 'entities', `${entity_type}/${id}`, {
				entity_type,
				id,
				data,
				updated_at: Date.now(),
			} satisfies CachedEntity);
		}

		// Refresh the local index too (reshaped like `toSparse` — a full entity
		// carries fields the index has no business tokenizing)
		if (state.search_mode === 'client') {
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
		if (fresh && on_refresh) {
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
		if (!this.#store) return false;
		try {
			await this.#store.applyWrites(writes);
			return true;
		} catch (error) {
			console.error(
				`[database] failed to index ${writes.length} ${entity_type} document(s)`,
				error,
			);
			return false;
		}
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
			await idbPut(this.#db, 'sync_meta', entity_type, {
				entity_type,
				search_mode: state.search_mode,
				config_version: state.config_version,
				last_synced_at: state.last_synced_at,
				start_updated_at: undefined,
				end_updated_at: undefined,
			} satisfies SyncMeta);
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
				// IMPORTANT: start/end are persisted as-is. Coercing a never-synced
				// `undefined` to 0 would make the next load believe the full history
				// was already backfilled (0 is the "backfill complete" sentinel).
				value: {
					entity_type,
					search_mode: state.search_mode,
					config_version: state.config_version,
					last_synced_at: state.last_synced_at,
					start_updated_at: state.start_updated_at,
					end_updated_at: state.end_updated_at,
				} satisfies SyncMeta,
			});
		}

		await idbBatch(this.#db, ops);
	}

	/** Microtask-batched subscriber notification */
	#notifySubscribers(entity_types: string[]): void {
		for (const t of entity_types) this.#pending_notify.add(t);
		if (this.#notify_scheduled) return;
		this.#notify_scheduled = true;
		queueMicrotask(() => {
			this.#notify_scheduled = false;
			const types = new Set(this.#pending_notify);
			this.#pending_notify.clear();
			for (const sub of this.#search_subscribers) {
				if (!types.has(sub.entity_type)) continue;
				this.search(sub.entity_type, sub.query).then(
					(result) => {
						try {
							sub.callback(result);
						} catch {
							// ignore
						}
					},
					() => {
						// ignore search errors in notification
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
