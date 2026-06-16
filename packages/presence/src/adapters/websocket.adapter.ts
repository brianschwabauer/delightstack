import type { WebsocketClient } from '@delightstack/websocket/client';
import type { AuthSessionMeta, WebsocketMessage } from '@delightstack/websocket/types';
import type {
	PresenceTransport,
	PresenceSession,
	PresenceMessage,
	PresenceEventMap,
} from '../types';

/** A `WebsocketClient` typed for presence's custom event map. */
export type PresenceWebsocketClient = WebsocketClient<AuthSessionMeta, PresenceEventMap>;

/**
 * Wrap a `@delightstack/websocket` client as a {@link PresenceTransport}.
 *
 * The websocket server must relay `presence:*` messages room-wide — use
 * `createPresenceServer()` from `@delightstack/presence/server`.
 */
export function websocketTransport(ws: PresenceWebsocketClient): PresenceTransport {
	return {
		get connected() {
			return ws.connected;
		},
		get sessions(): readonly PresenceSession[] {
			return ws.sessions.map((s) => ({
				id: s.ws_session_id,
				meta: s.meta as Record<string, unknown> | undefined,
			}));
		},
		send(message: PresenceMessage) {
			// PresenceMessage members have no index signature, so widen via unknown
			// to satisfy the CustomMessage branch of the WebsocketMessage union.
			void ws.send(message as unknown as WebsocketMessage);
		},
		on(handler) {
			return ws.on('*', (message) => {
				if (typeof message?.event === 'string' && message.event.startsWith('presence:')) {
					handler(message as unknown as PresenceMessage);
				}
			});
		},
	};
}
