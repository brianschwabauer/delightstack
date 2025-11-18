import { DurableObject } from 'cloudflare:workers';
import { ApiError, decodeJwt, generateID } from '@packages/lib';
import { parse as parseCookie } from 'cookie';
import { decodePermissions, WebSocketErrorEvent, WebSocketEvent } from '@packages/types';

/** A Durable Object for handling database requests */
export class WebsocketServer extends DurableObject {
	private sessions = new Map<
		WebSocket,
		{
			/**
			 * The epoch timestamp in ms when the last message was sent to the websocket
			 * This can be used to determine how up-to-date the connection is and what data might need to be sent
			 */
			last_sent_at: number;
			/** The session ID of the user that is connected */
			user_session_id: string;
			/** The bitwise permission level of the user in this organization */
			permission: number;
			/** The user ID of the user that is connected */
			user_id: string;
			/** The auth ID of the user that is connected */
			user_auth_id: string;
			/** The name of the user that is connected */
			user_name: string;
			/** The ID of the organization the user is connected to */
			org_id: string;
			/** The ID of the database (extracted from the orgID) */
			db_id: string;
			/** The ID of the websocket session connection */
			ws_session_id: string;
		}
	>();

	constructor(
		ctx: DurableObjectState,
		protected env: Env,
	) {
		super(ctx, env);
		this.ctx.setWebSocketAutoResponse(
			new WebSocketRequestResponsePair(
				JSON.stringify({ event: 'ping' }),
				JSON.stringify({ event: 'pong' }),
			),
		);
		this.ctx.getWebSockets().forEach((webSocket) => {
			const meta = webSocket.deserializeAttachment();
			this.sessions.set(webSocket, { ...meta });
		});
	}

	/** Handles receiving a websocket message */
	async webSocketMessage(ws: WebSocket, raw_message: string | ArrayBuffer) {
		if (typeof raw_message !== 'string') {
			return this.sendError({
				ws,
				message: 'Invalid message type',
				status: 400,
				request: raw_message,
			});
		}
		let raw_data: unknown;
		try {
			raw_data = JSON.parse(raw_message);
		} catch (error) {
			return this.sendError({
				ws,
				message: `Could not parse websocket message`,
				status: 400,
				request: raw_message,
			});
		}
		let message: WebSocketEvent;
		try {
			message = WebSocketEvent.parse(raw_data);
		} catch (error: any) {
			return this.sendError({
				ws,
				message: `Message doesn't match the expected format: ${error.message || 'Unknown'}`,
				status: 400,
				request: raw_data,
			});
		}

		// Get the session metadata for the websocket connection
		const session = this.sessions.get(ws);
		if (!session) return;

		// TODO: Use the permissions if necessary
		// TODO: Handle other message types
		const permissions = decodePermissions(session.permission);

		return this.sendError({
			ws,
			message: `Message type not implemented`,
			status: 501,
			request: message,
		});
	}

	/** Called when the client closes the connection */
	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
		const session = this.sessions.get(ws);
		this.sessions.delete(ws);
		if (session?.user_session_id) {
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
		console.log('Websocket closed', { code, reason, wasClean });
	}

	/** Called when a websocket error occurs */
	async webSocketError(ws: WebSocket, error: unknown) {
		const session = this.sessions.get(ws);
		this.sessions.delete(ws);
		if (session?.user_session_id) {
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
		console.log('Websocket errored', error);
	}

	/** The fetch event handler that should only be called in protected environments */
	async fetch(input: string | URL | Request, init?: RequestInit) {
		const url = input instanceof Request ? new URL(input.url) : new URL(input);
		const method = input instanceof Request ? input.method : init?.method || 'GET';
		const headers = input instanceof Request ? input.headers : new Headers(init?.headers);
		const ws_session_id = generateID();

		// Handle the websocket upgrade request
		if (headers.get('Upgrade') === 'websocket') {
			const wspath = new URLPattern({ pathname: '/api/websocket/:org_id?' });
			const cookies = parseCookie(headers.get('Cookie') || '') || {};

			// Extract the user's auth token from the cookies or headers
			let jwt =
				cookies['foreverfamily-session'] ||
				headers.get('Authorization')?.match(/Bearer\s+([^\s;]+)/)?.[1] ||
				url.searchParams.get('auth') ||
				undefined;
			const authToken = !jwt
				? undefined
				: await decodeJwt<'auth'>(this.env.JWT_KEY_SECRET, jwt).catch(() => undefined);
			if (!jwt || !authToken) {
				return new Response(JSON.stringify({ status: 401, message: 'Unauthorized' }), {
					status: 401,
				});
			}

			// Determine the org the user is trying to connect to
			const org_id =
				url.searchParams.get('orgID') ||
				url.searchParams.get('org') ||
				headers.get('OrgID') ||
				headers.get('Org') ||
				wspath.exec(url)?.pathname?.groups?.org_id ||
				cookies['foreverfamily-org'];
			if (!org_id) {
				return new Response(
					JSON.stringify({ status: 400, message: 'Invalid organization ID' }),
					{ status: 400 },
				);
			}

			// Ensure the user has permission to connect to the org
			const db_id = authToken.org[org_id]?.db;
			const role = authToken.org[org_id]?.role || 0;
			if (!role) {
				return new Response(JSON.stringify({ status: 403, message: 'Forbidden' }), {
					status: 403,
				});
			}

			// Start the websocket connection
			const webSocketPair = new WebSocketPair();
			const [client, server] = Object.values(webSocketPair);
			this.ctx.acceptWebSocket(server);
			this.sessions.set(server, {
				last_sent_at: 0,
				permission: role,
				user_session_id: authToken.jti,
				user_id: authToken.uid,
				user_auth_id: authToken.sub,
				user_name: authToken.name,
				org_id,
				db_id: db_id || this.env.DB.idFromName(org_id).toString(),
				ws_session_id,
			});
			server.serializeAttachment({
				...server.deserializeAttachment(),
				...this.sessions.get(server),
			});

			// Notify the other users that a new user has connected
			const activeSessions = this.getActiveSessions();
			if (activeSessions.length > 1) {
				this.broadcast({
					event: 'session:connected',
					user_auth_id: authToken.sub,
					user_id: authToken.uid,
					user_name: authToken.name,
					user_session_id: authToken.jti,
					ws_session_id,
					num_connections: activeSessions.length,
				});
			}

			return new Response(null, {
				status: 101,
				webSocket: client,
			});
		}

		// Handle the RPC request used during development to call methods on the server
		if (url.pathname === '/rpc' && method === 'POST') {
			const body: any = await (input instanceof Request ? input.json() : init?.body);
			if (body?.method && body?.args && body.method in this) {
				try {
					const result = (this as any)[body.method](...body.args);
					const response = result instanceof Promise ? await result : result;
					return new Response(JSON.stringify(response), {
						headers: { 'content-type': 'application/json' },
					});
				} catch (error: any) {
					const responseError = ApiError.from(error);
					return new Response(responseError.toJSON(), {
						status: responseError.status || 500,
						headers: { 'content-type': 'application/json' },
					});
				}
			}
		}
		return new Response(JSON.stringify({ status: 404, message: 'Not found' }), {
			status: 404,
		});
	}

	/** Sends the provided message to all of the attached websocket connections */
	broadcast(raw_message: WebSocketEvent) {
		const message = WebSocketEvent.parse(raw_message);
		this.ctx.getWebSockets().forEach((ws) => {
			const session = this.sessions.get(ws);
			if (!session) return;
			// Only broadcast session updates to the user that triggered them
			if (message.event === 'session:updated' || message.event === 'session:revoked') {
				if (session.user_id !== message.user_id) return;
			}

			// Send the message to the user
			try {
				session.last_sent_at = Date.now();
				ws.send(JSON.stringify(message));
				ws.serializeAttachment({
					...ws.deserializeAttachment(),
					...session,
					last_sent_at: session.last_sent_at || Date.now(),
				});
			} catch (error) {
				// Whoops, the connection is dead. Notify the other users and close the connection
				this.sessions.delete(ws);
				this.broadcast({
					event: 'session:disconnected',
					user_id: session.user_id,
					user_name: session.user_name,
					user_auth_id: session.user_auth_id,
					user_session_id: session.user_session_id,
					num_connections: this.getActiveSessions().length,
					ws_session_id: session.ws_session_id,
				});
			}
		});
	}

	/** Returns the current websocket sessions that are actually active */
	private getActiveSessions() {
		return this.ctx
			.getWebSockets()
			.filter(
				(ws) =>
					this.sessions.has(ws) &&
					ws.readyState !== ws.CLOSED &&
					ws.readyState !== ws.CLOSING,
			);
	}

	/** Sends an error message to the provided websocket connection */
	private sendError({
		ws,
		message,
		status,
		request,
	}: Omit<WebSocketErrorEvent, 'event'> & { ws: WebSocket }) {
		ws.send(
			JSON.stringify({
				event: 'error',
				message,
				status,
				request,
			} as WebSocketErrorEvent),
		);
	}
}
