import { afterEach, describe, expect, it, vi } from 'vitest';
import { PresenceClient } from './presence.client.svelte';
import type {
	PresenceIdentity,
	PresenceMessage,
	PresenceSession,
	PresenceTransport,
	PresenceUpdateMessage,
	PresenceReactionMessage,
} from '../types';

// ---------------------------------------------------------------------------
// Test doubles: a transport that captures outgoing messages and lets a test
// inject incoming ones, plus a static identity. The client only depends on the
// two ports, so this is all it takes to exercise the engine headlessly.
// ---------------------------------------------------------------------------

function mockTransport(initial_sessions: PresenceSession[] = []) {
	let sessions = initial_sessions;
	let handler: ((m: PresenceMessage) => void) | null = null;
	const sent: PresenceMessage[] = [];
	const transport: PresenceTransport = {
		connected: true,
		get sessions() {
			return sessions;
		},
		send: (m) => sent.push(m),
		on: (cb) => {
			handler = cb;
			return () => {
				if (handler === cb) handler = null;
			};
		},
	};
	return {
		transport,
		sent,
		deliver: (m: PresenceMessage) => handler?.(m),
		hasHandler: () => handler !== null,
		setSessions: (s: PresenceSession[]) => (sessions = s),
	};
}

const identity = (
	user: { id: string; name: string; image?: string } | null = { id: 'me', name: 'Me' },
): PresenceIdentity => ({
	user,
	orgId: 'org1',
});

const peerUpdate = (
	presence_id: string,
	uid: string,
	over: Partial<PresenceUpdateMessage['state']> = {},
	clock = 1,
	t = Date.now(),
): PresenceUpdateMessage => ({
	event: 'presence:update',
	presence_id,
	user: { id: uid, name: uid, color: '#abc' },
	state: { page: '/a', ...over },
	clock,
	t,
});

const updates = (sent: PresenceMessage[]) =>
	sent.filter((m): m is PresenceUpdateMessage => m.event === 'presence:update');

afterEach(() => {
	vi.useRealTimers();
});

describe('PresenceClient lifecycle', () => {
	it('announces an update then requests a snapshot on start', () => {
		const t = mockTransport();
		const c = new PresenceClient({
			transport: t.transport,
			identity: identity(),
			page: () => '/a',
		});
		c.start();
		expect(t.sent.map((m) => m.event)).toEqual(['presence:update', 'presence:request']);
		const first = t.sent[0] as PresenceUpdateMessage;
		expect(first.presence_id).toBe(c.presence_id);
		expect(first.user.id).toBe('me');
		expect(first.state.page).toBe('/a');
		c.destroy();
	});

	it('is idempotent: a second start does not re-announce', () => {
		const t = mockTransport();
		const c = new PresenceClient({
			transport: t.transport,
			identity: identity(),
			page: () => '/a',
		});
		c.start();
		t.sent.length = 0;
		c.start();
		expect(t.sent).toHaveLength(0);
		c.destroy();
	});

	it('emits presence:remove and unsubscribes on destroy', () => {
		const t = mockTransport();
		const c = new PresenceClient({
			transport: t.transport,
			identity: identity(),
			page: () => '/a',
		});
		c.start();
		t.sent.length = 0;
		c.destroy();
		expect(t.sent.some((m) => m.event === 'presence:remove')).toBe(true);
		expect(t.hasHandler()).toBe(false);
		// Messages delivered after destroy are ignored (handler detached).
		t.deliver(peerUpdate('p1', 'alice'));
		expect(c.peers).toHaveLength(0);
	});
});

describe('PresenceClient peer merging', () => {
	it('tracks remote peers and ignores its own echoed update', () => {
		const t = mockTransport();
		const c = new PresenceClient({
			transport: t.transport,
			identity: identity(),
			page: () => '/a',
		});
		c.start();
		t.deliver(peerUpdate('p1', 'alice'));
		expect(c.peers.map((p) => p.presence_id)).toEqual(['p1']);
		// An update echoed back with our own presence_id must not create a peer.
		t.deliver(peerUpdate(c.presence_id, 'me'));
		expect(c.peers).toHaveLength(1);
		c.destroy();
	});

	it('scopes `here` to peers on the same page', () => {
		const t = mockTransport();
		const c = new PresenceClient({
			transport: t.transport,
			identity: identity(),
			page: () => '/a',
		});
		c.start();
		t.deliver(peerUpdate('p1', 'alice', { page: '/a' }));
		t.deliver(peerUpdate('p2', 'bob', { page: '/b' }));
		expect(c.peers).toHaveLength(2);
		expect(c.here.map((p) => p.presence_id)).toEqual(['p1']);
		c.destroy();
	});

	it('applies a snapshot, skipping our own id', () => {
		const t = mockTransport();
		const c = new PresenceClient({
			transport: t.transport,
			identity: identity(),
			page: () => '/a',
		});
		c.start();
		// A `presence:update` is a structural superset of a snapshot peer entry.
		t.deliver({
			event: 'presence:snapshot',
			peers: [
				peerUpdate('p1', 'alice'),
				peerUpdate('p2', 'bob'),
				peerUpdate(c.presence_id, 'me'),
			],
		});
		expect(c.peers.map((p) => p.presence_id).sort()).toEqual(['p1', 'p2']);
		c.destroy();
	});

	it('re-announces when another client requests, but ignores its own request', () => {
		const t = mockTransport();
		const c = new PresenceClient({
			transport: t.transport,
			identity: identity(),
			page: () => '/a',
		});
		c.start();
		t.sent.length = 0;
		t.deliver({ event: 'presence:request', presence_id: c.presence_id });
		expect(t.sent).toHaveLength(0); // our own request is ignored
		t.deliver({ event: 'presence:request', presence_id: 'newcomer' });
		expect(updates(t.sent)).toHaveLength(1); // re-announced for the newcomer
		c.destroy();
	});

	it('removes a peer on presence:remove', () => {
		const t = mockTransport();
		const c = new PresenceClient({
			transport: t.transport,
			identity: identity(),
			page: () => '/a',
		});
		c.start();
		t.deliver(peerUpdate('p1', 'alice'));
		expect(c.peers).toHaveLength(1);
		t.deliver({ event: 'presence:remove', presence_id: 'p1' });
		expect(c.peers).toHaveLength(0);
		c.destroy();
	});
});

describe('PresenceClient publishing', () => {
	it('snapshots state to plain, structured-cloneable data (BroadcastChannel-safe)', () => {
		const t = mockTransport();
		const c = new PresenceClient({
			transport: t.transport,
			identity: identity(),
			page: () => '/a',
		});
		c.start();
		c.setCursor({ x: 0.25, y: 0.5, stage: 'board' });
		c.setFocus({ anchor: 'email', label: 'Email' });
		const last = updates(t.sent).at(-1)!;
		// The proxy would throw in structuredClone; plain data must not.
		expect(() => structuredClone(last.state)).not.toThrow();
		expect(last.state.cursor).toEqual({ x: 0.25, y: 0.5, stage: 'board' });
		expect(last.state.focus).toEqual({ anchor: 'email', label: 'Email' });
		c.destroy();
	});

	it('flushes focus/status immediately but throttles cursor moves', () => {
		vi.useFakeTimers();
		const t = mockTransport();
		const c = new PresenceClient({
			transport: t.transport,
			identity: identity(),
			page: () => '/a',
			cursor_throttle_ms: 50,
		});
		c.start();
		t.sent.length = 0;

		// A cursor move within the throttle window defers the network send.
		c.setCursor({ x: 0.1, y: 0.1 });
		expect(updates(t.sent)).toHaveLength(0);
		// A second move before the window elapses coalesces with the first.
		c.setCursor({ x: 0.2, y: 0.2 });
		expect(updates(t.sent)).toHaveLength(0);
		vi.advanceTimersByTime(50);
		const flushed = updates(t.sent);
		expect(flushed).toHaveLength(1);
		expect(flushed[0].state.cursor).toEqual({ x: 0.2, y: 0.2 });

		// Clearing the cursor (null) flushes immediately.
		t.sent.length = 0;
		c.setCursor(null);
		expect(updates(t.sent)).toHaveLength(1);
		c.destroy();
	});

	it('does not publish when signed out', () => {
		const t = mockTransport();
		const c = new PresenceClient({
			transport: t.transport,
			identity: identity(null),
			page: () => '/a',
		});
		c.start();
		// No user → no presence:update (the request still goes out).
		expect(updates(t.sent)).toHaveLength(0);
		expect(c.user).toBeNull();
		expect(c.self).toBeNull();
		c.setCursor({ x: 0.5, y: 0.5 });
		expect(updates(t.sent)).toHaveLength(0);
		c.destroy();
	});
});

describe('PresenceClient reactions', () => {
	it('sends a reaction and surfaces it to local listeners', () => {
		const t = mockTransport();
		const c = new PresenceClient({
			transport: t.transport,
			identity: identity(),
			page: () => '/a',
		});
		c.start();
		const seen: PresenceReactionMessage[] = [];
		c.onReaction((m) => seen.push(m));
		c.react('🎉');
		expect(t.sent.some((m) => m.event === 'presence:reaction')).toBe(true);
		expect(seen.map((m) => m.emoji)).toEqual(['🎉']); // local echo for own reaction
		c.destroy();
	});

	it('delivers remote reactions but ignores its own echoed reaction', () => {
		const t = mockTransport();
		const c = new PresenceClient({
			transport: t.transport,
			identity: identity(),
			page: () => '/a',
		});
		c.start();
		const seen: string[] = [];
		c.onReaction((m) => seen.push(m.presence_id));
		t.deliver({
			event: 'presence:reaction',
			presence_id: 'p1',
			user: { id: 'alice', name: 'alice', color: '#abc' },
			emoji: '👍',
			page: '/a',
			at: Date.now(),
		});
		t.deliver({
			event: 'presence:reaction',
			presence_id: c.presence_id, // our own, echoed by the relay
			user: { id: 'me', name: 'Me', color: '#abc' },
			emoji: '👍',
			page: '/a',
			at: Date.now(),
		});
		expect(seen).toEqual(['p1']);
		c.destroy();
	});
});

describe('PresenceClient roster (Layer-0 sessions merge)', () => {
	it('includes connected sessions with no peer state, excluding the local user', () => {
		const t = mockTransport([
			{ id: 'ws-me', meta: { user_id: 'me', user_name: 'Me' } },
			{ id: 'ws-zoe', meta: { user_id: 'zoe', user_name: 'Zoe' } },
		]);
		const c = new PresenceClient({
			transport: t.transport,
			identity: identity(),
			page: () => '/a',
			sessionUser: (s) => {
				const meta = s.meta as { user_id?: string; user_name?: string } | undefined;
				return meta?.user_id
					? { id: meta.user_id, name: meta.user_name ?? 'User' }
					: null;
			},
		});
		c.start();

		const zoe = c.users.find((u) => u.id === 'zoe')!;
		expect(zoe).toBeTruthy();
		expect(zoe.count).toBe(1);
		expect(zoe.here).toBe(false); // sessions carry no page
		expect(zoe.color).toBeTruthy(); // color resolved via the client's color fn
		// The local user is represented by `self`, never by a session entry.
		expect(c.users.filter((u) => u.id === 'me')).toHaveLength(1);
		c.destroy();
	});

	it('prefers rich peer state over a session for the same user', () => {
		const t = mockTransport([
			{ id: 'ws-zoe', meta: { user_id: 'zoe', user_name: 'Zoe' } },
		]);
		const c = new PresenceClient({
			transport: t.transport,
			identity: identity(),
			page: () => '/a',
			sessionUser: (s) => {
				const meta = s.meta as { user_id?: string } | undefined;
				return meta?.user_id ? { id: meta.user_id, name: 'Zoe' } : null;
			},
		});
		c.start();
		// Two tabs of zoe arrive as peers → peer state wins (count 2, on page).
		t.deliver(peerUpdate('p1', 'zoe', { page: '/a' }));
		t.deliver(peerUpdate('p2', 'zoe', { page: '/a' }));
		const zoe = c.users.find((u) => u.id === 'zoe')!;
		expect(zoe.count).toBe(2); // not inflated by the session
		expect(zoe.here).toBe(true);
		c.destroy();
	});
});

describe('PresenceClient heartbeat & TTL', () => {
	it('re-announces on the heartbeat interval so peers keep us alive', () => {
		vi.useFakeTimers();
		const t = mockTransport();
		const c = new PresenceClient({
			transport: t.transport,
			identity: identity(),
			page: () => '/a',
			heartbeat_ms: 1000,
			ttl_ms: 60_000,
		});
		c.start();
		t.sent.length = 0;
		vi.advanceTimersByTime(1000);
		expect(updates(t.sent).length).toBeGreaterThanOrEqual(1);
		const before = updates(t.sent).length;
		vi.advanceTimersByTime(1000);
		expect(updates(t.sent).length).toBeGreaterThan(before);
		c.destroy();
	});

	it('prunes peers whose last-seen exceeds the ttl', () => {
		vi.useFakeTimers();
		const t = mockTransport();
		const c = new PresenceClient({
			transport: t.transport,
			identity: identity(),
			page: () => '/a',
			ttl_ms: 5000,
			heartbeat_ms: 100_000, // keep the heartbeat out of the way
		});
		c.start();
		t.deliver(peerUpdate('p1', 'alice', {}, 1, Date.now()));
		expect(c.peers).toHaveLength(1);
		let changes = 0;
		c.onChange(() => changes++);
		// Advance well past the ttl. The prune interval is min(ttl,10s)=5s and the
		// check is strict (`age > ttl`), so the peer (delivered at t=0) is swept at
		// the 10s tick, not the 5s one — advance comfortably beyond it.
		vi.advanceTimersByTime(11_000);
		expect(c.peers).toHaveLength(0);
		expect(changes).toBeGreaterThanOrEqual(1);
		c.destroy();
	});
});

describe('PresenceClient onChange', () => {
	it('notifies subscribers on peer changes and stops after unsubscribe', () => {
		const t = mockTransport();
		const c = new PresenceClient({
			transport: t.transport,
			identity: identity(),
			page: () => '/a',
		});
		c.start();
		let changes = 0;
		const unsub = c.onChange(() => changes++);
		t.deliver(peerUpdate('p1', 'alice'));
		expect(changes).toBe(1);
		unsub();
		t.deliver(peerUpdate('p2', 'bob'));
		expect(changes).toBe(1);
		c.destroy();
	});
});
