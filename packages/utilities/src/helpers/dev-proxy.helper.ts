import { DelightError } from './error.helper.js';

// ---------------------------------------------------------------------------
// Client-side: SvelteKit dev handle
// ---------------------------------------------------------------------------

interface DevHandleOptions {
	/** URL of the wrangler dev server @default 'http://localhost:8787' */
	url?: string;
	/** DO binding names to proxy @default ['AUTH', 'DB', 'WS', 'RATE_LIMITER'] */
	bindings?: string[];
	/**
	 * Replace the listed bindings even when `getPlatformProxy()` already
	 * provides them. On by default. This bridge exists for DO classes that live
	 * in a SEPARATE worker (cross-script `script_name` bindings), and whenever
	 * that worker is running, wrangler's dev registry hands `getPlatformProxy()`
	 * its own stubs for them. Those stubs are broken here: older wrangler throws
	 * "Durable Object RPC is not yet supported between multiple dev sessions"
	 * on any RPC call, and newer miniflare can't deserialize a *thrown* error
	 * from an async DO method. It fails `assert(typeHeader === "Promise")`
	 * instead of rethrowing, so every DelightError (wrong password, not found,
	 * rate limited) surfaces as that assertion. With the old `false` default
	 * the bridge silently did nothing whenever the registry resolved the
	 * bindings.
	 *
	 * Set false only to keep a platform-proxy binding this bridge can't serve.
	 * @default true
	 */
	override?: boolean;
}

/**
 * SvelteKit handle that patches `event.platform.env` with dev proxy namespaces
 * that reach Durable Objects in a separate wrangler dev worker over HTTP (served
 * there by `createDevRpcHandler`). It replaces the listed bindings even when
 * `getPlatformProxy()` supplies them; see `override` for why.
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
	const override = options?.override ?? true;

	// Generic over the event so the returned function is assignable to
	// SvelteKit's `Handle` type (a concrete `resolve: (event: unknown) => …`
	// parameter would reject Kit's `resolve` under strict contravariance).
	return async <Event extends { platform?: unknown }>({
		event,
		resolve,
	}: {
		event: Event;
		resolve: (event: Event) => Promise<Response> | Response;
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

		// Patch DO bindings with proxy namespaces. With `override` (the
		// default) the dev registry's RPC-broken cross-session stubs are
		// replaced too; without it only missing bindings are filled.
		for (const name of binding_names) {
			if (override || !env[name]) {
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
	env: Record<
		string,
		{
			idFromName(n: string): unknown;
			idFromString(s: string): unknown;
			get(id: unknown): unknown;
		}
	>,
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
	env: Record<
		string,
		{
			idFromName(n: string): unknown;
			idFromString(s: string): unknown;
			get(id: unknown): unknown;
		}
	>,
	binding: string,
	id_type: string,
	id: string,
	request: Request,
): Promise<Response> {
	const namespace = env[binding];
	if (!namespace) {
		return new Response(
			JSON.stringify({ message: `Binding "${binding}" not found`, status: 404 }),
			{
				status: 404,
				headers: { 'content-type': 'application/json' },
			},
		);
	}

	const do_id =
		id_type === 'string' ? namespace.idFromString(id) : namespace.idFromName(id);
	const stub = namespace.get(do_id) as {
		fetch(input: string | Request, init?: RequestInit): Promise<Response>;
	};

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

function createStubProxy(
	base_url: string,
	binding: string,
	id_name: string,
	id_type: string,
): unknown {
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
						const text = await res.text().catch(() => '');
						let body: {
							message: string;
							status?: number;
							code?: string;
							detail?: string;
						};
						try {
							body = JSON.parse(text);
						} catch {
							// Extract a useful message from the raw error text
							const msg = text.slice(0, 200).trim() || `${res.status} ${res.statusText}`;
							body = {
								message: `${binding}.${method} failed: ${msg}`,
								status: res.status,
							};
						}
						throw new DelightError(body);
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
