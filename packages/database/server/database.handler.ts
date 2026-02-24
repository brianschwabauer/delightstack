import type { Handle, RequestEvent } from '@sveltejs/kit';
import type { Database } from '../schema/schema';
import { ApiError } from '@delightstack/utilities';

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

/** Extract the entity type from a Database.Table */
type EntityOf<T extends Database.Table> = ReturnType<T['parse']>;

/** Entity input (without auto-managed fields) */
type EntityInput<T extends Database.Table> = Omit<
	EntityOf<T>,
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
	existing: EntityOf<T>;
	/** The SvelteKit request event */
	event: RequestEvent;
}

/** Context passed to `beforeDelete` hooks */
export interface BeforeDeleteContext<T extends Database.Table> {
	/** The entity ID from the URL */
	id: string;
	/** The existing entity fetched from the database */
	existing: EntityOf<T>;
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
	data: EntityOf<T>;
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
	) =>
		| void
		| Record<string, unknown>
		| Promise<void | Record<string, unknown>>;

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
	) =>
		| void
		| Record<string, unknown>
		| Promise<void | Record<string, unknown>>;

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
export interface DatabaseRouteConfig {
	/** The base route path (e.g. `/api/person`) */
	route: string;
	/** The entity type name matching the key in your DatabaseConfig (e.g. `'person'`) */
	entity: string;
	/** The table definition created by `Database.table()` */
	table: Database.Table;
	/** Optional lifecycle hooks */
	hooks?: DatabaseRouteHooks<Database.Table>;
}

/**
 * Defines a typed database entity route. The generic parameter flows into hook
 * context types, giving you autocomplete on `data` and `existing`.
 *
 * @example
 * ```ts
 * const personRoute = defineRoute({
 *   entity: 'person', // route defaults to '/api/person'
 *   table: personTable,
 *   hooks: {
 *     beforeCreate: ({ data, event }) => {
 *       if (!event.locals.user) throw apiError({ status: 401 });
 *     },
 *     beforeUpdate: ({ existing, event }) => {
 *       if (existing.creator_id !== event.locals.user?.id) {
 *         throw apiError({ status: 403 });
 *       }
 *     },
 *   },
 * });
 * ```
 */
export function defineRoute<T extends Database.Table>(options: {
	/** The base route path (e.g. `/api/person`). Defaults to `/api/${entity}`. */
	route?: string;
	entity: string;
	table: T;
	hooks?: DatabaseRouteHooks<T>;
}): DatabaseRouteConfig {
	return {
		...options,
		route: options.route || `/api/${options.entity}`,
	} as DatabaseRouteConfig;
}

// ---------------------------------------------------------------------------
// Handle options
// ---------------------------------------------------------------------------

/** Options for `createDatabaseHandle()` */
export interface DatabaseHandleOptions {
	/**
	 * Returns the database server instance for the current request.
	 * Return `undefined` if no database is available (e.g. no org selected).
	 */
	getDatabase: (event: RequestEvent) => DatabaseRpc | undefined;

	/** The list of entity routes to handle */
	routes: DatabaseRouteConfig[];

	/**
	 * Enable the sync endpoint for client-side search index synchronization.
	 * Set to `true` to expose `POST /api/sync`, or pass `{ path: '/custom/sync' }`.
	 * Requires the database RPC to implement `sync()`.
	 */
	sync?: boolean | { path: string };
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
// Query decoder
// ---------------------------------------------------------------------------

/** Decodes URL search params into a search query object for `db.list()` */
function decodeListQuery(search_params: URLSearchParams): Record<string, unknown> {
	const query: Record<string, unknown> = {};

	const limit = search_params.get('limit');
	if (limit) query.limit = parseInt(limit, 10) || undefined;

	const offset = search_params.get('offset');
	if (offset) query.offset = parseInt(offset, 10) || undefined;

	const cursor = search_params.get('cursor');
	if (cursor) query.cursor = cursor;

	const term = search_params.get('term') || search_params.get('q');
	if (term) query.term = term;

	const sparse = search_params.get('sparse');
	if (sparse === 'false') query.sparse = false;
	else if (sparse === 'true') query.sparse = true;

	const order = search_params.get('order');
	if (order) {
		query.order = order.split(',').map((segment) => {
			const [key, direction] = segment.split(':');
			return { key, direction: direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC' };
		});
	}

	const where = search_params.get('where');
	if (where) {
		try {
			query.where = JSON.parse(where);
		} catch {
			// ignore invalid JSON
		}
	}

	// Pass through any additional params that may be Orama-specific
	const known_keys = new Set([
		'limit', 'offset', 'cursor', 'term', 'q', 'sparse', 'order', 'where',
	]);
	for (const [key, value] of search_params.entries()) {
		if (!known_keys.has(key) && !(key in query)) {
			query[key] = value;
		}
	}

	return query;
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
	const api_error = ApiError.from(error);
	return new Response(api_error.toJSON(), {
		status: api_error.status || 500,
		headers: { 'Content-Type': 'application/json' },
	});
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
				return { config, id: decodeURIComponent(rest) };
			}
		}
	}

	return undefined;
}

// ---------------------------------------------------------------------------
// Operation handlers
// ---------------------------------------------------------------------------

async function handleList(
	db: DatabaseRpc,
	route: DatabaseRouteConfig,
	event: RequestEvent,
): Promise<Response> {
	let query = decodeListQuery(event.url.searchParams);

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
		throw new ApiError('Request body must be a JSON object', 400);
	}

	// Parse through the table's Zod schema for validation
	let data: Record<string, unknown>;
	try {
		const parsed = route.table.parse({
			...raw_body,
			// Provide temp values for auto-managed fields so parse() succeeds
			id: route.table.config.primary_key_type === 'string' ? '_temp_' : 0,
			created_at: Date.now(),
			updated_at: Date.now(),
		});
		// Strip auto-managed fields — the DB will set them
		const { id: _id, created_at: _ca, updated_at: _ua, ...rest } = parsed as Record<string, unknown>;
		data = rest;
	} catch (error) {
		throw ApiError.from(error);
	}

	if (route.hooks?.beforeCreate) {
		const result = await route.hooks.beforeCreate({ data: data as EntityInput<Database.Table>, event });
		if (result && typeof result === 'object') {
			data = result as Record<string, unknown>;
		}
	}

	const created = await db.create(route.entity, data);

	if (route.hooks?.afterCreate) {
		await route.hooks.afterCreate({ data: created as EntityOf<Database.Table>, event });
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
		throw new ApiError('Request body must be a JSON object', 400);
	}

	// Fetch existing entity for the hook (commonly needed for ownership checks)
	const existing = await db.get(route.entity, id);

	if (route.hooks?.beforeUpdate) {
		const result = await route.hooks.beforeUpdate({
			id,
			data,
			existing: existing as EntityOf<Database.Table>,
			event,
		});
		if (result && typeof result === 'object') {
			data = result;
		}
	}

	const updated = await db.update(route.entity, id, data);

	if (route.hooks?.afterUpdate) {
		await route.hooks.afterUpdate({ data: updated as EntityOf<Database.Table>, event });
	}

	return jsonResponse(updated);
}

async function handleDelete(
	db: DatabaseRpc,
	route: DatabaseRouteConfig,
	id: string,
	event: RequestEvent,
): Promise<Response> {
	// Fetch existing entity for the hook (commonly needed for ownership checks)
	const existing = await db.get(route.entity, id);

	if (route.hooks?.beforeDelete) {
		await route.hooks.beforeDelete({
			id,
			existing: existing as EntityOf<Database.Table>,
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

async function handleSync(
	db: DatabaseRpc,
	event: RequestEvent,
): Promise<Response> {
	if (!db.sync) {
		throw new ApiError('Sync not supported by this database', 501);
	}

	// Support both POST body and URL search params for the sync query
	let query: Record<string, unknown> = {};
	if (event.request.method === 'POST') {
		const body = await event.request.json().catch(() => undefined);
		if (body && typeof body === 'object') {
			query = body as Record<string, unknown>;
		}
	}

	// Also merge URL params (start, end, limit)
	const start = event.url.searchParams.get('start');
	if (start) query.start_updated_at = query.start_updated_at ?? parseInt(start, 10);

	const end = event.url.searchParams.get('end');
	if (end) query.end_updated_at = query.end_updated_at ?? parseInt(end, 10);

	const limit = event.url.searchParams.get('limit');
	if (limit) query.limit = query.limit ?? parseInt(limit, 10);

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
 * @example
 * ```ts
 * // hooks.server.ts
 * import { createDatabaseHandle, defineRoute } from '@delightstack/database';
 *
 * const personRoute = defineRoute({
 *   entity: 'person', // route defaults to '/api/person'
 *   table: personTable,
 *   hooks: {
 *     beforeCreate: ({ event }) => {
 *       if (!event.locals.user) throw apiError({ status: 401 });
 *     },
 *   },
 * });
 *
 * const databaseHandle = createDatabaseHandle({
 *   getDatabase: (event) => event.locals.db,
 *   routes: [personRoute],
 *   sync: true,
 * });
 *
 * export const handle = sequence(authHandle, appHandle, databaseHandle);
 * ```
 */
export function createDatabaseHandle(options: DatabaseHandleOptions): Handle {
	// Normalize routes (strip trailing slashes) and sort longest-first for correct matching
	const routes = options.routes
		.map((r) => ({
			...r,
			route: r.route.endsWith('/') ? r.route.slice(0, -1) : r.route,
		}))
		.sort((a, b) => b.route.length - a.route.length);

	// Resolve sync path
	const sync_path = options.sync
		? typeof options.sync === 'object'
			? options.sync.path
			: '/api/sync'
		: null;

	return async ({ event, resolve }) => {
		const pathname = event.url.pathname;
		const method = event.request.method;

		// Handle sync route
		if (sync_path && pathname === sync_path && (method === 'POST' || method === 'GET')) {
			const db = options.getDatabase(event);
			if (!db) {
				return errorResponse(new ApiError('Database not available', 500));
			}
			try {
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
			return errorResponse(
				new ApiError('Database not available', 500),
			);
		}

		try {
			// Collection routes (no ID): GET = list, POST = create
			if (id === undefined) {
				if (method === 'GET') return await handleList(db, route, event);
				if (method === 'POST') return await handleCreate(db, route, event);
				return jsonResponse(
					{ message: 'Method not allowed', status: 405 },
					405,
				);
			}

			// Entity routes (with ID): GET = get, PATCH = update, DELETE = delete
			if (method === 'GET') return await handleGet(db, route, id, event);
			if (method === 'PATCH') return await handleUpdate(db, route, id, event);
			if (method === 'DELETE') return await handleDelete(db, route, id, event);

			return jsonResponse(
				{ message: 'Method not allowed', status: 405 },
				405,
			);
		} catch (error) {
			return errorResponse(error);
		}
	};
}
