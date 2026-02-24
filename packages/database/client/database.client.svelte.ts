import { proxy } from 'comlink';
import type { Remote } from 'comlink';
import { createSubscriber } from 'svelte/reactivity';
import { untrack } from 'svelte';
import { deepEqual } from 'fast-equals';
import type { Database } from '../schema/schema';
import type {
	DatabaseWorker,
	WorkerSearchQuery,
	WorkerSearchResult,
} from './database.worker';
import { DatabaseError } from './database.error';
import { getWorker, resetWorker } from './database.worker.init';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TableMap = Record<string, Database.Table>;

export interface DatabaseClientConfig<T extends TableMap = TableMap> {
	/** Same table definitions used on the server — single source of truth */
	tables: T;

	/** Per-entity overrides (all optional) */
	entities?: {
		[K in keyof T]?: {
			/** Force search mode — 'server' skips client-side Orama entirely */
			search_mode?: 'client' | 'server';
			/** Custom threshold for auto client→server switch (default: 5000) */
			threshold?: number;
			/** Disable IDB cache for this entity */
			cache?: boolean;
		};
	};

	/** IndexedDB database name — scope per org/context */
	db_name: string;

	/** Default threshold for auto client→server switch (default: 5000) */
	default_threshold?: number;

	/** Whether the app is in dev mode (uses regular Worker instead of SharedWorker) */
	dev?: boolean;

	/** Hooks for external integration (e.g. websocket) */
	hooks?: {
		/** Called after any local CRUD operation */
		onEntityChange?: (event: {
			type: 'create' | 'update' | 'delete';
			entity_type: string;
			id: string | number;
			data?: Record<string, unknown>;
		}) => void;
		/** Called to subscribe to external changes */
		onSubscribe?: (
			callback: (event: {
				type: 'create' | 'update' | 'delete';
				entity_type: string;
				id: string | number;
				data?: Record<string, unknown>;
			}) => void,
		) => (() => void) | void;
	};
}

type EntityInput<T extends Database.Table> = Omit<
	Database.Entity<T>,
	'id' | 'created_at' | 'updated_at'
>;

export interface SearchHit<T extends Database.Table = Database.Table> {
	id: string;
	document: Database.SearchEntity<T>;
	score: number;
}

export interface SearchResult<T extends Database.Table = Database.Table> {
	hits: SearchHit<T>[];
	count: number;
	elapsed?: unknown;
}

// ---------------------------------------------------------------------------
// EntityState — reactive per-entity wrapper
// ---------------------------------------------------------------------------

export class EntityState<
	T extends Database.Table = Database.Table,
	EntityType extends string = string,
> {
	readonly entity_type: EntityType;
	#id: string | number | undefined;
	#worker: Remote<DatabaseWorker> | null;
	#primary_key: string;
	#onChange?: (event: {
		type: 'create' | 'update' | 'delete';
		id: string | number;
		data?: Record<string, unknown>;
	}) => void;
	#subscriber: () => void;

	#value = $state({} as Database.Entity<T>);
	#server_value = $state.raw<Database.Entity<T> | undefined | null>();
	#saving = $state(false);
	#loading = $state(false);
	#loaded = $state(false);

	#has_changes = $derived.by(() => {
		if (!this.#server_value || !this.#value) return false;
		return !deepEqual(this.#value, this.#server_value);
	});

	/** Reusable comlink proxy for background refresh callback */
	#refresh_proxy = proxy((fresh: Record<string, unknown>) => {
		this.#server_value = fresh as Database.Entity<T>;
		if (!untrack(() => this.#has_changes)) {
			this.#value = fresh as Database.Entity<T>;
		}
	});

	/** The current local state (editable). Always non-null — initialized from initial_data. */
	get value(): Database.Entity<T> {
		this.#subscriber();
		return this.#value;
	}

	set value(v: Database.Entity<T>) {
		this.#value = v;
	}

	/** Last confirmed server state */
	get server_value(): Database.Entity<T> | undefined | null {
		this.#subscriber();
		return this.#server_value;
	}

	/** Whether local differs from server */
	get has_changes(): boolean {
		this.#subscriber();
		return this.#has_changes;
	}

	/** Whether a save is in progress */
	get saving(): boolean {
		return this.#saving;
	}

	/** Whether entity is being fetched */
	get loading(): boolean {
		return this.#loading;
	}

	/** Whether entity has been fetched at least once */
	get loaded(): boolean {
		this.#subscriber();
		return this.#loaded;
	}

	/** Entity ID */
	get id(): string | number | undefined {
		return this.#id;
	}

	/** Timestamp (epoch ms) when entity was created */
	get created_at(): number | undefined {
		return (this.#value as Record<string, unknown>).created_at as number | undefined;
	}

	/** Timestamp (epoch ms) when entity was last updated */
	get updated_at(): number | undefined {
		return (this.#value as Record<string, unknown>).updated_at as number | undefined;
	}

	constructor(
		entity_type: EntityType,
		id: string | number | undefined,
		options?: {
			worker?: Remote<DatabaseWorker> | null;
			initial_data?: Partial<Database.Entity<T>>;
			primary_key?: string;
			onChange?: (event: {
				type: 'create' | 'update' | 'delete';
				id: string | number;
				data?: Record<string, unknown>;
			}) => void;
		},
	) {
		this.entity_type = entity_type;
		this.#id = id;
		this.#worker = options?.worker ?? null;
		this.#primary_key = options?.primary_key ?? 'id';
		this.#onChange = options?.onChange;
		this.#value = (options?.initial_data ?? {}) as Database.Entity<T>;
		this.#subscriber = createSubscriber(() => {
			// Auto-load when first subscribed
			if (!this.#loaded && !this.#loading && this.#id) {
				this.load();
			}
		});
	}

	/** Save changes to server. Creates if no ID, updates otherwise. */
	async save(changes?: Partial<Database.Entity<T>>): Promise<this> {
		if (untrack(() => this.#saving)) return this;
		this.#saving = true;
		try {
			const data_to_save =
				changes ?? ($state.snapshot(this.#value) as Record<string, unknown>);

			const worker = this.#getWorker();
			let result: Database.Entity<T>;
			if (!this.#id) {
				// No ID — create new entity
				let raw: Record<string, unknown>;
				try {
					raw = await worker.create(
						this.entity_type,
						data_to_save as Record<string, unknown>,
					);
				} catch (error) {
					throw DatabaseError.fromWorker(error) ?? error;
				}
				result = raw as Database.Entity<T>;
				// Update ID from server response using configured primary key
				const pk = raw[this.#primary_key] as string | number;
				this.#id = pk;
				// Update cache key
				EntityState.#cache.delete(`${this.entity_type}:`);
				EntityState.#cache.set(`${this.entity_type}:${pk}`, this as EntityState);
				// Fire change hook
				this.#onChange?.({ type: 'create', id: pk, data: raw });
			} else {
				// Has ID — update existing entity
				let raw: Record<string, unknown>;
				try {
					raw = await worker.update(
						this.entity_type,
						this.#id,
						data_to_save as Record<string, unknown>,
					);
				} catch (error) {
					throw DatabaseError.fromWorker(error) ?? error;
				}
				result = raw as Database.Entity<T>;
				// Fire change hook
				this.#onChange?.({ type: 'update', id: this.#id, data: raw });
			}

			this.#server_value = result;
			this.#value = result;
			this.#loaded = true;
		} finally {
			this.#saving = false;
		}
		return this;
	}

	/** Fetch fresh data from server. Supports force_refresh and SSR. */
	async load(options?: {
		force_refresh?: boolean;
		fetch?: typeof globalThis.fetch;
	}): Promise<void> {
		if (this.#loading) return;
		if (!this.#id) return;
		this.#loading = true;
		try {
			let data: Database.Entity<T> | undefined;

			if (this.#worker) {
				// Worker path — normal browser environment
				// Reuse stored proxy to avoid creating new MessageChannel ports
				data = (await this.#worker.get(
					this.entity_type,
					this.#id,
					options?.force_refresh,
					this.#refresh_proxy,
				)) as Database.Entity<T> | undefined;
			} else {
				// SSR path — direct fetch without worker
				const fetchFn = options?.fetch ?? globalThis.fetch;
				const response = await fetchFn(`/api/${this.entity_type}/${this.#id}`);
				if (response.ok) {
					data = (await response.json()) as Database.Entity<T>;
				}
			}

			if (data) {
				// Read has_changes BEFORE updating server_value
				const had_changes = untrack(() => this.#has_changes);
				this.#server_value = data;
				// Update local value if user has no unsaved changes
				if (!had_changes) {
					this.#value = data;
				}
				this.#loaded = true;
			}
		} finally {
			this.#loading = false;
		}
	}

	/** Delete this entity from the server. */
	async delete(): Promise<void> {
		if (!this.#id) return;
		const worker = this.#getWorker();
		try {
			await worker.delete(this.entity_type, this.#id);
		} catch (error) {
			throw DatabaseError.fromWorker(error) ?? error;
		}
		// Fire change hook
		this.#onChange?.({ type: 'delete', id: this.#id });
		// Remove from cache
		EntityState.#cache.delete(`${this.entity_type}:${this.#id}`);
	}

	/** Discard local changes, revert to server_value. */
	reset(): void {
		if (this.#server_value) {
			this.#value = structuredClone(
				$state.snapshot(this.#server_value),
			) as Database.Entity<T>;
		}
	}

	/** Clean snapshot of the current value. */
	toJSON(): Database.Entity<T> {
		return $state.snapshot(this.#value) as Database.Entity<T>;
	}

	#getWorker(): Remote<DatabaseWorker> {
		if (!this.#worker) {
			throw new Error(
				'Worker not available. Call `await db.init()` first or provide fetch option for SSR.',
			);
		}
		return this.#worker;
	}

	// -- Static singleton cache --

	static #cache = new Map<string, EntityState>();

	static from<T extends Database.Table, EntityType extends string = string>(
		entity_type: EntityType,
		id: string | number | undefined,
		options?: {
			worker?: Remote<DatabaseWorker> | null;
			initial_data?: Partial<Database.Entity<T>>;
			primary_key?: string;
			onChange?: (event: {
				type: 'create' | 'update' | 'delete';
				id: string | number;
				data?: Record<string, unknown>;
			}) => void;
		},
	): EntityState<T, EntityType> {
		const key = `${entity_type}:${id ?? ''}`;
		if (EntityState.#cache.has(key)) {
			return EntityState.#cache.get(key) as EntityState<T, EntityType>;
		}
		const instance = new EntityState(entity_type, id, options) as EntityState<
			T,
			EntityType
		>;
		EntityState.#cache.set(key, instance as EntityState);
		return instance;
	}

	/** Clear all cached EntityState instances (used on scope change). */
	static clearCache(): void {
		EntityState.#cache.clear();
	}
}

// ---------------------------------------------------------------------------
// DatabaseSearch — reactive search wrapper
// ---------------------------------------------------------------------------

export class DatabaseSearch<
	T extends Database.Table = Database.Table,
	EntityType extends string = string,
> {
	readonly entity_type: EntityType;
	#worker: Remote<DatabaseWorker>;
	#subscriber_id: string | null = null;
	#init_promise: Promise<void> | null = null;
	#subscriber: () => void;
	#destroyed = false;
	#effect_cleanup: (() => void) | null = null;

	#results = $state<SearchHit<T>[]>([]);
	#docs = $derived<Database.SearchEntity<T>[]>(this.#results.map((h) => h.document));
	#count = $state(0);
	#loading = $state(true);
	#error = $state<unknown>(null);
	#mode = $state<'client' | 'server'>('client');
	#query_state = $state<WorkerSearchQuery>({});

	/** Reactive array of search hits */
	get results(): SearchHit<T>[] {
		this.#subscriber();
		return this.#results;
	}

	/** Convenience accessor for just the documents */
	get docs(): Database.SearchEntity<T>[] {
		this.#subscriber();
		return this.#docs;
	}

	/** Total matching count */
	get count(): number {
		this.#subscriber();
		return this.#count;
	}

	/** Whether search is in progress */
	get loading(): boolean {
		this.#subscriber();
		return this.#loading;
	}

	/** Any error from the search */
	get error(): unknown {
		return this.#error;
	}

	/** Current search mode */
	get mode(): 'client' | 'server' {
		return this.#mode;
	}

	/** Get/set the search query. Setting triggers a re-search. */
	get query(): WorkerSearchQuery {
		return this.#query_state;
	}

	set query(q: WorkerSearchQuery) {
		this.#query_state = q;
		this.#updateSubscription();
	}

	constructor(
		entity_type: EntityType,
		worker: Remote<DatabaseWorker>,
		query?: WorkerSearchQuery,
	) {
		this.entity_type = entity_type;
		this.#worker = worker;
		if (query) this.#query_state = query;

		this.#subscriber = createSubscriber(() => {
			if (!this.#subscriber_id && !this.#init_promise && !this.#destroyed) {
				this.#initSubscription();
			}
		});

		// Set up a reactive effect to re-search when query changes
		this.#effect_cleanup = $effect.root(() => {
			let first = true;
			$effect(() => {
				// Read the query to trigger on changes
				const _ = $state.snapshot(this.#query_state);
				if (first) {
					first = false;
					return;
				}
				this.#updateSubscription();
			});
		});
	}

	/** Manually refresh search results. */
	async refresh(): Promise<void> {
		try {
			this.#loading = true;
			const result = await this.#worker.search(
				this.entity_type,
				$state.snapshot(this.#query_state) as WorkerSearchQuery,
			);
			this.#results = result.hits as SearchHit<T>[];
			this.#count = result.count;
			this.#error = null;
		} catch (e) {
			this.#error = e;
		} finally {
			this.#loading = false;
		}
	}

	/** Cleanup subscription — clean up effect root. */
	destroy(): void {
		this.#destroyed = true;
		if (this.#effect_cleanup) {
			this.#effect_cleanup();
			this.#effect_cleanup = null;
		}
		if (this.#subscriber_id) {
			this.#worker.unsubscribe(this.#subscriber_id).catch(() => {});
			this.#subscriber_id = null;
		}
	}

	/** Dedup subscription init using promise */
	async #initSubscription(): Promise<void> {
		if (this.#destroyed) return;
		if (this.#init_promise) return;

		this.#init_promise = (async () => {
			try {
				const mode = await this.#worker.getSearchMode(this.entity_type);
				this.#mode = mode;

				this.#subscriber_id = await this.#worker.subscribe(
					this.entity_type,
					$state.snapshot(this.#query_state) as WorkerSearchQuery,
					proxy((result: WorkerSearchResult) => {
						if (this.#destroyed) return;
						this.#results = result.hits as SearchHit<T>[];
						this.#count = result.count;
						this.#loading = false;
						this.#error = null;
					}),
				);
			} catch (e) {
				this.#error = e;
				this.#loading = false;
			}
		})();

		await this.#init_promise;
	}

	async #updateSubscription(): Promise<void> {
		if (this.#destroyed) return;

		if (this.#subscriber_id) {
			try {
				await this.#worker.updateSubscription(
					this.#subscriber_id,
					$state.snapshot(this.#query_state) as WorkerSearchQuery,
				);
			} catch {
				// Fallback to refresh
				await this.refresh();
			}
		} else {
			await this.refresh();
		}
	}
}

// ---------------------------------------------------------------------------
// DatabaseClient — main entry point
// ---------------------------------------------------------------------------

export class DatabaseClient<T extends TableMap = TableMap> {
	#config: DatabaseClientConfig<T>;
	#worker: Remote<DatabaseWorker> | null = null;
	#initialized = $state(false);
	#destroyed = false;
	#external_unsubscribe: (() => void) | void = undefined;

	/** Whether the initial sync is in progress */
	#syncing = $state(false);

	/** Whether the initial sync has completed */
	#synced = $state(false);

	get syncing(): boolean {
		return this.#syncing;
	}

	get synced(): boolean {
		return this.#synced;
	}

	get initialized() {
		return this.#initialized;
	}

	constructor(config: DatabaseClientConfig<T>) {
		this.#config = {
			default_threshold: 5000,
			...config,
		};
	}

	/** Initialize the client — loads IDB cache, syncs with server, builds indices. */
	async init(): Promise<void> {
		if (typeof window === 'undefined') return; // SSR guard

		this.#destroyed = false;
		this.#worker = await getWorker(this.#config.dev);

		// Extract serializable config from table definitions
		const tables: Record<
			string,
			{
				orama: { schema: Record<string, unknown>; sort: unknown };
				primary_key: string;
			}
		> = {};
		for (const [name, table] of Object.entries(this.#config.tables)) {
			tables[name] = {
				orama: {
					schema: table.config.orama.schema,
					sort: table.config.orama.sort,
				},
				primary_key: table.config.primary_key,
			};
		}

		const entities: Record<
			string,
			{ search_mode?: 'client' | 'server'; threshold?: number; cache?: boolean }
		> = {};
		if (this.#config.entities) {
			for (const [name, overrides] of Object.entries(this.#config.entities)) {
				if (overrides) {
					entities[name] = overrides;
				}
			}
		}

		await this.#worker.init({
			tables,
			entities,
			db_name: this.#config.db_name,
			default_threshold: this.#config.default_threshold ?? 5000,
		});

		// Clear stale EntityState cache so new instances get the active worker
		EntityState.clearCache();

		this.#initialized = true;

		// Fire sync in background — main thread tracks state
		this.#syncing = true;
		this.#worker
			.sync()
			.then(() => {
				if (!this.#destroyed) this.#synced = true;
			})
			.catch(() => {})
			.finally(() => {
				if (!this.#destroyed) this.#syncing = false;
			});

		// Wire up external subscription hook (e.g. websocket)
		if (this.#config.hooks?.onSubscribe) {
			this.#external_unsubscribe = this.#config.hooks.onSubscribe((event) => {
				if (!this.#worker) return;
				// When an external event arrives, re-sync the affected entity
				this.#worker.sync([event.entity_type]).catch(() => {});
			});
		}
	}

	// -----------------------------------------------------------------------
	// CRUD
	// -----------------------------------------------------------------------

	/** Create a new entity. */
	async create<K extends keyof T & string>(
		entity_type: K,
		data: EntityInput<T[K]>,
	): Promise<Database.Entity<T[K]>> {
		const worker = this.#getWorker();
		let result: Record<string, unknown>;
		try {
			result = await worker.create(entity_type, data as Record<string, unknown>);
		} catch (error) {
			throw DatabaseError.fromWorker(error) ?? error;
		}
		this.#config.hooks?.onEntityChange?.({
			type: 'create',
			entity_type,
			id: result[this.#config.tables[entity_type].config.primary_key] as string,
			data: result,
		});
		return result as Database.Entity<T[K]>;
	}

	/** Get a single entity by ID. Returns from IDB cache with background refresh. */
	async get<K extends keyof T & string>(
		entity_type: K,
		id: string | number,
	): Promise<Database.Entity<T[K]> | undefined> {
		const worker = this.#getWorker();
		return (await worker.get(entity_type, id)) as Database.Entity<T[K]> | undefined;
	}

	/** Update an entity. Optimistically updates local index. */
	async update<K extends keyof T & string>(
		entity_type: K,
		id: string | number,
		data: Partial<Database.Entity<T[K]>>,
	): Promise<Database.Entity<T[K]>> {
		const worker = this.#getWorker();
		let result: Record<string, unknown>;
		try {
			result = await worker.update(entity_type, id, data as Record<string, unknown>);
		} catch (error) {
			throw DatabaseError.fromWorker(error) ?? error;
		}
		this.#config.hooks?.onEntityChange?.({
			type: 'update',
			entity_type,
			id,
			data: result,
		});
		return result as Database.Entity<T[K]>;
	}

	/** Delete an entity. Optimistically removes from local index. */
	async delete<K extends keyof T & string>(
		entity_type: K,
		id: string | number,
	): Promise<void> {
		const worker = this.#getWorker();
		try {
			await worker.delete(entity_type, id);
		} catch (error) {
			throw DatabaseError.fromWorker(error) ?? error;
		}
		this.#config.hooks?.onEntityChange?.({
			type: 'delete',
			entity_type,
			id,
		});
	}

	// -----------------------------------------------------------------------
	// Entity state (reactive singleton wrapper)
	// -----------------------------------------------------------------------

	/** Get a reactive EntityState wrapper for an entity (cached singleton per entity:id). */
	entity<K extends keyof T & string>(
		entity_type: K,
		id?: string | number,
		initial_data?: Partial<Database.Entity<T[K]>>,
	): EntityState<T[K], K> {
		const table = this.#config.tables[entity_type];
		return EntityState.from(entity_type, id, {
			worker: this.#worker,
			initial_data,
			primary_key: table.config.primary_key,
			onChange: (event) => {
				this.#config.hooks?.onEntityChange?.({
					...event,
					entity_type,
				});
			},
		});
	}

	// -----------------------------------------------------------------------
	// Search
	// -----------------------------------------------------------------------

	/** Create a reactive search that auto-updates when the index changes. */
	search<K extends keyof T & string>(
		entity_type: K,
		query?: WorkerSearchQuery,
	): DatabaseSearch<T[K], K> {
		const worker = this.#getWorker();
		return new DatabaseSearch(entity_type, worker, query);
	}

	/** One-shot list — always hits server. */
	async list<K extends keyof T & string>(
		entity_type: K,
		query?: WorkerSearchQuery,
	): Promise<SearchResult<T[K]>> {
		const worker = this.#getWorker();
		try {
			return (await worker.list(entity_type, query ?? {})) as SearchResult<T[K]>;
		} catch (error) {
			throw DatabaseError.fromWorker(error) ?? error;
		}
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	/** Change scope (e.g. user switches org). Clears cache and re-initializes. */
	async setScope(db_name: string): Promise<void> {
		EntityState.clearCache();
		if (this.#worker) await this.#worker.destroy();
		resetWorker();
		this.#worker = null;
		this.#initialized = false;
		this.#syncing = false;
		this.#synced = false;
		this.#config.db_name = db_name;
		await this.init();
	}

	/** Cleanup — terminates worker, clears subscriptions. */
	async destroy(): Promise<void> {
		this.#destroyed = true;
		if (this.#external_unsubscribe) {
			this.#external_unsubscribe();
		}
		EntityState.clearCache();
		if (this.#worker) {
			await this.#worker.destroy();
			this.#worker = null;
		}
		resetWorker();
		this.#initialized = false;
		this.#syncing = false;
		this.#synced = false;
	}

	// -----------------------------------------------------------------------
	// Private
	// -----------------------------------------------------------------------

	#getWorker(): Remote<DatabaseWorker> {
		if (!this.#worker) {
			throw new Error('DatabaseClient not initialized. Call `await db.init()` first.');
		}
		return this.#worker;
	}
}
