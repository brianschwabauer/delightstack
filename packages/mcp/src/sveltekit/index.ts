import type { Handle } from '@sveltejs/kit';
import { createMcpServer, type McpServer, type McpServerOptions } from '../server.js';
import type { OauthProvider } from '../oauth.js';

/**
 * The SvelteKit binding.
 *
 * Kept in its own entry point because it is the only file in the package that
 * imports `@sveltejs/kit`, and the package is meant to be usable from a bare
 * Durable Object `fetch` with no framework installed at all.
 */

export interface McpHandleOptions<Locals = unknown> extends McpServerOptions<Locals> {
	/** The MCP endpoint. @default '/mcp' */
	path?: string;
	/**
	 * The OAuth provider. When given, its metadata, registration, authorization
	 * and token endpoints are served by this handle too, and its `authenticate`
	 * and `challenge` fill in for the ones on {@link McpServerOptions}.
	 */
	oauth?: OauthProvider;
}

export interface McpHandle<Locals = unknown> {
	handle: Handle;
	/** The underlying server, so in-process callers reach the same registry. */
	server: McpServer<Locals>;
}

/**
 * Builds the `Handle` that owns the MCP endpoint and, optionally, the OAuth
 * endpoints in front of it.
 *
 * Returns the server alongside the handle rather than only the handle: the
 * in-app agent panel is a second client of the same tool implementations, and
 * it should not have to reach them through an HTTP request to itself.
 */
export function createMcpHandle<Locals = unknown>(
	options: McpHandleOptions<Locals>,
): McpHandle<Locals> {
	const path = options.path ?? '/mcp';
	const server = createMcpServer<Locals>({
		...options,
		authenticate: options.authenticate ?? options.oauth?.authenticate,
		challenge: options.challenge ?? options.oauth?.challenge,
	});

	const handle: Handle = async ({ event, resolve }) => {
		if (options.oauth) {
			const response = await options.oauth.fetch(event.request);
			if (response) return response;
		}
		const pathname = event.url.pathname.replace(/\/$/, '') || '/';
		if (pathname === path) return server.fetch(event.request);
		return resolve(event);
	};

	return { handle, server };
}
