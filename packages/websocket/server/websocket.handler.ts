import type { Handle, RequestEvent } from '@sveltejs/kit';

// ---------------------------------------------------------------------------
// Minimal auth locals shape (avoids hard dependency on @delightstack/auth)
// ---------------------------------------------------------------------------

/** Subset of AuthLocals that the websocket handle needs */
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
	 * The handle passes verified user metadata to the DO via internal headers.
	 * Return undefined if no WebSocket is available (e.g. no org selected).
	 *
	 * @example
	 * ```ts
	 * getWebsocket: (event) => {
	 *   const locals = event.locals as AuthLocals & App.Locals;
	 *   if (!locals.org_id) return undefined;
	 *   const platform = event.platform as App.Platform;
	 *   return platform.env.WS.get(platform.env.WS.idFromName(locals.org_id));
	 * }
	 * ```
	 */
	getWebsocket: (event: RequestEvent) => { fetch: typeof fetch } | undefined;
}

// ---------------------------------------------------------------------------
// Handle
// ---------------------------------------------------------------------------

/**
 * Creates a SvelteKit Handle that intercepts WebSocket upgrade requests
 * and forwards them to the org-scoped WebSocket Durable Object.
 *
 * Must be sequenced AFTER `authHandle` so `event.locals` has session/org data.
 *
 * @example
 * ```ts
 * import { createWebsocketHandle } from '@delightstack/websocket/server';
 *
 * const websocketHandle = createWebsocketHandle({
 *   getWebsocket: (event) => {
 *     const locals = event.locals as AuthLocals & App.Locals;
 *     if (!locals.org_id) return undefined;
 *     const platform = event.platform as App.Platform;
 *     return platform.env.WS.get(platform.env.WS.idFromName(locals.org_id));
 *   },
 * });
 *
 * export const handle = sequence(authHandle, appHandle, websocketHandle, databaseHandle);
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

		const locals = event.locals as WebsocketAuthLocals;

		// Auth gate: must be authenticated with an active org
		if (!locals.session || !locals.user || !locals.org_id || !locals.org) {
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

		// Forward the upgrade request to the DO with session metadata in headers.
		// The DO trusts these headers because it is only reachable via the CF binding.
		const forward_headers = new Headers(event.request.headers);
		forward_headers.set('X-WS-User-ID', locals.user.id);
		forward_headers.set('X-WS-User-Auth-ID', locals.user.user_auth_id);
		forward_headers.set('X-WS-User-Session-ID', locals.user.user_session_id);
		forward_headers.set('X-WS-User-Name', encodeURIComponent(locals.user.name));
		forward_headers.set('X-WS-Org-ID', locals.org_id);
		forward_headers.set('X-WS-Permission', String(locals.org.permissions));

		return ws_stub.fetch(event.request.url, {
			headers: forward_headers,
			method: event.request.method,
		});
	};
}
