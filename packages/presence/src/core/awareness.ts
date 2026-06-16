import type {
	PeerPresence,
	OnlineUser,
	PresenceUser,
	PresenceState,
	PresenceStatus,
} from '../types';

// ---------------------------------------------------------------------------
// Pure awareness helpers — operate on a plain `Map<presence_id, PeerPresence>`.
// A `SvelteMap` satisfies the same interface, so the reactive client reuses
// these directly. No runes here, so this module is trivially unit-testable.
// ---------------------------------------------------------------------------

/** The minimum fields needed to record a peer (a `presence:update` or snapshot entry). */
export interface PeerUpdate {
	presence_id: string;
	user: PresenceUser;
	state: PresenceState;
	clock: number;
	t: number;
}

/**
 * Apply an incoming update with last-writer-wins on `clock`. A strictly older
 * clock is ignored as stale. Returns `true` when the peer map changed.
 */
export function mergeUpdate(
	peers: Map<string, PeerPresence>,
	update: PeerUpdate,
): boolean {
	const existing = peers.get(update.presence_id);
	if (existing && existing.clock > update.clock) return false;
	peers.set(update.presence_id, {
		presence_id: update.presence_id,
		user: update.user,
		state: update.state,
		clock: update.clock,
		t: update.t,
	});
	return true;
}

/** Merge a full snapshot, skipping our own presence id. */
export function applySnapshot(
	peers: Map<string, PeerPresence>,
	snapshot: PeerUpdate[],
	self_presence_id: string,
): void {
	for (const peer of snapshot) {
		if (peer.presence_id === self_presence_id) continue;
		mergeUpdate(peers, peer);
	}
}

/** Remove a peer. Returns `true` if it existed. */
export function removePeer(
	peers: Map<string, PeerPresence>,
	presence_id: string,
): boolean {
	return peers.delete(presence_id);
}

/** Drop peers not seen within `ttl_ms`. Returns the removed presence ids. */
export function pruneStale(
	peers: Map<string, PeerPresence>,
	now: number,
	ttl_ms: number,
): string[] {
	const removed: string[] = [];
	for (const [id, peer] of peers) {
		if (now - peer.t > ttl_ms) {
			peers.delete(id);
			removed.push(id);
		}
	}
	return removed;
}

const STATUS_RANK: Record<PresenceStatus, number> = { active: 3, idle: 2, away: 1 };

/** Pick the more "present" of two statuses (active > idle > away). */
export function moreActive(a: PresenceStatus, b: PresenceStatus): PresenceStatus {
	return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

/**
 * Collapse per-tab peers (plus optionally the local user) into a deduplicated
 * roster keyed by user id — the data behind the presence facepile.
 */
export function dedupeUsers(opts: {
	peers: Iterable<PeerPresence>;
	self?: { user: PresenceUser; state: PresenceState } | null;
	self_page?: string;
	include_self?: boolean;
}): OnlineUser[] {
	const roster = new Map<string, OnlineUser>();

	const add = (user: PresenceUser, state: PresenceState, is_self: boolean) => {
		const status = state.status ?? 'active';
		const here = (state.page ?? undefined) === opts.self_page;
		const existing = roster.get(user.id);
		if (!existing) {
			roster.set(user.id, { ...user, status, count: 1, here, is_self });
			return;
		}
		existing.count += 1;
		existing.here = existing.here || here;
		existing.is_self = existing.is_self || is_self;
		existing.status = moreActive(existing.status, status);
		// Prefer an avatar image if any tab has one.
		if (!existing.image && user.image) existing.image = user.image;
	};

	if (opts.include_self && opts.self) add(opts.self.user, opts.self.state, true);
	for (const peer of opts.peers) add(peer.user, peer.state, false);

	return [...roster.values()];
}
