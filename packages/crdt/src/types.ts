/**
 * Shared types. Type-only imports of `loro-crdt` are erased at build time, so
 * this module never pulls a wasm build into either environment — see
 * `loro.server.ts` for why that matters.
 */
import type { LoroDoc } from 'loro-crdt';

/**
 * A point in a document's history, base64-encoded.
 *
 * Opaque: produced by the package, compared for equality, never parsed by a
 * consumer. Loro's own `Frontiers` are peer/counter pairs; encoding them keeps
 * a frontier storable in a column and sendable over RPC.
 */
export type Frontier = string;

/** Who produced an edit — `user:xxx`, `agent:claude`, `import`, … */
export type Actor = string;

/** Why a checkpoint exists. Consumers may extend this with their own strings. */
export type CheckpointKind =
	| 'manual'
	| 'agent'
	| 'pre_agent'
	| 'import'
	| 'restore'
	| 'conflict'
	| 'auto_daily';

/** One appended update in the op log — metadata only, never the blob. */
export interface UpdateMeta {
	seq: number;
	op_id: string;
	actor: Actor;
	peer_id: string;
	frontier: Frontier;
	byte_size: number;
	created_at: number;
}

/**
 * A run of edits by one actor with no long pause and no checkpoint inside it.
 *
 * Derived at read time, never stored, so the grouping gap can be retuned
 * without a migration.
 */
export interface EditSession {
	actor: Actor;
	start_frontier: Frontier;
	end_frontier: Frontier;
	started_at: number;
	ended_at: number;
	op_count: number;
	byte_size: number;
}

/** A named, user-visible point in history. */
export interface Checkpoint {
	id: string;
	kind: CheckpointKind;
	label: string;
	actor: Actor;
	frontier: Frontier;
	created_at: number;
	/** Set once compaction has materialised a snapshot exactly at this frontier. */
	snapshot_key?: string;
}

/** The result of applying one inbound update. */
export interface ApplyResult {
	/** False when `op_id` was already applied — the caller should still ack. */
	applied: boolean;
	frontier: Frontier;
	seq?: number;
}

/** A stored snapshot of the document. */
export interface SnapshotRef {
	frontier: Frontier;
	kind: 'shallow' | 'full';
	byte_size: number;
	covers_seq: number;
	r2_key?: string;
	created_at: number;
}

/** Why a compaction run did nothing. */
export type CompactionSkipReason =
	/** The op log has not reached `compact_threshold_bytes` yet. */
	| 'below_threshold'
	/**
	 * Every checkpoint at or before the boundary needs a snapshot exactly at its
	 * frontier, and on a small document those snapshots cost more than the op
	 * blobs they replace. Measured in the spike: a 9-op document grew 871B →
	 * 1188B. Rather than let invariant 7 be false, the run is rolled back.
	 */
	| 'would_not_shrink'
	/**
	 * The oldest live peer has not acknowledged anything newer than what is
	 * already retained, so there is nothing that can safely be discarded.
	 * See {@link CrdtConfig.peer_floor_ttl_ms}.
	 */
	| 'peer_floor'
	/** `retention()` returned `'forever'` — op blobs are never discarded. */
	| 'retention_forever'
	/** There were no update blobs to discard. */
	| 'nothing_to_do';

export interface CompactionResult {
	/** True when nothing was worth doing — see `skipped_reason`. */
	skipped: boolean;
	skipped_reason?: CompactionSkipReason;
	snapshots_written: number;
	updates_discarded: number;
	bytes_before: number;
	bytes_after: number;
	/**
	 * The `seq` history was trimmed back to. Updates above it are retained; a
	 * peer whose `acked_seq` is at or above it can still be served incrementally.
	 */
	boundary_seq: number;
	/** The floor the peer set imposed, or `null` when no live peer constrained it. */
	peer_floor_seq: number | null;
}

/** What a peer must be sent to catch up — the result of {@link CrdtSyncResult}. */
export type SyncKind =
	/** An incremental update blob computed from the peer's version vector. */
	| 'update'
	/** A full document; the peer had nothing, so importing is always safe. */
	| 'bootstrap'
	/**
	 * The peer holds local state that predates the retained history, so nothing
	 * can be merged in either direction. It must discard its local copy and
	 * import this payload — a data-losing action the caller has to surface.
	 */
	| 'reset';

/** What to send one peer so it converges with the server. */
export interface CrdtSyncResult {
	kind: SyncKind;
	/** The blob to send. Never empty except for an already-current peer. */
	payload: Uint8Array;
	/** The server's own oplog version vector, base64-encoded. */
	server_version: string;
	/** The server's frontier after this exchange. */
	frontier: Frontier;
	/** The `seq` the peer is now assumed to hold — its floor contribution. */
	acked_seq: number;
}

/** One peer the server is holding history open for. */
export interface PeerRecord {
	peer_key: string;
	acked_seq: number;
	seen_at: number;
}

/** Configuration for a {@link CrdtDocumentServer}. */
export interface CrdtConfig {
	/**
	 * Produce derived data after a commit. Debounced by the caller's own
	 * scheduling; the package never decides what a projection means.
	 */
	project?: (doc: LoroDoc, frontier: Frontier) => Promise<void> | void;
	/** Retention policy for this document. */
	retention?: () => 'default' | 'forever';
	/** Where snapshots go when they outgrow inline storage. */
	r2?: () => R2BucketLike | undefined;
	/** Gap that ends an edit session. Default 5 minutes. */
	session_gap_ms?: number;
	/** Op-log size that triggers compaction. Default 2MB. */
	compact_threshold_bytes?: number;
	/** Snapshots larger than this go to R2 rather than inline. Default 512KB. */
	inline_snapshot_max_bytes?: number;
	/**
	 * How long a peer keeps history pinned after it was last seen. Default 30
	 * days.
	 *
	 * Compaction must never trim past a peer that may still hold unsynced ops:
	 * that peer can neither be caught up from a shallow snapshot nor have its
	 * own ops accepted, because the dependencies are gone on both sides. A peer
	 * that has not been seen for longer than this is assumed dead and stops
	 * holding the floor; when it does come back it is told to `reset`.
	 */
	peer_floor_ttl_ms?: number;
	/** Prefix for snapshot object keys in R2. Default `snapshots/`. */
	snapshot_key_prefix?: string;
}

/** The one method of an object store this package needs. */
export interface R2BucketLike {
	get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
	put(key: string, value: ArrayBuffer | Uint8Array): Promise<unknown>;
	delete(key: string): Promise<unknown>;
}
