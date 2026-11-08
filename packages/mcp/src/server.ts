import { DelightError } from '@delightstack/utilities';
import {
	errorToJsonRpc,
	failure,
	isJsonRpcRequest,
	isNotification,
	JSON_RPC_ERROR,
	success,
} from './jsonrpc.js';
import { generateSessionId } from './sessions.js';
import { createToolRegistry, type McpToolRegistry } from './tools.js';
import type {
	JsonRpcRequest,
	JsonRpcResponse,
	McpAuthContext,
	McpSessionStore,
	McpTool,
	McpToolContext,
} from './types.js';

/**
 * The Streamable HTTP transport, as a plain `fetch` handler.
 *
 * A `Request` in, a `Response` out, and nothing in between that knows what a
 * framework is — which is what lets the same server run behind a SvelteKit
 * `Handle`, inside a Durable Object's `fetch`, and in a test with no server at
 * all.
 *
 * ## Which revision this speaks
 *
 * `2025-06-18` and `2025-03-26`: the `initialize` handshake, `Mcp-Session-Id`,
 * an optional standalone SSE stream on GET, and DELETE to end a session. That
 * is what shipping clients speak today. Revision `2026-07-28` removes all four
 * and moves the handshake into per-request `_meta`; it is deliberately *not*
 * implemented yet, because implementing a revision no client sends means
 * shipping untested code — and the negotiation below already answers such a
 * client with the versions it can fall back to, which is exactly what the
 * revision's own backward-compatibility rules ask for.
 */

/** In descending preference. The first is what an unversioned client gets. */
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26'] as const;

/** The version assumed when a client sends no `MCP-Protocol-Version` header. */
const DEFAULT_PROTOCOL_VERSION = '2025-03-26';

export interface McpServerOptions<Locals = unknown> {
	/** The server's name, as it appears in a client's server list. */
	name: string;
	version: string;
	/**
	 * Instructions the client puts in the model's context. The place to say
	 * that document content is data rather than instruction.
	 */
	instructions?: string;
	tools: McpTool<never, Locals>[];
	/**
	 * Resolves the caller. Return `null` for an unauthenticated request; throw
	 * a `DelightError` with status 401 for a *bad* credential. Omit entirely to
	 * run the server open, which is only ever right in a test.
	 */
	authenticate?: (request: Request) => Promise<McpAuthContext | null>;
	/** Builds the `WWW-Authenticate` value for a 401/403. */
	challenge?: (options?: {
		error?: 'invalid_token' | 'insufficient_scope';
		error_description?: string;
		scope?: string | string[];
	}) => string;
	/** Where `Mcp-Session-Id` sessions live. Omit to run without sessions. */
	sessions?: McpSessionStore;
	/**
	 * Origins allowed to reach the endpoint from a browser. A request with no
	 * `Origin` (every CLI client) is always allowed; a request with one that is
	 * not on this list is refused, which is the DNS-rebinding defence the
	 * transport requires. Omit to allow same-origin only.
	 */
	allowed_origins?: string[] | ((origin: string, request: Request) => boolean);
	/**
	 * The most JSON-RPC messages one POST may carry. A batch is processed
	 * serially, so an unbounded one is an unbounded amount of work bought with a
	 * single request. @default 64
	 */
	max_batch_size?: number;
	/** Whether one scope satisfies another. Defaults to plain membership. */
	has_scope?: (granted: string[], required: string) => boolean;
	/** Builds the per-request value handed to every tool as `ctx.locals`. */
	locals?: (request: Request, auth: McpAuthContext | null) => Locals | Promise<Locals>;
	/**
	 * Called before each `tools/call`. Throw a `DelightError` with status 429 to
	 * refuse. Injected rather than built in: the only correct counter on
	 * Workers lives in a Durable Object the application owns.
	 */
	rateLimit?: (ctx: {
		tool: string;
		auth: McpAuthContext | null;
		request: Request;
	}) => void | Promise<void>;
	/** Notified of every thrown error, including ones already turned into a result. */
	onError?: (error: unknown, context: { method?: string; tool?: string }) => void;
}

export interface McpServer<Locals = unknown> {
	fetch(request: Request): Promise<Response>;
	/** The registry, exposed so an in-process agent can call the same tools. */
	tools: McpToolRegistry<Locals>;
}

function jsonRpcResponse(
	body: unknown,
	status = 200,
	headers?: Record<string, string>,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'no-store',
			...headers,
		},
	});
}

function negotiateVersion(requested: string | null | undefined): string | undefined {
	if (!requested) return DEFAULT_PROTOCOL_VERSION;
	return SUPPORTED_PROTOCOL_VERSIONS.includes(
		requested as (typeof SUPPORTED_PROTOCOL_VERSIONS)[number],
	)
		? requested
		: undefined;
}

function originAllowed<Locals>(
	request: Request,
	options: McpServerOptions<Locals>,
): boolean {
	const origin = request.headers.get('Origin');
	// No `Origin` means no browser sent it, so there is no rebinding attack to
	// defend against — and every CLI MCP client is in that category.
	if (!origin) return true;
	const allowed = options.allowed_origins;
	if (typeof allowed === 'function') return allowed(origin, request);
	if (Array.isArray(allowed)) return allowed.includes(origin);
	try {
		return new URL(origin).origin === new URL(request.url).origin;
	} catch {
		return false;
	}
}

export function createMcpServer<Locals = unknown>(
	options: McpServerOptions<Locals>,
): McpServer<Locals> {
	const registry = createToolRegistry<Locals>(options.tools, {
		has_scope: options.has_scope,
	});

	function unauthorized(error?: DelightError): Response {
		const challenge = options.challenge?.({
			error: 'invalid_token',
			error_description: error?.message,
		});
		return new Response(
			JSON.stringify(
				failure(
					null,
					JSON_RPC_ERROR.forbidden,
					error?.message ?? 'Authorization required',
				),
			),
			{
				status: 401,
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'no-store',
					...(challenge ? { 'WWW-Authenticate': challenge } : {}),
				},
			},
		);
	}

	async function handleMessage(
		message: JsonRpcRequest,
		context: {
			auth: McpAuthContext | null;
			request: Request;
			session_id: string | undefined;
			protocol_version: string;
			locals: Locals;
		},
	): Promise<JsonRpcResponse | undefined> {
		const id = message.id ?? null;
		const notification = isNotification(message);

		try {
			switch (message.method) {
				case 'initialize': {
					const requested =
						(message.params?.protocolVersion as string | undefined) ?? null;
					// Negotiation, not rejection: an unknown version is answered with
					// the newest one we speak, and the client decides whether it can
					// live with that. Rejecting outright is what turns a version skew
					// into "the server is down".
					const negotiated =
						negotiateVersion(requested) ?? SUPPORTED_PROTOCOL_VERSIONS[0];
					return success(id, {
						protocolVersion: negotiated,
						capabilities: {
							tools: { listChanged: false },
						},
						serverInfo: { name: options.name, version: options.version },
						...(options.instructions ? { instructions: options.instructions } : {}),
					});
				}
				case 'notifications/initialized':
				case 'notifications/cancelled':
					return undefined;
				case 'ping':
					return success(id, {});
				case 'tools/list':
					return success(id, {
						tools: registry.list(context.auth ? context.auth.scopes : null),
					});
				case 'tools/call': {
					const name = message.params?.name;
					if (typeof name !== 'string') {
						return failure(id, JSON_RPC_ERROR.invalid_params, 'params.name is required');
					}
					await options.rateLimit?.({
						tool: name,
						auth: context.auth,
						request: context.request,
					});
					const ctx: McpToolContext<Locals> = {
						auth: context.auth,
						request: context.request,
						session_id: context.session_id,
						signal: context.request.signal,
						locals: context.locals,
						protocol_version: context.protocol_version,
					};
					const result = await registry.call(name, message.params?.arguments, ctx);
					return success(id, result);
				}
				default:
					if (notification) return undefined;
					return failure(
						id,
						JSON_RPC_ERROR.method_not_found,
						`Unknown method "${message.method}"`,
					);
			}
		} catch (error) {
			options.onError?.(error, {
				method: message.method,
				tool: message.params?.name as string | undefined,
			});
			if (notification) return undefined;
			return errorToJsonRpc(id, error);
		}
	}

	/**
	 * Resolves the caller, or the 401 to answer with.
	 *
	 * Hoisted out of `handlePost` because the authorization specification asks
	 * for a credential on *every* request — an unauthenticated `DELETE` would
	 * otherwise end a session it was never shown a token for, and an
	 * unauthenticated `GET` would hold a stream open for free.
	 */
	async function resolveAuth(
		request: Request,
	): Promise<{ auth: McpAuthContext | null } | Response> {
		if (!options.authenticate) return { auth: null };
		let auth: McpAuthContext | null;
		try {
			auth = await options.authenticate(request);
		} catch (error) {
			options.onError?.(error, {});
			return unauthorized(DelightError.is(error) ? error : undefined);
		}
		if (!auth) return unauthorized();
		return { auth };
	}

	/**
	 * Whether a stored session belongs to the caller presenting it.
	 *
	 * A session id is a bearer-ish string in a header, and the only thing that
	 * makes it safe to hand to a tool as `ctx.session_id` is that it cannot be
	 * lifted from one principal to another. A session opened anonymously stays
	 * anonymous; one opened under a token is answered only for that token.
	 */
	function sessionBelongsTo(
		session: { token_id?: string; subject?: string },
		auth: McpAuthContext | null,
	): boolean {
		if (session.token_id !== undefined) return session.token_id === auth?.token_id;
		if (session.subject !== undefined) return session.subject === auth?.subject;
		return auth === null || auth.token_id === undefined;
	}

	async function handlePost(request: Request): Promise<Response> {
		const protocol_version =
			negotiateVersion(request.headers.get('MCP-Protocol-Version')) ??
			SUPPORTED_PROTOCOL_VERSIONS[0];

		const resolved = await resolveAuth(request);
		if (resolved instanceof Response) return resolved;
		const auth = resolved.auth;

		let body: unknown;
		try {
			body = await request.json();
		} catch {
			return jsonRpcResponse(
				failure(null, JSON_RPC_ERROR.parse, 'Request body is not valid JSON'),
				400,
			);
		}

		// `2025-03-26` allows a batch; `2025-06-18` allows it; `2026-07-28`
		// removed it. Accepting one costs a loop, and refusing one that a live
		// client sends costs the whole session.
		const batch = Array.isArray(body);
		const raw_messages: unknown[] = batch ? (body as unknown[]) : [body];
		if (batch && raw_messages.length === 0) {
			return jsonRpcResponse(
				failure(null, JSON_RPC_ERROR.invalid_request, 'Empty batch'),
				400,
			);
		}
		const max_batch_size = options.max_batch_size ?? 64;
		if (raw_messages.length > max_batch_size) {
			// Refused whole rather than truncated: a half-run batch leaves the
			// client unable to say which half.
			return jsonRpcResponse(
				failure(
					null,
					JSON_RPC_ERROR.invalid_request,
					`A batch may carry at most ${max_batch_size} messages`,
				),
				400,
			);
		}

		// A session is opened by `initialize` and required on every later
		// request, so the header is resolved before any message runs.
		const session_header = request.headers.get('Mcp-Session-Id');
		let session_id = session_header ?? undefined;
		const initializing = raw_messages.some(
			(m) => isJsonRpcRequest(m) && m.method === 'initialize',
		);
		if (options.sessions && session_header && !initializing) {
			const session = await options.sessions.get(session_header);
			if (!session || !sessionBelongsTo(session, auth)) {
				// 404 is the transport's signal to start a new session, and the
				// client handles it by re-initializing. Anything else strands it.
				return jsonRpcResponse(
					failure(null, JSON_RPC_ERROR.invalid_request, 'Unknown or expired session'),
					404,
				);
			}
			await options.sessions.touch(session_header, Date.now());
		}

		const locals = options.locals
			? await options.locals(request, auth)
			: (undefined as Locals);

		const responses: JsonRpcResponse[] = [];
		for (const raw of raw_messages) {
			if (!isJsonRpcRequest(raw)) {
				responses.push(
					failure(null, JSON_RPC_ERROR.invalid_request, 'Not a JSON-RPC 2.0 message'),
				);
				continue;
			}
			const response = await handleMessage(raw, {
				auth,
				request,
				session_id,
				protocol_version,
				locals,
			});
			if (response) responses.push(response);
		}

		const headers: Record<string, string> = {};
		if (options.sessions && initializing) {
			const now = Date.now();
			session_id = generateSessionId();
			const info = raw_messages.find(
				(m): m is JsonRpcRequest => isJsonRpcRequest(m) && m.method === 'initialize',
			)?.params?.clientInfo as { name?: string; version?: string } | undefined;
			await options.sessions.create({
				id: session_id,
				protocol_version,
				token_id: auth?.token_id,
				subject: auth?.subject,
				org_id: auth?.org_id,
				client_name: info?.name,
				client_version: info?.version,
				created_at: now,
				last_seen_at: now,
			});
			headers['Mcp-Session-Id'] = session_id;
		}

		// Every message was a notification: the transport says 202 with no body.
		if (!responses.length) return new Response(null, { status: 202, headers });
		return jsonRpcResponse(batch ? responses : responses[0], 200, headers);
	}

	/**
	 * The standalone SSE stream.
	 *
	 * The server never initiates a request, so this stream carries nothing but
	 * keep-alives — and it exists anyway because a client that opens it and is
	 * told 405 logs an error on every connection. It is opened, kept alive, and
	 * closed when the client goes away.
	 */
	async function handleGet(request: Request): Promise<Response> {
		const resolved = await resolveAuth(request);
		if (resolved instanceof Response) return resolved;
		const accept = request.headers.get('Accept') ?? '';
		if (!accept.includes('text/event-stream')) {
			return new Response('This endpoint takes POST', {
				status: 405,
				headers: { Allow: 'POST, GET, DELETE' },
			});
		}
		const encoder = new TextEncoder();
		let timer: ReturnType<typeof setInterval> | undefined;
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode(': connected\n\n'));
				timer = setInterval(() => {
					try {
						controller.enqueue(encoder.encode(': keep-alive\n\n'));
					} catch {
						if (timer) clearInterval(timer);
					}
				}, 25_000);
				request.signal.addEventListener('abort', () => {
					if (timer) clearInterval(timer);
					try {
						controller.close();
					} catch {
						// Already closed by the disconnect itself.
					}
				});
			},
			cancel() {
				if (timer) clearInterval(timer);
			},
		});
		return new Response(stream, {
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-store',
				Connection: 'keep-alive',
				// Without this, a buffering proxy holds the keep-alives and the
				// client times out on a connection that is in fact healthy.
				'X-Accel-Buffering': 'no',
			},
		});
	}

	async function handleDelete(request: Request): Promise<Response> {
		const resolved = await resolveAuth(request);
		if (resolved instanceof Response) return resolved;
		const session_id = request.headers.get('Mcp-Session-Id');
		if (!session_id) return new Response(null, { status: 400 });
		if (options.sessions) {
			const session = await options.sessions.get(session_id);
			// A 404 either way: whether the session is gone or belongs to somebody
			// else is not this caller's business, and the transport already tells
			// a client what to do with a 404.
			if (!session || !sessionBelongsTo(session, resolved.auth)) {
				return new Response(null, { status: 404 });
			}
			await options.sessions.delete(session_id);
		}
		return new Response(null, { status: 204 });
	}

	return {
		tools: registry,
		async fetch(request: Request): Promise<Response> {
			if (!originAllowed(request, options)) {
				return jsonRpcResponse(
					failure(null, JSON_RPC_ERROR.invalid_request, 'Origin is not allowed'),
					403,
				);
			}
			switch (request.method) {
				case 'POST':
					return handlePost(request);
				case 'GET':
					return handleGet(request);
				case 'DELETE':
					return handleDelete(request);
				case 'OPTIONS':
					return new Response(null, {
						status: 204,
						headers: { Allow: 'POST, GET, DELETE, OPTIONS' },
					});
				default:
					return new Response('Method not allowed', {
						status: 405,
						headers: { Allow: 'POST, GET, DELETE, OPTIONS' },
					});
			}
		},
	};
}
