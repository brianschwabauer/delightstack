import type { McpSession, McpSessionStore } from './types.js';
import { randomToken } from './crypto.js';

/**
 * Session bookkeeping for the protocol versions that have sessions
 * (`2025-03-26` through `2025-11-25`). Revision `2026-07-28` removed them; the
 * server negotiates and only mints an id when the negotiated version wants one.
 */

/** Mints a session id. Opaque, ASCII-visible, unguessable. */
export function generateSessionId(): string {
	return randomToken(24);
}

/**
 * An in-memory store.
 *
 * Correct for tests and for a single-isolate dev server, and wrong for
 * production on Workers — an isolate can be recycled between two requests of
 * the same conversation, which would drop the session underneath a live
 * client. Back the interface with the Durable Object that owns the vault.
 */
export function createMemorySessionStore(options?: { ttl_ms?: number }): McpSessionStore {
	const ttl_ms = options?.ttl_ms ?? 30 * 60 * 1000;
	const sessions = new Map<string, McpSession>();

	const sweep = (now: number) => {
		for (const [id, session] of sessions) {
			if (now - session.last_seen_at > ttl_ms) sessions.delete(id);
		}
	};

	return {
		create(session) {
			sweep(session.created_at);
			sessions.set(session.id, { ...session });
		},
		get(id) {
			const session = sessions.get(id);
			if (!session) return undefined;
			if (Date.now() - session.last_seen_at > ttl_ms) {
				sessions.delete(id);
				return undefined;
			}
			return { ...session };
		},
		touch(id, at) {
			const session = sessions.get(id);
			if (session) session.last_seen_at = at;
		},
		delete(id) {
			sessions.delete(id);
		},
	};
}
