import type { Handle, RequestEvent } from '@sveltejs/kit';
import type { Database } from '../schema/schema';
import { DelightError } from '@delightstack/utilities';
import { decodeSearchQuery } from '../search-query';

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

/** Entity input (without auto-managed fields) */
type EntityInput<T extends Database.Table> = Omit<
	Database.Entity<T>,
	'id' | 'created_at' | 'updated_at'
>;

// ---------------------------------------------------------------------------
// Hook context types
// ---------------------------------------------------------------------------

/** Context passed to `beforeCreate` hooks */
export interface BeforeCreateContext<T extends Database.Table> {
	/** The parsed entity data (validated via table.parse) */
	data: EntityInput<T>;
	/** The SvelteKit request event */
	event: RequestEvent;
}

/** Context passed to `beforeUpdate` hooks */
export interface BeforeUpdateContext<T extends Database.Table> {
	/** The entity ID from the URL */
	id: string;
	/** The raw partial update data from the request body */
	data: Record<string, unknown>;
	/** The existing entity fetched from the database */
	existing: Database.Entity<T>;
	/** The SvelteKit request event */
	event: RequestEvent;
}

/** Context passed to `beforeDelete` hooks */
export interface BeforeDeleteContext<T extends Database.Table> {
	/** The entity ID from the URL */
	id: string;
	/** The existing entity fetched from the database */
	existing: Database.Entity<T>;
	/** The SvelteKit request event */
	event: RequestEvent;
}

/** Context passed to `beforeGet` hooks */
export interface BeforeGetContext {
	/** The entity ID from the URL */
	id: string;
	/** The SvelteKit request event */
	event: RequestEvent;
}

/** Context passed to `beforeList` hooks */
export interface BeforeListContext {
	/** The decoded search query from URL params */
	query: Record<string, unknown>;
	/** The SvelteKit request event */
	event: RequestEvent;
}

/** Context passed to `afterCreate` and `afterUpdate` hooks */
export interface AfterWriteContext<T extends Database.Table> {
	/** The entity as returned from the database after the write */
	data: Database.Entity<T>;
	/** The SvelteKit request event */
	event: RequestEvent;
}

/** Context passed to `afterDelete` hooks */
export interface AfterDeleteContext {
	/** The entity ID that was deleted */
	id: string;
	/** The SvelteKit request event */
	event: RequestEvent;
}

// ---------------------------------------------------------------------------
// Hook definitions
// ---------------------------------------------------------------------------

/** Lifecycle hooks for a database entity route */
export interface DatabaseRouteHooks<T extends Database.Table> {
	/**
	 * Called before creating an entity. Throw to reject.
	 * Optionally return modified data to override what gets written.
	 */
	beforeCreate?: (
		ctx: BeforeCreateContext<T>,
	) => void | EntityInput<T> | Promise<void | EntityInput<T>>;

	/**
	 * Called before updating an entity. Throw to reject.
	 * The `existing` entity is pre-fetched so you can check ownership.
	 * Optionally return modified partial data to override the update.
	 */
	beforeUpdate?: (
		ctx: BeforeUpdateContext<T>,
	) => void | Record<string, unknown> | Promise<void | Record<string, unknown>>;

	/**
	 * Called before deleting an entity. Throw to reject.
	 * The `existing` entity is pre-fetched so you can check ownership.
	 */
	beforeDelete?: (ctx: BeforeDeleteContext<T>) => void | Promise<void>;

	/**
	 * Called before fetching a single entity by ID. Throw to reject.
	 */
	beforeGet?: (ctx: BeforeGetContext) => void | Promise<void>;

	/**
	 * Called before listing entities. Throw to reject.
	 * Optionally return a modified query to override the search parameters.
	 */
	beforeList?: (
		ctx: BeforeListContext,
	) => void | Record<string, unknown> | Promise<void | Record<string, unknown>>;

	/**
	 * Called after an entity is created. Use for side effects (logging, notifications, etc.).
	 */
	afterCreate?: (ctx: AfterWriteContext<T>) => void | Promise<void>;

	/**
	 * Called after an entity is updated. Use for side effects.
	 */
	afterUpdate?: (ctx: AfterWriteContext<T>) => void | Promise<void>;

	/**
	 * Called after an entity is deleted. Use for side effects.
	 */
	afterDelete?: (ctx: AfterDeleteContext) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Route config
// ---------------------------------------------------------------------------

/** Internal config stored per route (type-erased for the array) */
interface DatabaseRouteConfig {
	/** The base route path (e.g. `/api/person`) */
	route: string;
	/** The entity type name matching the key in your DatabaseConfig (e.g. `'person'`) */
	entity: string;
	/** The table definition created by `Database.table()` */
	table: Database.Table;
	/** Optional lifecycle hooks */
	hooks?: DatabaseRouteHooks<Database.Table>;
}

// ---------------------------------------------------------------------------
// Handle options
// ---------------------------------------------------------------------------

/** Options for `createDatabaseHandle()` */
export interface DatabaseHandleOptions<
	Tables extends Record<string, Database.Table> = Record<string, Database.Table>,
> {
	/**
	 * Returns the database server instance for the current request.
	 * Return `undefined` if no database is available (e.g. no org selected).
	 */
	getDatabase: (event: RequestEvent) => DatabaseRpc | undefined;

	/**
	 * Tables to generate CRUD routes for at `/api/${entity}`. Use `hooks` to
	 * customize per-entity behavior.
	 */
	tables: Tables;

	/** Per-entity lifecycle hooks, keyed by entity name. */
	hooks?: { [K in keyof Tables]?: DatabaseRouteHooks<Tables[K]> };

	/**
	 * Require an authenticated session (`event.locals.session`) for
	 * create/update/delete on all `tables`. Defaults to `true`. Read
	 * operations are unaffected — wire auth there via `hooks[entity].beforeGet`
	 * or `beforeList`.
	 */
	requireAuth?: boolean;

	/**
	 * The sync endpoint for client-side search index synchronization —
	 * enabled by default at `POST /api/sync` (the client's local search
	 * index depends on it). Pass `false` to disable, or an object to
	 * customize the path and/or add a `beforeSync` hook (e.g. for per-user
	 * authorization). Requires the database RPC to implement `sync()`.
	 *
	 * SECURITY: the sync endpoint returns the sparse (searchable) fields of
	 * ALL entities — row-level restrictions applied in `beforeList` hooks do
	 * NOT apply to it. When `requireAuth` is true (the default) it requires a
	 * session; for entities with per-user visibility use `beforeSync` or opt
	 * them out of syncing with `search_mode: 'server'` on the client.
	 */
	sync?:
		| boolean
		| {
				path?: string;
				/** Called before serving a sync request. Throw to reject. */
				beforeSync?: (event: RequestEvent) => void | Promise<void>;
		  };
}

/**
 * Minimal interface for the database server RPC.
 * Compatible with `DurableObjectStub<DatabaseServer<Config>>`.
 */
interface DatabaseRpc {
	create(entity_type: string, data: unknown): unknown;
	get(entity_type: string, id: string | number): unknown;
	list(entity_type: string, query: unknown): unknown;
	update(entity_type: string, id: string | number, data: unknown): unknown;
	delete(entity_type: string, id: string | number): void;
	sync?(query?: unknown): unknown;
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function errorResponse(error: unknown): Response {
	return DelightError.from(error).toResponse();
}

// ---------------------------------------------------------------------------
// Route matching
// ---------------------------------------------------------------------------

type MatchedRoute = {
	config: DatabaseRouteConfig;
	/** The entity ID extracted from the URL (undefined for collection routes) */
	id: string | undefined;
};

function matchRoute(
	pathname: string,
	routes: DatabaseRouteConfig[],
): MatchedRoute | undefined {
	for (const config of routes) {
		const route = config.route.endsWith('/') ? config.route.slice(0, -1) : config.route;

		// Exact match → collection route (list/create)
		if (pathname === route || pathname === route + '/') {
			return { config, id: undefined };
		}

		// Route prefix + /id → entity route (get/update/delete)
		if (pathname.startsWith(route + '/')) {
			const rest = pathname.slice(route.length + 1);
			// Only match single-segment IDs (no nested sub-paths)
			if (rest && !rest.includes('/')) {
				try {
					return { config, id: decodeURIComponent(rest) };
				} catch {
					// Malformed percent-encoding — not a route we can serve
					return undefined;
				}
			}
		}
	}

	return undefined;
}

// ---------------------------------------------------------------------------
// Hook composition helpers
// ---------------------------------------------------------------------------

/** Wraps before{Create,Update,Delete} hooks to reject requests without a session. */
function withAuthGuards(
	hooks: DatabaseRouteHooks<Database.Table>,
): DatabaseRouteHooks<Database.Table> {
	const requireSession = (event: RequestEvent) => {
		if (!(event.locals as { session?: unknown }).session) {
			throw new DelightError({
				message: 'Unauthorized',
				status: 401,
				code: 'unauthorized',
			});
		}
	};
	return {
		...hooks,
		beforeCreate: async (ctx) => {
			requireSession(ctx.event);
			return hooks.beforeCreate?.(ctx);
		},
		beforeUpdate: async (ctx) => {
			requireSession(ctx.event);
			return hooks.beforeUpdate?.(ctx);
		},
		beforeDelete: async (ctx) => {
			requireSession(ctx.event);
			return hooks.beforeDelete?.(ctx);
		},
	};
}

// ---------------------------------------------------------------------------
// Operation handlers
// ---------------------------------------------------------------------------

async function handleList(
	db: DatabaseRpc,
	route: DatabaseRouteConfig,
	event: RequestEvent,
): Promise<Response> {
	// decodeSearchQuery is the symmetric counterpart of the client's
	// encodeSearchQuery — it JSON/number-parses structured search params instead
	// of passing raw strings through
	let query = decodeSearchQuery(event.url.searchParams) as Record<string, unknown>;

	if (route.hooks?.beforeList) {
		const result = await route.hooks.beforeList({ query, event });
		if (result && typeof result === 'object') {
			query = result;
		}
	}

	const data = await db.list(route.entity, query);
	return jsonResponse(data);
}

async function handleCreate(
	db: DatabaseRpc,
	route: DatabaseRouteConfig,
	event: RequestEvent,
): Promise<Response> {
	const raw_body = await event.request.json().catch(() => undefined);
	if (!raw_body || typeof raw_body !== 'object') {
		throw DelightError.badRequest('Request body must be a JSON object');
	}

	// Parse through the table's schema for an early 400 without an RPC round trip
	let data: Record<string, unknown>;
	try {
		// The primary key may have a custom name (e.g. `slug`) — use the
		// configured name for both the temp value and the strip below
		const primary_key = route.table.config.primary_key || 'id';
		const parsed = route.table.parse({
			...raw_body,
			// Provide temp values for auto-managed fields so parse() succeeds
			[primary_key]: route.table.config.primary_key_type === 'string' ? '_temp_' : 0,
			created_at: Date.now(),
			updated_at: Date.now(),
		});
		// Strip auto-managed fields — the DB will set them
		const {
			[primary_key]: _id,
			created_at: _ca,
			updated_at: _ua,
			...rest
		} = parsed as Record<string, unknown>;
		data = rest;
	} catch (error) {
		throw DelightError.from(error);
	}

	if (route.hooks?.beforeCreate) {
		const result = await route.hooks.beforeCreate({
			data: data as EntityInput<Database.Table>,
			event,
		});
		if (result && typeof result === 'object') {
			data = result as Record<string, unknown>;
		}
	}

	const created = await db.create(route.entity, data);

	if (route.hooks?.afterCreate) {
		await route.hooks.afterCreate({
			data: created as Database.Entity<Database.Table>,
			event,
		});
	}

	return jsonResponse(created);
}

async function handleGet(
	db: DatabaseRpc,
	route: DatabaseRouteConfig,
	id: string,
	event: RequestEvent,
): Promise<Response> {
	if (route.hooks?.beforeGet) {
		await route.hooks.beforeGet({ id, event });
	}

	const data = await db.get(route.entity, id);
	return jsonResponse(data);
}

async function handleUpdate(
	db: DatabaseRpc,
	route: DatabaseRouteConfig,
	id: string,
	event: RequestEvent,
): Promise<Response> {
	let data = (await event.request.json().catch(() => undefined)) as
		| Record<string, unknown>
		| undefined;
	if (!data || typeof data !== 'object') {
		throw DelightError.badRequest('Request body must be a JSON object');
	}

	// The existing entity is only needed by the hook (commonly for ownership
	// checks) — without one, fetching it would be a wasted RPC round trip:
	// db.update() re-reads the current row itself and 404s when it's missing.
	if (route.hooks?.beforeUpdate) {
		const existing = await db.get(route.entity, id);
		const result = await route.hooks.beforeUpdate({
			id,
			data,
			existing: existing as Database.Entity<Database.Table>,
			event,
		});
		if (result && typeof result === 'object') {
			data = result;
		}
	}

	const updated = await db.update(route.entity, id, data);

	if (route.hooks?.afterUpdate) {
		await route.hooks.afterUpdate({
			data: updated as Database.Entity<Database.Table>,
			event,
		});
	}

	return jsonResponse(updated);
}

async function handleDelete(
	db: DatabaseRpc,
	route: DatabaseRouteConfig,
	id: string,
	event: RequestEvent,
): Promise<Response> {
	// The existing entity is only needed by the hook (commonly for ownership
	// checks) — without one, fetching it would be a wasted RPC round trip:
	// db.delete() checks existence itself and 404s when it's missing.
	if (route.hooks?.beforeDelete) {
		const existing = await db.get(route.entity, id);
		await route.hooks.beforeDelete({
			id,
			existing: existing as Database.Entity<Database.Table>,
			event,
		});
	}

	await db.delete(route.entity, id);

	if (route.hooks?.afterDelete) {
		await route.hooks.afterDelete({ id, event });
	}

	return new Response(null, { status: 204 });
}

// ---------------------------------------------------------------------------
// Sync handler
// ---------------------------------------------------------------------------

async function handleSync(db: DatabaseRpc, event: RequestEvent): Promise<Response> {
	if (!db.sync) {
		throw new DelightError({
			message: 'Sync not supported by this database',
			status: 501,
		});
	}

	let query: Record<string, unknown> = {};
	const body = await event.request.json().catch(() => undefined);
	if (body && typeof body === 'object') {
		query = body as Record<string, unknown>;
	}

	const data = await db.sync(query);
	return jsonResponse(data);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Creates a SvelteKit Handle that intercepts requests matching the configured
 * entity routes and performs CRUD operations with lifecycle hooks.
 *
 * Pass your `tables` map and optional per-entity `hooks`. CRUD routes at
 * `/api/${entity}` are generated automatically. `requireAuth: true` (the
 * default) rejects create/update/delete without a session.
 *
 * ```ts
 * const databaseHandle = createDatabaseHandle({
 *   getDatabase: (event) => event.locals.db,
 *   tables,
 *   hooks: {
 *     post: {
 *       beforeCreate: ({ data, event }) => ({ ...data, author_id: event.locals.user!.id }),
 *     },
 *   },
 *   sync: true,
 * });
 * ```
 */
export function createDatabaseHandle<
	Tables extends Record<string, Database.Table> = Record<string, Database.Table>,
>(options: DatabaseHandleOptions<Tables>): Handle {
	const require_auth = options.requireAuth ?? true;

	// Generate routes from the tables map, merging per-entity hooks.
	const routes: DatabaseRouteConfig[] = Object.entries(options.tables).map(
		([entity, table]) => {
			const user_hooks =
				(options.hooks?.[entity as keyof Tables] as
					| DatabaseRouteHooks<Database.Table>
					| undefined) ?? {};
			const hooks: DatabaseRouteHooks<Database.Table> = require_auth
				? { ...withAuthGuards(user_hooks) }
				: user_hooks;
			return {
				route: `/api/${entity}`,
				entity,
				table: table as Database.Table,
				hooks,
			};
		},
	);

	// Resolve sync path + hook. Sync defaults ON — the client's local search
	// index depends on it, and a missing endpoint fails silently. Pass
	// `sync: false` to opt out.
	const sync = options.sync ?? true;
	const sync_path = sync
		? typeof sync === 'object'
			? (sync.path ?? '/api/sync')
			: '/api/sync'
		: null;
	const before_sync = typeof sync === 'object' ? sync.beforeSync : undefined;

	return async ({ event, resolve }) => {
		const pathname = event.url.pathname;
		const method = event.request.method;

		// Handle sync route
		if (sync_path && pathname === sync_path && method === 'POST') {
			const db = options.getDatabase(event);
			if (!db) {
				return errorResponse(new DelightError('Database not available'));
			}
			try {
				// The sync endpoint exposes the sparse search data of every entity —
				// it must not be publicly dumpable by default
				if (require_auth && !(event.locals as { session?: unknown }).session) {
					throw new DelightError({
						message: 'Unauthorized',
						status: 401,
						code: 'unauthorized',
					});
				}
				if (before_sync) await before_sync(event);
				return await handleSync(db, event);
			} catch (error) {
				return errorResponse(error);
			}
		}

		const match = matchRoute(pathname, routes);
		if (!match) {
			return resolve(event);
		}

		const { config: route, id } = match;

		// Get the database instance
		const db = options.getDatabase(event);
		if (!db) {
			return errorResponse(new DelightError('Database not available'));
		}

		try {
			// Collection routes (no ID): GET = list, POST = create
			if (id === undefined) {
				if (method === 'GET') return await handleList(db, route, event);
				if (method === 'POST') return await handleCreate(db, route, event);
				return jsonResponse({ message: 'Method not allowed', status: 405 }, 405);
			}

			// Entity routes (with ID): GET = get, PATCH = update, DELETE = delete
			if (method === 'GET') return await handleGet(db, route, id, event);
			if (method === 'PATCH') return await handleUpdate(db, route, id, event);
			if (method === 'DELETE') return await handleDelete(db, route, id, event);

			return jsonResponse({ message: 'Method not allowed', status: 405 }, 405);
		} catch (error) {
			return errorResponse(error);
		}
	};
}
