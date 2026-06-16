import { describe, expect, it } from 'vitest';
import {
	mergeUpdate,
	applySnapshot,
	removePeer,
	pruneStale,
	moreActive,
	dedupeUsers,
	type PeerUpdate,
} from './awareness';
import type { PeerPresence, PresenceState, PresenceUser } from '../types';

const user = (id: string, extra?: Partial<PresenceUser>): PresenceUser => ({
	id,
	name: id.toUpperCase(),
	color: '#abc',
	...extra,
});

const update = (
	presence_id: string,
	uid: string,
	clock: number,
	state: PresenceState = {},
	t = 1000,
): PeerUpdate => ({ presence_id, user: user(uid), state, clock, t });

describe('mergeUpdate (last-writer-wins)', () => {
	it('inserts a new peer', () => {
		const peers = new Map<string, PeerPresence>();
		expect(mergeUpdate(peers, update('p1', 'alice', 1))).toBe(true);
		expect(peers.get('p1')?.user.id).toBe('alice');
	});

	it('applies a newer clock', () => {
		const peers = new Map<string, PeerPresence>();
		mergeUpdate(peers, update('p1', 'alice', 1, { status: 'active' }));
		expect(mergeUpdate(peers, update('p1', 'alice', 2, { status: 'idle' }))).toBe(true);
		expect(peers.get('p1')?.state.status).toBe('idle');
	});

	it('ignores a strictly older clock', () => {
		const peers = new Map<string, PeerPresence>();
		mergeUpdate(peers, update('p1', 'alice', 5, { status: 'idle' }));
		expect(mergeUpdate(peers, update('p1', 'alice', 3, { status: 'active' }))).toBe(
			false,
		);
		expect(peers.get('p1')?.state.status).toBe('idle');
	});
});

describe('applySnapshot', () => {
	it('merges entries but skips our own presence id', () => {
		const peers = new Map<string, PeerPresence>();
		applySnapshot(
			peers,
			[update('self', 'me', 1), update('p1', 'alice', 1), update('p2', 'bob', 1)],
			'self',
		);
		expect([...peers.keys()].sort()).toEqual(['p1', 'p2']);
	});
});

describe('removePeer', () => {
	it('removes an existing peer and reports it', () => {
		const peers = new Map<string, PeerPresence>();
		mergeUpdate(peers, update('p1', 'alice', 1));
		expect(removePeer(peers, 'p1')).toBe(true);
		expect(removePeer(peers, 'p1')).toBe(false);
	});
});

describe('pruneStale', () => {
	it('drops peers older than the ttl and keeps fresh ones', () => {
		const peers = new Map<string, PeerPresence>();
		mergeUpdate(peers, update('old', 'alice', 1, {}, 1000));
		mergeUpdate(peers, update('new', 'bob', 1, {}, 9000));
		const removed = pruneStale(peers, 10_000, 5000);
		expect(removed).toEqual(['old']);
		expect([...peers.keys()]).toEqual(['new']);
	});
});

describe('moreActive', () => {
	it('ranks active > idle > away', () => {
		expect(moreActive('away', 'active')).toBe('active');
		expect(moreActive('idle', 'away')).toBe('idle');
		expect(moreActive('idle', 'idle')).toBe('idle');
	});
});

describe('dedupeUsers', () => {
	it('collapses a user across tabs, counting connections', () => {
		const peers: PeerPresence[] = [
			{ ...update('p1', 'alice', 1, { page: '/a', status: 'idle' }) },
			{ ...update('p2', 'alice', 1, { page: '/b', status: 'active' }) },
			{ ...update('p3', 'bob', 1, { page: '/a' }) },
		];
		const roster = dedupeUsers({ peers, self_page: '/a' });
		const alice = roster.find((u) => u.id === 'alice')!;
		const bob = roster.find((u) => u.id === 'bob')!;
		expect(alice.count).toBe(2);
		expect(alice.status).toBe('active'); // most-present across tabs
		expect(alice.here).toBe(true); // one tab is on /a
		expect(bob.here).toBe(true);
		expect(alice.is_self).toBe(false);
	});

	it('includes self when requested', () => {
		const roster = dedupeUsers({
			peers: [],
			self: { user: user('me'), state: { page: '/a', status: 'active' } },
			self_page: '/a',
			include_self: true,
		});
		expect(roster).toHaveLength(1);
		expect(roster[0].is_self).toBe(true);
		expect(roster[0].here).toBe(true);
	});

	it('omits self when not requested', () => {
		const roster = dedupeUsers({
			peers: [],
			self: { user: user('me'), state: {} },
			include_self: false,
		});
		expect(roster).toHaveLength(0);
	});

	it('keeps an avatar image contributed by any tab', () => {
		const peers: PeerPresence[] = [
			{ ...update('p1', 'alice', 1) },
			{
				...update('p2', 'alice', 1),
				user: user('alice', { image: 'https://img/alice.png' }),
			},
		];
		const roster = dedupeUsers({ peers });
		expect(roster[0].image).toBe('https://img/alice.png');
	});
});
