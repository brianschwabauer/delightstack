// ---------------------------------------------------------------------------
// Core presence value types
// ---------------------------------------------------------------------------

/**
 * A cursor position, normalized relative to a "stage" element so it maps to the
 * same logical point across different viewport sizes. `x`/`y` are fractions in
 * the `[0, 1]` range of the stage's scrollable content box.
 *
 * @see normalizeCursor / denormalizeCursor in `../core/coordinates`
 */
export interface Cursor {
	/** Horizontal position as a fraction `[0, 1]` of the stage content box. */
	x: number;
	/** Vertical position as a fraction `[0, 1]` of the stage content box. */
	y: number;
	/**
	 * Identifier of the stage the coordinates are relative to (the
	 * `data-presence-stage` attribute value). Omitted when the stage is the
	 * document root.
	 */
	stage?: string;
}

/** A user as surfaced to presence UI. `color` is always resolved (stable per user). */
export interface PresenceUser {
	/** The user's unique id. */
	id: string;
	/** Display name (used for the cursor label, initials, and tooltips). */
	name: string;
	/** Optional avatar image URL. Falls back to initials when absent. */
	image?: string;
	/** Stable per-user color as a CSS color string. */
	color: string;
}

/** Activity status, driven by pointer/keyboard activity and tab visibility. */
export type PresenceStatus = 'active' | 'idle' | 'away';

/**
 * The ephemeral awareness state a client publishes about itself. Every field is
 * optional — clients only set what they use. State is never persisted; it clears
 * when the client disconnects.
 */
export interface PresenceState {
	/**
	 * Page scope key. Cursors, cursor chat, and field presence are only shown
	 * among peers that share the same `page`. Defaults to `location.pathname`.
	 */
	page?: string;
	/** Cursor position, or `null` when hidden / off-stage. */
	cursor?: Cursor | null;
	/** Live cursor-chat message, or `null` when none. */
	message?: { text: string; at: number } | null;
	/** Focused field/cell anchor, or `null` when nothing is focused. */
	focus?: { anchor: string; label?: string } | null;
	/** Activity status. */
	status?: PresenceStatus;
	/** App-defined extension slot for custom presence data. */
	custom?: Record<string, unknown>;
}

/** A remote peer (one per browser tab) as tracked by the local client. */
export interface PeerPresence {
	/** The peer's per-tab presence id. */
	presence_id: string;
	/** The peer's user identity. */
	user: PresenceUser;
	/** The peer's latest published awareness state. */
	state: PresenceState;
	/** Monotonic clock used for last-writer-wins merges. */
	clock: number;
	/** Last-seen epoch ms — used to prune peers after `ttl_ms`. */
	t: number;
}

/**
 * A deduplicated online user, merged across all of that user's tabs. Drives the
 * presence facepile (`PresenceClient.users`).
 */
export interface OnlineUser extends PresenceUser {
	/** Most "present" status across the user's tabs (active > idle > away). */
	status: PresenceStatus;
	/** Number of connected tabs/sessions for this user. */
	count: number;
	/** Whether at least one of the user's tabs is on the local user's page. */
	here: boolean;
	/** Whether this entry is the local user. */
	is_self: boolean;
}

// ---------------------------------------------------------------------------
// Wire protocol (rides on the transport's custom-message channel)
// ---------------------------------------------------------------------------

/** Broadcast when a client's awareness state changes. */
export interface PresenceUpdateMessage {
	event: 'presence:update';
	presence_id: string;
	user: PresenceUser;
	state: PresenceState;
	clock: number;
	t: number;
}

/** Broadcast when a client leaves (graceful) or is cleaned up by the server. */
export interface PresenceRemoveMessage {
	event: 'presence:remove';
	presence_id: string;
}

/** Sent by a newcomer to ask the room (or server) to announce current presence. */
export interface PresenceRequestMessage {
	event: 'presence:request';
	presence_id: string;
}

/** Server reply to a `presence:request`, delivered only to the requester. */
export interface PresenceSnapshotMessage {
	event: 'presence:snapshot';
	peers: PeerPresence[];
}

/** Fire-and-forget ephemeral reaction (never stored). */
export interface PresenceReactionMessage {
	event: 'presence:reaction';
	presence_id: string;
	user: PresenceUser;
	emoji: string;
	/** Page the reaction was sent from (so peers can scope it). */
	page?: string;
	at: number;
}

/** Union of every message presence sends or receives over the transport. */
export type PresenceMessage =
	| PresenceUpdateMessage
	| PresenceRemoveMessage
	| PresenceRequestMessage
	| PresenceSnapshotMessage
	| PresenceReactionMessage;

/**
 * Event map for typing a `WebsocketClient<Meta, PresenceEventMap>` so the
 * default websocket adapter gets fully-typed `on(...)` handlers.
 */
export type PresenceEventMap = {
	'presence:update': PresenceUpdateMessage;
	'presence:remove': PresenceRemoveMessage;
	'presence:request': PresenceRequestMessage;
	'presence:snapshot': PresenceSnapshotMessage;
	'presence:reaction': PresenceReactionMessage;
};
