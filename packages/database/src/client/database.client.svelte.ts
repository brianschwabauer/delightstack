import { proxy } from 'comlink';
import type { Remote } from 'comlink';
import { createSubscriber, SvelteMap } from 'svelte/reactivity';
import { untrack } from 'svelte';
import { deepEqual } from 'fast-equals';
import type { Database } from '../schema/schema';
import type { DatabaseClientHooks } from '../contract';
import type { DatabaseWorker, WorkerSearchResult } from './database.worker';
import { encodeSearchQuery } from '../search-query';
import type { SearchQueryInput, ValidSearchQuery } from '../search-query';
import { DelightError } from '@delightstack/utilities';
import { getWorker, resetWorker, isWorkerShared } from './database.worker.init';

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
			/**
			 * Force where searches are answered.
			 *
			 * By default routing is coverage-based: local search is used once the
			 * entity's synced window covers the whole table, and the server answers
			 * until then (it has the full corpus and the correct global statistics).
			 * `'server'` opts out of local search and local syncing entirely;
			 * `'client'` opts in unconditionally, including while the window is
			 * still filling — results are then a partial-corpus answer by design.
			 */
			search_mode?: 'client' | 'server';
			/** Disable IDB cache for this entity */
			cache?: boolean;
			/**
			 * Per-entity sync ceiling — overrides the global `max_synced_docs`
			 * (`false` disables the ceiling for this entity). Applies even to a
			 * `search_mode: 'client'` entity.
			 */
			max_synced_docs?: number | false;
		};
	};

	/** IndexedDB database name — scope per org/context */
	db_name: string;

	/**
	 * Backfill ceiling, defaulting to 50 000: an entity whose server table
	 * holds more rows than this is never mirrored locally. Its backfill is
	 * deferred — sync sends cheap count-only probes instead — and its queries
	 * answer from the server, exactly as if the window were still filling.
	 * The decision is re-probed every sync run, so raising the ceiling or
	 * shrinking the table resumes the backfill automatically. A table that
	 * finished backfilling keeps syncing incrementally however large it grows;
	 * the ceiling prevents the big download, it never evicts a finished index.
	 *
	 * `false` disables the ceiling globally. Entities explicitly forced
	 * `search_mode: 'client'` ignore the default and the global value — only
	 * their own `max_synced_docs` caps them.
	 */
	max_synced_docs?: number | false;

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

	/**
	 * Hooks for external integration — the client half of the
	 * database ↔ websocket contract (see `DatabaseClientHooks`).
	 * `@delightstack/websocket` supplies all three via `ws.databaseHooks()`.
	 */
	hooks?: DatabaseClientHooks;
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
	/** Convenience — just the sparse documents, in hit order. */
	items: Database.SearchEntity<T>[];
	count: number;
	/** Which side answered — the live routing decision for this result. */
	mode: 'client' | 'server';
}

/**
 * Lifecycle of a reactive handle ({@link EntityHandle}, {@link ListHandle},
 * {@link EntityState}):
 * - `'loading'` — no data has arrived yet.
 * - `'refreshing'` — a re-query is in flight; the previous data stays visible.
 * - `'ready'` — the shown data answers the current query.
 * - `'error'` — the last operation failed; `error` holds it, and any previous
 *   data stays visible (last-known-good).
 */
export type HandleStatus = 'loading' | 'refreshing' | 'ready' | 'error';

/**
 * Lifecycle of a {@link DatabaseClient}:
 * - `'idle'` — not initialized (SSR, or before `init()` / after `destroy()`).
 * - `'initializing'` — `init()` is in flight.
 * - `'ready'` — the client is usable. Note the background initial sync may
 *   still be running — that's the orthogonal `syncing`/`synced` pair.
 * - `'signed_out'` — `signOut()` wiped local data; the client is inert until
 *   the next `init()`.
 */
export type DatabaseStatus = 'idle' | 'initializing' | 'ready' | 'signed_out';

/** Parse a failed API response into a DelightError. */
async function errorFromResponse(
	response: Response,
	fallback_message?: string,
): Promise<DelightError> {
	const body = (await response.json().catch(() => null)) as {
		message?: string;
		status?: number;
		code?: string;
		detail?: string;
	} | null;
	return new DelightError({
		message: body?.message ?? fallback_message ?? response.statusText,
		status: body?.status ?? response.status,
		code: body?.code,
		detail: body?.detail,
	});
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
	/**
	 * Wired by `DatabaseClient.entity` to the client's sign-out freeze. While
	 * it returns `true`, no in-flight load or background refresh may touch
	 * reactive state — the displayed values must stay exactly as they are.
	 */
	#frozen?: () => boolean;
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
		// A refresh landing after a sign-out freeze must not repaint anything.
		if (this.#frozen?.()) return;
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

	/** Where the entity is in its lifecycle — see {@link HandleStatus}. */
	get status(): HandleStatus {
		this.#subscriber();
		if (this.#error) return 'error';
		if (this.#loading || this.#saving) return this.#loaded ? 'refreshing' : 'loading';
		return this.#loaded ? 'ready' : 'loading';
	}

	/** Entity ID */
	get id(): string | number | undefined {
		return this.#id;
	}

	#form: T['form'];

	/**
	 * The table's form helpers for this entity: `form.field.<name>` gives
	 * spreadable input props (`<Input {...person.form.field.email} />`) and
	 * `form.schema` is a Standard Schema validator. Pass the entity itself to
	 * the components `<Form entity={person}>` and spread the field props —
	 * values, validation, saving, and submit state are wired automatically.
	 *
	 * Populated when the entity is created via `DatabaseClient.entity()`;
	 * standalone-constructed EntityStates only have it if `form` was passed.
	 */
	get form(): T['form'] {
		return this.#form;
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
			/**
			 * Invoked before applying any async result. `true` (sign-out
			 * freeze) drops the result so displayed values never change.
			 */
			frozen?: () => boolean;
			onChange?: (event: {
				type: 'create' | 'update' | 'delete';
				id: string | number;
				data?: Record<string, unknown>;
			}) => void;
			/**
			 * The table's form helpers (spreadable per-field input props and a
			 * Standard Schema validator). Wired by `DatabaseClient.entity` from
			 * the table config so a page needs only the entity to build a form.
			 */
			form?: T['form'];
		},
	) {
		this.entity_type = entity_type;
		this.#id = id;
		this.#worker = options?.worker ?? null;
		this.#form = options?.form as T['form'];
		this.#fetch = options?.fetch;
		this.#primary_key = options?.primary_key ?? 'id';
		this.#prefer_fetch = options?.prefer_fetch;
		this.#skip_background_refresh = options?.skip_background_refresh;
		this.#frozen = options?.frozen;
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
	 *   search index via `applyExternalChange`. Subsequent reads hit IDB.
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
	}): Promise<Database.Entity<T> | undefined> {
		if (this.#loading || !this.#id || this.#frozen?.()) {
			return (this.#server_value ?? undefined) as Database.Entity<T> | undefined;
		}
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
						// Seed the worker's IDB + search index so client-side nav reads
						// back from cache. Fire-and-forget: comlink delivers port
						// messages in order, so a later `worker.get` still sees the
						// seed — awaiting would put a worker RPC + IDB write on the
						// first-paint critical path for a pure cache-warm side effect.
						void this.#worker
							.applyExternalChange(
								this.entity_type,
								'update',
								this.#id,
								data as unknown as Record<string, unknown>,
							)
							.catch(() => {});
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

			// A sign-out freeze landed while the request was in flight — the
			// result (and even the loading→ready transition) must not repaint.
			if (this.#frozen?.()) {
				return (this.#server_value ?? undefined) as Database.Entity<T> | undefined;
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
			if (!this.#frozen?.()) this.#error = error;
		} finally {
			if (!this.#frozen?.()) this.#loading = false;
		}
		return (this.#server_value ?? undefined) as Database.Entity<T> | undefined;
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
			throw new DelightError({
				message:
					'Worker not available. Call `await db.init()` first or provide fetch option for SSR.',
				status: 503,
				code: 'worker_unavailable',
			});
		}
		return this.#worker;
	}
}

// ---------------------------------------------------------------------------
// EntityHandle — reactive read handle for a single entity
// ---------------------------------------------------------------------------

/**
 * Dependencies EntityHandle needs from the owning DatabaseClient. Passed in
 * so the handle stays decoupled from client internals while reusing the
 * version-invalidation and comlink plumbing.
 */
interface EntityHandleDeps {
	getWorker: () => Remote<DatabaseWorker> | null;
	fetch?: typeof globalThis.fetch;
	trackVersion: (entity_type: string, id: string | number) => void;
	refreshProxy: (
		entity_type: string,
		id: string | number,
	) => (data: Record<string, unknown>) => void;
	/** Skip the worker's safety-net stale refresh (wired to `hooks.isLive`). */
	skipBackgroundRefresh?: () => boolean;
	/**
	 * The client's sign-out freeze. While `true`, the handle starts no fetch
	 * and applies no late-arriving result — displayed values stay put.
	 */
	isFrozen?: () => boolean;
	/** Called when the last reactive listener stops reading — drops the cache entry. */
	release: () => void;
}

/**
 * The reactive read handle returned by `db.get(type, id)` — cached per
 * `type:id`, so every call site shares one instance.
 *
 * Two ways to consume it:
 *
 * - **Reactive:** read `.value` in a template or `$derived` — the first read
 *   starts a live subscription (auto-load, updates on mutations, websocket
 *   pushes and background refreshes; tears down when the last listener stops
 *   reading). `value` is `undefined` until loaded / when not found.
 * - **Awaited:** `await db.get(type, id).load()` resolves with the entity
 *   (or `undefined` when not found). Called inside `$derived`, `load()`
 *   registers a reactive dependency first, so
 *   `$derived(await db.get(type, id).load())` re-runs on changes and always
 *   yields a non-stale value. Called from a `+page.ts` load with the client's
 *   configured SvelteKit `fetch`, it SSRs and hydrates from one request.
 *
 * The resolved/`value` object is a snapshot — it is replaced (never mutated)
 * on updates.
 */
export class EntityHandle<
	T extends Database.Table = Database.Table,
	EntityType extends string = string,
> {
	readonly entity_type: EntityType;
	readonly id: string | number;
	#deps: EntityHandleDeps;
	#subscriber: () => void;
	#effect_cleanup: (() => void) | null = null;

	#value = $state.raw<Database.Entity<T> | undefined>(undefined);
	#status = $state<HandleStatus>('loading');
	#error = $state.raw<unknown>(null);
	/** Monotonic fetch sequence — a stale fetch must never overwrite a newer one. */
	#fetch_token = 0;

	/** The current entity data, or `undefined` until loaded / if not found. */
	get value(): Database.Entity<T> | undefined {
		this.#subscriber();
		return this.#value;
	}

	/** Where the handle is in its lifecycle — see {@link HandleStatus}. */
	get status(): HandleStatus {
		this.#subscriber();
		return this.#status;
	}

	/** Last error from a fetch; cleared on the next successful load. */
	get error(): unknown {
		return this.#error;
	}

	/**
	 * Whether a reactive listener currently holds the handle live (between
	 * start and stop). Read by the owning client so cache eviction never
	 * discards a handle with active subscribers.
	 */
	get live(): boolean {
		return this.#effect_cleanup !== null;
	}

	constructor(entity_type: EntityType, id: string | number, deps: EntityHandleDeps) {
		this.entity_type = entity_type;
		this.id = id;
		this.#deps = deps;
		this.#subscriber = createSubscriber(() => {
			this.#start();
			return () => this.#stop();
		});
	}

	/**
	 * Fetch the entity and resolve with it (`undefined` when not found).
	 *
	 * Reactive when called inside `$derived`/`$effect`/a template: the version
	 * dependency is registered synchronously before the fetch, so mutations and
	 * external changes re-run the enclosing scope. Outside reactive contexts
	 * (a `+page.ts` load, an event handler) it is a plain one-shot read.
	 */
	async load(options?: {
		force_refresh?: boolean;
	}): Promise<Database.Entity<T> | undefined> {
		// Synchronous reactive read — must happen before any await.
		this.#deps.trackVersion(this.entity_type, this.id);
		return this.#fetch(options?.force_refresh === true, true);
	}

	/** Force a re-fetch, bypassing the worker's IDB cache. */
	async refresh(): Promise<Database.Entity<T> | undefined> {
		return this.#fetch(true, true);
	}

	#start(): void {
		if (this.#effect_cleanup) return;
		this.#effect_cleanup = $effect.root(() => {
			$effect(() => {
				// Reactive read: the entity version. Any mutation or external
				// change bumps it and re-runs this effect → fresh fetch.
				this.#deps.trackVersion(this.entity_type, this.id);
				untrack(() => {
					this.#fetch(false, false).catch(() => {
						// surfaced through `error`/`status`
					});
				});
			});
		});
	}

	#stop(): void {
		if (this.#effect_cleanup) {
			this.#effect_cleanup();
			this.#effect_cleanup = null;
		}
		this.#deps.release();
	}

	async #fetch(
		force_refresh: boolean,
		rethrow: boolean,
	): Promise<Database.Entity<T> | undefined> {
		// Sign-out freeze: no new fetch may start (the client is inert).
		if (this.#deps.isFrozen?.()) return this.#value;
		const token = ++this.#fetch_token;
		try {
			let data: Database.Entity<T> | undefined;
			const worker = this.#deps.getWorker();
			if (worker) {
				const skip_bg_refresh = this.#deps.skipBackgroundRefresh?.() ?? false;
				data = (await worker.get(
					this.entity_type,
					this.id,
					force_refresh,
					this.#deps.refreshProxy(this.entity_type, this.id),
					skip_bg_refresh,
				)) as Database.Entity<T> | undefined;
			} else if (this.#deps.fetch) {
				// SSR / pre-init: the configured fetch carries the request's auth
				// context, and SvelteKit records the response for hydration reuse.
				const response = await this.#deps.fetch(`/api/${this.entity_type}/${this.id}`);
				if (response.status === 404) {
					data = undefined;
				} else if (response.ok) {
					data = (await response.json()) as Database.Entity<T>;
				} else {
					throw await errorFromResponse(response);
				}
			}

			// A newer fetch settled first — keep its result. Same guard for a
			// sign-out freeze: a late result must not repaint the frozen handle.
			if (token !== this.#fetch_token || this.#deps.isFrozen?.()) return this.#value;
			this.#value = data;
			this.#status = 'ready';
			this.#error = null;
			return data;
		} catch (error) {
			const wrapped = DelightError.fromWorker(error) ?? error;
			if (token === this.#fetch_token && !this.#deps.isFrozen?.()) {
				this.#error = wrapped;
				this.#status = 'error';
			}
			if (rethrow) throw wrapped;
			return this.#value;
		}
	}
}

// ---------------------------------------------------------------------------
// ListHandle — reactive list/search handle
// ---------------------------------------------------------------------------

/** Baseline defaults applied to every watch. Callers override selectively. */
const DEFAULT_SEARCH_QUERY = {
	term: '',
	limit: 100,
	order: [{ field: 'updated_at', direction: 'DESC' as const }],
};

/**
 * Merge a query over the defaults. Relevance queries (a term or a vector) with
 * no explicit `order` drop the recency default so the engine's empty-order
 * path ranks by score — otherwise `updated_at DESC` would silently override
 * BM25/boost ranking.
 */
function mergeQueryDefaults<T extends Database.Table>(
	defaults: Database.SearchQuery<T>,
	q: Partial<Database.SearchQuery<T>>,
): Database.SearchQuery<T> {
	const merged = { ...defaults, ...q };
	const has_relevance = !!(merged.term as string | undefined)?.trim() || !!merged.vector;
	if (has_relevance && q.order === undefined) merged.order = [];
	return merged;
}

/** Quiet window for coalescing rapid query changes (e.g. typing) into one push */
const QUERY_DEBOUNCE_MS = 150;

export type ListQueryInit<T extends Database.Table = Database.Table> =
	| Partial<Database.SearchQuery<T>>
	| (() => Partial<Database.SearchQuery<T>>);

/**
 * Dependencies ListHandle needs from the owning DatabaseClient.
 */
interface ListHandleDeps {
	getWorker: () => Remote<DatabaseWorker> | null;
	fetch?: typeof globalThis.fetch;
	/**
	 * The client's sign-out freeze. While `true`, the handle runs no query and
	 * applies no late-arriving result — the displayed hits stay put.
	 */
	isFrozen?: () => boolean;
	/** Called when the last reactive listener stops reading — drops the cache entry. */
	release: () => void;
}

/**
 * Compile-time guard applied to `db.list` query arguments: rejects
 * `source: 'client'` combined with `vector` (vector search is server-only).
 * Unwraps the function form of {@link ListQueryInit}.
 */
type ValidQueryInit<Q> = Q extends () => infer R
	? ValidSearchQuery<R>
	: ValidSearchQuery<Q>;

/**
 * The reactive list/search handle returned by `db.list(type, query)`.
 *
 * Read `hits`/`items`/`count` in a template or `$derived` — the first read
 * starts a live worker subscription that re-runs the query whenever the index
 * changes, and tears down when the last listener stops reading. `query` is a
 * live reactive object (`posts.query.term = 'x'` re-queries automatically),
 * or pass a function to drive the query from other reactive state.
 *
 * For a one-shot list, `await db.list(type, query).load()` resolves with a
 * {@link SearchResult} and never starts a subscription — including on SSR,
 * where it answers via the configured `fetch`.
 */
export class ListHandle<
	T extends Database.Table = Database.Table,
	EntityType extends string = string,
> {
	readonly entity_type: EntityType;
	#deps: ListHandleDeps;
	#subscriber_id: string | null = null;
	#init_promise: Promise<void> | null = null;
	#subscriber: () => void;
	#destroyed = false;
	#effect_cleanup: (() => void) | null = null;
	#reactive_query: (() => Partial<Database.SearchQuery<T>>) | null = null;
	#defaults: Database.SearchQuery<T>;
	#push_timer: ReturnType<typeof setTimeout> | null = null;
	#last_push_at = 0;
	/**
	 * Monotonic query sequence. Every push (subscription update or manual
	 * refresh) claims the next token; the worker echoes it back with the
	 * result, and any result older than the newest one already applied is
	 * discarded — a slow query can never overwrite a newer one's results.
	 */
	#push_token = 0;
	/** The token of the newest result applied to `#hits`. */
	#delivered_token = 0;

	#hits = $state.raw<SearchHit<T>[]>([]);
	#items = $derived<Database.SearchEntity<T>[]>(this.#hits.map((h) => h.document));
	#count = $state(0);
	#status = $state<HandleStatus>('loading');
	#error = $state<unknown>(null);
	#mode = $state<'client' | 'server'>('client');
	#query_state = $state<Database.SearchQuery<T>>({});

	/** Reactive array of scored search hits ({ id, score, document }) */
	get hits(): SearchHit<T>[] {
		this.#subscriber();
		return this.#hits;
	}

	/** Convenience accessor for just the documents, in hit order */
	get items(): Database.SearchEntity<T>[] {
		this.#subscriber();
		return this.#items;
	}

	/** Total matching count */
	get count(): number {
		this.#subscriber();
		return this.#count;
	}

	/** Whether the server has rows beyond the current window (see `loadMore`). */
	get has_more(): boolean {
		this.#subscriber();
		return this.#hits.length < this.#count;
	}

	/** Where the handle is in its lifecycle — see {@link HandleStatus}. */
	get status(): HandleStatus {
		this.#subscriber();
		return this.#status;
	}

	/** Any error from the query (set while `status === 'error'`) */
	get error(): unknown {
		return this.#error;
	}

	/** Which side answered the current results — updated with every result. */
	get mode(): 'client' | 'server' {
		this.#subscriber();
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
		this.#applyQuery(mergeQueryDefaults(this.#defaults, q));
	}

	constructor(entity_type: EntityType, deps: ListHandleDeps, query?: ListQueryInit<T>) {
		this.entity_type = entity_type;
		this.#deps = deps;
		this.#defaults = { ...DEFAULT_SEARCH_QUERY } as Database.SearchQuery<T>;

		let initial: Partial<Database.SearchQuery<T>> = {};
		if (typeof query === 'function') {
			this.#reactive_query = query;
			initial = untrack(() => query()) ?? {};
		} else if (query) {
			initial = query;
		}
		this.#applyQuery(mergeQueryDefaults(this.#defaults, initial));

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
		await this.#runQuery();
	}

	/**
	 * Run the current query once and resolve with the results — the one-shot
	 * form of the handle. Never starts a subscription, and works on SSR (the
	 * query is answered via the configured `fetch`). Rejects on failure.
	 */
	async load(): Promise<SearchResult<T>> {
		const result = await this.#runQuery(true);
		return {
			hits: result.hits as SearchHit<T>[],
			items: (result.hits as SearchHit<T>[]).map((h) => h.document),
			count: result.count,
			mode: result.mode,
		};
	}

	/**
	 * Grow the result window by `count` more rows (default 100). The live
	 * subscription keeps the whole window updated, so paging is a growing
	 * window rather than detached pages. `has_more` reports whether the server
	 * has rows beyond the current window.
	 */
	loadMore(count = 100): void {
		const current = untrack(() => this.#query_state.limit) ?? DEFAULT_SEARCH_QUERY.limit;
		this.#query_state.limit = current + count;
	}

	/** Run the query once (worker or SSR fetch) and apply the result. */
	async #runQuery(rethrow = false): Promise<WorkerSearchResult> {
		// Sign-out freeze: run nothing, touch nothing — not even `status`.
		if (this.#deps.isFrozen?.()) {
			return { hits: [], count: 0, mode: untrack(() => this.#mode) };
		}
		const token = ++this.#push_token;
		try {
			if (this.#status !== 'loading') this.#status = 'refreshing';
			const query = untrack(() => $state.snapshot(this.#query_state) as SearchQueryInput);
			const worker = this.#deps.getWorker();
			let result: WorkerSearchResult;
			if (worker) {
				result = await worker.list(this.entity_type, query);
			} else {
				result = await this.#listViaFetch(query);
			}
			// A newer push already delivered — this result is stale for the live
			// state, but still the answer to THIS call. A sign-out freeze that
			// landed mid-flight drops the result the same way.
			if (
				!this.#destroyed &&
				!this.#deps.isFrozen?.() &&
				token >= this.#delivered_token
			) {
				this.#delivered_token = token;
				this.#hits = result.hits as SearchHit<T>[];
				this.#count = result.count;
				this.#mode = result.mode;
				this.#error = null;
				this.#status = 'ready';
			}
			return result;
		} catch (e) {
			const wrapped = DelightError.fromWorker(e) ?? e;
			// Keep the last-known-good results; surface the failure only when no
			// newer result has landed in the meantime (and never once frozen).
			if (
				!this.#destroyed &&
				!this.#deps.isFrozen?.() &&
				token >= this.#delivered_token
			) {
				this.#error = wrapped;
				this.#status = 'error';
			}
			if (rethrow) throw wrapped;
			return { hits: [], count: 0, mode: this.#mode };
		}
	}

	/** SSR / pre-init query path via the auto-generated list endpoint. */
	async #listViaFetch(query: SearchQueryInput): Promise<WorkerSearchResult> {
		const fetcher = this.#deps.fetch ?? globalThis.fetch;
		const params = encodeSearchQuery({ sparse: true, ...query });
		const qs = params.toString();
		const response = await fetcher(`/api/${this.entity_type}${qs ? '?' : ''}${qs}`);
		if (!response.ok) {
			throw await errorFromResponse(response, `List ${this.entity_type} failed`);
		}
		const body = (await response.json()) as {
			hits?: { id: string; document: Record<string, unknown>; score: number }[];
			count?: number;
		};
		return { hits: body.hits ?? [], count: body.count ?? 0, mode: 'server' };
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
						this.#applyQuery(mergeQueryDefaults(this.#defaults, q));
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
				this.#schedulePushQuery();
			});
		});

		this.#initSubscription();
	}

	/** Tear down subscription and effects. Called by createSubscriber cleanup. */
	#stop(): void {
		if (this.#push_timer !== null) {
			clearTimeout(this.#push_timer);
			this.#push_timer = null;
		}
		if (this.#effect_cleanup) {
			this.#effect_cleanup();
			this.#effect_cleanup = null;
		}
		if (this.#subscriber_id) {
			this.#deps
				.getWorker()
				?.unsubscribe(this.#subscriber_id)
				.catch(() => {});
			this.#subscriber_id = null;
		}
		this.#init_promise = null;
		this.#deps.release();
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

	/**
	 * Leading-edge debounce around #pushQuery: the first change after a quiet
	 * period pushes immediately (no added latency for a lone change), while
	 * rapid follow-ups (e.g. typing) coalesce into one trailing push. The
	 * trailing push snapshots #query_state at fire time, so it always sends
	 * the latest query.
	 */
	#schedulePushQuery(): void {
		const now = Date.now();
		if (this.#push_timer === null && now - this.#last_push_at >= QUERY_DEBOUNCE_MS) {
			this.#last_push_at = now;
			void this.#pushQuery();
			return;
		}
		if (this.#push_timer !== null) clearTimeout(this.#push_timer);
		this.#push_timer = setTimeout(() => {
			this.#push_timer = null;
			this.#last_push_at = Date.now();
			void this.#pushQuery();
		}, QUERY_DEBOUNCE_MS);
	}

	async #pushQuery(): Promise<void> {
		if (this.#destroyed || this.#deps.isFrozen?.()) return;
		const worker = this.#deps.getWorker();
		if (this.#subscriber_id && worker) {
			const token = ++this.#push_token;
			if (this.#status !== 'loading') this.#status = 'refreshing';
			try {
				// The subscription callback delivers the result (and the 'ready' /
				// 'error' status) before this await resolves.
				await worker.updateSubscription(
					this.#subscriber_id,
					$state.snapshot(this.#query_state) as SearchQueryInput,
					token,
				);
			} catch {
				await this.refresh();
			}
		} else {
			await this.refresh();
		}
	}

	async #initSubscription(): Promise<void> {
		if (this.#destroyed || this.#deps.isFrozen?.()) return;
		if (this.#init_promise) return;

		const worker = this.#deps.getWorker();
		if (!worker) {
			// SSR / pre-init: no live subscription exists — answer the current
			// query once so reactive readers still get data.
			void this.#runQuery();
			return;
		}

		this.#init_promise = (async () => {
			try {
				this.#subscriber_id = await worker.subscribe(
					this.entity_type,
					$state.snapshot(this.#query_state) as SearchQueryInput,
					proxy((result: WorkerSearchResult) => {
						// Destroyed or frozen (sign-out): a late-arriving push must
						// not touch the displayed results.
						if (this.#destroyed || this.#deps.isFrozen?.()) return;
						// Sequence guard: the worker echoes the token of the query each
						// result answered. A slow push that arrives after a newer one has
						// delivered is stale — drop it rather than regress the list.
						const token = result.token ?? this.#delivered_token;
						if (token < this.#delivered_token) return;
						this.#delivered_token = token;
						if (result.error) {
							// Keep the last-known-good results on screen; surface the
							// failure through the error state instead of blanking the list.
							this.#error = new DelightError(result.error);
							this.#status = 'error';
							return;
						}
						this.#hits = result.hits as SearchHit<T>[];
						this.#count = result.count;
						this.#mode = result.mode;
						this.#error = null;
						this.#status = 'ready';
					}),
					this.#push_token,
					// Liveness probe: the worker pings this periodically and drops the
					// subscription when the ping stops settling (this tab's port died
					// without an unsubscribe — crash, hard navigation).
					proxy(async () => true),
				);
			} catch (e) {
				this.#error = e;
				this.#status = 'error';
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
	#status = $state<DatabaseStatus>('idle');
	#destroyed = false;
	/**
	 * Sign-out freeze (deliberately NOT reactive — flipping it must never
	 * itself cause a repaint). While set, `#invalidateEntity` is a no-op,
	 * refresh proxies do nothing, and every handle drops late-arriving
	 * results — displayed values stay exactly as they are until the app
	 * navigates away. Cleared by the next `init()` (fresh sign-in).
	 */
	#frozen = false;
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
	 * MessageChannel for every `$derived` re-run. Bounded (LRU) — each proxy
	 * holds comlink transfer state, so an unbounded map would grow for the
	 * lifetime of the session as the user browses entities.
	 */
	#refresh_proxies = new Map<string, (data: Record<string, unknown>) => void>();
	static readonly #REFRESH_PROXY_LIMIT = 500;

	/**
	 * LRU cap shared by `#entity_cache` and `#get_cache`. Each entry retains
	 * full entity copies, so both maps are bounded like `#refresh_proxies`;
	 * eviction skips entries that hold live state (an active subscriber or
	 * unsaved changes), so exceeding the cap is possible but self-limiting.
	 */
	static readonly #HANDLE_CACHE_LIMIT = 200;

	/**
	 * Cached `EntityState` instances keyed by `type:id`. Scoped to the
	 * DatabaseClient so per-request SvelteKit SSR (where the layout creates
	 * a fresh client) is cache-isolated, while client sessions still reuse
	 * the same wrapper across navigations / multiple reads of the same id.
	 * Bounded (LRU) — instances used once (e.g. a `load()` in `+page.ts`)
	 * would otherwise accumulate for the lifetime of the session. An evicted
	 * instance keeps working standalone; the same key just constructs fresh.
	 */
	#entity_cache = new Map<string, EntityState>();

	/**
	 * Cached `EntityHandle` instances keyed by `type:id` — `db.get` in a load
	 * function and in a component must land on the same handle for the SSR →
	 * hydration handoff to be a single request. Entries drop themselves when
	 * their last reactive listener stops reading; handles that never start a
	 * subscription (awaited `.load()` only) are bounded by LRU eviction
	 * instead. An evicted handle keeps working standalone.
	 */
	#get_cache = new Map<string, EntityHandle>();

	/**
	 * Cached `ListHandle` instances keyed by `type?<canonical query>` (static
	 * object queries only — function-form queries are per-call). Entries drop
	 * themselves when their last reactive listener stops reading.
	 */
	#list_cache = new Map<string, ListHandle>();

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
	 * user can interact with the page.
	 */
	#hydrated = $state(false);
	#hydrate_timer: ReturnType<typeof setTimeout> | null = null;

	get syncing(): boolean {
		return this.#syncing;
	}

	get synced(): boolean {
		return this.#synced;
	}

	/** Where the client is in its lifecycle — see {@link DatabaseStatus}. */
	get status(): DatabaseStatus {
		return this.#status;
	}

	constructor(config: DatabaseClientConfig<T>) {
		this.#config = { ...config };
	}

	/** Initialize the client — loads IDB cache, syncs with server, builds indices. */
	async init(): Promise<void> {
		if (typeof window === 'undefined') return; // SSR guard

		this.#destroyed = false;
		// A fresh init un-freezes: after signOut(), a new sign-in calls init()
		// and the client must come back to life normally.
		this.#frozen = false;
		this.#status = 'initializing';
		this.#worker = await getWorker(this.#config.dev);

		// Extract serializable config from table definitions
		const tables: Record<
			string,
			{
				index_schema: Record<string, unknown>;
				primary_key: string;
				primary_key_type?: 'string' | 'number';
			}
		> = {};
		for (const [name, table] of Object.entries(this.#config.tables)) {
			tables[name] = {
				index_schema: table.config.index_schema as Record<string, unknown>,
				primary_key: table.config.primary_key,
				primary_key_type: table.config.primary_key_type,
			};
		}

		const entities: Record<
			string,
			{
				search_mode?: 'client' | 'server';
				cache?: boolean;
				max_synced_docs?: number | false;
			}
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
			max_synced_docs: this.#config.max_synced_docs,
		});

		// Clear stale caches so new instances get the active worker
		this.#entity_cache.clear();
		this.#get_cache.clear();
		this.#list_cache.clear();

		this.#status = 'ready';

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
				if (!this.#worker || this.#frozen) return;
				// Apply the single change in place — search index + IDB + subscribers
				// update for just this entity. A full `sync([entity_type])` is
				// wasteful when we already know what changed; reconnect/page
				// refresh still triggers full sync via init().
				this.#worker
					.applyExternalChange(
						event.entity_type,
						event.type,
						event.id,
						event.data,
						event.sparse,
					)
					.then((applied) => {
						// A sign-out freeze mid-flight: nothing may repaint.
						if (this.#frozen) return;
						this.#invalidateEntity(event.entity_type, event.id);
						// `#invalidateEntity` wakes up `db.get`
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
	 * The reactive read handle for a single entity — cached per `type:id`, so
	 * every call site (load functions, components, repeated `$derived` runs)
	 * shares one instance.
	 *
	 * **Reading:** `db.get('post', id).value` in a template/`$derived` is live —
	 * it auto-loads on first read and updates on mutations, websocket pushes
	 * and background refreshes. For a non-undefined awaited form use
	 * `$derived(await db.get('post', id).load())`.
	 *
	 * **SSR:** call `.load()` in a `+page.ts` load; with the SvelteKit `fetch`
	 * passed to the client config, the response is serialized into the page
	 * payload and replayed during hydration — one request total:
	 *
	 * ```ts
	 * // +page.ts
	 * export const load: PageLoad = async ({ params, parent }) => {
	 *   const { db } = await parent();
	 *   const post = await db.get('post', params.post_id).load();
	 *   return { post };
	 * };
	 * ```
	 *
	 * For editing (drafts, save/reset, dirty-tracking) use {@link entity}.
	 */
	get<K extends keyof T & string>(
		entity_type: K,
		id: string | number,
	): EntityHandle<T[K], K> {
		const key = `${entity_type}:${id}`;
		const cached = this.#get_cache.get(key);
		if (cached) {
			// Re-insert to mark as recently used (Map preserves insertion order)
			this.#get_cache.delete(key);
			this.#get_cache.set(key, cached);
			return cached as EntityHandle<T[K], K>;
		}
		if (this.#get_cache.size >= DatabaseClient.#HANDLE_CACHE_LIMIT) {
			// Evict the least recently used handle that has no active reactive
			// listener — a live handle must never be discarded from under its
			// subscribers, so when everything is live nothing is evicted.
			for (const [k, h] of this.#get_cache) {
				if (!h.live) {
					this.#get_cache.delete(k);
					break;
				}
			}
		}
		const handle = new EntityHandle<T[K], K>(entity_type, id, {
			getWorker: () => this.#worker,
			fetch: this.#config.fetch,
			trackVersion: (t, i) => this.#trackEntity(t, i),
			refreshProxy: (t, i) => this.#refreshProxyFor(t, i),
			skipBackgroundRefresh: () => this.#config.hooks?.isLive?.() ?? false,
			isFrozen: () => this.#frozen,
			release: () => {
				if (this.#get_cache.get(key) === (handle as EntityHandle)) {
					this.#get_cache.delete(key);
				}
			},
		});
		this.#get_cache.set(key, handle as EntityHandle);
		return handle;
	}

	/**
	 * Optimistically patch a document in the LOCAL search index only — no
	 * server write. Live search subscriptions re-run immediately, so list UIs
	 * reflect the change within a frame. Use when the authoritative write goes
	 * through a custom endpoint (whose websocket echo then replaces this
	 * overlay with the real row) — calling `update()` as well would double the
	 * server writes and can race the endpoint's own state reads.
	 * No-op (returns false) when the entity runs in server search mode.
	 */
	async applyLocalPatch<K extends keyof T & string>(
		entity_type: K,
		id: string | number,
		patch: Partial<Database.Entity<T[K]>>,
	): Promise<boolean> {
		if (!this.#worker) return false;
		const applied = await this.#worker.applyLocalPatch(
			entity_type,
			id,
			patch as Record<string, unknown>,
		);
		if (applied) this.#invalidateEntity(entity_type, id);
		return applied;
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
		if (cached) {
			// Re-insert to mark as recently used (Map preserves insertion order)
			this.#entity_cache.delete(key);
			this.#entity_cache.set(key, cached);
			return cached as EntityState<T[K], K>;
		}
		if (this.#entity_cache.size >= DatabaseClient.#HANDLE_CACHE_LIMIT) {
			// Evict the least recently used instance with no unsaved work.
			// `untrack` keeps the scan from registering reactive reads (this
			// method is called from `$derived`) — `has_changes` would otherwise
			// subscribe the caller to every scanned instance and auto-load them.
			untrack(() => {
				for (const [k, s] of this.#entity_cache) {
					if (!s.has_changes && !s.saving) {
						this.#entity_cache.delete(k);
						break;
					}
				}
			});
		}

		const table = this.#config.tables[entity_type];
		const instance = new EntityState<T[K], K>(entity_type, id, {
			worker: this.#worker,
			fetch: this.#config.fetch,
			initial_data,
			primary_key: table.config.primary_key,
			form: table.form as T[K]['form'],
			// Pre-hydration (SSR + initial client load) we want the SvelteKit
			// fetch so SSR + hydration share a single response; after the
			// first client navigation we want the worker's IDB cache.
			prefer_fetch: () => !this.#hydrated,
			// When the app's change feed is live (websocket connected, or
			// briefly dropped within the grace window) the worker skips its
			// safety-net stale refresh — IDB is authoritative.
			skip_background_refresh: () => this.#config.hooks?.isLive?.() ?? false,
			frozen: () => this.#frozen,
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
	// List
	// -----------------------------------------------------------------------

	/**
	 * The reactive list/search handle for an entity type — the one list API.
	 *
	 * **Live:** read `hits`/`items`/`count` in a template and the handle
	 * subscribes, re-running the query whenever the local index changes (and
	 * tearing down when nothing reads it anymore). `query` is live and has
	 * sensible defaults (order by `updated_at` DESC, limit 100): mutate fields
	 * (`posts.query.term = 'x'`), bind to them
	 * (`<Input bind:value={posts.query.term} />`), or pass a function to drive
	 * the query from other reactive state. `loadMore()` grows the window.
	 *
	 * **One-shot:** `await db.list('post', { term }).load()` resolves with a
	 * {@link SearchResult} without starting a subscription — including on SSR,
	 * where the query is answered via the configured `fetch`.
	 *
	 * Queries are routed like every read: answered locally once the entity's
	 * synced window covers the whole table, by the server until then. Force a
	 * side per query with `source: 'client' | 'server'`; the handle's `mode`
	 * reports which side answered the current results.
	 *
	 * Handles for identical static queries are cached and shared; a function
	 * query gets its own handle per call.
	 */
	list<K extends keyof T & string, Q extends ListQueryInit<T[K]>>(
		entity_type: K,
		query?: Q & ValidQueryInit<Q>,
	): ListHandle<T[K], K> {
		const deps = (release: () => void) => ({
			getWorker: () => this.#worker,
			fetch: this.#config.fetch,
			isFrozen: () => this.#frozen,
			release,
		});
		// Function-form queries are reactive per call site — never shared.
		if (typeof query === 'function') {
			return new ListHandle(
				entity_type,
				deps(() => {}),
				query as ListQueryInit<T[K]>,
			);
		}
		const key = `${entity_type}?${encodeSearchQuery((query ?? {}) as SearchQueryInput).toString()}`;
		const cached = this.#list_cache.get(key);
		if (cached) return cached as ListHandle<T[K], K>;
		const handle = new ListHandle<T[K], K>(
			entity_type,
			deps(() => {
				if (this.#list_cache.get(key) === (handle as ListHandle)) {
					this.#list_cache.delete(key);
				}
			}),
			query as ListQueryInit<T[K]>,
		);
		this.#list_cache.set(key, handle as ListHandle);
		return handle;
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	/**
	 * Sign-out data wipe: freeze first, then delete everything persisted.
	 *
	 * Wipes all locally persisted data (the IndexedDB entity cache, sync
	 * metadata, and the search-index postings stores — one database per
	 * `db_name`) so nothing searchable remains on disk after sign-out.
	 *
	 * **No UI flashes.** The app navigates away after this resolves;
	 * navigation is the app's job, not this library's. Between the call and
	 * that navigation nothing repaints: the client freezes synchronously
	 * before any async work, so no list handle receives empty results, no
	 * entity handle flips to `undefined`, and no subscriber notification
	 * fires — displayed values stay exactly as they are.
	 *
	 * Under a SharedWorker the wipe applies to every tab of the origin by
	 * design (sign-out is account-level); dedicated-Worker peers are told over
	 * the broadcast channel and drop their state just as silently. With no
	 * worker (SSR / pre-init) there is nothing persisted — this just freezes,
	 * clears the in-memory caches, and resolves.
	 *
	 * The client is inert afterwards; a later `init()` (fresh sign-in)
	 * un-freezes and works normally.
	 */
	async signOut(): Promise<void> {
		// 1. Freeze — synchronously, before any await. From this line on no
		//    version bump, refresh proxy, or late-arriving result can repaint.
		this.#frozen = true;
		if (this.#external_unsubscribe) {
			this.#external_unsubscribe();
			this.#external_unsubscribe = undefined;
		}
		if (this.#hydrate_timer) {
			clearTimeout(this.#hydrate_timer);
			this.#hydrate_timer = null;
		}

		// 2. Silence the worker, then wipe the IndexedDB database.
		if (this.#worker) {
			await this.#worker.wipe();
		}

		// 3. Clear the client caches. The frozen guards keep this quiet: any
		//    effect the version-map clear wakes hits a frozen no-op fetch.
		this.#entity_cache.clear();
		this.#get_cache.clear();
		this.#list_cache.clear();
		this.#refresh_proxies.clear();
		this.#entity_versions.clear();
		this.#status = 'signed_out';
		this.#syncing = false;
		this.#synced = false;
		this.#hydrated = false;
	}

	/**
	 * Change scope (e.g. user switches org). Clears cache and re-initializes.
	 * The worker is kept alive and re-pointed at the new scope — with a
	 * SharedWorker this applies to every tab (a scope switch is a global
	 * decision), and the worker handles the database transition internally.
	 */
	async setScope(db_name: string): Promise<void> {
		this.#entity_cache.clear();
		this.#get_cache.clear();
		this.#list_cache.clear();
		this.#entity_versions.clear();
		this.#refresh_proxies.clear();
		if (this.#hydrate_timer) {
			clearTimeout(this.#hydrate_timer);
			this.#hydrate_timer = null;
		}
		this.#hydrated = false;
		this.#status = 'idle';
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
		this.#get_cache.clear();
		this.#list_cache.clear();
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
		this.#status = 'idle';
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
		// Frozen (sign-out): version bumps would wake reactive readers and
		// repaint — the whole point of the freeze is that nothing does.
		if (this.#frozen) return;
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
		if (cached) {
			// Re-insert to mark as recently used (Map preserves insertion order)
			this.#refresh_proxies.delete(key);
			this.#refresh_proxies.set(key, cached);
			return cached;
		}
		if (this.#refresh_proxies.size >= DatabaseClient.#REFRESH_PROXY_LIMIT) {
			const oldest = this.#refresh_proxies.keys().next().value;
			if (oldest !== undefined) this.#refresh_proxies.delete(oldest);
		}
		const p = proxy(() => {
			this.#invalidateEntity(entity_type, id);
		});
		this.#refresh_proxies.set(key, p);
		return p;
	}
}
