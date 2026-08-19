/**
 * The transport contract between {@link CrdtClient} and whatever moves bytes.
 *
 * This package **never opens a socket**. The server half already keeps
 * transport out — `syncFor()` says *what* a peer must be sent and the Durable
 * Object that owns the sockets decides how — and the client half mirrors it for
 * the same reasons:
 *
 * - the connection is shared. In a real app one WebSocket carries metadata
 *   sync, presence and document bodies; a CRDT package that opens its own is a
 *   second connection, a second reconnect policy and a second auth handshake.
 * - reconnection, backoff, auth refresh and hibernation are the transport's
 *   problem and they are already solved by `@delightstack/websocket`.
 * - a transport that is an interface is a transport a test can drive
 *   deterministically, including partitioning it mid-edit.
 *
 * Messages are **structured objects carrying `Uint8Array` payloads**, not
 * frames. Framing is a wire decision (length-prefixed binary, JSON with base64,
 * something else entirely) and it does not belong here. The message set maps
 * one-to-one onto the server half's API: `subscribe` → `syncFor()`,
 * `update` → `applyUpdate()`.
 */

/** Sent by the client to the document server. */
export type CrdtOutboundMessage =
	/**
	 * "Here is my version vector for this document; send me what I am missing."
	 *
	 * `peer_version` is `null` for a document the client has never seen. The
	 * server answers with exactly one `sync`. Sent on open and again on every
	 * reconnect — it is the whole of the catch-up protocol.
	 */
	| { type: 'subscribe'; node_id: string; peer_version: Uint8Array | null }
	/** One local commit (or a coalesced run of them). Answered with an `ack`. */
	| { type: 'update'; node_id: string; op_id: string; actor: string; blob: Uint8Array }
	/** No more interest in this document; the server may stop broadcasting. */
	| { type: 'unsubscribe'; node_id: string };

/** Received by the client from the document server. */
export type CrdtInboundMessage =
	/**
	 * The answer to a `subscribe`. `kind` comes straight from the server's
	 * `CrdtSyncResult`:
	 *
	 * - `update` — an incremental blob; import it.
	 * - `bootstrap` — a full document; import it. Safe because the client had
	 *   nothing.
	 * - `reset` — the client holds state that predates the server's retained
	 *   history. Nothing can merge in either direction. See
	 *   {@link CrdtClientConfig.on_reset}.
	 */
	| {
			type: 'sync';
			node_id: string;
			kind: 'update' | 'bootstrap' | 'reset';
			payload: Uint8Array;
			frontier?: string;
	  }
	/** Another peer's commit, relayed. */
	| { type: 'broadcast'; node_id: string; blob: Uint8Array }
	/**
	 * One `update` was durably applied — or was a duplicate, which is the same
	 * thing from the client's point of view. Only on an ack is the blob dropped
	 * from the local pending log.
	 */
	| {
			type: 'ack';
			node_id: string;
			op_id: string;
			frontier?: string;
			duplicate?: boolean;
	  }
	/** The server refused something. Puts the client into `error`. */
	| { type: 'error'; node_id?: string; code: string; message: string };

/**
 * What {@link CrdtClient} needs from a connection.
 *
 * Implementations must be forgiving of `send()` while disconnected: the client
 * treats a send as best-effort and relies on the reconnect resend, so throwing
 * is allowed but dropping is preferred.
 */
export interface CrdtTransport {
	/** True while messages can actually reach the server. */
	readonly connected: boolean;
	/** Best-effort delivery. Never awaited by the client. */
	send(message: CrdtOutboundMessage): void;
	/** Subscribe to inbound messages. Returns an unsubscribe function. */
	onMessage(handler: (message: CrdtInboundMessage) => void): () => void;
	/**
	 * Subscribe to connection transitions. Returns an unsubscribe function.
	 *
	 * The client re-subscribes every open document and resends every unacked
	 * blob on each `true`, so a transport that reconnects silently (without
	 * firing this) will leave documents stuck at their last known version.
	 */
	onConnectionChange(handler: (connected: boolean) => void): () => void;
}
