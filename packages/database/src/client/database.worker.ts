import { expose } from 'comlink';
import {
	create as createOrama,
	insertMultiple,
	removeMultiple,
	insert as insertIntoOrama,
	remove as removeFromOrama,
	search as searchOrama,
	save as saveOrama,
	load as loadOrama,
	count as countOrama,
	getByID as getOramaByID,
	type AnyOrama,
	type AnySchema,
	type RawData,
} from '@orama/orama';
import {
	openDatabase,
	idbGet,
	idbPut,
	idbDelete,
	idbDeleteByPrefix,
	idbBatch,
	type SyncMeta,
	type CachedEntity,
	type CachedSearchIndex,
} from './database.idb';
import { DelightError } from '@delightstack/utilities';
import { type SearchQueryInput, encodeSearchQuery } from '../search-query';

/** Inline sync response type to avoid importing server module in worker context. */
interface SyncEntityResult {
	config?: { schema: Record<string, unknown>; sort: unknown };
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
	/** Serializable Orama configs extracted from table definitions */
	tables: Record<
		string,
		{
			orama: { schema: Record<string, unknown>; sort: unknown };
			primary_key: string;
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
	/** Default entity count threshold for auto client->server switch */
	default_threshold: number;
}

export interface WorkerSearchResult {
	hits: { id: string; document: Record<string, unknown>; score: number }[];
	count: number;
	elapsed?: unknown;
}

interface EntitySyncState {
	orama: AnyOrama | null;
	search_mode: 'client' | 'server';
	config_version: number;
	last_synced_at: number;
	start_updated_at: number | undefined;
	end_updated_at: number | undefined;
	synced: boolean;
	threshold: number;
	cache_enabled: boolean;
	primary_key: string;
}

type SearchSubscriber = {
	id: string;
	entity_type: string;
	query: SearchQueryInput;
	callback: (result: WorkerSearchResult) => void;
};

/** Cache entries fresher than this are not background-refreshed (ms) */
const REFRESH_STALE_MS = 30_000;

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

export class DatabaseWorker {
	#db: IDBDatabase | null = null;
	#entities: Record<string, EntitySyncState> = {};
	#tables: WorkerInitConfig['tables'] = {};
	#search_subscribers: SearchSubscriber[] = [];
	#subscriber_counter = 0;
	#default_threshold = 5000;
	#pending_notify = new Set<string>();
	#notify_scheduled = false;
	#pending_refreshes = new Set<string>();
	#db_name: string | undefined;
	#sync_in_flight: Promise<void> | null = null;

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	async init(config: WorkerInitConfig): Promise<void> {
		// A SharedWorker is initialized by EVERY connecting tab. Re-running init
		// for the same database would discard in-memory sync state (and any
		// un-persisted Orama data) while another tab's sync loop is mid-flight.
		if (this.#db && this.#db_name === config.db_name) return;

		// Switching scope (different db_name): tear down the previous state
		// cleanly. This applies to ALL tabs sharing the worker — a scope switch
		// (e.g. changing orgs) is a global decision, not a per-tab one.
		if (this.#db) {
			this.#db.close();
			this.#db = null;
			this.#entities = {};
			this.#pending_refreshes.clear();
		}

		this.#tables = config.tables;
		this.#default_threshold = config.default_threshold;

		// Open IDB
		this.#db = await openDatabase(config.db_name);
		this.#db_name = config.db_name;

		// Initialize per-entity state
		for (const [entity_type, table] of Object.entries(config.tables)) {
			const overrides = config.entities?.[entity_type];
			const forced_mode = overrides?.search_mode;

			// Load persisted sync meta
			const meta = await idbGet<SyncMeta>(this.#db, 'sync_meta', entity_type);

			const search_mode: 'client' | 'server' =
				forced_mode ?? meta?.search_mode ?? 'client';

			// Create Orama index (unless server-only mode)
			let orama: AnyOrama | null = null;
			if (search_mode === 'client') {
				orama = createOrama({
					schema: table.orama.schema as AnySchema,
					sort: table.orama.sort as Record<string, unknown>,
				});

				// Try to load cached index from IDB
				const cached = await idbGet<CachedSearchIndex>(
					this.#db,
					'search_index',
					entity_type,
				);
				if (cached?.index && cached.config_version === (meta?.config_version ?? 0)) {
					try {
						loadOrama(orama, cached.index as RawData);
					} catch {
						// Corrupted cache — start fresh
						orama = createOrama({
							schema: table.orama.schema as AnySchema,
							sort: table.orama.sort as Record<string, unknown>,
						});
					}
				}
			}

			this.#entities[entity_type] = {
				orama,
				search_mode,
				config_version: meta?.config_version ?? 0,
				last_synced_at: meta?.last_synced_at ?? 0,
				start_updated_at: meta?.start_updated_at,
				end_updated_at: meta?.end_updated_at,
				synced: false,
				threshold: overrides?.threshold ?? this.#default_threshold,
				cache_enabled: overrides?.cache !== false,
				primary_key: table.primary_key,
			};
		}

		// Sync is NOT awaited here — the main thread controls sync lifecycle
	}

	async destroy(): Promise<void> {
		this.#search_subscribers = [];
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
		let next_persist_page = 1;
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

				// Handle schema changes — rebuild the index and restart this
				// entity's sync from scratch (the old window refers to documents
				// shaped by the old schema), and drop the cached entities
				if (
					entity_result.config &&
					entity_result.config_version !== state.config_version
				) {
					const table = this.#tables[entity_type];
					state.orama = createOrama({
						schema:
							(entity_result.config.schema as AnySchema) ??
							(table.orama.schema as AnySchema),
						sort:
							(entity_result.config.sort as Record<string, unknown>) ??
							(table.orama.sort as Record<string, unknown>),
					});
					state.config_version = entity_result.config_version;
					state.start_updated_at = undefined;
					state.end_updated_at = undefined;
					descending_request.add(entity_type);
					await idbDeleteByPrefix(this.#db, 'entities', `${entity_type}/`);
				}

				if (!state.orama) {
					done.add(entity_type);
					continue;
				}

				// Apply deletes to the index AND the entity cache — a row deleted on
				// another device must not keep being served by get()
				if (entity_result.deleted?.length) {
					any_changes = true;
					try {
						removeMultiple(
							state.orama,
							entity_result.deleted.map((id) => String(id)),
						);
					} catch {
						// Some IDs may not exist in the index
					}
					if (state.cache_enabled) {
						await idbBatch(
							this.#db,
							entity_result.deleted.map((id) => ({
								store: 'entities' as const,
								type: 'delete' as const,
								key: `${entity_type}/${id}`,
							})),
						);
					}
				}

				// Apply inserts (created + updated treated the same for indexing).
				// Fast path: batch remove + insert of the projected docs. If ANY doc
				// fails validation, insertMultiple throws at that doc and silently
				// drops the rest of the page — while the synced window still
				// advances, permanently losing those documents. So on failure, fall
				// back to per-doc application where one bad doc costs only itself.
				const inserts = [
					...(entity_result.created ?? []),
					...(entity_result.updated ?? []),
				] as Record<string, unknown>[];
				if (inserts.length > 0) {
					any_changes = true;
					const projected = inserts.map((e) =>
						this.#projectToIndex(entity_type, e),
					);
					const ids = projected.map((e) => String(e[state.primary_key]));
					try {
						removeMultiple(state.orama, ids);
						insertMultiple(state.orama, projected);
					} catch {
						// Partial batch failure — re-apply doc-by-doc (idempotent:
						// each doc is removed then reinserted) so only genuinely
						// corrupt docs are lost, loudly.
						for (const doc of inserts) {
							this.#applyIndexDoc(entity_type, doc);
						}
					}

					// The index only makes sense client-side up to a size; past the
					// threshold, switch to server search. Use the ACTUAL index size —
					// counting cumulative inserts would also count re-synced updates
					// (a live backfill bumps the same docs over and over) and switch
					// modes long before the index is actually big.
					if (countOrama(state.orama) >= state.threshold) {
						await this.#switchToServerMode(entity_type);
						done.add(entity_type);
						continue;
					}
				}

				// Grow the synced window with the page that was just applied
				const had_changes =
					inserts.length > 0 || (entity_result.deleted?.length ?? 0) > 0;
				if (entity_result.start_updated_at) {
					state.start_updated_at = Math.min(
						entity_result.start_updated_at,
						state.start_updated_at ?? Infinity,
					);
				}
				if (entity_result.end_updated_at) {
					state.end_updated_at = Math.max(
						entity_result.end_updated_at,
						state.end_updated_at ?? 0,
					);
				}
				state.last_synced_at = Date.now();

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

			// Persist the synced-window meta and the Orama index TOGETHER — the
			// persisted window must never get ahead of the persisted index,
			// otherwise a refresh would reload an index that is missing documents
			// the window claims are synced (and they would never be refetched).
			// Serializing the index is expensive and grows with its size, so
			// persist on a doubling page schedule (1, 2, 4, 8, ...): early saves
			// are cheap and keep resume granularity fine, later saves are rare so
			// total serialization work stays bounded on long backfills.
			if (num_requests >= next_persist_page) {
				next_persist_page = num_requests * 2;
				await this.#persistSyncState(client_types);
			}

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

		// Final index persist to capture remaining pages
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

		// Remove then insert to handle sync race (projected: the full entity's
		// arrays/objects/nulls fail the sparse index's schema validation)
		if (state.orama && state.search_mode === 'client') {
			this.#applyIndexDoc(entity_type, server_entity);
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

		// Store pre-update version for rollback
		let prev_doc: Record<string, unknown> | undefined;
		if (state.orama && state.search_mode === 'client') {
			try {
				const result = searchOrama(state.orama, {
					where: { [state.primary_key]: { eq: String(id) } },
					limit: 1,
				});
				const hits = result instanceof Promise ? (await result).hits : result.hits;
				if (hits[0]?.document) {
					prev_doc = hits[0].document as Record<string, unknown>;
				}
			} catch {
				// ignore
			}

			// Optimistic update
			if (prev_doc) {
				const optimistic = { ...prev_doc, ...data, updated_at: Date.now() };
				this.#applyIndexDoc(entity_type, optimistic);
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
				this.#rollbackOrama(entity_type, id, prev_doc);
				throw DelightError.transferable({
					message: (error_body.message as string) || `Update ${entity_type}/${id} failed`,
					status: response.status,
					detail: error_body.detail as string | undefined,
				});
			}
			server_entity = (await response.json()) as Record<string, unknown>;
		} catch (error) {
			if (DelightError.is(error)) throw error;
			this.#rollbackOrama(entity_type, id, prev_doc);
			throw error;
		}

		// Replace optimistic with server data (projected to the index schema)
		if (state.orama && state.search_mode === 'client') {
			this.#applyIndexDoc(entity_type, server_entity);
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

		// Store for rollback
		let prev_doc: Record<string, unknown> | undefined;
		if (state.orama && state.search_mode === 'client') {
			try {
				const result = searchOrama(state.orama, {
					where: { [state.primary_key]: { eq: String(id) } },
					limit: 1,
				});
				const hits = result instanceof Promise ? (await result).hits : result.hits;
				if (hits[0]?.document) {
					prev_doc = hits[0].document as Record<string, unknown>;
				}
			} catch {
				// ignore
			}

			// Optimistic delete
			try {
				removeFromOrama(state.orama, String(id));
			} catch {
				// ignore
			}
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
				this.#rollbackOrama(entity_type, id, prev_doc);
				throw DelightError.transferable({
					message: (error_body.message as string) || `Delete ${entity_type}/${id} failed`,
					status: response.status,
					detail: error_body.detail as string | undefined,
				});
			}
		} catch (error) {
			if (DelightError.is(error)) throw error;
			this.#rollbackOrama(entity_type, id, prev_doc);
			throw error;
		}

		// Remove from IDB cache
		if (state.cache_enabled && this.#db) {
			await idbDelete(this.#db, 'entities', `${entity_type}/${id}`);
		}
	}

	/**
	 * Apply a change that originated outside this tab (e.g. a websocket
	 * event). Upserts/removes the single entity in Orama + IDB and notifies
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
			if (state.orama && state.search_mode === 'client') {
				try {
					removeFromOrama(state.orama, String(id));
				} catch {
					// ignore — may not be in index
				}
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
			// #fetchAndCache already updates Orama + IDB + notifies
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

		if (state.orama && state.search_mode === 'client') {
			// Index the server's sparse projection when the event carries it —
			// that is exactly the document a sync page would deliver. The full
			// entity is only a fallback (projected to the schema) for servers
			// that don't send `sparse` yet.
			const index_doc = sparse ?? entity!;
			const applied = this.#applyIndexDoc(entity_type, index_doc);
			if (!applied) {
				// The old version was removed but the new one couldn't be
				// indexed. Roll the synced window back to just before this
				// change and resync, otherwise the document is silently gone
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
		if (!state?.orama || state.search_mode !== 'client') return false;
		const current = getOramaByID(state.orama, String(id)) as
			| Record<string, unknown>
			| undefined;
		if (!current) return false;
		const applied = this.#applyIndexDoc(entity_type, { ...current, ...patch });
		this.#notifySubscribers([entity_type]);
		return applied;
	}

	// -----------------------------------------------------------------------
	// Search
	// -----------------------------------------------------------------------

	async search(
		entity_type: string,
		query: SearchQueryInput,
	): Promise<WorkerSearchResult> {
		const state = this.#entities[entity_type];
		if (!state) throw new Error(`Unknown entity type: ${entity_type}`);

		if (state.search_mode === 'server' || !state.orama) {
			return this.#serverSearch(entity_type, query);
		}

		// Client-side Orama search — convert SearchQueryInput to Orama-native params
		const orama_params: Record<string, unknown> = { ...query };
		// Resolve q alias
		if (!orama_params.term && orama_params.q) orama_params.term = orama_params.q;
		delete orama_params.q;
		// Convert order[] → Orama's sortBy
		if (Array.isArray(orama_params.order) && orama_params.order.length > 0) {
			const orders = orama_params.order as { key: string; direction?: string }[];
			orama_params.sortBy = {
				property: orders[0].key,
				order: (orders[0].direction || 'ASC').toUpperCase(),
			};
			delete orama_params.order;
		}
		// Remove fields Orama doesn't understand
		delete orama_params.sparse;
		delete orama_params.cursor;

		let result = searchOrama(state.orama, orama_params);
		if (result instanceof Promise) result = await result;

		// Orama (<= 3.1.18) can return ghost hits with an empty document for
		// previously removed docs — filter them out of user-facing results
		const hits = result.hits.filter(
			(h) =>
				h.document &&
				(h.document as Record<string, unknown>)[state.primary_key] !== undefined,
		);
		return {
			hits: hits.map((h) => ({
				id: String(h.id),
				document: h.document as Record<string, unknown>,
				score: h.score,
			})),
			count: Math.max(0, result.count - (result.hits.length - hits.length)),
			elapsed: result.elapsed,
		};
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

	/** Get the current search mode for an entity type. */
	async getSearchMode(entity_type: string): Promise<'client' | 'server'> {
		return this.#entities[entity_type]?.search_mode ?? 'server';
	}

	/** Whether the entity type has completed its initial sync. */
	async isSynced(entity_type: string): Promise<boolean> {
		return this.#entities[entity_type]?.synced ?? false;
	}

	// -----------------------------------------------------------------------
	// Private helpers
	// -----------------------------------------------------------------------

	/** Rollback an Orama index change by removing the current entry and re-inserting the previous doc. */
	#rollbackOrama(
		entity_type: string,
		id: string | number,
		prev_doc: Record<string, unknown> | undefined,
	): void {
		const state = this.#entities[entity_type];
		if (!prev_doc || !state?.orama || state.search_mode !== 'client') return;
		this.#applyIndexDoc(entity_type, prev_doc);
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
				if (state.orama && state.search_mode === 'client') {
					try {
						removeFromOrama(state.orama, String(id));
					} catch {
						/* may not exist */
					}
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

		// Update Orama search index if in client search mode (projected: full
		// entities don't fit the sparse index schema)
		if (state.orama && state.search_mode === 'client') {
			this.#applyIndexDoc(entity_type, data);
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
	 * Project a document to what the entity's Orama index can safely accept:
	 * keep the primary key + timestamps + schema fields whose runtime type
	 * matches the schema, drop everything else (nulls, arrays of objects, full-
	 * entity fields the sparse schema doesn't know). Orama tolerates missing
	 * fields but THROWS on mismatched ones — and a throw after the
	 * remove-before-insert silently drops the document from the index, which is
	 * how a mailbox lost ~30% of its threads during a live backfill.
	 */
	#projectToIndex(
		entity_type: string,
		doc: Record<string, unknown>,
	): Record<string, unknown> {
		const state = this.#entities[entity_type];
		const schema = this.#tables[entity_type]?.orama?.schema as
			| Record<string, unknown>
			| undefined;
		const projected: Record<string, unknown> = {};
		const pk = state?.primary_key ?? 'id';
		if (doc[pk] !== undefined) projected[pk] = String(doc[pk]);
		for (const ts_field of ['created_at', 'updated_at']) {
			if (typeof doc[ts_field] === 'number') projected[ts_field] = doc[ts_field];
		}
		if (!schema) return projected;

		const matches = (type: unknown, value: unknown): boolean => {
			if (value === null || value === undefined) return false;
			switch (type) {
				case 'string':
				case 'enum':
					return typeof value === 'string' || typeof value === 'number';
				case 'number':
					return typeof value === 'number' && Number.isFinite(value);
				case 'boolean':
					return typeof value === 'boolean';
				case 'string[]':
				case 'enum[]':
					return (
						Array.isArray(value) &&
						value.every((v) => typeof v === 'string' || typeof v === 'number')
					);
				case 'number[]':
					return Array.isArray(value) && value.every((v) => typeof v === 'number');
				case 'boolean[]':
					return Array.isArray(value) && value.every((v) => typeof v === 'boolean');
				default:
					return false;
			}
		};

		for (const [field, type] of Object.entries(schema)) {
			if (field === pk || field in projected) continue;
			const value = doc[field];
			if (typeof type === 'object' && type !== null) {
				// Nested schema object — recurse shallowly
				if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
					const nested: Record<string, unknown> = {};
					for (const [nf, nt] of Object.entries(type as Record<string, unknown>)) {
						const nv = (value as Record<string, unknown>)[nf];
						if (matches(nt, nv)) nested[nf] = nv;
					}
					projected[field] = nested;
				}
				continue;
			}
			if (matches(type, value)) projected[field] = value;
		}
		return projected;
	}

	/**
	 * Remove + re-insert a single document in the entity's index. Never throws;
	 * returns false when the document could not be (re)inserted. The caller
	 * decides whether a failure needs a window rollback (external changes) or
	 * just a loud log (sync pages, where refetching the same corrupt doc
	 * forever would wedge the sync).
	 */
	#applyIndexDoc(entity_type: string, doc: Record<string, unknown>): boolean {
		const state = this.#entities[entity_type];
		if (!state?.orama) return false;
		const id = String(doc[state.primary_key] ?? '');
		if (!id) return false;
		try {
			removeFromOrama(state.orama, id);
		} catch {
			// not in the index — expected for creates
		}
		try {
			insertIntoOrama(state.orama, this.#projectToIndex(entity_type, doc));
			return true;
		} catch (error) {
			console.error(
				`[database] failed to index ${entity_type}/${id} — document dropped from local search`,
				error,
			);
			return false;
		}
	}

	async #switchToServerMode(entity_type: string): Promise<void> {
		const state = this.#entities[entity_type];
		if (!state) return;

		state.search_mode = 'server';
		state.orama = null;

		if (this.#db) {
			await idbBatch(this.#db, [
				{
					store: 'sync_meta',
					type: 'put',
					key: entity_type,
					value: {
						entity_type,
						search_mode: 'server',
						config_version: state.config_version,
						last_synced_at: state.last_synced_at,
						start_updated_at: state.start_updated_at,
						end_updated_at: state.end_updated_at,
					} satisfies SyncMeta,
				},
				{
					store: 'search_index',
					type: 'delete',
					key: entity_type,
				},
			]);
		}
	}

	/**
	 * Persist sync state using batched IDB writes.
	 *
	 * The sync meta (synced window) and the serialized Orama index are always
	 * written together, in one IDB transaction. Persisting the window without
	 * the index would let the window get ahead of the saved index — after a
	 * refresh, documents inside the window but missing from the index would
	 * never be refetched.
	 */
	async #persistSyncState(entity_types: string[]): Promise<void> {
		if (!this.#db) return;

		const ops: {
			store: 'sync_meta' | 'search_index';
			type: 'put';
			key: string;
			value: SyncMeta | CachedSearchIndex;
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

			if (state.orama && state.search_mode === 'client') {
				const saved = saveOrama(state.orama);
				ops.push({
					store: 'search_index',
					type: 'put',
					key: entity_type,
					value: {
						entity_type,
						index: saved,
						config_version: state.config_version,
						updated_at: Date.now(),
					} satisfies CachedSearchIndex,
				});
			}
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
