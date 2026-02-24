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
	type AnyOrama,
	type AnySchema,
	type RawData,
} from '@orama/orama';
import {
	openDatabase,
	idbGet,
	idbPut,
	idbDelete,
	idbBatch,
	type SyncMeta,
	type CachedEntity,
	type CachedSearchIndex,
} from './database.idb';
import { DatabaseError } from './database.error';

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

export interface WorkerSearchQuery {
	term?: string;
	limit?: number;
	offset?: number;
	where?: Record<string, unknown>;
	sortBy?: { property: string; order?: 'ASC' | 'DESC' };
	[key: string]: unknown;
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
	query: WorkerSearchQuery;
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

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	async init(config: WorkerInitConfig): Promise<void> {
		this.#tables = config.tables;
		this.#default_threshold = config.default_threshold;

		// Open IDB
		this.#db = await openDatabase(config.db_name);

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
		this.#entities = {};
		this.#pending_refreshes.clear();
	}

	// -----------------------------------------------------------------------
	// Sync
	// -----------------------------------------------------------------------

	async sync(entity_types?: string[]): Promise<void> {
		if (!this.#db) return;

		const types = entity_types ?? Object.keys(this.#entities);
		const client_types = types.filter((t) => this.#entities[t]?.search_mode === 'client');

		if (client_types.length === 0) return;

		// Build sync request body
		const entity_request: Record<string, unknown> = {};
		for (const entity_type of client_types) {
			const state = this.#entities[entity_type];
			entity_request[entity_type] = {
				config_version: state.config_version,
				start_updated_at: state.start_updated_at,
				end_updated_at: state.end_updated_at,
			};
		}

		// We need to determine the query params based on the state
		// If start_updated_at is undefined for any entity, we're doing a full initial sync (descending)
		// Otherwise, we request changes since end_updated_at (ascending)
		const is_initial = client_types.some(
			(t) => this.#entities[t].start_updated_at === undefined,
		);

		let num_requests = 0;
		while (num_requests++ < 50) {
			const params = new URLSearchParams();

			if (is_initial) {
				// Descending sync — get newest first
				const min_start = Math.min(
					...client_types.map((t) => this.#entities[t].start_updated_at ?? Infinity),
				);
				if (isFinite(min_start) && min_start > 0) {
					params.set('end', String(min_start));
				}
			} else {
				// Ascending sync — get changes since last known
				const max_end = Math.max(
					...client_types.map((t) => this.#entities[t].end_updated_at ?? 0),
				);
				if (max_end > 0) {
					params.set('start', String(max_end));
				}
			}

			const query = params.toString() ? `?${params}` : '';
			let response: Response;
			try {
				response = await fetch(`/api/sync${query}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ entity: entity_request }),
				});
			} catch {
				break; // Network error — stop syncing
			}

			if (!response.ok) break;

			const body = (await response.json().catch(() => undefined)) as
				| SyncResponse
				| undefined;
			if (!body) break;

			let any_data = false;

			for (const entity_type of client_types) {
				const state = this.#entities[entity_type];
				const entity_result = body.entity[entity_type];
				if (!entity_result) continue;

				// Handle schema changes — rebuild index
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
				}

				if (!state.orama) continue;

				// Apply deletes
				if (entity_result.deleted?.length) {
					try {
						removeMultiple(state.orama, entity_result.deleted as string[]);
					} catch {
						// Some IDs may not exist in the index
					}
				}

				// Apply inserts (created + updated treated the same for indexing)
				const inserts = [
					...(entity_result.created ?? []),
					...(entity_result.updated ?? []),
				];
				if (inserts.length > 0) {
					any_data = true;
					// Remove then re-insert to handle updates
					const ids = inserts.map((e) =>
						String((e as Record<string, unknown>)[state.primary_key]),
					);
					try {
						removeMultiple(state.orama, ids);
					} catch {
						// Some IDs may not exist
					}
					try {
						insertMultiple(state.orama, inserts as Record<string, unknown>[]);
					} catch {
						// Schema mismatch or corrupt data
					}

					// Check threshold
					const total_inserted =
						(entity_result.created?.length ?? 0) + (entity_result.updated?.length ?? 0);
					if (total_inserted >= state.threshold) {
						await this.#switchToServerMode(entity_type);
						continue;
					}
				}

				// Update sync timestamps
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

				// Update entity sync request for next page
				entity_request[entity_type] = {
					config_version: state.config_version,
					start_updated_at: state.start_updated_at,
					end_updated_at: state.end_updated_at,
				};
			}

			// Always persist sync meta (cheap — timestamps for resumption)
			// Persist search indices less frequently (expensive — full Orama serialization) (#10)
			await this.#persistSyncState(client_types, num_requests % 5 === 0);

			// Check if we need more pages
			if (is_initial) {
				const all_caught_up = client_types.every((t) => {
					const entity_result = body.entity[t];
					if (!entity_result) return true;
					return (
						!entity_result.first_updated_at ||
						entity_result.start_updated_at === entity_result.first_updated_at
					);
				});
				if (all_caught_up) {
					for (const t of client_types) {
						this.#entities[t].start_updated_at = 0;
						this.#entities[t].synced = true;
					}
					await this.#persistSyncState(client_types, true);
					break;
				}
			} else {
				const all_caught_up = client_types.every((t) => {
					const entity_result = body.entity[t];
					if (!entity_result) return true;
					return (
						!entity_result.end_updated_at ||
						entity_result.end_updated_at === entity_result.last_updated_at
					);
				});
				if (all_caught_up || !any_data) break;
			}
		}

		// Mark all as synced
		for (const t of client_types) {
			this.#entities[t].synced = true;
		}

		// Final index persist to capture remaining pages
		await this.#persistSyncState(client_types, true);

		// Notify active search subscribers
		this.#notifySubscribers(client_types);
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
			throw DatabaseError.transferable(
				`Create ${entity_type} failed`,
				response.status,
				error_body,
			);
		}
		const server_entity = (await response.json()) as Record<string, unknown>;

		// Remove then insert to handle sync race
		if (state.orama && state.search_mode === 'client') {
			const id = String(server_entity[state.primary_key]);
			try {
				removeFromOrama(state.orama, id);
			} catch {
				// ignore — may not exist
			}
			try {
				insertIntoOrama(state.orama, server_entity);
			} catch {
				// ignore
			}
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

	/** Get — returns IDB cache with background refresh */
	async get(
		entity_type: string,
		id: string | number,
		force_refresh?: boolean,
		on_refresh?: (data: Record<string, unknown>) => void,
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
				// Only background refresh if stale and not already in-flight
				const key = `${entity_type}/${id}`;
				const stale = Date.now() - (cached.updated_at ?? 0) > REFRESH_STALE_MS;
				if (stale && !this.#pending_refreshes.has(key)) {
					this.#pending_refreshes.add(key);
					this.#backgroundRefresh(entity_type, id, on_refresh)
						.catch(() => {})
						.finally(() => this.#pending_refreshes.delete(key));
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
				try {
					removeFromOrama(state.orama, String(id));
				} catch {
					// ignore
				}
				try {
					insertIntoOrama(state.orama, optimistic);
				} catch {
					// ignore
				}
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
				throw DatabaseError.transferable(
					`Update ${entity_type}/${id} failed`,
					response.status,
					error_body,
				);
			}
			server_entity = (await response.json()) as Record<string, unknown>;
		} catch (error) {
			if (error instanceof DatabaseError) throw error;
			this.#rollbackOrama(entity_type, id, prev_doc);
			throw error;
		}

		// Replace optimistic with server data
		if (state.orama && state.search_mode === 'client') {
			try {
				removeFromOrama(state.orama, String(id));
			} catch {
				// ignore
			}
			try {
				insertIntoOrama(state.orama, server_entity);
			} catch {
				// ignore
			}
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
				throw DatabaseError.transferable(
					`Delete ${entity_type}/${id} failed`,
					response.status,
					error_body,
				);
			}
		} catch (error) {
			if (error instanceof DatabaseError) throw error;
			this.#rollbackOrama(entity_type, id, prev_doc);
			throw error;
		}

		// Remove from IDB cache
		if (state.cache_enabled && this.#db) {
			await idbDelete(this.#db, 'entities', `${entity_type}/${id}`);
		}
	}

	// -----------------------------------------------------------------------
	// Search
	// -----------------------------------------------------------------------

	async search(
		entity_type: string,
		query: WorkerSearchQuery,
	): Promise<WorkerSearchResult> {
		const state = this.#entities[entity_type];
		if (!state) throw new Error(`Unknown entity type: ${entity_type}`);

		if (state.search_mode === 'server' || !state.orama) {
			return this.#serverSearch(entity_type, query);
		}

		// Client-side Orama search
		let result = searchOrama(state.orama, query as Record<string, unknown>);
		if (result instanceof Promise) result = await result;

		return {
			hits: result.hits.map((h) => ({
				id: String(h.id),
				document: h.document as Record<string, unknown>,
				score: h.score,
			})),
			count: result.count,
			elapsed: result.elapsed,
		};
	}

	/** One-shot list that always hits the server */
	async list(entity_type: string, query: WorkerSearchQuery): Promise<WorkerSearchResult> {
		const state = this.#entities[entity_type];
		if (!state) throw new Error(`Unknown entity type: ${entity_type}`);
		return this.#serverSearch(entity_type, query, true);
	}

	/** Subscribe to search results that auto-update when the index changes. */
	async subscribe(
		entity_type: string,
		query: WorkerSearchQuery,
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
		query: WorkerSearchQuery,
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
		try {
			removeFromOrama(state.orama, String(id));
		} catch {
			// may not exist
		}
		try {
			insertIntoOrama(state.orama, prev_doc);
		} catch {
			// ignore
		}
		this.#notifySubscribers([entity_type]);
	}

	/** Server-side search. Throws on error when throw_on_error is true. */
	async #serverSearch(
		entity_type: string,
		query: WorkerSearchQuery,
		throw_on_error = false,
	): Promise<WorkerSearchResult> {
		const params = new URLSearchParams();
		if (query.term) params.set('term', query.term);
		if (query.limit) params.set('limit', String(query.limit));
		if (query.offset) params.set('offset', String(query.offset));
		if (query.where) params.set('where', JSON.stringify(query.where));
		if (query.sortBy) {
			params.set('order', `${query.sortBy.property}:${query.sortBy.order ?? 'ASC'}`);
		}
		params.set('sparse', 'true');

		const qs = params.toString();
		const response = await fetch(`/api/${entity_type}${qs ? '?' : ''}${qs}`);
		if (!response.ok) {
			if (throw_on_error) {
				const error_body = (await response.json().catch(() => ({}))) as Record<
					string,
					unknown
				>;
				throw DatabaseError.transferable(
					`List ${entity_type} failed`,
					response.status,
					error_body,
				);
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
		if (!response.ok) return undefined;
		const data = (await response.json()) as Record<string, unknown>;

		if (state.cache_enabled && this.#db) {
			await idbPut(this.#db, 'entities', `${entity_type}/${id}`, {
				entity_type,
				id,
				data,
				updated_at: Date.now(),
			} satisfies CachedEntity);
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
						start_updated_at: state.start_updated_at ?? 0,
						end_updated_at: state.end_updated_at ?? 0,
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
	 * Always saves sync meta (cheap). Optionally saves Orama indices (expensive).
	 */
	async #persistSyncState(entity_types: string[], save_index = true): Promise<void> {
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
				value: {
					entity_type,
					search_mode: state.search_mode,
					config_version: state.config_version,
					last_synced_at: state.last_synced_at,
					start_updated_at: state.start_updated_at ?? 0,
					end_updated_at: state.end_updated_at ?? 0,
				} satisfies SyncMeta,
			});

			if (save_index && state.orama && state.search_mode === 'client') {
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
