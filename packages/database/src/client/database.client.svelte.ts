import { proxy } from 'comlink';
import type { Remote } from 'comlink';
import { createSubscriber, SvelteMap } from 'svelte/reactivity';
import { untrack } from 'svelte';
import { deepEqual } from 'fast-equals';
import type { Database } from '../schema/schema';
import type { DatabaseWorker, WorkerSearchResult } from './database.worker';
import type { SearchQueryInput } from '../search-query';
import { DelightError } from '@delightstack/utilities';
import { getWorker, resetWorker, isWorkerShared } from './database.worker.init';

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
		/**
		 * Optional predicate that answers "is there a reliable live change
		 * feed right now?" — typically wired to a websocket's connection
		 * state. When it returns `true`, `worker.get` skips its safety-net
		 * stale-refresh because any recent server changes would already have
		 * landed in IDB via `applyExternalChange`. When it returns `false`
		 * (or when the hook is absent), the worker falls back to the
		 * refresh-if-stale behavior so apps without a push channel still
		 * stay in sync.
		 */
		isLive?: () => boolean;
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
	#fetch: typeof globalThis.fetch | undefined;
	#primary_key: string;
	/**
	 * Called by `load()` to decide whether to prefer a main-thread fetch
	 * over the worker's IDB-backed read. Wired by `DatabaseClient.entity`
	 * to `() => !db.hydrated` — before hydration we want fresh data (and
	 * SvelteKit's fetch cache); after, we want the worker's IDB cache.
	 */
	#prefer_fetch?: () => boolean;

	/**
	 * Called by `load()` on the worker path to decide whether the worker's
	 * safety-net stale refresh should be skipped. Wired to the app's
	 * `hooks.isLive` so we skip redundant fetches while a websocket is
	 * pushing changes in.
	 */
	#skip_background_refresh?: () => boolean;
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
	#error = $state.raw<unknown>(null);

	#has_changes = $derived.by(() => {
		if (!this.#server_value) return false;
		return !deepEqual(this.#value, this.#server_value);
	});

	/** Reusable comlink proxy for background refresh callback */
	#refresh_proxy = proxy((fresh: Record<string, unknown>) => {
		// Read `has_changes` before mutating `#server_value`, otherwise the
		// derived would compare the stale `#value` against the incoming
		// server row and incorrectly conclude there are unsaved edits.
		const had_changes = untrack(() => this.#has_changes);
		this.#server_value = fresh as Database.Entity<T>;
		if (!had_changes) {
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

	/**
	 * Last error from `load`, `save`, or `delete`. Cleared on the next
	 * successful operation of the same kind. Bind in templates:
	 * `{#if entity.error} <Alert>{entity.error.message}</Alert> {/if}`.
	 */
	get error(): unknown {
		return this.#error;
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
			/**
			 * `fetch` used on SSR / pre-init when no worker is available.
			 * Typically supplied by `DatabaseClient` from its config so that
			 * server-side requests carry the original request's auth context.
			 */
			fetch?: typeof globalThis.fetch;
			/**
			 * Starting value for the entity's local state.
			 *
			 * When passed together with an `id` it's also treated as the
			 * authoritative server state — `server_value` is seeded and
			 * `loaded` is set to `true`, so the first reactive read does
			 * *not* trigger an auto-load. This is the right shape for SSR
			 * hydration (pass the entity fetched in `+page.ts`). For
			 * create-new-entity forms (no id), it's used as a scratch
			 * starting point and no loaded-state is implied.
			 */
			initial_data?: Partial<Database.Entity<T>>;
			primary_key?: string;
			/**
			 * Invoked by `load()` to decide whether to prefer the main-thread
			 * fetch over the worker's IDB-backed read. See
			 * `DatabaseClient.entity` for the default wiring.
			 */
			prefer_fetch?: () => boolean;
			/**
			 * Invoked by `load()` on the worker path to skip the worker's
			 * safety-net stale refresh. Typically wired to the app's
			 * `hooks.isLive` (websocket connection state).
			 */
			skip_background_refresh?: () => boolean;
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
		this.#fetch = options?.fetch;
		this.#primary_key = options?.primary_key ?? 'id';
		this.#prefer_fetch = options?.prefer_fetch;
		this.#skip_background_refresh = options?.skip_background_refresh;
		this.#onChange = options?.onChange;
		this.#value = (options?.initial_data ?? {}) as Database.Entity<T>;

		// SSR / hydration seed: if an existing entity is constructed with
		// data in hand, treat it as the current server truth so we skip a
		// redundant load and `has_changes` works from the first edit.
		if (id !== undefined && options?.initial_data) {
			this.#server_value = options.initial_data as Database.Entity<T>;
			this.#loaded = true;
		}

		this.#subscriber = createSubscriber(() => {
			// Auto-load when first subscribed
			if (!this.#loaded && !this.#loading && this.#id) {
				this.load();
			}
		});
	}

	/**
	 * Save changes to server. Creates if no ID, updates otherwise.
	 * Concurrent calls are queued: each save runs after the previous one
	 * settles (and snapshots its data at that point), so a save issued while
	 * another is in flight is never silently dropped.
	 */
	async save(changes?: Partial<Database.Entity<T>>): Promise<this> {
		const run = this.#save_chain
			.catch(() => {
				// A failed previous save must not poison the queue — its caller
				// already received the rejection
			})
			.then(() => this.#performSave(changes));
		this.#save_chain = run;
		return run;
	}

	/** Promise chain serializing save() calls */
	#save_chain: Promise<unknown> = Promise.resolve();

	async #performSave(changes?: Partial<Database.Entity<T>>): Promise<this> {
		this.#saving = true;
		try {
			const data_to_save =
				changes ?? ($state.snapshot(this.#value) as Record<string, unknown>);

			const worker = this.#getWorker();
			let result: Database.Entity<T>;
			if (!this.#id) {
				// No ID — create new entity
				const raw = (await worker
					.create(this.entity_type, data_to_save as Record<string, unknown>)
					.catch((error) => {
						throw DelightError.fromWorker(error) ?? error;
					})) as Record<string, unknown>;
				result = raw as Database.Entity<T>;
				// Update ID from server response using configured primary key
				const pk = raw[this.#primary_key] as string | number;
				this.#id = pk;
				// Fire change hook — owners (e.g. DatabaseClient) rekey their
				// caches and invalidate other readers off this event.
				this.#onChange?.({ type: 'create', id: pk, data: raw });
			} else {
				// Has ID — update existing entity
				const raw = (await worker
					.update(this.entity_type, this.#id, data_to_save as Record<string, unknown>)
					.catch((error) => {
						throw DelightError.fromWorker(error) ?? error;
					})) as Record<string, unknown>;
				result = raw as Database.Entity<T>;
				// Fire change hook
				this.#onChange?.({ type: 'update', id: this.#id, data: raw });
			}

			this.#server_value = result;
			this.#value = result;
			this.#loaded = true;
			this.#error = null;
		} catch (error) {
			this.#error = error;
			throw error;
		} finally {
			this.#saving = false;
		}
		return this;
	}

	/**
	 * Fetch fresh data from the server.
	 *
	 * Picks its read path automatically:
	 *
	 * - **No worker (SSR / pre-init):** uses the configured `fetch` — on
	 *   the server this is SvelteKit's scoped fetch, so the response is
	 *   recorded for reuse during client hydration.
	 * - **Worker + pre-hydration (initial page load / refresh):** fetches
	 *   on the main thread (hits SvelteKit's hydration cache, so no new
	 *   network request), then pushes the result into the worker's IDB +
	 *   Orama index via `applyExternalChange`. Subsequent reads hit IDB.
	 * - **Worker + post-hydration (client-side navigation):** delegates to
	 *   `worker.get` which serves from IDB, falling back to the server
	 *   behind the scenes — fastest path for nav-heavy flows.
	 *
	 * Pass `{ force_refresh: true }` to skip IDB on the worker path. A
	 * per-call `fetch` override is accepted but rarely needed.
	 */
	async load(options?: {
		force_refresh?: boolean;
		fetch?: typeof globalThis.fetch;
	}): Promise<void> {
		if (this.#loading) return;
		if (!this.#id) return;
		this.#loading = true;
		try {
			let data: Database.Entity<T> | undefined;
			const fetchFn = options?.fetch ?? this.#fetch ?? globalThis.fetch;

			// No worker means SSR / pre-init — we have to use the main-thread
			// fetch. With a worker: prefer the main-thread fetch before the
			// app has hydrated (so the SSR response is reused via SvelteKit's
			// fetch cache), otherwise go through the worker's IDB cache. A
			// `force_refresh: true` always goes through the worker so it
			// bypasses IDB cleanly.
			const force_refresh = options?.force_refresh === true;
			const prefer_main_thread = this.#prefer_fetch?.() ?? false;
			const use_fetch_path = !this.#worker || (!force_refresh && prefer_main_thread);

			if (use_fetch_path) {
				const response = await fetchFn(`/api/${this.entity_type}/${this.#id}`);
				if (response.ok) {
					data = (await response.json()) as Database.Entity<T>;
					if (this.#worker && data) {
						// Seed worker IDB + Orama so client-side nav reads
						// back from cache.
						await this.#worker.applyExternalChange(
							this.entity_type,
							'update',
							this.#id,
							data as unknown as Record<string, unknown>,
						);
					}
				}
			} else if (this.#worker) {
				const skip_bg_refresh = this.#skip_background_refresh?.() ?? false;
				data = (await this.#worker.get(
					this.entity_type,
					this.#id,
					options?.force_refresh,
					this.#refresh_proxy,
					skip_bg_refresh,
				)) as Database.Entity<T> | undefined;
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
			this.#error = null;
		} catch (error) {
			this.#error = error;
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
			const wrapped = DelightError.fromWorker(error) ?? error;
			this.#error = wrapped;
			throw wrapped;
		}
		this.#error = null;
		// Fire change hook — owners (e.g. DatabaseClient) drop cache entries
		// and invalidate other readers off this event.
		this.#onChange?.({ type: 'delete', id: this.#id });
		// Clear local state
		this.#value = {} as Database.Entity<T>;
		this.#server_value = null;
	}

	/**
	 * Apply a fresh copy of the server-side entity from an external source
	 * (e.g. a websocket push routed through `DatabaseClient`). Mirrors the
	 * refresh-proxy behavior: always updates `server_value`; only updates
	 * `value` when the user has no unsaved local changes, so a live push
	 * doesn't clobber an open edit form.
	 */
	applyExternalUpdate(data: Record<string, unknown>): void {
		// Read `has_changes` before mutating `#server_value`: the derived
		// would otherwise see the stale `#value` against the new server row
		// and incorrectly report unsaved edits, making us skip the `#value`
		// update when the user has nothing in flight.
		const had_changes = untrack(() => this.#has_changes);
		this.#server_value = data as Database.Entity<T>;
		if (!had_changes) {
			this.#value = data as Database.Entity<T>;
		}
		this.#loaded = true;
		this.#error = null;
	}

	/**
	 * Drop local state in response to an external delete (e.g. the entity
	 * was removed in another tab). Pair with a route redirect in the
	 * component if the page only makes sense when the entity exists.
	 */
	applyExternalDelete(): void {
		this.#server_value = null;
		this.#value = {} as Database.Entity<T>;
		this.#error = null;
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

	/**
	 * Thin alias for `new EntityState(...)`. Kept for backwards compatibility
	 * with standalone usage; prefer `db.entity(...)` via `DatabaseClient`,
	 * which adds caching, version invalidation, and lifecycle management.
	 */
	static from<T extends Database.AnyTable, EntityType extends string = string>(
		entity_type: EntityType,
		id: string | number | undefined,
		options?: {
			worker?: Remote<DatabaseWorker> | null;
			fetch?: typeof globalThis.fetch;
			initial_data?: Partial<Database.Entity<T>>;
			primary_key?: string;
			onChange?: (event: {
				type: 'create' | 'update' | 'delete';
				id: string | number;
				data?: Record<string, unknown>;
			}) => void;
		},
	): EntityState<T, EntityType> {
		return new EntityState(entity_type, id, options) as EntityState<T, EntityType>;
	}
}

// ---------------------------------------------------------------------------
// EntityReader — lightweight reactive reader for read-mostly pages
// ---------------------------------------------------------------------------

/**
 * Dependencies EntityReader needs from the owning DatabaseClient. Passed in
 * so the reader stays decoupled from client internals while still reusing
 * the version-invalidation and comlink plumbing.
 */
interface EntityReaderDeps {
	getWorker: () => Remote<DatabaseWorker> | null;
	fetch?: typeof globalThis.fetch;
	trackVersion: (entity_type: string, id: string | number) => void;
	refreshProxy: (
		entity_type: string,
		id: string | number,
	) => (data: Record<string, unknown>) => void;
	/**
	 * Invoked on the worker read path to skip the safety-net stale
	 * refresh. Wired to the app's `hooks.isLive`.
	 */
	skipBackgroundRefresh?: () => boolean;
}

/**
 * Reactive single-entity reader. Construct synchronously, read the live
 * `value`/`loading`/`error` fields in templates. Re-fetches automatically
 * when:
 *
 *   - the id source returns a different id
 *   - a mutation (via `db.create`/`db.update`/`db.delete`) hits the id
 *   - the worker reports a background refresh or an external websocket
 *     event touches this entity
 *
 * Cleanup is automatic — the underlying subscription tears down when the
 * last reactive listener stops reading (e.g. on component unmount).
 */
export class EntityReader<
	T extends Database.AnyTable = Database.Table,
	EntityType extends string = string,
> {
	readonly entity_type: EntityType;
	#id_source: () => string | number | undefined;
	#deps: EntityReaderDeps;

	#value = $state.raw<Database.Entity<T> | undefined>(undefined);
	#loading = $state(true);
	#loaded = $state(false);
	#error = $state.raw<unknown>(null);
	#current_id: string | number | undefined;

	#subscriber: () => void;
	#effect_cleanup: (() => void) | null = null;
	#destroyed = false;

	/** The current entity data, or `undefined` until loaded / if not found. */
	get value(): Database.Entity<T> | undefined {
		this.#subscriber();
		return this.#value;
	}

	/** True while the initial load (or a fresh id) is in flight. */
	get loading(): boolean {
		this.#subscriber();
		return this.#loading;
	}

	/** True once the first fetch has resolved (even with no record). */
	get loaded(): boolean {
		this.#subscriber();
		return this.#loaded;
	}

	/** Last error from a fetch; cleared on the next successful load. */
	get error(): unknown {
		return this.#error;
	}

	/** The id currently being tracked (resolved from the id source). */
	get id(): string | number | undefined {
		return this.#current_id;
	}

	constructor(
		entity_type: EntityType,
		id_source: () => string | number | undefined,
		deps: EntityReaderDeps,
	) {
		this.entity_type = entity_type;
		this.#id_source = id_source;
		this.#deps = deps;
		this.#subscriber = createSubscriber(() => {
			if (this.#destroyed) return;
			this.#start();
			return () => this.#stop();
		});
	}

	/** Force a re-fetch, bypassing the worker's IDB cache. */
	async reload(): Promise<void> {
		await this.#fetch(
			untrack(() => this.#id_source()),
			true,
		);
	}

	/**
	 * Force full cleanup. Not normally needed — the reader auto-cleans when
	 * the last reactive listener stops reading.
	 */
	destroy(): void {
		this.#destroyed = true;
		this.#stop();
	}

	#start(): void {
		if (this.#effect_cleanup) return;
		this.#effect_cleanup = $effect.root(() => {
			$effect(() => {
				// Reactive reads: id source + entity version. Either changing
				// re-runs this effect and triggers a fresh fetch.
				const id = this.#id_source();
				if (id !== undefined) this.#deps.trackVersion(this.entity_type, id);
				untrack(() => this.#fetch(id, false));
			});
		});
	}

	#stop(): void {
		if (this.#effect_cleanup) {
			this.#effect_cleanup();
			this.#effect_cleanup = null;
		}
	}

	async #fetch(id: string | number | undefined, force_refresh: boolean): Promise<void> {
		const prev_id = this.#current_id;
		this.#current_id = id;

		if (id === undefined) {
			this.#value = undefined;
			this.#loading = false;
			this.#loaded = true;
			this.#error = null;
			return;
		}

		// Flip `loading` true on the first fetch and on any id transition;
		// stay quiet for same-id refetches (mutations, background refresh)
		// so the UI doesn't flicker.
		if (!this.#loaded || prev_id !== id) this.#loading = true;

		const worker = this.#deps.getWorker();
		try {
			let data: Database.Entity<T> | undefined;
			if (worker) {
				const skip_bg_refresh = this.#deps.skipBackgroundRefresh?.() ?? false;
				data = (await worker.get(
					this.entity_type,
					id,
					force_refresh,
					this.#deps.refreshProxy(this.entity_type, id),
					skip_bg_refresh,
				)) as Database.Entity<T> | undefined;
			} else if (this.#deps.fetch) {
				const response = await this.#deps.fetch(`/api/${this.entity_type}/${id}`);
				if (response.status === 404) {
					data = undefined;
				} else if (response.ok) {
					data = (await response.json()) as Database.Entity<T>;
				} else {
					const body = (await response.json().catch(() => null)) as {
						message?: string;
						status?: number;
						code?: string;
						detail?: string;
					} | null;
					throw new DelightError({
						message: body?.message ?? response.statusText,
						status: body?.status ?? response.status,
						code: body?.code,
						detail: body?.detail,
					});
				}
			}

			// Ignore stale fetches: id changed (or reader destroyed) mid-flight.
			if (this.#destroyed || this.#current_id !== id) return;

			this.#value = data;
			this.#loaded = true;
			this.#error = null;
		} catch (error) {
			if (this.#destroyed || this.#current_id !== id) return;
			this.#error = error;
		} finally {
			if (!this.#destroyed && this.#current_id === id) {
				this.#loading = false;
			}
		}
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

	/**
	 * Cached `EntityState` instances keyed by `type:id`. Scoped to the
	 * DatabaseClient so per-request SvelteKit SSR (where the layout creates
	 * a fresh client) is cache-isolated, while client sessions still reuse
	 * the same wrapper across navigations / multiple reads of the same id.
	 */
	#entity_cache = new Map<string, EntityState>();

	/** Whether the initial sync is in progress */
	#syncing = $state(false);

	/** Whether the initial sync has completed */
	#synced = $state(false);

	/**
	 * Whether the app has finished its initial hydration. Drives the read
	 * path in `EntityState.load()`: pre-hydration uses a main-thread fetch
	 * (so SSR + client share the SvelteKit fetch cache and the first paint
	 * serves the latest data); post-hydration uses the worker's IDB cache
	 * for instant client-side navigation.
	 *
	 * `init()` schedules a short timer to flip this automatically after the
	 * browser has finished the initial hydration task — the timer fires
	 * after the first `+page.ts` load has read the flag but well before the
	 * user can interact with the page. `markHydrated()` is still public as
	 * a manual override.
	 */
	#hydrated = $state(false);
	#hydrate_timer: ReturnType<typeof setTimeout> | null = null;

	get syncing(): boolean {
		return this.#syncing;
	}

	get synced(): boolean {
		return this.#synced;
	}

	get initialized() {
		return this.#initialized;
	}

	get hydrated(): boolean {
		return this.#hydrated;
	}

	/**
	 * Mark the client as hydrated, flipping `EntityState.load()` over to
	 * the worker/IDB path. `init()` already schedules this automatically via
	 * a short timer after boot, so manual calls are rarely needed — useful
	 * as an override (e.g. if a route hard-depends on IDB-cached reads
	 * happening right away).
	 */
	markHydrated(): void {
		if (this.#hydrate_timer) {
			clearTimeout(this.#hydrate_timer);
			this.#hydrate_timer = null;
		}
		this.#hydrated = true;
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
		this.#entity_cache.clear();

		this.#initialized = true;

		// Flip the hydration flag on the next macrotask. This runs after the
		// current SvelteKit boot task drains — in particular after the
		// initial `+page.ts` load has synchronously started and read the
		// flag — but long before the user can interact with the page. 50ms
		// is a generous buffer; macrotasks from here queue behind anything
		// the browser is already chewing through for paint.
		if (this.#hydrate_timer) clearTimeout(this.#hydrate_timer);
		this.#hydrate_timer = setTimeout(() => {
			this.#hydrate_timer = null;
			if (!this.#destroyed) this.#hydrated = true;
		}, 50);

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
					.applyExternalChange(event.entity_type, event.type, event.id, event.data)
					.then((applied) => {
						this.#invalidateEntity(event.entity_type, event.id);
						// `#invalidateEntity` wakes up `db.get` / `db.read`
						// readers via `#entity_versions`, but `db.entity()`
						// wrappers own their own reactive state — push the
						// fresh row into any cached instance so detail pages
						// live-update too.
						const key = `${event.entity_type}:${event.id}`;
						const cached = this.#entity_cache.get(key);
						if (!cached) return;
						if (event.type === 'delete') {
							cached.applyExternalDelete();
							this.#entity_cache.delete(key);
						} else if (applied) {
							cached.applyExternalUpdate(applied);
						}
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
			const body = (await response.json().catch(() => null)) as {
				message?: string;
				status?: number;
				code?: string;
				detail?: string;
			} | null;
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
						const body = xhr.response as {
							message?: string;
							status?: number;
							code?: string;
							detail?: string;
						} | null;
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
			const body = (await response.json().catch(() => null)) as {
				message?: string;
				status?: number;
				code?: string;
				detail?: string;
			} | null;
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
	// Reactive read primitives
	// -----------------------------------------------------------------------

	/**
	 * Lightweight reactive reader for a single entity. Use this on read-mostly
	 * pages where you just need the current data; for edit forms use
	 * `db.entity(...)` instead (it adds dirty-tracking, save/reset, etc.).
	 *
	 * The id can be a static value or a getter that depends on other reactive
	 * state — when the id changes, the reader re-fetches automatically:
	 *
	 * ```svelte
	 * <script>
	 *   const person = db.read('person', () => page.params.person_id);
	 * </script>
	 *
	 * {#if person.loading && !person.value}
	 *   Loading…
	 * {:else if person.error}
	 *   <Alert>{person.error.message}</Alert>
	 * {:else if person.value}
	 *   <h1>{person.value.name}</h1>
	 * {/if}
	 * ```
	 *
	 * Mutations via `db.create`/`db.update`/`db.delete` and websocket-pushed
	 * external changes automatically refresh the reader — no manual
	 * invalidation required.
	 */
	read<K extends keyof T & string>(
		entity_type: K,
		id: string | number | (() => string | number | undefined),
	): EntityReader<T[K], K> {
		const id_source =
			typeof id === 'function' ? (id as () => string | number | undefined) : () => id;
		return new EntityReader(entity_type, id_source, {
			getWorker: () => this.#worker,
			fetch: this.#config.fetch,
			trackVersion: (t, i) => this.#trackEntity(t, i),
			refreshProxy: (t, i) => this.#refreshProxyFor(t, i),
			skipBackgroundRefresh: () => this.#config.hooks?.isLive?.() ?? false,
		});
	}

	// -----------------------------------------------------------------------
	// Entity state (reactive singleton wrapper)
	// -----------------------------------------------------------------------

	/**
	 * Reactive edit-form wrapper for a single entity (cached per `entity:id`
	 * on this client). Adds dirty-tracking, save/reset/delete, and
	 * saving/loading/error state on top of the underlying entity cache.
	 *
	 * **SSR pattern — preload in `+page.ts`, read in the component.**
	 * The same `DatabaseClient` is used by both, so `db.entity(...)` in the
	 * component returns the instance already loaded in the load function:
	 *
	 * ```ts
	 * // +page.ts
	 * export const load: PageLoad = async ({ params, parent }) => {
	 *   const { db } = await parent();
	 *   const person = db.entity('person', params.person_id);
	 *   await person.load();
	 *   if (!person.loaded) error(404, 'Not found');
	 *   return {};
	 * };
	 *
	 * // +page.svelte
	 * const person = $derived(db.entity('person', page.params.person_id));
	 * ```
	 *
	 * Server-side the load uses the `fetch` passed to `DatabaseClient`
	 * (carrying auth cookies). On client hydration the load runs again but
	 * reuses the SSR'd fetch response via SvelteKit's fetch cache, then
	 * populates the same entity cache so the component reads it synchronously.
	 *
	 * **New-entity pattern.** Omit the id (and pass default fields as
	 * `initial_data` if needed) — `save()` will `create` on the server and
	 * attach the returned id to the wrapper.
	 */
	entity<K extends keyof T & string>(
		entity_type: K,
		id?: string | number,
		initial_data?: Partial<Database.Entity<T[K]>>,
	): EntityState<T[K], K> {
		const key = `${entity_type}:${id ?? ''}`;
		const cached = this.#entity_cache.get(key);
		if (cached) return cached as EntityState<T[K], K>;

		const table = this.#config.tables[entity_type];
		const instance = new EntityState<T[K], K>(entity_type, id, {
			worker: this.#worker,
			fetch: this.#config.fetch,
			initial_data,
			primary_key: table.config.primary_key,
			// Pre-hydration (SSR + initial client load) we want the SvelteKit
			// fetch so SSR + hydration share a single response; after the
			// first client navigation we want the worker's IDB cache.
			prefer_fetch: () => !this.#hydrated,
			// When the app's change feed is live (websocket connected, or
			// briefly dropped within the grace window) the worker skips its
			// safety-net stale refresh — IDB is authoritative.
			skip_background_refresh: () => this.#config.hooks?.isLive?.() ?? false,
			onChange: (event) => {
				// Keep the instance cache in sync with the entity's lifecycle:
				// on create, rekey from `type:` to `type:${new_id}`; on delete,
				// drop the entry entirely. Also bump the version map so any
				// `db.get` / `db.read` readers for the same id re-fetch.
				if (event.type === 'create') {
					this.#entity_cache.delete(`${entity_type}:`);
					this.#entity_cache.set(`${entity_type}:${event.id}`, instance as EntityState);
				} else if (event.type === 'delete') {
					this.#entity_cache.delete(`${entity_type}:${event.id}`);
				}
				this.#invalidateEntity(entity_type, event.id);
				this.#config.hooks?.onEntityChange?.({
					...event,
					entity_type,
				});
			},
		});
		this.#entity_cache.set(key, instance as EntityState);
		return instance;
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

	/**
	 * Change scope (e.g. user switches org). Clears cache and re-initializes.
	 * The worker is kept alive and re-pointed at the new scope — with a
	 * SharedWorker this applies to every tab (a scope switch is a global
	 * decision), and the worker handles the database transition internally.
	 */
	async setScope(db_name: string): Promise<void> {
		this.#entity_cache.clear();
		this.#entity_versions.clear();
		this.#refresh_proxies.clear();
		if (this.#hydrate_timer) {
			clearTimeout(this.#hydrate_timer);
			this.#hydrate_timer = null;
		}
		this.#hydrated = false;
		this.#initialized = false;
		this.#syncing = false;
		this.#synced = false;
		this.#config.db_name = db_name;
		await this.init();
	}

	/** Cleanup — disconnects from the worker, clears subscriptions. */
	async destroy(): Promise<void> {
		this.#destroyed = true;
		if (this.#external_unsubscribe) {
			this.#external_unsubscribe();
		}
		this.#entity_cache.clear();
		this.#entity_versions.clear();
		this.#refresh_proxies.clear();
		if (this.#hydrate_timer) {
			clearTimeout(this.#hydrate_timer);
			this.#hydrate_timer = null;
		}
		if (this.#worker) {
			// A SharedWorker's state belongs to ALL connected tabs — destroying it
			// here would brick the other tabs. Only tear down worker state for a
			// dedicated Worker (which is terminated below anyway).
			if (!isWorkerShared()) {
				await this.#worker.destroy();
			}
			this.#worker = null;
		}
		// For a SharedWorker this only closes THIS tab's port
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
