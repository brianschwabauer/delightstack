import type { AuthSessionMeta, WebsocketMessage } from '@delightstack/websocket/types';
import type { WebsocketServerConfig } from '@delightstack/websocket/server';
import type {
	PeerPresence,
	PresenceUpdateMessage,
	PresenceRemoveMessage,
	PresenceRequestMessage,
	PresenceSnapshotMessage,
} from '../types';

/**
 * Event prefixes that should use the websocket server's generous "ephemeral"
 * rate bucket. Pass to `rate_limit.ephemeral_events` so high-frequency cursor
 * updates aren't throttled by the standard limit.
 */
export const PRESENCE_EPHEMERAL_EVENTS = ['presence:'];

type Handlers<Meta extends Record<string, unknown>> = Pick<
	WebsocketServerConfig<Meta>,
	'onMessage' | 'onDisconnect'
>;

export interface PresenceServerOptions<
	Meta extends Record<string, unknown> = AuthSessionMeta,
> {
	/** Chained handler for non-presence messages. */
	onMessage?: WebsocketServerConfig<Meta>['onMessage'];
	/** Chained handler run after presence cleanup on disconnect. */
	onDisconnect?: WebsocketServerConfig<Meta>['onDisconnect'];
}

/**
 * Server-side presence support for the `@delightstack/websocket` Durable Object.
 *
 * Returns `onMessage` / `onDisconnect` handlers that:
 * - relay `presence:*` messages room-wide,
 * - keep an in-memory snapshot so a newcomer's `presence:request` is answered
 *   instantly (delivered only to the requester), and
 * - emit `presence:remove` for a tab's presences when its connection closes.
 *
 * Pair with `rate_limit.ephemeral_events: PRESENCE_EPHEMERAL_EVENTS` so cursor
 * updates use the generous bucket.
 *
 * The snapshot map is in-memory (per Durable Object) and intentionally not
 * persisted: it is rebuilt as clients re-announce after a hibernation wake, and
 * client-side TTL is the ultimate backstop.
 *
 * @example
 * ```ts
 * export class WebsocketDO extends WebsocketServer {
 *   constructor(ctx: DurableObjectState, env: Env) {
 *     const presence = createPresenceServer();
 *     super(
 *       {
 *         onMessage: presence.onMessage,
 *         onDisconnect: presence.onDisconnect,
 *         rate_limit: { ephemeral_events: PRESENCE_EPHEMERAL_EVENTS },
 *       },
 *       ctx,
 *       env,
 *     );
 *   }
 * }
 * ```
 */
export function createPresenceServer<
	Meta extends Record<string, unknown> = AuthSessionMeta,
>(options: PresenceServerOptions<Meta> = {}): Handlers<Meta> {
	/** Latest state per presence id (one per remote tab). */
	const snapshot = new Map<string, PeerPresence>();
	/** Which presence ids belong to each connection, for disconnect cleanup. */
	const owners = new Map<string, Set<string>>();

	const track = (ws_session_id: string, presence_id: string) => {
		let ids = owners.get(ws_session_id);
		if (!ids) {
			ids = new Set();
			owners.set(ws_session_id, ids);
		}
		ids.add(presence_id);
	};

	const untrack = (ws_session_id: string, presence_id: string) => {
		const ids = owners.get(ws_session_id);
		if (!ids) return;
		ids.delete(presence_id);
		if (ids.size === 0) owners.delete(ws_session_id);
	};

	return {
		onMessage: (message, session, server) => {
			switch (message.event) {
				case 'presence:update': {
					const m = message as unknown as PresenceUpdateMessage;
					snapshot.set(m.presence_id, {
						presence_id: m.presence_id,
						user: m.user,
						state: m.state,
						clock: m.clock,
						t: m.t,
					});
					track(session.ws_session_id, m.presence_id);
					server.broadcast(message);
					return;
				}
				case 'presence:remove': {
					const m = message as unknown as PresenceRemoveMessage;
					snapshot.delete(m.presence_id);
					untrack(session.ws_session_id, m.presence_id);
					server.broadcast(message);
					return;
				}
				case 'presence:reaction': {
					server.broadcast(message);
					return;
				}
				case 'presence:request': {
					const m = message as unknown as PresenceRequestMessage;
					const peers = [...snapshot.values()].filter(
						(p) => p.presence_id !== m.presence_id,
					);
					// Returned value is delivered only to the requesting connection.
					return {
						event: 'presence:snapshot',
						peers,
					} satisfies PresenceSnapshotMessage as unknown as WebsocketMessage;
				}
				default:
					return options.onMessage?.(message, session, server);
			}
		},

		onDisconnect: async (session, server) => {
			const ids = owners.get(session.ws_session_id);
			if (ids) {
				for (const presence_id of ids) {
					snapshot.delete(presence_id);
					server.broadcast({
						event: 'presence:remove',
						presence_id,
					} satisfies PresenceRemoveMessage as unknown as WebsocketMessage);
				}
				owners.delete(session.ws_session_id);
			}
			await options.onDisconnect?.(session, server);
		},
	};
}
