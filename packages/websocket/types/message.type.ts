// ---------------------------------------------------------------------------
// Built-in event types
// ---------------------------------------------------------------------------

/** Entity change events — broadcast from server after DB mutations */
export interface EntityChangedMessage {
	event: 'entity:created' | 'entity:updated' | 'entity:deleted';
	entity_type: string;
	id: string | number;
	/** Sparse entity data for create/update; undefined for delete */
	data?: Record<string, unknown>;
	/** The user who triggered the change (if known) */
	user_id?: string;
}

/** Broadcast when a user connects to the WebSocket */
export interface SessionConnectedMessage {
	event: 'session:connected';
	user_id: string;
	user_name: string;
	user_auth_id: string;
	user_session_id: string;
	ws_session_id: string;
	num_connections: number;
}

/** Broadcast when a user disconnects from the WebSocket */
export interface SessionDisconnectedMessage {
	event: 'session:disconnected';
	user_id: string;
	user_name: string;
	user_auth_id: string;
	user_session_id: string;
	ws_session_id: string;
	num_connections: number;
}

/** Error event sent to an individual connection */
export interface ErrorMessage {
	event: 'error';
	message: string;
	status: number;
	request?: unknown;
}

/** Keep-alive ping (handled automatically by hibernation API) */
export interface PingMessage {
	event: 'ping';
}

/** Keep-alive pong (handled automatically by hibernation API) */
export interface PongMessage {
	event: 'pong';
}

/** Custom event — extensible for app-specific messages */
export interface CustomMessage {
	event: string;
	[key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Union type
// ---------------------------------------------------------------------------

export type WebsocketMessage =
	| EntityChangedMessage
	| SessionConnectedMessage
	| SessionDisconnectedMessage
	| ErrorMessage
	| PingMessage
	| PongMessage
	| CustomMessage;

// ---------------------------------------------------------------------------
// Session metadata (stored in WS attachment for hibernation recovery)
// ---------------------------------------------------------------------------

export interface WebsocketSessionMeta {
	/** Epoch ms when last message was sent to this connection */
	last_sent_at: number;
	/** The user's auth session ID (jti from JWT) */
	user_session_id: string;
	/** Bitwise encoded permission level */
	permission: number;
	/** The user ID */
	user_id: string;
	/** The user's auth method ID (sub from JWT) */
	user_auth_id: string;
	/** The user's display name */
	user_name: string;
	/** The org ID this connection belongs to */
	org_id: string;
	/** Unique ID for this specific WebSocket session */
	ws_session_id: string;
}

// ---------------------------------------------------------------------------
// Client connection status
// ---------------------------------------------------------------------------

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

// ---------------------------------------------------------------------------
// Entity change event (used by DatabaseClient integration)
// ---------------------------------------------------------------------------

export interface EntityChangeEvent {
	type: 'create' | 'update' | 'delete';
	entity_type: string;
	id: string | number;
	data?: Record<string, unknown>;
}
