import { DelightError } from './error.helper';

// ---------------------------------------------------------------------------
// Client-side: SvelteKit dev handle
// ---------------------------------------------------------------------------

interface DevHandleOptions {
	/** URL of the wrangler dev server @default 'http://localhost:8787' */
	url?: string;
	/** DO binding names to proxy @default ['AUTH', 'DB', 'WS', 'RATE_LIMITER'] */
	bindings?: string[];
}

/**
 * SvelteKit handle that patches `event.platform.env` with dev proxy namespaces
 * for Durable Object bindings that aren't available via `getPlatformProxy()`.
 *
 * Place this **first** in your `sequence()` so downstream handles see the proxied bindings.
 *
 * @example
 * ```ts
 * import { createDevHandle } from '@delightstack/utilities';
 * import { dev } from '$app/environment';
 *
 * export const handle = sequence(
 *   ...(dev ? [createDevHandle()] : []),
 *   authHandle,
 *   appHandle,
 * );
 * ```
 */
export function createDevHandle(options?: DevHandleOptions) {
	const url = options?.url ?? 'http://localhost:8787';
	const binding_names = options?.bindings ?? ['AUTH', 'DB', 'WS', 'RATE_LIMITER'];

	return async ({
		event,
		resolve,
	}: {
		event: { platform?: Record<string, unknown> };
		resolve: (event: unknown) => Promise<Response>;
	}) => {
		// Ensure event.platform exists
		if (!event.platform) {
			(event as Record<string, unknown>).platform = {
				env: {},
				cf: {},
				ctx: { waitUntil: () => {}, passThroughOnException: () => {} },
			};
		}
		const platform = event.platform as Record<string, unknown>;
		if (!platform.env) platform.env = {};
		const env = platform.env as Record<string, unknown>;

		// Patch missing DO bindings with proxy namespaces
		for (const name of binding_names) {
			if (!env[name]) {
				env[name] = createProxyNamespace(url, name);
			}
		}

		return resolve(event);
	};
}

// ---------------------------------------------------------------------------
// Server-side: Worker fetch handler
// ---------------------------------------------------------------------------

/**
 * Default fetch handler for the server worker that bridges HTTP requests
 * from the dev proxy to real Durable Object instances.
 *
 * @example
 * ```ts
 * import { createDevRpcHandler } from '@delightstack/utilities';
 *
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     return createDevRpcHandler(request, { AUTH: env.AUTH, DB: env.DB });
 *   }
 * };
 * ```
 */
export async function createDevRpcHandler(
	request: Request,
	env: Record<string, { idFromName(n: string): unknown; idFromString(s: string): unknown; get(id: unknown): unknown }>,
): Promise<Response> {
	const url = new URL(request.url);

	if (url.pathname.startsWith('/__rpc/') && request.method === 'POST') {
		const segments = url.pathname.slice('/__rpc/'.length).split('/');
		const [binding, id_type, id] = segments;
		return routeToStub(env, binding, id_type, id, request);
	}

	return new Response('Not found', { status: 404 });
}

async function routeToStub(
	env: Record<string, { idFromName(n: string): unknown; idFromString(s: string): unknown; get(id: unknown): unknown }>,
	binding: string,
	id_type: string,
	id: string,
	request: Request,
): Promise<Response> {
	const namespace = env[binding];
	if (!namespace) {
		return new Response(JSON.stringify({ message: `Binding "${binding}" not found`, status: 404 }), {
			status: 404,
			headers: { 'content-type': 'application/json' },
		});
	}

	const do_id = id_type === 'string' ? namespace.idFromString(id) : namespace.idFromName(id);
	const stub = namespace.get(do_id) as { fetch(input: string | Request, init?: RequestInit): Promise<Response> };

	// Forward the RPC body to the DO's /rpc fetch handler
	return stub.fetch('http://do/rpc', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: request.body,
	});
}

// ---------------------------------------------------------------------------
// Proxy internals
// ---------------------------------------------------------------------------

function createProxyNamespace(base_url: string, binding: string) {
	return {
		idFromName(name: string) {
			return { __name: name, __type: 'name' };
		},
		idFromString(id: string) {
			return { __name: id, __type: 'string' };
		},
		get(id: { __name: string; __type: string }) {
			return createStubProxy(base_url, binding, id.__name, id.__type);
		},
	};
}

function createStubProxy(base_url: string, binding: string, id_name: string, id_type: string): unknown {
	const rpc_url = `${base_url}/__rpc/${binding}/${id_type}/${encodeURIComponent(id_name)}`;

	function buildProxy(path: string[] = []): unknown {
		const handler: ProxyHandler<CallableFunction> = {
			apply: async (_target, _this_arg, args) => {
				const method = path.join('.');
				try {
					const res = await fetch(rpc_url, {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ method, args }),
					});
					if (!res.ok) {
						const body = await res.json().catch(() => ({
							message: `RPC call ${binding}.${method} failed (${res.status})`,
							status: res.status,
						}));
						throw new DelightError(body as { message: string; status?: number; code?: string; detail?: string });
					}
					const text = await res.text();
					return text ? JSON.parse(text) : undefined;
				} catch (error) {
					if (DelightError.is(error)) throw error;
					// Connection refused — wrangler dev probably not ready yet
					const msg = (error as Error)?.message ?? String(error);
					if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
						console.warn(
							`[dev-proxy] Could not reach worker at ${base_url} — is "pnpm dev:worker" running?`,
						);
					}
					throw new DelightError({
						message: `Dev proxy error: ${msg}`,
						status: 503,
					});
				}
			},
			get: (_target, prop) => {
				if (prop === 'then') return undefined; // not thenable
				if (typeof prop === 'symbol') return undefined;
				return buildProxy([...path, prop as string]);
			},
		};
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		return new Proxy(function () {}, handler);
	}

	return buildProxy();
}
