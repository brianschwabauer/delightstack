/**
 * The private SQLite schema of a `CrdtDocumentServer`.
 *
 * This is **not** a `@delightstack/database` schema — it is raw SQLite inside
 * one Durable Object, owned entirely by this package. Nothing else reads it,
 * so it has no config versions and no migrations beyond `CREATE … IF NOT
 * EXISTS`; a new column is added by a guarded `ALTER TABLE` in `migrate()`.
 */
export const SCHEMA_STATEMENTS: readonly string[] = [
	/*
	 * The op log. Append-only, and the only durable record of *how* the document
	 * got where it is — the snapshots below are derived from it, never the other
	 * way round.
	 *
	 * `frontier` is the document's frontier AFTER this row was applied. Storing
	 * it is what makes history listing and time travel free of blob reads:
	 * `getVersion()` maps a frontier to a `seq` with an index lookup instead of
	 * replaying to find it, and `listSessions()` can hand out diffable
	 * start/end points without decoding a single update.
	 *
	 * `byte_size` is denormalised rather than computed with `LENGTH(blob)` so
	 * the compaction threshold check is a single `SUM` over a narrow column.
	 */
	`CREATE TABLE IF NOT EXISTS crdt_update (
		seq          INTEGER PRIMARY KEY AUTOINCREMENT,
		op_id        TEXT NOT NULL UNIQUE,
		actor        TEXT NOT NULL,
		peer_id      TEXT NOT NULL,
		update_blob  BLOB NOT NULL,
		frontier     TEXT NOT NULL,
		byte_size    INTEGER NOT NULL,
		created_at   INTEGER NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS crdt_update_created ON crdt_update (created_at)`,
	`CREATE INDEX IF NOT EXISTS crdt_update_frontier ON crdt_update (frontier)`,

	/*
	 * Snapshots. `frontier` is the primary key because "a snapshot at exactly
	 * this point" is the thing the checkpoint-reachability invariant is stated
	 * in terms of — two rows at one frontier would be two answers to a question
	 * that has one.
	 *
	 * `pinned` marks a snapshot that exists to keep a checkpoint reachable.
	 * Pinned snapshots are never thinned; that is the whole invariant.
	 */
	`CREATE TABLE IF NOT EXISTS crdt_snapshot (
		frontier     TEXT PRIMARY KEY,
		kind         TEXT NOT NULL,
		r2_key       TEXT,
		blob         BLOB,
		byte_size    INTEGER NOT NULL,
		covers_seq   INTEGER NOT NULL,
		pinned       INTEGER NOT NULL DEFAULT 0,
		created_at   INTEGER NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS crdt_snapshot_covers ON crdt_snapshot (covers_seq)`,

	/*
	 * Checkpoints.
	 *
	 * `02-data-model.md` puts the user-visible `checkpoint` rows in
	 * `WorkspaceDO`, and they belong there — that is where they are listed,
	 * filtered and joined against the tree. But compaction cannot ask another
	 * Durable Object a synchronous question, and "which frontiers must stay
	 * reachable?" has to be answered *inside the transaction that deletes
	 * blobs*. So the document keeps its own copy: this table is the authority
	 * for reachability, the workspace copy is the authority for presentation.
	 */
	`CREATE TABLE IF NOT EXISTS crdt_checkpoint (
		id           TEXT PRIMARY KEY,
		kind         TEXT NOT NULL,
		label        TEXT NOT NULL,
		actor        TEXT NOT NULL,
		frontier     TEXT NOT NULL,
		covers_seq   INTEGER NOT NULL,
		created_at   INTEGER NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS crdt_checkpoint_covers ON crdt_checkpoint (covers_seq)`,

	/*
	 * Live peers — the compaction floor.
	 *
	 * See `CrdtDocumentServer.peerFloor()`. A peer holds history open until it
	 * has acknowledged it, or until it has been silent long enough to be
	 * presumed dead.
	 */
	`CREATE TABLE IF NOT EXISTS crdt_peer (
		peer_key     TEXT PRIMARY KEY,
		acked_seq    INTEGER NOT NULL,
		seen_at      INTEGER NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS crdt_peer_seen ON crdt_peer (seen_at)`,

	/* Small key/value bag: node_id, schema_version, last_projection_frontier, … */
	`CREATE TABLE IF NOT EXISTS doc_meta (
		key          TEXT PRIMARY KEY,
		value        TEXT NOT NULL
	)`,
];
