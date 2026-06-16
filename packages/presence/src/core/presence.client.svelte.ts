import { generateID } from '@delightstack/utilities';
import { SvelteMap } from 'svelte/reactivity';
import type {
	PresenceTransport,
	PresenceIdentity,
	PresenceSession,
	PresenceState,
	PresenceUser,
	PeerPresence,
	OnlineUser,
	Cursor,
	PresenceMessage,
	PresenceStatus,
	PresenceUpdateMessage,
	PresenceReactionMessage,
} from '../types';
import { userColor } from './color';
import {
	mergeUpdate,
	applySnapshot,
	removePeer,
	pruneStale,
	dedupeUsers,
} from './awareness';

export interface PresenceClientOptions {
	/** The relay. Wrap `@delightstack/websocket` with the default adapter, or supply your own. */
	transport: PresenceTransport;
	/** Who the local user is. Wrap `@delightstack/auth`, or supply your own. */
	identity: PresenceIdentity;
	/**
	 * Resolves the current page scope key. Cursors, cursor chat, and field
	 * presence are scoped to peers sharing this value.
	 * @default () => location.pathname
	 */
	page?: () => string;
	/**
	 * Prune peers not seen for this long (ms). Acts as a backstop for ungraceful
	 * disconnects; clients heartbeat well within it. Must comfortably exceed
	 * `heartbeat_ms` (and a hidden tab's clamped timer) or live peers flicker.
	 * @default 60000
	 */
	ttl_ms?: number;
	/**
	 * Re-announce local presence on this interval (ms) so peers keep us in their
	 * roster between cursor/focus/status changes. @default ttl_ms / 3 (min 5000)
	 */
	heartbeat_ms?: number;
	/** Throttle interval for cursor network sends (ms). @default 45 (~22/s) */
	cursor_throttle_ms?: number;
	/** Mark the local user idle after this long without activity (ms). @default 60000 */
	idle_after_ms?: number;
	/** Override the per-user color. @default colorHash(user.id) */
	color?: (user: { id: string; name: string }) => string;
	/** Include the local user in the `users` roster. @default true */
	include_self?: boolean;
	/**
	 * Map a transport (Layer-0) session to the user it represents, so connected
	 * users appear in the roster even before their first `presence:update`. The
	 * default adapters supply one that reads `user_id`/`user_name` from session
	 * metadata; return `null` for anonymous/unidentifiable sessions.
	 */
	sessionUser?: (
		session: PresenceSession,
	) => { id: string; name: string; image?: string } | null;
}

const DEFAULT_TTL = 60_000;
const DEFAULT_CURSOR_THROTTLE = 45;
const DEFAULT_IDLE_AFTER = 60_000;
const MIN_HEARTBEAT = 5_000;

/**
 * Reactive presence client for Svelte 5. Owns the local user's ephemeral
 * awareness state, broadcasts changes over a {@link PresenceTransport}, and
 * merges peers' states into a reactive map.
 *
 * Construct it directly with the two ports, or use `createDelightPresence` from
 * `@delightstack/presence/adapters` to wire it to `@delightstack/websocket` and
 * `@delightstack/auth`.
 *
 * @example
 * ```ts
 * const presence = new PresenceClient({ transport, identity });
 * setPresence(presence);
 * $effect(() => { presence.start(); return () => presence.destroy(); });
 * ```
 */
export class PresenceClient {
	/** This tab's stable presence id (distinct from any other tab of the same user). */
	readonly presence_id = generateID();

	#transport: PresenceTransport;
	#identity: PresenceIdentity;
	#page_fn: (() => string) | undefined;
	#ttl_ms: number;
	#heartbeat_ms: number;
	#cursor_throttle_ms: number;
	#idle_after_ms: number;
	#color_fn: (user: { id: string; name: string }) => string;
	#include_self: boolean;
	#session_user_fn:
		| ((session: PresenceSession) => { id: string; name: string; image?: string } | null)
		| undefined;

	#peers = new SvelteMap<string, PeerPresence>();
	#self_state = $state<PresenceState>({ status: 'active' });
	#page = $state('');
	#clock = 0;
	#started = false;

	#reaction_listeners = new Set<(message: PresenceReactionMessage) => void>();
	#change_listeners = new Set<() => void>();
	#unsub: (() => void) | undefined;
	#effect_cleanup: (() => void) | undefined;
	#prune_timer: ReturnType<typeof setInterval> | undefined;
	#heartbeat_timer: ReturnType<typeof setInterval> | undefined;
	#idle_timer: ReturnType<typeof setTimeout> | undefined;
	#pending_send: ReturnType<typeof setTimeout> | undefined;
	#last_sent = 0;

	#self_user = $derived.by<PresenceUser | null>(() => {
		const u = this.#identity.user;
		if (!u) return null;
		return {
			id: u.id,
			name: u.name,
			image: u.image,
			color: this.#color_fn({ id: u.id, name: u.name }),
		};
	});

	constructor(options: PresenceClientOptions) {
		this.#transport = options.transport;
		this.#identity = options.identity;
		this.#page_fn = options.page;
		this.#ttl_ms = options.ttl_ms ?? DEFAULT_TTL;
		this.#heartbeat_ms =
			options.heartbeat_ms ?? Math.max(MIN_HEARTBEAT, Math.floor(this.#ttl_ms / 3));
		this.#cursor_throttle_ms = options.cursor_throttle_ms ?? DEFAULT_CURSOR_THROTTLE;
		this.#idle_after_ms = options.idle_after_ms ?? DEFAULT_IDLE_AFTER;
		this.#color_fn = options.color ?? userColor;
		this.#session_user_fn = options.sessionUser;
		this.#include_self = options.include_self ?? true;
	}

	// -----------------------------------------------------------------------
	// Reactive surface
	// -----------------------------------------------------------------------

	/** Whether the underlying transport is connected. */
	get connected(): boolean {
		return this.#transport.connected;
	}

	/** The local user (with resolved color), or `null` when signed out. */
	get user(): PresenceUser | null {
		return this.#self_user;
	}

	/** The local user's current activity status. */
	get status(): PresenceStatus {
		return this.#self_state.status ?? 'active';
	}

	/** The local user's current page scope key. */
	get page(): string {
		return this.#page;
	}

	/** The local presence (id, user, state), or `null` when signed out. */
	get self(): { presence_id: string; user: PresenceUser; state: PresenceState } | null {
		const user = this.#self_user;
		if (!user) return null;
		return { presence_id: this.presence_id, user, state: this.#self_state };
	}

	/** All remote peers (one entry per remote tab). */
	get peers(): PeerPresence[] {
		return [...this.#peers.values()];
	}

	/** Remote peers on the same page as the local user. */
	get here(): PeerPresence[] {
		const page = this.#page;
		return [...this.#peers.values()].filter((p) => (p.state.page ?? '') === page);
	}

	/** Deduplicated online roster (one entry per user, merged across tabs). */
	get users(): OnlineUser[] {
		return dedupeUsers({
			peers: this.#peers.values(),
			self: this.self ? { user: this.self.user, state: this.#self_state } : null,
			self_page: this.#page,
			include_self: this.#include_self,
			sessions: this.#sessionUsers(),
		});
	}

	/**
	 * Map the transport's Layer-0 sessions to users (via the `sessionUser`
	 * option), excluding the local user — they're already represented by `self`
	 * and peer state.
	 */
	#sessionUsers(): PresenceUser[] {
		const map = this.#session_user_fn;
		if (!map) return [];
		const self_id = this.#self_user?.id;
		const out: PresenceUser[] = [];
		for (const session of this.#transport.sessions) {
			const u = map(session);
			if (!u || u.id === self_id) continue;
			out.push({
				id: u.id,
				name: u.name,
				image: u.image,
				color: this.#color_fn({ id: u.id, name: u.name }),
			});
		}
		return out;
	}

	// -----------------------------------------------------------------------
	// Lifecycle
	// -----------------------------------------------------------------------

	/** Subscribe to the transport, announce presence, and start activity tracking. */
	start(): void {
		if (this.#started) return;
		this.#started = true;
		this.#page = this.#resolvePage();

		this.#unsub = this.#transport.on((message) => this.#onMessage(message));

		// React to local identity changes: re-announce on sign-in / org switch /
		// profile change, withdraw presence on sign-out. The first run is skipped —
		// the explicit announce below covers startup.
		let first = true;
		let had_user = false;
		this.#effect_cleanup = $effect.root(() => {
			$effect(() => {
				const user = this.#self_user;
				if (first) {
					first = false;
					had_user = !!user;
					return;
				}
				if (this.#started) {
					if (user) this.#scheduleUpdate(true);
					else if (had_user) this.#leave(); // signed out: don't linger until TTL
				}
				had_user = !!user;
			});
		});

		this.#prune_timer = setInterval(
			() => {
				if (pruneStale(this.#peers, Date.now(), this.#ttl_ms).length > 0) this.#notify();
			},
			Math.min(this.#ttl_ms, 10_000),
		);

		// Heartbeat: re-announce periodically so peers keep us in their roster even
		// when we're not moving the cursor or changing state. Without this, a quiet
		// but connected user is TTL-pruned and flickers in and out everywhere.
		this.#heartbeat_timer = setInterval(() => {
			if (this.#started && this.#self_user) this.#scheduleUpdate(true);
		}, this.#heartbeat_ms);

		// Announce ourselves and ask the room/server for the current snapshot.
		this.#scheduleUpdate(true);
		this.#transport.send({ event: 'presence:request', presence_id: this.presence_id });

		if (typeof window !== 'undefined') {
			window.addEventListener('pointermove', this.#activity, { passive: true });
			window.addEventListener('keydown', this.#activity);
			// `pagehide` fires on bfcache/mobile navigations where `beforeunload`
			// doesn't; both withdraw our presence promptly on the way out.
			window.addEventListener('beforeunload', this.#leave);
			window.addEventListener('pagehide', this.#leave);
		}
		if (typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', this.#visibility);
		}
		this.#resetIdleTimer();
	}

	/** Tear everything down: announce departure, drop listeners and timers. */
	destroy(): void {
		this.#leave();
		this.#unsub?.();
		this.#unsub = undefined;
		this.#effect_cleanup?.();
		this.#effect_cleanup = undefined;
		if (this.#prune_timer) clearInterval(this.#prune_timer);
		if (this.#heartbeat_timer) clearInterval(this.#heartbeat_timer);
		if (this.#idle_timer) clearTimeout(this.#idle_timer);
		if (this.#pending_send) clearTimeout(this.#pending_send);
		if (typeof window !== 'undefined') {
			window.removeEventListener('pointermove', this.#activity);
			window.removeEventListener('keydown', this.#activity);
			window.removeEventListener('beforeunload', this.#leave);
			window.removeEventListener('pagehide', this.#leave);
		}
		if (typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', this.#visibility);
		}
		this.#peers.clear();
		this.#reaction_listeners.clear();
		this.#change_listeners.clear();
		this.#started = false;
	}

	// -----------------------------------------------------------------------
	// Publishing local state
	// -----------------------------------------------------------------------

	/** Set the local cursor (throttled) or clear it with `null`. */
	setCursor(cursor: Cursor | null): void {
		this.#self_state = { ...this.#self_state, cursor };
		this.#scheduleUpdate(cursor === null);
	}

	/** Set the live cursor-chat message, or clear it with `null`. */
	setMessage(text: string | null): void {
		this.#self_state = {
			...this.#self_state,
			message: text ? { text, at: Date.now() } : null,
		};
		this.#scheduleUpdate(true);
	}

	/** Set the focused field/cell anchor, or clear it with `null`. */
	setFocus(focus: { anchor: string; label?: string } | null): void {
		this.#self_state = { ...this.#self_state, focus };
		this.#scheduleUpdate(true);
	}

	/** Set the activity status (no-op if unchanged). */
	setStatus(status: PresenceStatus): void {
		if (this.#self_state.status === status) return;
		this.#self_state = { ...this.#self_state, status };
		this.#scheduleUpdate(true);
	}

	/** Set the app-defined custom presence slot. */
	setCustom(custom: Record<string, unknown>): void {
		this.#self_state = { ...this.#self_state, custom };
		this.#scheduleUpdate(true);
	}

	/** Merge a partial state patch and announce immediately. */
	patch(partial: Partial<PresenceState>): void {
		this.#self_state = { ...this.#self_state, ...partial };
		this.#scheduleUpdate(true);
	}

	/** Override the page scope key and re-announce. */
	setPage(page: string): void {
		if (this.#page === page) return;
		this.#page = page;
		// A new page means our old cursor/focus no longer apply.
		this.#self_state = { ...this.#self_state, cursor: null, focus: null };
		this.#scheduleUpdate(true);
	}

	/** Send a fire-and-forget reaction to the room (also surfaced locally). */
	react(emoji: string): void {
		const user = this.#self_user;
		if (!user) return;
		const message: PresenceReactionMessage = {
			event: 'presence:reaction',
			presence_id: this.presence_id,
			user,
			emoji,
			page: this.#page,
			at: Date.now(),
		};
		this.#transport.send(message);
		for (const cb of this.#reaction_listeners) cb(message);
	}

	/** Subscribe to incoming reactions. Returns an unsubscribe function. */
	onReaction(callback: (message: PresenceReactionMessage) => void): () => void {
		this.#reaction_listeners.add(callback);
		return () => this.#reaction_listeners.delete(callback);
	}

	/**
	 * Subscribe to peer changes (add / update / remove). Useful for non-component
	 * consumers such as attachments or vanilla JS. Returns an unsubscribe function.
	 * Components can read the reactive `peers`/`users`/`here` getters instead.
	 */
	onChange(callback: () => void): () => void {
		this.#change_listeners.add(callback);
		return () => this.#change_listeners.delete(callback);
	}

	// -----------------------------------------------------------------------
	// Internal
	// -----------------------------------------------------------------------

	#onMessage(message: PresenceMessage): void {
		switch (message.event) {
			case 'presence:update':
				if (message.presence_id === this.presence_id) return;
				if (mergeUpdate(this.#peers, message)) this.#notify();
				break;
			case 'presence:remove':
				if (removePeer(this.#peers, message.presence_id)) this.#notify();
				break;
			case 'presence:request':
				// A newcomer (or the relay) is asking everyone to re-announce.
				if (message.presence_id !== this.presence_id) this.#scheduleUpdate(true);
				break;
			case 'presence:snapshot':
				applySnapshot(this.#peers, message.peers, this.presence_id);
				this.#notify();
				break;
			case 'presence:reaction':
				if (message.presence_id === this.presence_id) return;
				for (const cb of this.#reaction_listeners) cb(message);
				break;
		}
	}

	#notify(): void {
		for (const cb of this.#change_listeners) {
			try {
				cb();
			} catch {
				/* listener errors should not break the chain */
			}
		}
	}

	#resolvePage(): string {
		if (this.#page_fn) return this.#page_fn();
		return typeof location !== 'undefined' ? location.pathname : '';
	}

	#scheduleUpdate(immediate: boolean): void {
		if (immediate) {
			if (this.#pending_send) {
				clearTimeout(this.#pending_send);
				this.#pending_send = undefined;
			}
			this.#flushUpdate();
			return;
		}
		const elapsed = Date.now() - this.#last_sent;
		if (elapsed >= this.#cursor_throttle_ms) {
			this.#flushUpdate();
			return;
		}
		if (!this.#pending_send) {
			this.#pending_send = setTimeout(() => {
				this.#pending_send = undefined;
				this.#flushUpdate();
			}, this.#cursor_throttle_ms - elapsed);
		}
	}

	#flushUpdate(): void {
		const user = this.#self_user;
		if (!user) return;
		this.#last_sent = Date.now();
		this.#clock += 1;
		// `#self_state` (and its nested cursor/focus/message) are Svelte `$state`
		// proxies, which aren't structured-cloneable. Snapshot to plain data so the
		// message survives any transport — postMessage/structured-clone ones like
		// BroadcastChannel, not just JSON-serializing ones.
		const state = $state.snapshot(this.#self_state) as PresenceState;
		const message: PresenceUpdateMessage = {
			event: 'presence:update',
			presence_id: this.presence_id,
			user,
			state: { ...state, page: state.page ?? this.#page },
			clock: this.#clock,
			t: Date.now(),
		};
		this.#transport.send(message);
	}

	#activity = (): void => {
		if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
		if (this.#self_state.status !== 'active') this.setStatus('active');
		this.#resetIdleTimer();
	};

	#visibility = (): void => {
		if (typeof document === 'undefined') return;
		if (document.visibilityState === 'hidden') {
			this.setStatus('away');
		} else {
			this.setStatus('active');
			this.#resetIdleTimer();
		}
	};

	#resetIdleTimer(): void {
		if (this.#idle_timer) clearTimeout(this.#idle_timer);
		this.#idle_timer = setTimeout(() => this.setStatus('idle'), this.#idle_after_ms);
	}

	#leave = (): void => {
		if (!this.#started) return;
		this.#transport.send({ event: 'presence:remove', presence_id: this.presence_id });
	};
}
