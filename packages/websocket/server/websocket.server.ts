import { DurableObject } from 'cloudflare:workers';
import { DelightError, generateID } from '@delightstack/utilities';
import type {
	WebsocketMessage,
	WebsocketSessionMeta,
	EntityChangedMessage,
	SessionListMessage,
} from '../types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Configuration for the WebsocketServer Durable Object */
export interface WebsocketServerConfig {
	/**
	 * Handler for incoming client messages. Return a message to send back, or void.
	 * Only called for messages that are not handled internally (ping/pong is automatic).
	 */
	onMessage?: (
		message: WebsocketMessage,
		session: WebsocketSessionMeta,
		server: WebsocketServer,
	) => WebsocketMessage | void | Promise<WebsocketMessage | void>;

	/**
	 * Rate limit for incoming client messages (token bucket).
	 * @default { max_tokens: 30, refill_every_seconds: 10 }
	 */
	rate_limit?: {
		max_tokens?: number;
		refill_every_seconds?: number;
	};
}

// ---------------------------------------------------------------------------
// WebsocketServer Durable Object
// ---------------------------------------------------------------------------

interface Env {
	[key: string]: unknown;
}

/**
 * Org-scoped WebSocket Durable Object that manages real-time connections.
 * One instance per organization — all connections belong to the same org.
 *
 * Uses the Cloudflare Hibernation API for efficient connection management
 * and automatic ping/pong keep-alive.
 *
 * @example
 * ```ts
 * // In your app's Durable Object definition:
 * export class WebsocketDO extends WebsocketServer {
 *   constructor(ctx: DurableObjectState, env: Env) {
 *     super({}, ctx, env);
 *   }
 * }
 * ```
 */
export class WebsocketServer extends DurableObject<Env> {
	private sessions = new Map<WebSocket, WebsocketSessionMeta>();
	private config: WebsocketServerConfig;

	// In-memory token bucket rate limiter (per ws_session_id)
	private rate_limit_buckets = new Map<
		string,
		{ count: number; last_refill: number }
	>();

	constructor(config: WebsocketServerConfig, ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.config = config;

		// Automatic ping/pong for keep-alive during hibernation
		this.ctx.setWebSocketAutoResponse(
			new WebSocketRequestResponsePair(
				JSON.stringify({ event: 'ping' }),
				JSON.stringify({ event: 'pong' }),
			),
		);

		// Recover sessions from hibernation
		this.ctx.getWebSockets().forEach((ws) => {
			const meta = ws.deserializeAttachment();
			if (meta) this.sessions.set(ws, { ...meta });
		});
	}

	// -----------------------------------------------------------------------
	// WebSocket lifecycle (Hibernation API callbacks)
	// -----------------------------------------------------------------------

	async webSocketMessage(ws: WebSocket, raw_message: string | ArrayBuffer): Promise<void> {
		if (typeof raw_message !== 'string') {
			return this.sendError(ws, 'Binary messages are not supported', 400);
		}

		const session = this.sessions.get(ws);
		if (!session) return;

		// Rate limit incoming messages
		if (!this.consumeRateToken(session.ws_session_id)) {
			return this.sendError(ws, 'Too many messages. Please slow down.', 429);
		}

		let parsed: Record<string, unknown>;
		try {
			parsed = JSON.parse(raw_message);
		} catch {
			return this.sendError(ws, 'Could not parse message', 400);
		}

		if (!parsed?.event || typeof parsed.event !== 'string') {
			return this.sendError(ws, 'Message missing event field', 400);
		}

		// Delegate to app-provided handler (parsed is validated to have a string event field)
		if (this.config.onMessage) {
			const response = await this.config.onMessage(parsed as WebsocketMessage, session, this);
			if (response) {
				this.send(ws, response);
			}
		}
	}

	async webSocketClose(
		ws: WebSocket,
		_code: number,
		_reason: string,
		_wasClean: boolean,
	): Promise<void> {
		this.handleDisconnect(ws);
	}

	async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
		this.handleDisconnect(ws);
	}

	// -----------------------------------------------------------------------
	// Fetch handler (upgrade requests from createWebsocketHandle)
	// -----------------------------------------------------------------------

	async fetch(request: Request): Promise<Response> {
		const headers = request.headers;

		// Only handle WebSocket upgrade requests
		if (headers.get('Upgrade') !== 'websocket') {
			return new Response(JSON.stringify({ status: 404, message: 'Not found' }), {
				status: 404,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Session metadata is passed via headers by createWebsocketHandle().
		// The DO trusts these headers because it is only reachable via the CF binding.
		const user_id = headers.get('X-WS-User-ID');
		const user_auth_id = headers.get('X-WS-User-Auth-ID');
		const user_session_id = headers.get('X-WS-User-Session-ID');
		const raw_user_name = headers.get('X-WS-User-Name');
		const org_id = headers.get('X-WS-Org-ID');
		const permission = parseInt(headers.get('X-WS-Permission') || '0', 10);

		if (!user_id || !user_auth_id || !user_session_id || !org_id) {
			return DelightError.unauthorized('Missing session metadata').toResponse();
		}

		// Decode the user name (encoded by createWebsocketHandle to handle special chars)
		const user_name = raw_user_name ? decodeURIComponent(raw_user_name) : '';

		const ws_session_id = generateID();
		const webSocketPair = new WebSocketPair();
		const [client, server] = Object.values(webSocketPair);

		this.ctx.acceptWebSocket(server);

		const session_meta: WebsocketSessionMeta = {
			last_sent_at: 0,
			user_session_id,
			permission,
			user_id,
			user_auth_id,
			user_name,
			org_id,
			ws_session_id,
		};

		this.sessions.set(server, session_meta);
		server.serializeAttachment(session_meta);

		// Send the new connection a list of all currently active sessions
		const active = this.getActiveSessions();
		this.send(server, {
			event: 'session:list',
			sessions: active.map((s) => ({
				user_id: s.user_id,
				user_name: s.user_name,
				user_auth_id: s.user_auth_id,
				user_session_id: s.user_session_id,
				ws_session_id: s.ws_session_id,
			})),
		} satisfies SessionListMessage);

		// Notify existing connections about the new user
		if (active.length > 1) {
			this.broadcast(
				{
					event: 'session:connected',
					user_id,
					user_auth_id,
					user_name,
					user_session_id,
					ws_session_id,
					num_connections: active.length,
				},
				server, // exclude the new connection (it already got session:list)
			);
		}

		return new Response(null, { status: 101, webSocket: client });
	}

	// -----------------------------------------------------------------------
	// Public API (called via RPC from DatabaseServer or app code)
	// -----------------------------------------------------------------------

	/**
	 * Called by DatabaseServer after a create/update/delete to broadcast
	 * the entity change to all connected WebSocket clients in this org.
	 */
	entityChanged(
		action: 'created' | 'updated' | 'deleted',
		entity_type: string,
		id: string | number,
		data?: unknown,
		user_id?: string,
	): void {
		this.broadcast({
			event: `entity:${action}` as EntityChangedMessage['event'],
			entity_type,
			id,
			data: data as Record<string, unknown> | undefined,
			user_id,
		});
	}

	/** Broadcast a message to all connected clients in this org. Optionally exclude one connection. */
	broadcast(message: WebsocketMessage, exclude?: WebSocket): void {
		const serialized = JSON.stringify(message);
		const disconnected: WebsocketSessionMeta[] = [];

		for (const ws of this.ctx.getWebSockets()) {
			if (ws === exclude) continue;
			const session = this.sessions.get(ws);
			if (!session) continue;
			try {
				ws.send(serialized);
			} catch {
				// Dead connection — collect for cleanup after the loop
				this.sessions.delete(ws);
				disconnected.push(session);
			}
		}

		// Notify remaining connections about each disconnected session (non-recursive)
		if (disconnected.length > 0) {
			const active_count = this.getActiveSessions().length;
			for (const session of disconnected) {
				const disconnect_msg = JSON.stringify({
					event: 'session:disconnected',
					user_id: session.user_id,
					user_name: session.user_name,
					user_auth_id: session.user_auth_id,
					user_session_id: session.user_session_id,
					ws_session_id: session.ws_session_id,
					num_connections: active_count,
				});
				for (const ws of this.ctx.getWebSockets()) {
					if (!this.sessions.has(ws)) continue;
					try {
						ws.send(disconnect_msg);
					} catch {
						// Already dead — will be cleaned up on next broadcast
					}
				}
			}
		}
	}

	/** Send a message to a specific connection. */
	send(ws: WebSocket, message: WebsocketMessage): void {
		try {
			ws.send(JSON.stringify(message));
		} catch {
			// Dead connection — ignore
		}
	}

	/** Returns metadata for all active sessions in this org. */
	getActiveSessions(): WebsocketSessionMeta[] {
		return this.ctx
			.getWebSockets()
			.filter(
				(ws) =>
					this.sessions.has(ws) &&
					ws.readyState !== WebSocket.CLOSED &&
					ws.readyState !== WebSocket.CLOSING,
			)
			.map((ws) => this.sessions.get(ws)!);
	}

	// -----------------------------------------------------------------------
	// Private
	// -----------------------------------------------------------------------

	private handleDisconnect(ws: WebSocket): void {
		const session = this.sessions.get(ws);
		this.sessions.delete(ws);
		if (session) {
			this.rate_limit_buckets.delete(session.ws_session_id);
			this.broadcast({
				event: 'session:disconnected',
				user_id: session.user_id,
				user_name: session.user_name,
				user_auth_id: session.user_auth_id,
				user_session_id: session.user_session_id,
				ws_session_id: session.ws_session_id,
				num_connections: this.getActiveSessions().length,
			});
		}
	}

	private sendError(ws: WebSocket, message: string, status: number): void {
		try {
			ws.send(JSON.stringify({ event: 'error', message, status }));
		} catch {
			// Connection already dead — nothing to do
		}
	}

	/**
	 * Token bucket rate limiter. Returns true if the request is allowed.
	 * Cleans up stale buckets to prevent memory leaks.
	 */
	private consumeRateToken(key: string): boolean {
		const now = Date.now();
		const max_tokens = this.config.rate_limit?.max_tokens ?? 30;
		const refill_every_seconds = this.config.rate_limit?.refill_every_seconds ?? 10;

		let bucket = this.rate_limit_buckets.get(key);
		if (!bucket) {
			bucket = { count: max_tokens - 1, last_refill: now };
		} else {
			const refill = Math.floor(
				(now - bucket.last_refill) / (refill_every_seconds * 1000),
			);
			bucket.count = Math.min(bucket.count + refill, max_tokens);
			bucket.last_refill = now;
			bucket.count = Math.max(0, bucket.count - 1);
		}
		this.rate_limit_buckets.set(key, bucket);

		// Clean up stale buckets (older than 10 minutes)
		if (this.rate_limit_buckets.size > 100) {
			for (const [k, b] of this.rate_limit_buckets.entries()) {
				if (b.last_refill < now - 600_000) {
					this.rate_limit_buckets.delete(k);
				}
			}
		}

		return bucket.count > 0;
	}
}
