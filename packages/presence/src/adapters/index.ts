import type { AuthClient } from '@delightstack/auth/client';
import { PresenceClient, type PresenceClientOptions } from '../core';
import { websocketTransport, type PresenceWebsocketClient } from './websocket.adapter';
import { authIdentity } from './auth.adapter';

export { websocketTransport, type PresenceWebsocketClient } from './websocket.adapter';
export { authIdentity } from './auth.adapter';

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
	const { ws, auth, ...rest } = options;
	return new PresenceClient({
		transport: websocketTransport(ws),
		identity: authIdentity(auth),
		...rest,
	});
}
