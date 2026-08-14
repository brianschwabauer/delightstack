import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebsocketServer, type WebsocketServerConfig } from './websocket.server';
import type { WebsocketSessionMeta } from '../types';

vi.mock('cloudflare:workers', () => {
	class DurableObject {
		constructor(
			public ctx: unknown,
			public env: unknown,
		) {}
	}
	return { DurableObject };
});

// ---------------------------------------------------------------------------
// Mocks for the Workers runtime globals used by WebsocketServer
// ---------------------------------------------------------------------------

interface MockSocket {
	send: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
	readyState: number;
	serializeAttachment: ReturnType<typeof vi.fn>;
	deserializeAttachment: ReturnType<typeof vi.fn>;
}

function makeSocket(meta?: WebsocketSessionMeta | (() => never)): MockSocket {
	return {
		send: vi.fn(),
		close: vi.fn(),
		readyState: 1, // OPEN
		serializeAttachment: vi.fn(),
		deserializeAttachment: vi.fn(() => {
			if (typeof meta === 'function') return meta();
			return meta ?? null;
		}),
	};
}

interface MockCtx {
	sockets: MockSocket[];
	setWebSocketAutoResponse: ReturnType<typeof vi.fn>;
	getWebSockets: ReturnType<typeof vi.fn>;
	acceptWebSocket: ReturnType<typeof vi.fn>;
}

function makeCtx(sockets: MockSocket[] = []): MockCtx {
	const ctx: MockCtx = {
		sockets,
		setWebSocketAutoResponse: vi.fn(),
		getWebSockets: vi.fn(() => [...ctx.sockets]),
		acceptWebSocket: vi.fn((ws: MockSocket) => ctx.sockets.push(ws)),
	};
	return ctx;
}

function createServer(
	config: WebsocketServerConfig = {},
	sockets: MockSocket[] = [],
): { server: WebsocketServer; ctx: MockCtx } {
	const ctx = makeCtx(sockets);
	const server = new WebsocketServer(config, ctx as unknown as DurableObjectState, {});
	return { server, ctx };
}

/** Parse every JSON message sent on a mock socket */
function sentMessages(socket: MockSocket): Array<Record<string, unknown>> {
	return socket.send.mock.calls.map(([raw]) => JSON.parse(raw as string));
}

/** Fake upgrade Request carrying optional session metadata */
function makeUpgradeRequest(meta?: unknown, raw_meta?: string): Request {
	const headers = new Headers({ Upgrade: 'websocket' });
	if (raw_meta !== undefined) headers.set('X-WS-Meta', raw_meta);
	else if (meta !== undefined) headers.set('X-WS-Meta', JSON.stringify(meta));
	return { headers } as unknown as Request;
}

class FakeWebSocketPair {
	0 = makeSocket();
	1 = makeSocket();
}

class FakeResponse {
	constructor(
		public body: unknown,
		public init?: { status?: number; webSocket?: unknown },
	) {}
	get status(): number {
		return this.init?.status ?? 200;
	}
	get webSocket(): unknown {
		return this.init?.webSocket;
	}
}

beforeEach(() => {
	vi.stubGlobal(
		'WebSocketRequestResponsePair',
		class {
			constructor(
				public request: string,
				public response: string,
			) {}
		},
	);
	vi.stubGlobal('WebSocket', { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
	vi.stubGlobal('WebSocketPair', FakeWebSocketPair);
	// The DO returns `new Response(null, { status: 101, webSocket })`, which
	// real fetch Response implementations reject — use a permissive stand-in.
	vi.stubGlobal('Response', FakeResponse);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const session_a: WebsocketSessionMeta = { ws_session_id: 'a', meta: { user_id: 'u1' } };
const session_b: WebsocketSessionMeta = { ws_session_id: 'b', meta: { user_id: 'u2' } };
const session_c: WebsocketSessionMeta = { ws_session_id: 'c' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebsocketServer', () => {
	describe('message size limit', () => {
		it('rejects an oversized message with a 413 error without crashing or parsing', async () => {
			const onMessage = vi.fn();
			const socket = makeSocket(session_a);
			const { server } = createServer({ onMessage }, [socket]);

			const oversized = 'x'.repeat(65_537);
			await expect(
				server.webSocketMessage(socket as unknown as WebSocket, oversized),
			).resolves.toBeUndefined();

			expect(onMessage).not.toHaveBeenCalled();
			const messages = sentMessages(socket);
			expect(messages).toHaveLength(1);
			expect(messages[0]).toMatchObject({ event: 'error', status: 413 });
			expect(socket.close).not.toHaveBeenCalled();
		});

		it('respects a custom max_message_bytes', async () => {
			const onMessage = vi.fn();
			const socket = makeSocket(session_a);
			const { server } = createServer({ onMessage, max_message_bytes: 100 }, [socket]);

			await server.webSocketMessage(
				socket as unknown as WebSocket,
				JSON.stringify({ event: 'test', payload: 'y'.repeat(200) }),
			);

			expect(onMessage).not.toHaveBeenCalled();
			expect(sentMessages(socket)[0]).toMatchObject({ event: 'error', status: 413 });
		});

		it('still processes a normal message on the same connection afterwards', async () => {
			const onMessage = vi.fn();
			const socket = makeSocket(session_a);
			const { server } = createServer({ onMessage }, [socket]);

			await server.webSocketMessage(socket as unknown as WebSocket, 'x'.repeat(65_537));
			await server.webSocketMessage(
				socket as unknown as WebSocket,
				JSON.stringify({ event: 'cursor:move', x: 1 }),
			);

			expect(onMessage).toHaveBeenCalledTimes(1);
			expect(onMessage).toHaveBeenCalledWith(
				{ event: 'cursor:move', x: 1 },
				session_a,
				expect.anything(),
			);
		});
	});

	describe('corrupt attachment recovery', () => {
		it('closes a connection with code 1011 when deserializeAttachment throws', () => {
			const corrupt = makeSocket(() => {
				throw new Error('corrupt attachment');
			});
			const healthy = makeSocket(session_a);
			const { server } = createServer({}, [corrupt, healthy]);

			expect(corrupt.close).toHaveBeenCalledWith(1011, 'Invalid session state');
			expect(healthy.close).not.toHaveBeenCalled();
			expect(server.getActiveSessions()).toEqual([session_a]);
		});

		it('removes the corrupt session so broadcasts skip it', () => {
			const corrupt = makeSocket(() => {
				throw new Error('corrupt attachment');
			});
			const healthy = makeSocket(session_a);
			const { server } = createServer({}, [corrupt, healthy]);

			server.broadcast({ event: 'entity:updated', entity_type: 'post', id: 1 });

			expect(corrupt.send).not.toHaveBeenCalled();
			expect(sentMessages(healthy)).toEqual([
				{ event: 'entity:updated', entity_type: 'post', id: 1 },
			]);
		});

		it('does not throw when close() itself fails on a corrupt connection', () => {
			const corrupt = makeSocket(() => {
				throw new Error('corrupt attachment');
			});
			corrupt.close.mockImplementation(() => {
				throw new Error('already closed');
			});

			expect(() => createServer({}, [corrupt])).not.toThrow();
		});
	});

	describe('broadcast', () => {
		it('sends the message to all connected clients', () => {
			const a = makeSocket(session_a);
			const b = makeSocket(session_b);
			const { server } = createServer({}, [a, b]);

			server.broadcast({ event: 'entity:created', entity_type: 'post', id: 7 });

			for (const socket of [a, b]) {
				expect(sentMessages(socket)).toEqual([
					{ event: 'entity:created', entity_type: 'post', id: 7 },
				]);
			}
		});

		it('skips the excluded connection', () => {
			const a = makeSocket(session_a);
			const b = makeSocket(session_b);
			const { server } = createServer({}, [a, b]);

			server.broadcast({ event: 'custom' }, a as unknown as WebSocket);

			expect(a.send).not.toHaveBeenCalled();
			expect(sentMessages(b)).toEqual([{ event: 'custom' }]);
		});

		it('cleans up a dead connection and notifies the remaining clients', () => {
			const a = makeSocket(session_a);
			const dead = makeSocket(session_b);
			const c = makeSocket(session_c);
			dead.send.mockImplementation(() => {
				throw new Error('socket closed');
			});
			const { server } = createServer({}, [a, dead, c]);

			server.broadcast({ event: 'entity:deleted', entity_type: 'post', id: 1 });

			// Dead session is removed from active sessions
			expect(server.getActiveSessions()).toEqual([session_a, session_c]);

			// Remaining connections got the original message AND the disconnect notice
			for (const socket of [a, c]) {
				const messages = sentMessages(socket);
				expect(messages[0]).toEqual({
					event: 'entity:deleted',
					entity_type: 'post',
					id: 1,
				});
				expect(messages[1]).toMatchObject({
					event: 'session:disconnected',
					ws_session_id: 'b',
					num_connections: 2,
				});
			}
		});

		it('entityChanged broadcasts an entity event to all clients', () => {
			const a = makeSocket(session_a);
			const { server } = createServer({}, [a]);

			server.entityChanged('updated', 'post', 42, { title: 'hi' }, { title: 'hi' });

			expect(sentMessages(a)).toEqual([
				{
					event: 'entity:updated',
					entity_type: 'post',
					id: 42,
					data: { title: 'hi' },
					sparse: { title: 'hi' },
				},
			]);
		});
	});

	describe('fetch (new connection)', () => {
		it('returns 404 for non-upgrade requests', async () => {
			const { server } = createServer();
			const response = await server.fetch({
				headers: new Headers(),
			} as unknown as Request);
			expect(response.status).toBe(404);
		});

		it('rejects invalid session metadata with a 400', async () => {
			const { server } = createServer();
			const response = await server.fetch(
				makeUpgradeRequest(undefined, 'not-valid-json{'),
			);
			expect(response.status).toBe(400);
		});

		it('accepts the socket, sends session:list, and broadcasts session:connected', async () => {
			const existing = makeSocket(session_a);
			const { server, ctx } = createServer({}, [existing]);

			const response = await server.fetch(
				makeUpgradeRequest({ meta: { user_id: 'u2' } }),
			);

			expect(response.status).toBe(101);
			expect(ctx.acceptWebSocket).toHaveBeenCalledTimes(1);
			const accepted = ctx.acceptWebSocket.mock.calls[0][0] as MockSocket;
			expect(accepted.serializeAttachment).toHaveBeenCalledWith(
				expect.objectContaining({ meta: { user_id: 'u2' } }),
			);

			// New connection got the full session list (existing + itself)
			const list = sentMessages(accepted)[0];
			expect(list.event).toBe('session:list');
			expect(list.sessions).toHaveLength(2);

			// Existing connection was notified exactly once
			const notices = sentMessages(existing);
			expect(notices).toHaveLength(1);
			expect(notices[0]).toMatchObject({
				event: 'session:connected',
				meta: { user_id: 'u2' },
				num_connections: 2,
			});
		});

		it('does not notify a connection that appears mid-broadcast (snapshot before broadcast)', async () => {
			const existing = makeSocket(session_a);
			const { server, ctx } = createServer({}, [existing]);

			// Simulate another connection racing in while session:connected is
			// being delivered — it must not break iteration or receive the notice.
			const late = makeSocket(session_b);
			existing.send.mockImplementation(() => {
				if (!ctx.sockets.includes(late)) ctx.sockets.push(late);
			});

			await expect(
				server.fetch(makeUpgradeRequest({ meta: { user_id: 'u3' } })),
			).resolves.toMatchObject({ status: 101 });

			expect(existing.send).toHaveBeenCalledTimes(1);
			expect(late.send).not.toHaveBeenCalled();
		});

		it('calls onConnect after setup completes', async () => {
			const onConnect = vi.fn();
			const { server } = createServer({ onConnect });

			await server.fetch(makeUpgradeRequest({ meta: { user_id: 'u1' } }));

			expect(onConnect).toHaveBeenCalledTimes(1);
			expect(onConnect).toHaveBeenCalledWith(
				expect.objectContaining({
					ws_session_id: expect.any(String),
					meta: { user_id: 'u1' },
				}),
				server,
			);
		});
	});

	describe('rate limiting', () => {
		it('depletes tokens and rejects with a 429 error', async () => {
			vi.useFakeTimers();
			const onMessage = vi.fn();
			const socket = makeSocket(session_a);
			const { server } = createServer(
				{ onMessage, rate_limit: { max_tokens: 3, refill_every_seconds: 10 } },
				[socket],
			);

			const message = JSON.stringify({ event: 'test' });
			for (let i = 0; i < 3; i++) {
				await server.webSocketMessage(socket as unknown as WebSocket, message);
			}
			expect(onMessage).toHaveBeenCalledTimes(3);
			expect(socket.send).not.toHaveBeenCalled();

			await server.webSocketMessage(socket as unknown as WebSocket, message);
			expect(onMessage).toHaveBeenCalledTimes(3);
			expect(sentMessages(socket).at(-1)).toMatchObject({ event: 'error', status: 429 });
		});

		it('refills one token after the refill interval', async () => {
			vi.useFakeTimers();
			const onMessage = vi.fn();
			const socket = makeSocket(session_a);
			const { server } = createServer(
				{ onMessage, rate_limit: { max_tokens: 2, refill_every_seconds: 10 } },
				[socket],
			);

			// Deplete the bucket exactly (rejected attempts also consume, so don't over-send)
			const message = JSON.stringify({ event: 'test' });
			await server.webSocketMessage(socket as unknown as WebSocket, message);
			await server.webSocketMessage(socket as unknown as WebSocket, message);
			expect(onMessage).toHaveBeenCalledTimes(2);

			vi.advanceTimersByTime(10_000);
			await server.webSocketMessage(socket as unknown as WebSocket, message);
			expect(onMessage).toHaveBeenCalledTimes(3);

			// Only one token refilled — the next message is rejected again
			await server.webSocketMessage(socket as unknown as WebSocket, message);
			expect(onMessage).toHaveBeenCalledTimes(3);
		});

		it('never refills beyond max_tokens after a long idle period', async () => {
			vi.useFakeTimers();
			const onMessage = vi.fn();
			const socket = makeSocket(session_a);
			const { server } = createServer(
				{ onMessage, rate_limit: { max_tokens: 3, refill_every_seconds: 10 } },
				[socket],
			);

			const message = JSON.stringify({ event: 'test' });
			for (let i = 0; i < 4; i++) {
				await server.webSocketMessage(socket as unknown as WebSocket, message);
			}
			expect(onMessage).toHaveBeenCalledTimes(3);

			// Idle long enough to refill 100x the bucket — capped at max_tokens
			vi.advanceTimersByTime(10_000_000);
			for (let i = 0; i < 4; i++) {
				await server.webSocketMessage(socket as unknown as WebSocket, message);
			}
			expect(onMessage).toHaveBeenCalledTimes(6);
			expect(sentMessages(socket).at(-1)).toMatchObject({ event: 'error', status: 429 });
		});

		it('rate limits per session independently', async () => {
			vi.useFakeTimers();
			const onMessage = vi.fn();
			const a = makeSocket(session_a);
			const b = makeSocket(session_b);
			const { server } = createServer(
				{ onMessage, rate_limit: { max_tokens: 1, refill_every_seconds: 10 } },
				[a, b],
			);

			const message = JSON.stringify({ event: 'test' });
			await server.webSocketMessage(a as unknown as WebSocket, message);
			await server.webSocketMessage(a as unknown as WebSocket, message);
			await server.webSocketMessage(b as unknown as WebSocket, message);

			expect(onMessage).toHaveBeenCalledTimes(2);
			expect(b.send).not.toHaveBeenCalled();
		});
	});

	describe('ephemeral rate limiting', () => {
		it('routes ephemeral events to a separate, more generous bucket', async () => {
			vi.useFakeTimers();
			const onMessage = vi.fn();
			const socket = makeSocket(session_a);
			const { server } = createServer(
				{
					onMessage,
					rate_limit: {
						max_tokens: 1,
						refill_every_seconds: 10,
						ephemeral_events: ['presence:'],
						ephemeral_max_tokens: 5,
						ephemeral_refill_every_seconds: 1,
					},
				},
				[socket],
			);

			// Standard bucket holds only 1 token — the 2nd standard message is rejected.
			const std = JSON.stringify({ event: 'chat' });
			await server.webSocketMessage(socket as unknown as WebSocket, std);
			await server.webSocketMessage(socket as unknown as WebSocket, std);
			expect(onMessage).toHaveBeenCalledTimes(1);
			expect(sentMessages(socket).at(-1)).toMatchObject({ event: 'error', status: 429 });

			// presence:* events draw from the generous ephemeral bucket (5 tokens).
			const eph = JSON.stringify({ event: 'presence:update' });
			for (let i = 0; i < 5; i++) {
				await server.webSocketMessage(socket as unknown as WebSocket, eph);
			}
			expect(onMessage).toHaveBeenCalledTimes(6); // 1 standard + 5 ephemeral

			// 6th ephemeral exhausts its own bucket.
			await server.webSocketMessage(socket as unknown as WebSocket, eph);
			expect(onMessage).toHaveBeenCalledTimes(6);
			expect(sentMessages(socket).at(-1)).toMatchObject({ event: 'error', status: 429 });
		});

		it('leaves behavior unchanged when ephemeral_events is omitted', async () => {
			const onMessage = vi.fn();
			const socket = makeSocket(session_a);
			const { server } = createServer({ onMessage }, [socket]);

			await server.webSocketMessage(
				socket as unknown as WebSocket,
				JSON.stringify({ event: 'presence:update' }),
			);

			expect(onMessage).toHaveBeenCalledTimes(1);
		});
	});

	describe('message validation', () => {
		it('rejects binary messages with a 400 error', async () => {
			const socket = makeSocket(session_a);
			const { server } = createServer({}, [socket]);

			await server.webSocketMessage(socket as unknown as WebSocket, new ArrayBuffer(8));

			expect(sentMessages(socket)[0]).toMatchObject({ event: 'error', status: 400 });
		});

		it('rejects unparseable JSON with a 400 error', async () => {
			const socket = makeSocket(session_a);
			const { server } = createServer({}, [socket]);

			await server.webSocketMessage(socket as unknown as WebSocket, '{nope');

			expect(sentMessages(socket)[0]).toMatchObject({ event: 'error', status: 400 });
		});

		it('rejects messages without a string event field', async () => {
			const onMessage = vi.fn();
			const socket = makeSocket(session_a);
			const { server } = createServer({ onMessage }, [socket]);

			await server.webSocketMessage(
				socket as unknown as WebSocket,
				JSON.stringify({ data: 1 }),
			);

			expect(onMessage).not.toHaveBeenCalled();
			expect(sentMessages(socket)[0]).toMatchObject({ event: 'error', status: 400 });
		});

		it('sends the onMessage return value back to the sender', async () => {
			const socket = makeSocket(session_a);
			const { server } = createServer(
				{ onMessage: () => ({ event: 'echo', ok: true }) },
				[socket],
			);

			await server.webSocketMessage(
				socket as unknown as WebSocket,
				JSON.stringify({ event: 'test' }),
			);

			expect(sentMessages(socket)).toEqual([{ event: 'echo', ok: true }]);
		});

		it('ignores messages from sockets without a session', async () => {
			const onMessage = vi.fn();
			const unknown_socket = makeSocket();
			const { server } = createServer({ onMessage }, []);

			await server.webSocketMessage(
				unknown_socket as unknown as WebSocket,
				JSON.stringify({ event: 'test' }),
			);

			expect(onMessage).not.toHaveBeenCalled();
			expect(unknown_socket.send).not.toHaveBeenCalled();
		});
	});

	describe('disconnect lifecycle', () => {
		it('webSocketClose removes the session and broadcasts session:disconnected', async () => {
			const onDisconnect = vi.fn();
			const a = makeSocket(session_a);
			const b = makeSocket(session_b);
			const { server, ctx } = createServer({ onDisconnect }, [a, b]);

			ctx.sockets.splice(ctx.sockets.indexOf(b), 1);
			await server.webSocketClose(b as unknown as WebSocket, 1000, 'bye', true);

			expect(server.getActiveSessions()).toEqual([session_a]);
			expect(sentMessages(a)[0]).toMatchObject({
				event: 'session:disconnected',
				ws_session_id: 'b',
				num_connections: 1,
			});
			expect(onDisconnect).toHaveBeenCalledWith(session_b, server);
		});

		it('webSocketError also triggers disconnect handling', async () => {
			const onDisconnect = vi.fn();
			const a = makeSocket(session_a);
			const { server, ctx } = createServer({ onDisconnect }, [a]);

			ctx.sockets.length = 0;
			await server.webSocketError(a as unknown as WebSocket, new Error('boom'));

			expect(server.getActiveSessions()).toEqual([]);
			expect(onDisconnect).toHaveBeenCalledWith(session_a, server);
		});
	});

	describe('getActiveSessions', () => {
		it('excludes closing and closed sockets', () => {
			const open = makeSocket(session_a);
			const closing = makeSocket(session_b);
			const closed = makeSocket(session_c);
			closing.readyState = 2; // CLOSING
			closed.readyState = 3; // CLOSED
			const { server } = createServer({}, [open, closing, closed]);

			expect(server.getActiveSessions()).toEqual([session_a]);
		});
	});
});
