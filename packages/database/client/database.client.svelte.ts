import { proxy } from 'comlink';
import type { Remote } from 'comlink';
import { createSubscriber, SvelteMap } from 'svelte/reactivity';
import { untrack } from 'svelte';
import { deepEqual } from 'fast-equals';
import type { Database } from '../schema/schema';
import type { DatabaseWorker, WorkerSearchResult } from './database.worker';
import type { SearchQueryInput } from '../search-query';
import { DelightError } from '@delightstack/utilities';
import { getWorker, resetWorker } from './database.worker.init';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TableMap = Record<string, Database.AnyTable>;

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

	/**
	 * `fetch` implementation used when no web worker is available (SSR).
	 * Pass the `fetch` from your SvelteKit load event so server-side calls
	 * carry the original request's cookies and auth context. Ignored on the
	 * client once the worker has initialized.
	 *
	 * ```ts
	 * // +layout.ts
	 * export const load: LayoutLoad = async ({ fetch }) => {
	 *   const db = new DatabaseClient({ tables, db_name, fetch });
	 *   await db.init();
	 *   return { db };
	 * };
	 * ```
	 */
	fetch?: typeof globalThis.fetch;

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

type EntityInput<T extends Database.AnyTable> = Omit<
	Database.Entity<T>,
	'id' | 'created_at' | 'updated_at'
>;

export interface SearchHit<T extends Database.AnyTable = Database.Table> {
	id: string;
	document: Database.SearchEntity<T>;
	score: number;
}

export interface SearchResult<T extends Database.AnyTable = Database.Table> {
	hits: SearchHit<T>[];
	count: number;
	elapsed?: unknown;
}

// ---------------------------------------------------------------------------
// EntityState — reactive per-entity wrapper
// ---------------------------------------------------------------------------

export class EntityState<
	T extends Database.AnyTable = Database.Table,
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
		if (!this.#server_value) return false;
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
					throw DelightError.fromWorker(error) ?? error;
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
					throw DelightError.fromWorker(error) ?? error;
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
			throw DelightError.fromWorker(error) ?? error;
		}
		// Fire change hook
		this.#onChange?.({ type: 'delete', id: this.#id });
		// Clear local state
		this.#value = {} as Database.Entity<T>;
		this.#server_value = null;
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

	static from<T extends Database.AnyTable, EntityType extends string = string>(
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

/** Baseline defaults applied to every search. Callers override selectively. */
const DEFAULT_SEARCH_QUERY = {
	term: '',
	limit: 100,
	order: [{ key: 'updated_at', direction: 'DESC' as const }],
};

export type SearchQueryInit<T extends Database.AnyTable = Database.Table> =
	| Partial<Database.SearchQuery<T>>
	| (() => Partial<Database.SearchQuery<T>>);

export class DatabaseSearch<
	T extends Database.AnyTable = Database.Table,
	EntityType extends string = string,
> {
	readonly entity_type: EntityType;
	#worker: Remote<DatabaseWorker>;
	#subscriber_id: string | null = null;
	#init_promise: Promise<void> | null = null;
	#subscriber: () => void;
	#destroyed = false;
	#effect_cleanup: (() => void) | null = null;
	#reactive_query: (() => Partial<Database.SearchQuery<T>>) | null = null;
	#defaults: Database.SearchQuery<T>;

	#results = $state<SearchHit<T>[]>([]);
	#docs = $derived<Database.SearchEntity<T>[]>(this.#results.map((h) => h.document));
	#count = $state(0);
	#loading = $state(true);
	#searching = $state(false);
	#loaded = $state(false);
	#error = $state<unknown>(null);
	#mode = $state<'client' | 'server'>('client');
	#query_state = $state<Database.SearchQuery<T>>({});

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

	/** Whether the initial load is in progress (true until the first result arrives). */
	get loading(): boolean {
		this.#subscriber();
		return this.#loading;
	}

	/** Whether a background re-query is in progress. Previous results remain visible. */
	get searching(): boolean {
		this.#subscriber();
		return this.#searching;
	}

	/** Whether the first result has arrived. */
	get loaded(): boolean {
		this.#subscriber();
		return this.#loaded;
	}

	/** Any error from the search */
	get error(): unknown {
		return this.#error;
	}

	/** Current search mode */
	get mode(): 'client' | 'server' {
		return this.#mode;
	}

	/**
	 * The live, reactive query. Mutate fields directly (`posts.query.term = 'x'`)
	 * or bind to them (`<Input bind:value={posts.query.term} />`); the class
	 * re-queries automatically. Assigning a new object merges over defaults
	 * rather than overwriting them.
	 */
	get query(): Database.SearchQuery<T> {
		this.#subscriber();
		return this.#query_state;
	}

	set query(q: Partial<Database.SearchQuery<T>>) {
		this.#applyQuery({ ...this.#defaults, ...q });
	}

	constructor(
		entity_type: EntityType,
		worker: Remote<DatabaseWorker>,
		query?: SearchQueryInit<T>,
	) {
		this.entity_type = entity_type;
		this.#worker = worker;
		this.#defaults = { ...DEFAULT_SEARCH_QUERY } as Database.SearchQuery<T>;

		let initial: Partial<Database.SearchQuery<T>> = {};
		if (typeof query === 'function') {
			this.#reactive_query = query;
			initial = untrack(() => query()) ?? {};
		} else if (query) {
			initial = query;
		}
		this.#applyQuery({ ...this.#defaults, ...initial });

		// createSubscriber drives the subscription lifecycle: the first reactive
		// read (from a template or effect) starts the effect root and worker
		// subscription; the cleanup runs automatically when the last listener
		// stops reading (e.g. the component unmounts).
		this.#subscriber = createSubscriber(() => {
			if (this.#destroyed) return;
			this.#start();
			return () => this.#stop();
		});
	}

	/**
	 * Manually refresh search results. Usually not needed — subscriptions
	 * auto-update. Useful for forced re-fetch or when subscription is down.
	 */
	async refresh(): Promise<void> {
		try {
			if (!this.#loaded) this.#loading = true;
			else this.#searching = true;
			const result = await this.#worker.search(
				this.entity_type,
				$state.snapshot(this.#query_state) as SearchQueryInput,
			);
			this.#results = result.hits as SearchHit<T>[];
			this.#count = result.count;
			this.#error = null;
			this.#loaded = true;
		} catch (e) {
			this.#error = e;
		} finally {
			this.#loading = false;
			this.#searching = false;
		}
	}

	/**
	 * Force full cleanup. Not normally needed — the class auto-cleans when the
	 * last reactive listener stops reading. Call this only to force teardown
	 * while readers are still active (e.g. on scope change).
	 */
	destroy(): void {
		this.#destroyed = true;
		this.#stop();
	}

	// -- private --

	/** Start the subscription and reactive effects. Called by createSubscriber. */
	#start(): void {
		if (this.#effect_cleanup) return;

		this.#effect_cleanup = $effect.root(() => {
			// If a reactive query function was passed, keep #query_state in sync.
			if (this.#reactive_query) {
				$effect(() => {
					const q = this.#reactive_query!();
					untrack(() => {
						this.#applyQuery({ ...this.#defaults, ...q });
					});
				});
			}

			// Watch #query_state and push changes to the worker subscription.
			let first = true;
			$effect(() => {
				$state.snapshot(this.#query_state);
				if (first) {
					first = false;
					return;
				}
				this.#pushQuery();
			});
		});

		this.#initSubscription();
	}

	/** Tear down subscription and effects. Called by createSubscriber cleanup. */
	#stop(): void {
		if (this.#effect_cleanup) {
			this.#effect_cleanup();
			this.#effect_cleanup = null;
		}
		if (this.#subscriber_id) {
			this.#worker.unsubscribe(this.#subscriber_id).catch(() => {});
			this.#subscriber_id = null;
		}
		this.#init_promise = null;
	}

	/** Replace #query_state contents in place so reactive bindings stay stable. */
	#applyQuery(q: Database.SearchQuery<T>): void {
		const state = this.#query_state as Record<string, unknown>;
		for (const k of Object.keys(state)) {
			if (!(k in q)) delete state[k];
		}
		for (const [k, v] of Object.entries(q)) {
			if (!deepEqual(state[k], v)) state[k] = v;
		}
	}

	async #pushQuery(): Promise<void> {
		if (this.#destroyed) return;
		if (this.#subscriber_id) {
			this.#searching = true;
			try {
				await this.#worker.updateSubscription(
					this.#subscriber_id,
					$state.snapshot(this.#query_state) as SearchQueryInput,
				);
			} catch {
				await this.refresh();
			} finally {
				this.#searching = false;
			}
		} else {
			await this.refresh();
		}
	}

	async #initSubscription(): Promise<void> {
		if (this.#destroyed) return;
		if (this.#init_promise) return;

		this.#init_promise = (async () => {
			try {
				const mode = await this.#worker.getSearchMode(this.entity_type);
				this.#mode = mode;

				this.#subscriber_id = await this.#worker.subscribe(
					this.entity_type,
					$state.snapshot(this.#query_state) as SearchQueryInput,
					proxy((result: WorkerSearchResult) => {
						if (this.#destroyed) return;
						this.#results = result.hits as SearchHit<T>[];
						this.#count = result.count;
						this.#loading = false;
						this.#searching = false;
						this.#loaded = true;
						this.#error = null;
					}),
				);
			} catch (e) {
				this.#error = e;
				this.#loading = false;
				this.#init_promise = null;
			}
		})();

		await this.#init_promise;
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

	/**
	 * Per-entity reactive version counter. `db.get` reads the version for its
	 * `type:id` key synchronously before awaiting, which registers a reactive
	 * dependency when called from inside `$derived`/`$effect`. Mutations bump
	 * the matching key so reactive reads automatically re-run.
	 */
	#entity_versions = new SvelteMap<string, number>();

	/**
	 * Cached comlink proxies (one per `type:id`) passed to `worker.get` for
	 * background-refresh notifications. Caching avoids spinning up a fresh
	 * MessageChannel for every `$derived` re-run.
	 */
	#refresh_proxies = new Map<string, (data: Record<string, unknown>) => void>();

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
					schema: table.config.orama.schema as Record<string, unknown>,
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
				// Apply the single change in place — Orama + IDB + subscribers
				// update for just this entity. A full `sync([entity_type])` is
				// wasteful when we already know what changed; reconnect/page
				// refresh still triggers full sync via init().
				this.#worker
					.applyExternalChange(
						event.entity_type,
						event.type,
						event.id,
						event.data,
					)
					.then(() => {
						this.#invalidateEntity(event.entity_type, event.id);
					})
					.catch(() => {});
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
			throw DelightError.fromWorker(error) ?? error;
		}
		const id = result[this.#config.tables[entity_type].config.primary_key] as
			| string
			| number;
		this.#invalidateEntity(entity_type, id);
		this.#config.hooks?.onEntityChange?.({
			type: 'create',
			entity_type,
			id,
			data: result,
		});
		return result as Database.Entity<T[K]>;
	}

	/**
	 * Get a single entity by ID.
	 *
	 * **Client:** returns from IDB cache with background refresh via the
	 * web worker.
	 *
	 * **SSR:** falls back to the auto-generated `/api/${entity}/${id}` HTTP
	 * endpoint using the `fetch` passed to the `DatabaseClient` config.
	 * Provide it once at construction time (typically from your SvelteKit
	 * load event) and every `db.get` call works on both server and client:
	 *
	 * ```ts
	 * // +layout.ts
	 * export const load: LayoutLoad = async ({ fetch }) => {
	 *   const db = new DatabaseClient({ tables, db_name, fetch });
	 *   await db.init();
	 *   return { db };
	 * };
	 *
	 * // +page.ts
	 * export const load: PageLoad = async ({ params, parent }) => {
	 *   const { db } = await parent();
	 *   const post = await db.get('post', params.post_id);
	 *   return { post };
	 * };
	 * ```
	 */
	async get<K extends keyof T & string>(
		entity_type: K,
		id: string | number,
	): Promise<Database.Entity<T[K]> | undefined> {
		// Register a reactive dependency on this entity's version. When any
		// mutation (via db.update/delete/create) or worker-side refresh bumps
		// the version, enclosing $derived/$effect re-runs and a fresh get
		// promise is produced — no manual invalidate wiring required.
		this.#trackEntity(entity_type, id);

		if (this.#worker) {
			return (await this.#worker.get(
				entity_type,
				id,
				false,
				this.#refreshProxyFor(entity_type, id),
			)) as Database.Entity<T[K]> | undefined;
		}
		// No worker: SSR or pre-init. Use the configured fetch to preserve
		// the original request's auth context.
		const fetchFn = this.#config.fetch;
		if (!fetchFn) return undefined;
		const response = await fetchFn(`/api/${entity_type}/${id}`);
		if (response.status === 404) return undefined;
		if (!response.ok) {
			const body = (await response.json().catch(() => null)) as
				| { message?: string; status?: number; code?: string; detail?: string }
				| null;
			throw new DelightError({
				message: body?.message ?? response.statusText,
				status: body?.status ?? response.status,
				code: body?.code,
				detail: body?.detail,
			});
		}
		return (await response.json()) as Database.Entity<T[K]>;
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
			throw DelightError.fromWorker(error) ?? error;
		}
		this.#invalidateEntity(entity_type, id);
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
			throw DelightError.fromWorker(error) ?? error;
		}
		this.#invalidateEntity(entity_type, id);
		this.#config.hooks?.onEntityChange?.({
			type: 'delete',
			entity_type,
			id,
		});
	}

	/**
	 * Upload an image file. POSTs multipart form data to `/api/image`; the
	 * server runs the full processing pipeline (variants, thumbhash, EXIF)
	 * and returns the resulting image record.
	 *
	 * Pass an `onProgress` callback for upload progress (0..1). Progress
	 * reflects the HTTP upload only — server-side processing continues in
	 * the background after the upload completes and can be tracked via the
	 * image entity's `processing_status` field.
	 */
	async uploadImage(
		file: File | Blob,
		options?: {
			caption?: string;
			file_name?: string;
			fields?: Record<string, string>;
			onProgress?: (fraction: number) => void;
		},
	): Promise<Record<string, unknown>> {
		const form = new FormData();
		form.append('file', file, options?.file_name);
		if (options?.caption !== undefined) form.append('caption', options.caption);
		for (const [k, v] of Object.entries(options?.fields ?? {})) {
			form.append(k, v);
		}

		if (options?.onProgress && typeof XMLHttpRequest !== 'undefined') {
			return new Promise<Record<string, unknown>>((resolve, reject) => {
				const xhr = new XMLHttpRequest();
				xhr.open('POST', '/api/image');
				xhr.responseType = 'json';
				xhr.upload.onprogress = (e) => {
					if (e.lengthComputable) options.onProgress!(e.loaded / e.total);
				};
				xhr.onerror = () =>
					reject(new DelightError({ message: 'Upload failed', status: 0 }));
				xhr.onload = () => {
					if (xhr.status >= 200 && xhr.status < 300) {
						resolve(xhr.response as Record<string, unknown>);
					} else {
						const body = xhr.response as
							| { message?: string; status?: number; code?: string; detail?: string }
							| null;
						reject(
							new DelightError({
								message: body?.message ?? xhr.statusText,
								status: body?.status ?? xhr.status,
								code: body?.code,
								detail: body?.detail,
							}),
						);
					}
				};
				xhr.send(form);
			});
		}

		const response = await fetch('/api/image', { method: 'POST', body: form });
		if (!response.ok) {
			const body = (await response.json().catch(() => null)) as
				| { message?: string; status?: number; code?: string; detail?: string }
				| null;
			throw new DelightError({
				message: body?.message ?? response.statusText,
				status: body?.status ?? response.status,
				code: body?.code,
				detail: body?.detail,
			});
		}
		return (await response.json()) as Record<string, unknown>;
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

	/**
	 * Create a reactive search that auto-updates when the index changes.
	 *
	 * The returned search has a live reactive `query` object with sensible
	 * defaults (order by `updated_at` DESC, limit 100). Mutate fields on it
	 * (`posts.query.term = 'x'`) or bind to them directly
	 * (`<Input bind:value={posts.query.term} />`).
	 *
	 * Pass an object to override defaults, or a function to drive the query
	 * from other reactive state (the function's reactive reads are tracked).
	 *
	 * Subscriptions clean up automatically when no reactive context is reading
	 * the search anymore (e.g. on component unmount).
	 */
	search<K extends keyof T & string>(
		entity_type: K,
		query?: SearchQueryInit<T[K]>,
	): DatabaseSearch<T[K], K> {
		const worker = this.#getWorker();
		return new DatabaseSearch(entity_type, worker, query);
	}

	/** One-shot list — always hits server. */
	async list<K extends keyof T & string>(
		entity_type: K,
		query?: Database.SearchQuery<T[K]>,
	): Promise<SearchResult<T[K]>> {
		const worker = this.#getWorker();
		try {
			return (await worker.list(
				entity_type,
				(query ?? {}) as SearchQueryInput,
			)) as SearchResult<T[K]>;
		} catch (error) {
			throw DelightError.fromWorker(error) ?? error;
		}
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	/** Change scope (e.g. user switches org). Clears cache and re-initializes. */
	async setScope(db_name: string): Promise<void> {
		EntityState.clearCache();
		this.#entity_versions.clear();
		this.#refresh_proxies.clear();
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
		this.#entity_versions.clear();
		this.#refresh_proxies.clear();
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
			// Return a no-op proxy during SSR and before init() so that
			// $derived expressions (which run before $effect) don't throw.
			return new Proxy({} as Remote<DatabaseWorker>, {
				get: () => () => Promise.resolve(undefined),
			});
		}
		return this.#worker;
	}

	/** Register a reactive read for `entity_type:id`. */
	#trackEntity(entity_type: string, id: string | number): void {
		this.#entity_versions.get(`${entity_type}:${id}`);
	}

	/** Bump the version for `entity_type:id`, re-running reactive readers. */
	#invalidateEntity(entity_type: string, id: string | number): void {
		const key = `${entity_type}:${id}`;
		this.#entity_versions.set(key, (this.#entity_versions.get(key) ?? 0) + 1);
	}

	/**
	 * Comlink proxy passed to `worker.get` so the worker can notify us when a
	 * background refresh returns fresh data — we bump the entity's version so
	 * live `$derived(await db.get(...))` readers see the update.
	 */
	#refreshProxyFor(entity_type: string, id: string | number) {
		const key = `${entity_type}:${id}`;
		const cached = this.#refresh_proxies.get(key);
		if (cached) return cached;
		const p = proxy(() => {
			this.#invalidateEntity(entity_type, id);
		});
		this.#refresh_proxies.set(key, p);
		return p;
	}
}
