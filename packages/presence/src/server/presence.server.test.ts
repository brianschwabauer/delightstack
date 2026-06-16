import { describe, expect, it, vi, type Mock } from 'vitest';
import type {
	WebsocketMessage,
	WebsocketSessionMeta,
} from '@delightstack/websocket/types';
import type { WebsocketServer } from '@delightstack/websocket/server';
import { createPresenceServer } from './presence.server';
import type {
	PresenceUser,
	PresenceUpdateMessage,
	PresenceReactionMessage,
	PresenceSnapshotMessage,
} from '../types';

const user = (id: string): PresenceUser => ({ id, name: id, color: '#abc' });

const updateMsg = (
	presence_id: string,
	uid: string,
	clock = 1,
): PresenceUpdateMessage => ({
	event: 'presence:update',
	presence_id,
	user: user(uid),
	state: { page: '/a', cursor: { x: 0.1, y: 0.2 } },
	clock,
	t: 1000,
});

const session = (ws_session_id: string): WebsocketSessionMeta => ({ ws_session_id });

function setup() {
	const server = { broadcast: vi.fn() } as unknown as WebsocketServer;
	const presence = createPresenceServer();
	const onMessage = presence.onMessage!;
	const onDisconnect = presence.onDisconnect!;
	const broadcasts = () =>
		(server.broadcast as Mock).mock.calls.map((c) => c[0] as WebsocketMessage);
	return { server, onMessage, onDisconnect, broadcasts };
}

const asMsg = (m: unknown) => m as WebsocketMessage;

describe('createPresenceServer.onMessage', () => {
	it('stores and relays presence:update', () => {
		const { server, onMessage, broadcasts } = setup();
		onMessage(asMsg(updateMsg('p1', 'alice')), session('ws1'), server);
		expect(broadcasts()).toHaveLength(1);
		expect(broadcasts()[0]).toMatchObject({
			event: 'presence:update',
			presence_id: 'p1',
		});
	});

	it('answers presence:request with a snapshot for the requester only (excluding them)', () => {
		const { server, onMessage } = setup();
		onMessage(asMsg(updateMsg('p1', 'alice')), session('ws1'), server);
		onMessage(asMsg(updateMsg('p2', 'bob')), session('ws2'), server);

		const reply = onMessage(
			asMsg({ event: 'presence:request', presence_id: 'p2' }),
			session('ws2'),
			server,
		) as unknown as PresenceSnapshotMessage;

		expect(reply.event).toBe('presence:snapshot');
		expect(reply.peers.map((p) => p.presence_id)).toEqual(['p1']); // p2 excluded
	});

	it('relays reactions without storing them', () => {
		const { server, onMessage } = setup();
		const reaction: PresenceReactionMessage = {
			event: 'presence:reaction',
			presence_id: 'p1',
			user: user('alice'),
			emoji: '🎉',
			at: 1,
		};
		onMessage(asMsg(reaction), session('ws1'), server);

		const reply = onMessage(
			asMsg({ event: 'presence:request', presence_id: 'pX' }),
			session('wsX'),
			server,
		) as unknown as PresenceSnapshotMessage;
		expect(reply.peers).toHaveLength(0); // reaction was not stored
	});

	it('removes a peer on presence:remove', () => {
		const { server, onMessage } = setup();
		onMessage(asMsg(updateMsg('p1', 'alice')), session('ws1'), server);
		onMessage(
			asMsg({ event: 'presence:remove', presence_id: 'p1' }),
			session('ws1'),
			server,
		);

		const reply = onMessage(
			asMsg({ event: 'presence:request', presence_id: 'pX' }),
			session('wsX'),
			server,
		) as unknown as PresenceSnapshotMessage;
		expect(reply.peers).toHaveLength(0);
	});

	it('delegates non-presence messages to the chained handler', () => {
		const inner = vi.fn(() => ({ event: 'echo' }) as WebsocketMessage);
		const server = { broadcast: vi.fn() } as unknown as WebsocketServer;
		const presence = createPresenceServer({ onMessage: inner });
		const result = presence.onMessage!(asMsg({ event: 'chat' }), session('ws1'), server);
		expect(inner).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ event: 'echo' });
		expect(server.broadcast as Mock).not.toHaveBeenCalled();
	});
});

describe('createPresenceServer.onDisconnect', () => {
	it('emits presence:remove for every presence id owned by the closing connection', async () => {
		const { server, onMessage, onDisconnect, broadcasts } = setup();
		// One connection (shared worker) carrying two tabs' presence ids.
		onMessage(asMsg(updateMsg('p1', 'alice')), session('ws1'), server);
		onMessage(asMsg(updateMsg('p2', 'alice')), session('ws1'), server);
		(server.broadcast as Mock).mockClear();

		await onDisconnect(session('ws1'), server);

		const removed = broadcasts()
			.filter((m) => m.event === 'presence:remove')
			.map((m) => (m as unknown as { presence_id: string }).presence_id)
			.sort();
		expect(removed).toEqual(['p1', 'p2']);

		// Snapshot is now empty.
		const reply = onMessage(
			asMsg({ event: 'presence:request', presence_id: 'pX' }),
			session('wsX'),
			server,
		) as unknown as PresenceSnapshotMessage;
		expect(reply.peers).toHaveLength(0);
	});

	it('runs the chained onDisconnect handler', async () => {
		const inner = vi.fn();
		const server = { broadcast: vi.fn() } as unknown as WebsocketServer;
		const presence = createPresenceServer({ onDisconnect: inner });
		await presence.onDisconnect!(session('ws1'), server);
		expect(inner).toHaveBeenCalledWith(session('ws1'), server);
	});
});
