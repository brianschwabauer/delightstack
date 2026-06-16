import type { PresenceMessage } from './presence.type';

// ---------------------------------------------------------------------------
// Ports — the two interfaces the presence core depends on. Anything that
// satisfies these can power presence, which is what makes the websocket/auth
// integrations optional and swappable.
// ---------------------------------------------------------------------------

/** A connected session as seen by the transport (Layer-0 "who's connected"). */
export interface PresenceSession {
	/**
	 * Stable id for this connection. Note: with a SharedWorker-based transport
	 * (like `@delightstack/websocket`) there is one connection — and therefore
	 * one id — per browser, shared across that browser's tabs.
	 */
	id: string;
	/** Arbitrary session metadata supplied by the transport's auth layer. */
	meta?: Record<string, unknown>;
}

/**
 * The relay port. Anything that can broadcast/receive presence messages within
 * a room and expose the set of currently-connected sessions satisfies this.
 *
 * The default adapter (`@delightstack/presence/adapters`) wraps
 * `@delightstack/websocket`'s `WebsocketClient`, but a Socket.IO / PartyKit /
 * raw-WebSocket equivalent can be dropped in by implementing this interface.
 */
export interface PresenceTransport {
	/** Whether the underlying transport is currently connected (reactive). */
	readonly connected: boolean;
	/** Currently-connected sessions in the room (reactive Layer-0 presence). */
	readonly sessions: readonly PresenceSession[];
	/** Send a presence message to the room. */
	send(message: PresenceMessage): void;
	/**
	 * Subscribe to incoming presence messages. The transport should deliver
	 * every `presence:*` message it receives. Returns an unsubscribe function.
	 */
	on(handler: (message: PresenceMessage) => void): () => void;
}

/** The minimal user shape an identity provider must expose. */
export interface IdentityUser {
	id: string;
	name: string;
	image?: string;
}

/**
 * The identity port — who the local user is. The default adapter wraps
 * `@delightstack/auth`'s `AuthClient`, but any auth library can be used by
 * implementing this interface.
 */
export interface PresenceIdentity {
	/** The current user, or `null` when signed out (reactive). */
	readonly user: IdentityUser | null;
	/** The active org/room id, or `null` (reactive). */
	readonly orgId: string | null;
}
