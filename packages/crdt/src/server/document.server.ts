import { DurableObject } from 'cloudflare:workers';
import { DelightError, generateTimestampID } from '@delightstack/utilities';
import {
	LoroDoc,
	VersionVector,
	decodeImportBlobMeta,
	type Frontiers,
} from '../loro.server.js';
import { SCHEMA_STATEMENTS } from './schema.js';
import { DEFAULT_SESSION_GAP_MS, deriveSessions } from './sessions.js';
import { decodeFrontier, encodeFrontier, toBase64 } from './frontier.js';
import type {
	Actor,
	ApplyResult,
	Checkpoint,
	CheckpointKind,
	CompactionResult,
	CompactionSkipReason,
	CrdtConfig,
	CrdtSyncResult,
	EditSession,
	Frontier,
	PeerRecord,
	SnapshotRef,
	UpdateMeta,
} from '../types.js';

/** Op-log size that makes compaction worth its CPU. Spike-confirmed at 2MB. */
export const DEFAULT_COMPACT_THRESHOLD_BYTES = 2_000_000;

/**
 * Snapshots above this go to R2 rather than into the Durable Object's SQLite.
 * DO SQLite caps a single value at 2MB; 512KB leaves headroom and keeps the
 * common case (a 20k-word document snapshots at ~159KB) inline, where reading
 * it costs no network round trip.
 */
export const DEFAULT_INLINE_SNAPSHOT_MAX_BYTES = 512_000;

/** How long a silent peer keeps history pinned. See {@link CrdtDocumentServer.peerFloor}. */
export const DEFAULT_PEER_FLOOR_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Thrown inside `transactionSync` to roll a compaction back. Never escapes. */
const ROLLBACK = Symbol('crdt.compaction.rollback');

/** Minimal shape of the `SqlStorage` cursor this package consumes. */
interface SqlCursorLike<Row> {
	toArray(): Row[];
	one(): Row;
}

/** Minimal shape of `DurableObjectState` this package consumes. */
interface CrdtStateLike {
	storage: {
		sql: {
			exec<Row = Record<string, unknown>>(
				query: string,
				...bindings: unknown[]
			): SqlCursorLike<Row>;
		};
		transactionSync<T>(callback: () => T): T;
	};
}

/** DO SQLite hands back `ArrayBuffer` for a BLOB; `node:sqlite` hands back bytes. */
function toBytes(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	throw new DelightError({
		message: 'Stored CRDT blob was not binary.',
		status: 500,
		code: 'crdt_blob_corrupt',
	});
}

/**
 * Export everything a peer with no usable local state needs.
 *
 * A full snapshot is preferred — it carries history, so the receiver can time
 * travel locally. Once the document is shallow that mode throws, and the only
 * thing left to send is the shallow form.
 */
function exportFull(doc: LoroDoc): Uint8Array {
	try {
		return doc.export({ mode: 'snapshot' });
	} catch {
		return doc.export({ mode: 'shallow-snapshot', frontiers: doc.frontiers() });
	}
}

/**
 * Export the state a document is *currently* at, retaining no history.
 *
 * The `frontiers` argument does **not** select the state being exported — it is
 * where the retained history is trimmed back to, and the exported state is
 * always the document's current state. This is the single most expensive
 * misreading of the Loro API (spike finding 1): `export({ mode:
 * 'shallow-snapshot', frontiers: checkpoint_frontier })` on a live document
 * produces the *current* text labelled as a checkpoint. The only correct way to
 * snapshot a past point is to build a document whose current state already is
 * that point, then call this.
 */
function exportShallowHere(doc: LoroDoc): Uint8Array {
	return doc.export({ mode: 'shallow-snapshot', frontiers: doc.frontiers() });
}

interface UpdateRow {
	seq: number;
	op_id: string;
	actor: string;
	peer_id: string;
	frontier: string;
	byte_size: number;
	created_at: number;
}

interface SnapshotRow {
	frontier: string;
	kind: string;
	r2_key: string | null;
	blob: unknown;
	byte_size: number;
	covers_seq: number;
	pinned: number;
	created_at: number;
}

interface CheckpointRow {
	id: string;
	kind: string;
	label: string;
	actor: string;
	frontier: string;
	covers_seq: number;
	created_at: number;
}

/** A snapshot blob produced in the async phase of {@link CrdtDocumentServer.compact}. */
interface PreparedSnapshot {
	frontier: Frontier;
	kind: 'shallow' | 'full';
	covers_seq: number;
	pinned: boolean;
	byte_size: number;
	blob: Uint8Array | null;
	r2_key: string | null;
}

/**
 * One collaborative document, stored in one Durable Object.
 *
 * ## What this class owns
 *
 * A single Loro document plus the append-only log that produced it, and
 * everything derived from that pair: edit sessions, named checkpoints, time
 * travel, snapshots and compaction. Loro lives **only** behind this class —
 * consumers never import `loro-crdt`, which is what makes the packaging
 * problem (three published builds, two of which fail in the environment they
 * are resolved into) solvable in one place.
 *
 * ## Sync vs. async
 *
 * `applyUpdate`, `listUpdates`, `listSessions`, `checkpoint`, `restore` and
 * `syncFor` are **synchronous**: DO SQLite is synchronous and Loro is
 * synchronous, so making them async would only add microtask latency to the
 * hot path.
 *
 * `getVersion`, `snapshot` and `compact` are **asynchronous**, which is a
 * deliberate departure from the signature sketched in
 * `04-crdt-and-history.md`. Snapshots above `inline_snapshot_max_bytes` live in
 * R2, and R2 is async; a synchronous `getVersion` could only ever read inline
 * snapshots, which would make the R2 tier unreadable and quietly cap the
 * document size at which history works.
 *
 * ## What it does not own
 *
 * Transport. There is no WebSocket handling here: {@link syncFor} computes what
 * one peer must be sent, and the consuming Durable Object decides how to send
 * it (hibernatable sockets, RPC, HTTP). That keeps this class testable without
 * a runtime and keeps the wire protocol the application's business.
 *
 * Projection. `config.project` is called by {@link runProjection}, which the
 * consumer schedules — the package has no opinion about how long "debounced"
 * is, and a projection is far too expensive to run inside `applyUpdate`.
 */
export class CrdtDocumentServer<Env = unknown> extends DurableObject<Env> {
	readonly crdt_config: CrdtConfig;
	#doc = new LoroDoc();
	#hydrated = false;

	constructor(ctx: DurableObjectState, env: Env, config: CrdtConfig = {}) {
		super(ctx, env);
		this.crdt_config = config;
		const state = ctx as unknown as CrdtStateLike;
		for (const statement of SCHEMA_STATEMENTS) state.storage.sql.exec(statement);
	}

	/* ---------------------------------------------------------------------- */
	/* Internals                                                              */
	/* ---------------------------------------------------------------------- */

	private get sql() {
		return (this.ctx as unknown as CrdtStateLike).storage.sql;
	}

	private get store() {
		return (this.ctx as unknown as CrdtStateLike).storage;
	}

	private get session_gap_ms(): number {
		return this.crdt_config.session_gap_ms ?? DEFAULT_SESSION_GAP_MS;
	}

	/**
	 * Rebuild the in-memory document from durable state, once per instance.
	 *
	 * Newest snapshot first, then every update it does not already cover. Before
	 * the first compaction there is no snapshot and this is a plain replay of
	 * the whole log — which is exactly why compaction exists.
	 *
	 * Hydration is lazy rather than done in `blockConcurrencyWhile`, because it
	 * is synchronous: there is nothing to await, and a lazy check costs one
	 * boolean on every call instead of a promise on every instantiation. An
	 * inline snapshot is always readable here; an R2-tiered one is not (R2 is
	 * async), so the boundary snapshot is deliberately never offloaded — see
	 * {@link compact}.
	 */
	private ensureHydrated(): void {
		if (this.#hydrated) return;
		this.#hydrated = true;
		const snapshot = this.sql
			.exec<SnapshotRow>(
				`SELECT * FROM crdt_snapshot WHERE blob IS NOT NULL
				 ORDER BY covers_seq DESC, pinned ASC LIMIT 1`,
			)
			.toArray()[0];
		let from_seq = 0;
		if (snapshot) {
			this.#doc.import(toBytes(snapshot.blob));
			from_seq = Number(snapshot.covers_seq);
		}
		const rows = this.sql
			.exec<{ update_blob: unknown }>(
				'SELECT update_blob FROM crdt_update WHERE seq > ? ORDER BY seq ASC',
				from_seq,
			)
			.toArray();
		for (const row of rows) this.#doc.import(toBytes(row.update_blob));
	}

	/** The live document. Read-only by convention: write through {@link applyUpdate}. */
	protected get doc(): LoroDoc {
		this.ensureHydrated();
		return this.#doc;
	}

	/** The document's current frontier. */
	get frontier(): Frontier {
		return encodeFrontier(this.doc.frontiers());
	}

	/** The highest `seq` in the op log, or 0 when the log is empty. */
	get head_seq(): number {
		this.ensureHydrated();
		const row = this.sql
			.exec<{ head: number | null }>('SELECT MAX(seq) AS head FROM crdt_update')
			.toArray()[0];
		return Number(row?.head ?? 0);
	}

	private lastInsertRowId(): number {
		return Number(
			this.sql.exec<{ id: number }>('SELECT last_insert_rowid() AS id').one().id,
		);
	}

	private sumUpdateBytes(): number {
		const row = this.sql
			.exec<{ total: number | null }>('SELECT SUM(byte_size) AS total FROM crdt_update')
			.toArray()[0];
		return Number(row?.total ?? 0);
	}

	private sumSnapshotBytes(): number {
		const row = this.sql
			.exec<{ total: number | null }>('SELECT SUM(byte_size) AS total FROM crdt_snapshot')
			.toArray()[0];
		return Number(row?.total ?? 0);
	}

	/** Total durable bytes this document occupies — the number invariant 7 is about. */
	storageStats(): { update_bytes: number; snapshot_bytes: number; total_bytes: number } {
		this.ensureHydrated();
		const update_bytes = this.sumUpdateBytes();
		const snapshot_bytes = this.sumSnapshotBytes();
		return { update_bytes, snapshot_bytes, total_bytes: update_bytes + snapshot_bytes };
	}

	/* ---------------------------------------------------------------------- */
	/* Applying updates                                                       */
	/* ---------------------------------------------------------------------- */

	/**
	 * Apply one inbound update blob and append it to the log.
	 *
	 * **Idempotent on `op_id`.** Every mutation in this system crosses at least
	 * one retry boundary (an offline queue drain, a sync replay, an agent
	 * retry), so a repeat is normal traffic rather than an error. A repeat
	 * returns `applied: false` with the *current* frontier, the `seq` of the
	 * original row, and appends nothing: Loro's `import` is idempotent anyway,
	 * so the point of the dedupe is that the **log** does not grow on retries.
	 *
	 * An update whose causal dependencies have not arrived yet is still logged.
	 * Loro parks it as pending and applies it when the gap fills, so the log
	 * stays a faithful record of what arrived, and the frontier recorded on the
	 * row is honestly "where the document was after this arrived" rather than
	 * "where it would be if everything had arrived in order".
	 */
	applyUpdate(op_id: string, actor: Actor, blob: Uint8Array): ApplyResult {
		this.ensureHydrated();
		if (!op_id) {
			throw new DelightError({
				message:
					'An update needs a client-generated op_id so retries can be deduplicated.',
				status: 400,
				code: 'op_id_required',
			});
		}

		const existing = this.sql
			.exec<{ seq: number }>('SELECT seq FROM crdt_update WHERE op_id = ?', op_id)
			.toArray()[0];
		if (existing) {
			return { applied: false, frontier: this.frontier, seq: Number(existing.seq) };
		}

		const bytes = toBytes(blob);
		try {
			this.#doc.import(bytes);
		} catch (cause) {
			throw new DelightError({
				message: 'The update could not be applied — it is not a valid Loro update blob.',
				status: 400,
				code: 'invalid_update',
				cause,
			});
		}

		const frontier = encodeFrontier(this.#doc.frontiers());
		// The DO's clock, never the client's: `created_at` orders the history
		// rail and groups sessions, and a device with a skewed clock must not be
		// able to reorder anyone else's edits.
		const created_at = Date.now();
		this.sql.exec(
			`INSERT INTO crdt_update (op_id, actor, peer_id, update_blob, frontier, byte_size, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			op_id,
			actor,
			peerOf(bytes),
			bytes,
			frontier,
			bytes.byteLength,
			created_at,
		);
		return { applied: true, frontier, seq: this.lastInsertRowId() };
	}

	/* ---------------------------------------------------------------------- */
	/* History                                                                */
	/* ---------------------------------------------------------------------- */

	/**
	 * Op-log metadata, oldest first. Never reads an update blob — `byte_size` is
	 * a stored column, so listing a 40,000-op history is a narrow row scan and
	 * nothing is decoded.
	 */
	listUpdates(opts: { from?: number; to?: number; limit?: number } = {}): UpdateMeta[] {
		this.ensureHydrated();
		const from = opts.from ?? 0;
		const to = opts.to ?? Number.MAX_SAFE_INTEGER;
		const limit = opts.limit ?? -1;
		return this.sql
			.exec<UpdateRow>(
				`SELECT seq, op_id, actor, peer_id, frontier, byte_size, created_at
				 FROM crdt_update WHERE seq > ? AND seq <= ? ORDER BY seq ASC LIMIT ?`,
				from,
				to,
				limit,
			)
			.toArray()
			.map((row) => ({
				seq: Number(row.seq),
				op_id: row.op_id,
				actor: row.actor,
				peer_id: row.peer_id,
				frontier: row.frontier,
				byte_size: Number(row.byte_size),
				created_at: Number(row.created_at),
			}));
	}

	/**
	 * The history rail's unit: runs of edits by one actor with no long pause and
	 * no checkpoint inside them. Derived from {@link listUpdates} metadata, so
	 * this is as cheap as listing and can be recomputed with a different gap at
	 * any time without a migration.
	 */
	listSessions(
		opts: { gap_ms?: number; from?: number; to?: number } = {},
	): EditSession[] {
		return deriveSessions(
			this.listUpdates({ from: opts.from, to: opts.to }),
			this.listCheckpoints(),
			opts.gap_ms ?? this.session_gap_ms,
		);
	}

	/** Every checkpoint on this document, oldest first. */
	listCheckpoints(): Checkpoint[] {
		this.ensureHydrated();
		const snapshot_frontiers = new Set(
			this.sql
				.exec<{ frontier: string }>('SELECT frontier FROM crdt_snapshot')
				.toArray()
				.map((row) => row.frontier),
		);
		return this.sql
			.exec<CheckpointRow>(
				'SELECT * FROM crdt_checkpoint ORDER BY covers_seq ASC, created_at ASC, id ASC',
			)
			.toArray()
			.map((row) => ({
				id: row.id,
				kind: row.kind as CheckpointKind,
				label: row.label,
				actor: row.actor,
				frontier: row.frontier,
				created_at: Number(row.created_at),
				...(snapshot_frontiers.has(row.frontier) ? { snapshot_key: row.frontier } : {}),
			}));
	}

	/** Every snapshot on this document, oldest first. */
	listSnapshots(): SnapshotRef[] {
		this.ensureHydrated();
		return this.sql
			.exec<SnapshotRow>('SELECT * FROM crdt_snapshot ORDER BY covers_seq ASC')
			.toArray()
			.map((row) => ({
				frontier: row.frontier,
				kind: row.kind as 'shallow' | 'full',
				byte_size: Number(row.byte_size),
				covers_seq: Number(row.covers_seq),
				...(row.r2_key ? { r2_key: row.r2_key } : {}),
				created_at: Number(row.created_at),
			}));
	}

	/**
	 * Record a named point in history.
	 *
	 * A checkpoint is a promise: *this exact version stays readable forever, no
	 * matter what compaction does*. {@link compact} enforces that by
	 * materialising a snapshot at the frontier before it discards anything, so
	 * every checkpoint taken is a permanent, if small, storage commitment.
	 */
	checkpoint(input: { kind: CheckpointKind; label: string; actor: Actor }): Checkpoint {
		this.ensureHydrated();
		const checkpoint: Checkpoint = {
			id: generateTimestampID(),
			kind: input.kind,
			label: input.label,
			actor: input.actor,
			frontier: this.frontier,
			created_at: Date.now(),
		};
		this.sql.exec(
			`INSERT INTO crdt_checkpoint (id, kind, label, actor, frontier, covers_seq, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			checkpoint.id,
			checkpoint.kind,
			checkpoint.label,
			checkpoint.actor,
			checkpoint.frontier,
			this.head_seq,
			checkpoint.created_at,
		);
		return checkpoint;
	}

	/**
	 * Reconstruct one past version and return it as an importable document blob.
	 *
	 * Three things about the implementation are load-bearing and none of them is
	 * the obvious choice:
	 *
	 * 1. **Replay onto a throwaway document, never `forkAt()`.** `forkAt` is the
	 *    shorter route and is what the API suggests, but it is *not implemented
	 *    on shallow documents* — so it works right up until the first compaction
	 *    and then throws forever.
	 * 2. **Replay only up to the target, then export.** Exporting a document
	 *    that has been `checkout()`-ed exports its whole oplog state, not the
	 *    checked-out state — so "replay everything, check out the past, export"
	 *    silently returns the *present*. The throwaway document's log must
	 *    therefore end at the target.
	 * 3. **A point whose blobs were discarded and which is not a checkpoint is
	 *    reported unreachable**, never approximated with the nearest snapshot.
	 *    Silently serving a neighbouring version as if it were exact is how a
	 *    history feature loses someone's work.
	 */
	async getVersion(frontier: Frontier): Promise<Uint8Array> {
		this.ensureHydrated();
		if (frontier === this.frontier) return exportFull(this.#doc);

		// A snapshot taken at exactly this frontier is both the cheapest answer
		// and, after compaction, the only possible one.
		const exact = this.sql
			.exec<SnapshotRow>('SELECT * FROM crdt_snapshot WHERE frontier = ?', frontier)
			.toArray()[0];
		if (exact) return await this.readSnapshot(exact);

		const seq = this.seqOfFrontier(frontier);
		if (seq === null) {
			throw new DelightError({
				message:
					'That version is no longer reachable — its history was compacted away and it was not a checkpoint.',
				status: 410,
				code: 'frontier_unreachable',
				detail: frontier,
			});
		}
		const replayed = await this.replayTo(seq);
		if (encodeFrontier(replayed.frontiers()) !== frontier) {
			throw new DelightError({
				message:
					'That version is no longer reachable — some of the updates it depends on have been discarded.',
				status: 410,
				code: 'frontier_unreachable',
				detail: frontier,
			});
		}
		return exportFull(replayed);
	}

	/**
	 * The earliest `seq` at which the document stood at `frontier`.
	 *
	 * Earliest rather than latest: an update that arrives out of causal order is
	 * parked as pending and leaves the frontier where it was, so several rows
	 * can carry the same frontier. The first of them is the one whose prefix
	 * actually produces that state.
	 */
	private seqOfFrontier(frontier: Frontier): number | null {
		const checkpoint = this.sql
			.exec<{ covers_seq: number }>(
				'SELECT covers_seq FROM crdt_checkpoint WHERE frontier = ? ORDER BY covers_seq ASC LIMIT 1',
				frontier,
			)
			.toArray()[0];
		if (checkpoint) return Number(checkpoint.covers_seq);
		const update = this.sql
			.exec<{ seq: number }>(
				'SELECT MIN(seq) AS seq FROM crdt_update WHERE frontier = ?',
				frontier,
			)
			.toArray()[0];
		return update?.seq == null ? null : Number(update.seq);
	}

	/** Read a snapshot's bytes from wherever they live. */
	private async readSnapshot(row: SnapshotRow): Promise<Uint8Array> {
		if (row.blob != null) return toBytes(row.blob);
		const bucket = this.crdt_config.r2?.();
		if (!bucket || !row.r2_key) {
			throw new DelightError({
				message:
					'A snapshot was tiered to object storage but no bucket is configured to read it back.',
				status: 500,
				code: 'snapshot_store_missing',
			});
		}
		const object = await bucket.get(row.r2_key);
		if (!object) {
			throw new DelightError({
				message:
					'A snapshot recorded in the document log is missing from object storage.',
				status: 500,
				code: 'snapshot_missing',
				detail: row.r2_key,
			});
		}
		return new Uint8Array(await object.arrayBuffer());
	}

	/**
	 * Build a detached document holding the state after exactly `target_seq`
	 * updates: the newest snapshot at or below the target, then every retained
	 * update above it.
	 *
	 * The returned document's own log ends at the target, which is what makes
	 * exporting it produce the past rather than the present.
	 */
	private async replayTo(target_seq: number): Promise<LoroDoc> {
		const doc = new LoroDoc();
		const snapshot = this.sql
			.exec<SnapshotRow>(
				'SELECT * FROM crdt_snapshot WHERE covers_seq <= ? ORDER BY covers_seq DESC, pinned ASC LIMIT 1',
				target_seq,
			)
			.toArray()[0];
		let from_seq = 0;
		if (snapshot) {
			doc.import(await this.readSnapshot(snapshot));
			from_seq = Number(snapshot.covers_seq);
		}
		if (from_seq < target_seq) {
			const rows = this.sql
				.exec<{ update_blob: unknown }>(
					'SELECT update_blob FROM crdt_update WHERE seq > ? AND seq <= ? ORDER BY seq ASC',
					from_seq,
					target_seq,
				)
				.toArray();
			for (const row of rows) doc.import(toBytes(row.update_blob));
		}
		return doc;
	}

	/**
	 * Make the document equal the version at `frontier` **by writing forward**.
	 *
	 * History is append-only, always: a restore is a new edit that happens to
	 * produce an old state, never a rewrite. That is what makes undoing a
	 * restore just another restore, and it is why invariant 4 ("restore never
	 * removes history") is true by construction rather than by care.
	 *
	 * The generated operations are logged like any other update and returned as
	 * a `restore` checkpoint, so the restore itself is a point in history.
	 *
	 * Limitation worth knowing: this uses Loro's `revertTo`, which needs the
	 * target inside the document's *retained* history. A checkpoint that only
	 * survives as a snapshot after compaction can still be **read**
	 * ({@link getVersion}) but cannot be reverted to here — reconstructing
	 * minimal operations from a detached document is a content-aware diff
	 * (ProseMirror-shaped), and belongs to the editor layer, not to a CRDT
	 * store that knows nothing about the schema inside the document.
	 */
	restore(frontier: Frontier, actor: Actor): Checkpoint {
		this.ensureHydrated();
		let target: Frontiers;
		try {
			target = decodeFrontier(frontier);
		} catch (cause) {
			throw new DelightError({
				message: 'That is not a frontier produced by this package.',
				status: 400,
				code: 'invalid_frontier',
				cause,
			});
		}

		const before = this.#doc.oplogVersion();
		try {
			this.#doc.revertTo(target);
			this.#doc.commit();
		} catch (cause) {
			throw new DelightError({
				message:
					'That version can be read but not restored — the operations it is built from have been compacted away.',
				status: 409,
				code: 'restore_unreachable',
				detail: frontier,
				cause,
			});
		}

		const blob = this.#doc.export({ mode: 'update', from: before });
		if (blob.byteLength > 0) {
			const now = Date.now();
			this.sql.exec(
				`INSERT INTO crdt_update (op_id, actor, peer_id, update_blob, frontier, byte_size, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				`restore:${generateTimestampID()}`,
				actor,
				this.#doc.peerIdStr,
				blob,
				encodeFrontier(this.#doc.frontiers()),
				blob.byteLength,
				now,
			);
		}
		return this.checkpoint({ kind: 'restore', label: 'Restored version', actor });
	}

	/* ---------------------------------------------------------------------- */
	/* Peers — the compaction floor                                           */
	/* ---------------------------------------------------------------------- */

	/**
	 * Record that `peer_key` holds every update up to `acked_seq`.
	 *
	 * This is what stops compaction from destroying a device. `acked_seq` only
	 * ever moves forward: a peer that reconnects with a stale vector must not be
	 * able to *lower* the floor and re-pin history that was already released.
	 */
	notePeer(peer_key: string, acked_seq: number): void {
		this.ensureHydrated();
		this.sql.exec(
			`INSERT INTO crdt_peer (peer_key, acked_seq, seen_at) VALUES (?, ?, ?)
			 ON CONFLICT (peer_key) DO UPDATE SET
			   acked_seq = MAX(crdt_peer.acked_seq, excluded.acked_seq),
			   seen_at = excluded.seen_at`,
			peer_key,
			acked_seq,
			Date.now(),
		);
	}

	/** Stop holding history open for a peer — a device that was explicitly reset or removed. */
	forgetPeer(peer_key: string): void {
		this.ensureHydrated();
		this.sql.exec('DELETE FROM crdt_peer WHERE peer_key = ?', peer_key);
	}

	/** Every peer still inside the floor TTL, oldest acknowledgement first. */
	listPeers(now = Date.now()): PeerRecord[] {
		this.ensureHydrated();
		const ttl = this.crdt_config.peer_floor_ttl_ms ?? DEFAULT_PEER_FLOOR_TTL_MS;
		return this.sql
			.exec<PeerRecord>(
				'SELECT peer_key, acked_seq, seen_at FROM crdt_peer WHERE seen_at > ? ORDER BY acked_seq ASC',
				now - ttl,
			)
			.toArray()
			.map((row) => ({
				peer_key: row.peer_key,
				acked_seq: Number(row.acked_seq),
				seen_at: Number(row.seen_at),
			}));
	}

	/**
	 * The `seq` compaction must not trim past, or `null` when nothing constrains it.
	 *
	 * This is the sharpest edge in the whole design, and the API gives no help
	 * with it. Once history has been trimmed to a shallow start, a peer whose
	 * version predates that start is *unrecoverable in both directions*: it
	 * cannot be caught up (a shallow snapshot silently no-ops when imported into
	 * a document that is behind its start — `import` returns success and changes
	 * nothing) and its own pending operations can never be accepted, because
	 * their dependencies are gone here too. Nothing throws. The device simply
	 * stops syncing, forever, and both sides believe they are fine.
	 *
	 * So retention takes a floor at the least-advanced live peer. "Live" means
	 * seen within `peer_floor_ttl_ms` (30 days by default): a device that has
	 * been dark for longer is presumed gone rather than pinning history for the
	 * rest of the document's life, and when it does reappear {@link syncFor}
	 * tells it to `reset` instead of pretending it can merge.
	 *
	 * A document with no registered peers has no floor. That is the correct
	 * default for a server-authoritative deployment where clients are told to
	 * re-bootstrap — but a deployment with real offline devices **must** call
	 * {@link syncFor} (or {@link notePeer}) so they are known.
	 */
	peerFloor(now = Date.now()): number | null {
		const peers = this.listPeers(now);
		if (peers.length === 0) return null;
		return peers.reduce((lowest, peer) => Math.min(lowest, peer.acked_seq), Infinity);
	}

	/**
	 * Work out what one peer must be sent to converge with this document, and
	 * record that it now holds everything.
	 *
	 * `peer_version` is the peer's encoded Loro version vector, or `null`/empty
	 * for a peer with nothing at all.
	 *
	 * The interesting case is the middle one. A shallow (compacted) document
	 * cannot serve an incremental update to a peer that is behind its shallow
	 * start: `export({ mode: 'update', from })` happily returns a blob whose
	 * dependencies were trimmed, and the receiver's `import` reports success and
	 * stays where it was. The check has to be made *here*, by comparing the
	 * peer's vector against `shallowSinceVV()` — nothing downstream can detect
	 * the failure.
	 */
	syncFor(peer_key: string, peer_version: Uint8Array | null): CrdtSyncResult {
		this.ensureHydrated();
		const head = this.head_seq;
		const server_version = toBase64(this.#doc.oplogVersion().encode());
		const finish = (
			kind: CrdtSyncResult['kind'],
			payload: Uint8Array,
		): CrdtSyncResult => {
			this.notePeer(peer_key, head);
			return { kind, payload, server_version, frontier: this.frontier, acked_seq: head };
		};

		// A cold peer. Note `.length()`, not `encode().length`: an *empty*
		// version vector still encodes to one byte, so the byte-length test that
		// looks obviously right never fires.
		let peer_vv: VersionVector | null = null;
		if (peer_version && peer_version.byteLength > 0) {
			try {
				const decoded = VersionVector.decode(peer_version);
				if (decoded.length() > 0) peer_vv = decoded;
			} catch (cause) {
				throw new DelightError({
					message: 'The peer sent a version vector this document cannot decode.',
					status: 400,
					code: 'invalid_version_vector',
					cause,
				});
			}
		}
		if (!peer_vv) return finish('bootstrap', exportFull(this.#doc));

		if (this.canServeIncrementally(peer_vv)) {
			return finish('update', this.#doc.export({ mode: 'update', from: peer_vv }));
		}
		// The peer holds state that predates the retained history. Anything it
		// has not already sent is lost; the caller must surface that.
		return finish('reset', exportFull(this.#doc));
	}

	/**
	 * Whether an incremental update from `peer_version` is actually applicable —
	 * i.e. this document still holds every operation the peer is missing.
	 */
	canServeIncrementally(peer_version: VersionVector): boolean {
		const shallow_since = this.doc.shallowSinceVV();
		if (shallow_since.length() === 0) return true;
		const order = shallow_since.compare(peer_version);
		// `compare` returns undefined for concurrent vectors — which here means
		// the peer has ops we trimmed away, so it cannot be served.
		return order === -1 || order === 0;
	}

	/* ---------------------------------------------------------------------- */
	/* Snapshots & compaction                                                 */
	/* ---------------------------------------------------------------------- */

	/**
	 * Write a snapshot of the document as it stands now.
	 *
	 * `full` carries history and can bootstrap anyone; `shallow` carries only
	 * the state and is roughly 40% smaller (85KB vs 159KB on a 20k-word
	 * document, measured) because on a real document the history, not the text,
	 * is the bulk of a snapshot.
	 */
	async snapshot(kind: 'shallow' | 'full'): Promise<SnapshotRef> {
		this.ensureHydrated();
		const blob = kind === 'full' ? exportFull(this.#doc) : exportShallowHere(this.#doc);
		const prepared = await this.prepareSnapshot({
			frontier: this.frontier,
			kind,
			covers_seq: this.head_seq,
			pinned: false,
			blob,
		});
		this.writeSnapshot(prepared, Date.now());
		return {
			frontier: prepared.frontier,
			kind: prepared.kind,
			byte_size: prepared.byte_size,
			covers_seq: prepared.covers_seq,
			...(prepared.r2_key ? { r2_key: prepared.r2_key } : {}),
			created_at: Date.now(),
		};
	}

	/** Tier a snapshot blob to R2 if it is large and a bucket is configured. */
	private async prepareSnapshot(input: {
		frontier: Frontier;
		kind: 'shallow' | 'full';
		covers_seq: number;
		pinned: boolean;
		blob: Uint8Array;
		/** Never offload this one — hydration must be able to read it synchronously. */
		keep_inline?: boolean;
	}): Promise<PreparedSnapshot> {
		const inline_max =
			this.crdt_config.inline_snapshot_max_bytes ?? DEFAULT_INLINE_SNAPSHOT_MAX_BYTES;
		const bucket = this.crdt_config.r2?.();
		const base = {
			frontier: input.frontier,
			kind: input.kind,
			covers_seq: input.covers_seq,
			pinned: input.pinned,
			byte_size: input.blob.byteLength,
		};
		if (input.keep_inline || !bucket || input.blob.byteLength <= inline_max) {
			return { ...base, blob: input.blob, r2_key: null };
		}
		const prefix = this.crdt_config.snapshot_key_prefix ?? 'snapshots/';
		const r2_key = `${prefix}${this.ctx.id.toString()}/${encodeURIComponent(input.frontier)}.loro`;
		await bucket.put(r2_key, input.blob);
		return { ...base, blob: null, r2_key };
	}

	/**
	 * Insert a prepared snapshot. `INSERT OR IGNORE` then a pin update: a
	 * frontier already snapshotted holds exactly the same bytes, so re-writing
	 * it would be pure churn — but a snapshot that was incidental and is now a
	 * checkpoint's lifeline must gain its pin.
	 */
	private writeSnapshot(prepared: PreparedSnapshot, now: number): void {
		this.sql.exec(
			`INSERT INTO crdt_snapshot (frontier, kind, r2_key, blob, byte_size, covers_seq, pinned, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT (frontier) DO UPDATE SET pinned = MAX(crdt_snapshot.pinned, excluded.pinned)`,
			prepared.frontier,
			prepared.kind,
			prepared.r2_key,
			prepared.blob,
			prepared.byte_size,
			prepared.covers_seq,
			prepared.pinned ? 1 : 0,
			now,
		);
	}

	/**
	 * Trim the op log, keeping every promise the document has made.
	 *
	 * The order of operations is the whole design:
	 *
	 * 1. Decide a **boundary** — the head of the log, pulled back to the
	 *    {@link peerFloor} if a live peer has not caught up. Never trim past a
	 *    peer that may still hold unsynced operations.
	 * 2. For every checkpoint at or before the boundary with no snapshot at its
	 *    exact frontier, replay to that checkpoint and snapshot it, **pinned**.
	 *    This happens before a single blob is deleted, which is what makes
	 *    invariant 3 ("every checkpoint stays checkoutable forever") true.
	 * 3. Snapshot the boundary itself.
	 * 4. Delete the update blobs at or below the boundary, and any unpinned
	 *    snapshot the boundary supersedes.
	 *
	 * Steps 2–4 run in one `transactionSync`. If the result would be *larger*
	 * than what it replaced — which really happens: a 9-op document with one
	 * checkpoint measured 871B → 1188B, because a mandatory checkpoint snapshot
	 * costs more than the handful of blobs it stands in for — the transaction is
	 * rolled back and the run reports `would_not_shrink`. Invariant 7 is only
	 * true at or above the threshold, and this is how it is *made* true rather
	 * than assumed.
	 *
	 * @param options.force Run regardless of threshold and shrinkage. For tests
	 * and for an explicit "compact now" action; the daily alarm should not use it.
	 */
	async compact(options: { force?: boolean } = {}): Promise<CompactionResult> {
		this.ensureHydrated();
		const now = Date.now();
		const bytes_before = this.storageStats().total_bytes;
		const head = this.head_seq;
		const floor = this.peerFloor(now);
		const skip = (skipped_reason: CompactionSkipReason): CompactionResult => ({
			skipped: true,
			skipped_reason,
			snapshots_written: 0,
			updates_discarded: 0,
			bytes_before,
			bytes_after: bytes_before,
			boundary_seq: 0,
			peer_floor_seq: floor,
		});

		if (head === 0) return skip('nothing_to_do');
		if ((this.crdt_config.retention?.() ?? 'default') === 'forever' && !options.force) {
			return skip('retention_forever');
		}
		const threshold =
			this.crdt_config.compact_threshold_bytes ?? DEFAULT_COMPACT_THRESHOLD_BYTES;
		if (this.sumUpdateBytes() < threshold && !options.force)
			return skip('below_threshold');

		const boundary_seq = floor === null ? head : Math.min(head, floor);
		const discardable = Number(
			this.sql
				.exec<{ count: number }>(
					'SELECT COUNT(*) AS count FROM crdt_update WHERE seq <= ?',
					boundary_seq,
				)
				.one().count,
		);
		if (discardable === 0) return skip(floor === null ? 'nothing_to_do' : 'peer_floor');

		/* Phase A — produce every blob. Async, because tiering to R2 is. */
		const prepared: PreparedSnapshot[] = [];
		const snapshotted = new Set(
			this.sql
				.exec<{ frontier: string }>('SELECT frontier FROM crdt_snapshot')
				.toArray()
				.map((row) => row.frontier),
		);
		for (const checkpoint of this.listCheckpoints()) {
			if (snapshotted.has(checkpoint.frontier)) continue;
			const seq = this.seqOfFrontier(checkpoint.frontier);
			if (seq === null || seq > boundary_seq) continue;
			const replayed = await this.replayTo(seq);
			// Already unreachable (an earlier run trimmed past it); nothing to save.
			if (encodeFrontier(replayed.frontiers()) !== checkpoint.frontier) continue;
			prepared.push(
				await this.prepareSnapshot({
					frontier: checkpoint.frontier,
					kind: 'shallow',
					covers_seq: seq,
					pinned: true,
					blob: exportShallowHere(replayed),
				}),
			);
			snapshotted.add(checkpoint.frontier);
		}

		const boundary_doc =
			boundary_seq === head ? this.#doc : await this.replayTo(boundary_seq);
		const boundary_frontier = encodeFrontier(boundary_doc.frontiers());
		const boundary_blob = exportShallowHere(boundary_doc);
		const boundary_snapshot = await this.prepareSnapshot({
			frontier: boundary_frontier,
			kind: 'shallow',
			covers_seq: boundary_seq,
			pinned: false,
			blob: boundary_blob,
			// Hydration reads the newest snapshot synchronously, so the one it
			// will reach for must never be behind an await.
			keep_inline: true,
		});

		/* Phase B — one transaction: write, delete, verify it shrank. */
		let result: CompactionResult;
		try {
			result = this.store.transactionSync(() => {
				for (const snapshot of prepared) this.writeSnapshot(snapshot, now);
				this.writeSnapshot(boundary_snapshot, now);
				this.sql.exec('DELETE FROM crdt_update WHERE seq <= ?', boundary_seq);
				this.sql.exec(
					'DELETE FROM crdt_snapshot WHERE pinned = 0 AND covers_seq < ? AND frontier <> ?',
					boundary_seq,
					boundary_frontier,
				);
				const bytes_after = this.storageStats().total_bytes;
				if (bytes_after > bytes_before && !options.force) throw ROLLBACK;
				return {
					skipped: false,
					snapshots_written: prepared.length + 1,
					updates_discarded: discardable,
					bytes_before,
					bytes_after,
					boundary_seq,
					peer_floor_seq: floor,
				} satisfies CompactionResult;
			});
		} catch (error) {
			if (error === ROLLBACK) return skip('would_not_shrink');
			throw error;
		}

		/* Adopt the compacted state, so the shallow code paths are exercised
		   immediately rather than only after the next Durable Object restart. */
		const rebuilt = new LoroDoc();
		rebuilt.import(boundary_blob);
		for (const row of this.sql
			.exec<{ update_blob: unknown }>(
				'SELECT update_blob FROM crdt_update WHERE seq > ? ORDER BY seq ASC',
				boundary_seq,
			)
			.toArray()) {
			rebuilt.import(toBytes(row.update_blob));
		}
		this.#doc = rebuilt;
		return result;
	}

	/* ---------------------------------------------------------------------- */
	/* Projection                                                             */
	/* ---------------------------------------------------------------------- */

	/**
	 * Run `config.project` against the current document, at most once per
	 * frontier.
	 *
	 * Idempotence is enforced here rather than trusted to the projector: a
	 * projection fans out to a search index, link rows and an R2 mirror, and
	 * "re-running it at the same version is free" is much easier to guarantee
	 * with one recorded frontier than in four downstream systems.
	 *
	 * Scheduling is the caller's: this class has no opinion about how long the
	 * debounce is, and running a projection inside `applyUpdate` would put a
	 * markdown serialization on every keystroke.
	 */
	async runProjection(options: { force?: boolean } = {}): Promise<boolean> {
		this.ensureHydrated();
		const project = this.crdt_config.project;
		if (!project) return false;
		const frontier = this.frontier;
		if (!options.force && this.meta('last_projection_frontier') === frontier)
			return false;
		await project(this.#doc, frontier);
		this.setMeta('last_projection_frontier', frontier);
		this.setMeta('last_projection_at', String(Date.now()));
		return true;
	}

	/** Read one `doc_meta` value. */
	meta(key: string): string | null {
		this.ensureHydrated();
		const row = this.sql
			.exec<{ value: string }>('SELECT value FROM doc_meta WHERE key = ?', key)
			.toArray()[0];
		return row?.value ?? null;
	}

	/** Write one `doc_meta` value. */
	setMeta(key: string, value: string): void {
		this.ensureHydrated();
		this.sql.exec(
			`INSERT INTO doc_meta (key, value) VALUES (?, ?)
			 ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
			key,
			value,
		);
	}
}

/**
 * Which Loro peer produced an update blob.
 *
 * Read from the blob's own header rather than inferred from the frontier: an
 * update that arrives out of causal order does not move the frontier at all, so
 * the frontier cannot identify it. Best-effort — a blob this fails on will
 * still be logged, just without attribution.
 */
function peerOf(blob: Uint8Array): string {
	try {
		const meta = decodeImportBlobMeta(blob, false);
		for (const peer of meta.partialEndVersionVector.toJSON().keys()) return String(peer);
	} catch {
		/* not fatal — see above */
	}
	return '';
}
