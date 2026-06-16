import type { AuthClient } from '@delightstack/auth/client';
import type { AuthSessionMeta } from '@delightstack/websocket/types';
import { PresenceClient, type PresenceClientOptions } from '../core';
import type { PresenceSession } from '../types';
import { websocketTransport, type PresenceWebsocketClient } from './websocket.adapter';
import { authIdentity } from './auth.adapter';

export { websocketTransport, type PresenceWebsocketClient } from './websocket.adapter';
export { authIdentity } from './auth.adapter';

/**
 * Map a `@delightstack/websocket` Layer-0 session to the user it represents,
 * reading the auth metadata the server attaches (`user_id` / `user_name`). Used
 * as the default `sessionUser` so connected users show in the roster before
 * their first `presence:update`.
 */
export function websocketSessionUser(
	session: PresenceSession,
): { id: string; name: string } | null {
	const meta = session.meta as AuthSessionMeta | undefined;
	if (!meta?.user_id) return null;
	return { id: meta.user_id, name: meta.user_name ?? 'User' };
}

/** Options for {@link createDelightPresence} — the core options minus the ports. */
export interface DelightPresenceOptions extends Omit<
	PresenceClientOptions,
	'transport' | 'identity'
> {
	/** A connected `@delightstack/websocket` client. */
	ws: PresenceWebsocketClient;
	/** A `@delightstack/auth` client. */
	auth: AuthClient;
}

/**
 * Batteries-included constructor: wires a `PresenceClient` to
 * `@delightstack/websocket` and `@delightstack/auth`.
 *
 * @example
 * ```ts
 * const presence = createDelightPresence({ ws, auth });
 * setPresence(presence);
 * $effect(() => { presence.start(); return () => presence.destroy(); });
 * ```
 */
export function createDelightPresence(options: DelightPresenceOptions): PresenceClient {
	const { ws, auth, sessionUser, ...rest } = options;
	return new PresenceClient({
		transport: websocketTransport(ws),
		identity: authIdentity(auth),
		// Default the Layer-0 roster mapper, but let callers override it.
		sessionUser: sessionUser ?? websocketSessionUser,
		...rest,
	});
}
