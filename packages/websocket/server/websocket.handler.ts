import type { Handle, RequestEvent } from '@sveltejs/kit';
import type { WebsocketSessionMeta } from '../types';

// ---------------------------------------------------------------------------
// Minimal auth locals shape (used by default authorize behavior)
// ---------------------------------------------------------------------------

/** Subset of AuthLocals that the default authorize behavior needs */
interface WebsocketAuthLocals {
	session: unknown;
	user: {
		id: string;
		name: string;
		user_auth_id: string;
		user_session_id: string;
	} | null;
	org_id: string | null;
	org: {
		permissions: number;
	} | null;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Options for `createWebsocketHandle()` */
export interface WebsocketHandleOptions {
	/**
	 * The URL path to intercept for WebSocket upgrades.
	 * @default '/api/websocket'
	 */
	path?: string;

	/**
	 * Returns the WebSocket Durable Object stub for the given request.
	 * The handle passes session metadata to the DO via internal headers.
	 * Return undefined if no WebSocket is available.
	 *
	 * @example
	 * ```ts
	 * // With @delightstack/auth (org-scoped):
	 * getWebsocket: (event) => {
	 *   const locals = event.locals as AuthLocals & App.Locals;
	 *   if (!locals.org_id) return undefined;
	 *   const platform = event.platform as App.Platform;
	 *   return platform.env.WS.get(platform.env.WS.idFromName(locals.org_id));
	 * }
	 *
	 * // Standalone (custom room):
	 * getWebsocket: (event) => {
	 *   const room = event.url.searchParams.get('room');
	 *   if (!room) return undefined;
	 *   const platform = event.platform as App.Platform;
	 *   return platform.env.WS.get(platform.env.WS.idFromName(room));
	 * }
	 * ```
	 */
	getWebsocket: (event: RequestEvent) => { fetch: typeof fetch } | undefined;

	/**
	 * Custom authorization callback. Return session metadata to allow the
	 * connection, or undefined to reject with 401.
	 *
	 * When omitted, the default behavior checks `@delightstack/auth` locals
	 * (`locals.session`, `locals.user`, `locals.org_id`, `locals.org`).
	 *
	 * @example
	 * ```ts
	 * authorize: (event) => {
	 *   const token = event.url.searchParams.get('token');
	 *   const user = verifyToken(token);
	 *   if (!user) return undefined;
	 *   return { user_id: user.id, user_name: user.name };
	 * }
	 * ```
	 */
	authorize?: (
		event: RequestEvent,
	) => Omit<WebsocketSessionMeta, 'ws_session_id'> | undefined | Promise<Omit<WebsocketSessionMeta, 'ws_session_id'> | undefined>;
}

// ---------------------------------------------------------------------------
// Handle
// ---------------------------------------------------------------------------

/**
 * Creates a SvelteKit Handle that intercepts WebSocket upgrade requests
 * and forwards them to a WebSocket Durable Object.
 *
 * By default, uses `@delightstack/auth` locals for authorization. Provide
 * a custom `authorize` callback to use your own auth logic.
 *
 * @example
 * ```ts
 * // With @delightstack/auth (default):
 * const websocketHandle = createWebsocketHandle({
 *   getWebsocket: (event) => {
 *     const locals = event.locals as AuthLocals & App.Locals;
 *     if (!locals.org_id) return undefined;
 *     const platform = event.platform as App.Platform;
 *     return platform.env.WS.get(platform.env.WS.idFromName(locals.org_id));
 *   },
 * });
 *
 * // Standalone with custom auth:
 * const websocketHandle = createWebsocketHandle({
 *   authorize: (event) => {
 *     const user = verifyMyAuth(event);
 *     if (!user) return undefined;
 *     return { user_id: user.id, user_name: user.name };
 *   },
 *   getWebsocket: (event) => {
 *     const platform = event.platform as App.Platform;
 *     const room = event.url.searchParams.get('room') ?? 'default';
 *     return platform.env.WS.get(platform.env.WS.idFromName(room));
 *   },
 * });
 * ```
 */
export function createWebsocketHandle(options: WebsocketHandleOptions): Handle {
	const path = options.path ?? '/api/websocket';

	return async ({ event, resolve }) => {
		// Only intercept upgrade requests to the configured path
		if (
			event.url.pathname !== path ||
			event.request.headers.get('Upgrade') !== 'websocket'
		) {
			return resolve(event);
		}

		// Authorize the connection
		const session_meta = options.authorize
			? await options.authorize(event)
			: defaultAuthorize(event);

		if (!session_meta) {
			return new Response(
				JSON.stringify({ status: 401, message: 'Unauthorized' }),
				{ status: 401, headers: { 'Content-Type': 'application/json' } },
			);
		}

		const ws_stub = options.getWebsocket(event);
		if (!ws_stub) {
			return new Response(
				JSON.stringify({ status: 503, message: 'WebSocket not available' }),
				{ status: 503, headers: { 'Content-Type': 'application/json' } },
			);
		}

		// Forward the upgrade request to the DO with session metadata in a header.
		// The DO trusts this header because it is only reachable via the CF binding.
		const forward_headers = new Headers(event.request.headers);
		forward_headers.set('X-WS-Meta', JSON.stringify(session_meta));

		return ws_stub.fetch(event.request.url, {
			headers: forward_headers,
			method: event.request.method,
		});
	};
}

// ---------------------------------------------------------------------------
// Default authorize (uses @delightstack/auth locals)
// ---------------------------------------------------------------------------

function defaultAuthorize(event: RequestEvent): Omit<WebsocketSessionMeta, 'ws_session_id'> | undefined {
	const locals = event.locals as WebsocketAuthLocals;

	if (!locals.session || !locals.user || !locals.org_id || !locals.org) {
		return undefined;
	}

	return {
		user_id: locals.user.id,
		user_name: locals.user.name,
		user_auth_id: locals.user.user_auth_id,
		user_session_id: locals.user.user_session_id,
		room: locals.org_id,
		permission: locals.org.permissions,
	};
}
