import {
	SqlDatabase,
	addableColumnDefinition,
	type ExecStatement,
	type Migration,
	type MigrationStatus,
} from './sql.database.js';
import {
	CHANGES_TABLE,
	CHANGE_TRIGGER_PREFIX,
	WRITE_MARK_COLUMN,
	capturesBeforeImage,
	changeTriggerStatements,
} from './schema.sql.js';
import { prepareSql, SqlQueryFn } from './sql.helper.js';
import { deepEqual } from 'fast-equals';
import type { Database } from '../schema/schema.js';
import type { FileReference, VectorField } from '../schema/field-types.js';
import type { DatabaseBroadcast } from '../contract.js';
import { normalizeWhere } from '../search-query.js';
import type { SearchQuery, SearchQueryResults } from '../search/core/types.js';
import {
	SqliteSearchEngine,
	whereContext,
	type ServerDocument,
	type ServerSearchTable,
} from '../search/server/engine.js';
import {
	GENERATED_COLUMN_PREFIX,
	planGeneratedColumnMigration,
	planGeneratedColumns,
	quoteIdentifier,
} from '../search/server/sql_where.js';
import {
	buildServerSearchTable,
	type SearchTableSource,
} from '../search/server/table_config.js';
import { SEARCH_INDEX_FORMAT } from '../search/server/sqlite_store.js';
import { fieldTokenLimit } from '../search/core/tokenizer.js';
import { generateTimestampID, DelightError } from '@delightstack/utilities';

interface Env {
	DEV: boolean;
}

/**
 * Legacy `search_journal` rows cleared per teardown invocation. DO SQLite
 * deletes row by row (DROP TABLE included), so the journal — one msgpack row
 * per document — must be emptied in bounded chunks before the DROP. Sized for
 * the rows as they actually are, not as plain rows: journal entries carry
 * multi-KB msgpack blobs and measured ~6.5ms per deleted row on a production
 * Durable Object, so 5000 (the original default) burned the whole 30s CPU
 * budget in one chunk. 500 ≈ ~3s worst case; `legacyJournalDropBatch()` lets
 * a subclass tune it further.
 */
const LEGACY_JOURNAL_DROP_BATCH = 500;

/** The `where` grammar's composite keys — containers, not field names. */
const WHERE_COMPOSITE_KEYS = new Set(['and', 'or', 'not']);

/**
 * Rejects any query that tries to filter, order or search on a *carried* field.
 *
 * A carried field is delivered to the client but never indexed, so it has no
 * entry in `index_schema`, no posting list and no column the engine can compile
 * against. Every such path would already fail deeper down — `normalizeWhere`
 * with `unknown_filter_field`, `resolveSearchFields` with
 * `unknown_search_field` — but "unknown" is a lie that sends the caller looking
 * for a typo. This says what actually happened, and it says it once, at the top
 * of the query, for all three surfaces.
 */
function assertNotCarried(
	carried_fields: readonly string[],
	query: { where?: unknown; order?: unknown; fields?: unknown },
): void {
	if (carried_fields.length === 0) return;
	const carried = new Set(carried_fields);
	const reject = (field: string, surface: string): never => {
		throw new DelightError({
			message: `Field "${field}" is carried, not indexed — it is delivered to the client but never enters the search index, so it cannot be used in ${surface}. Mark it .searchable() if it needs to be queryable.`,
			status: 400,
			code: 'carried_field_not_queryable',
		});
	};

	/** Walk the `where` tree, checking every leaf key against the carried set. */
	const walkWhere = (node: unknown, depth: number): void => {
		// The same depth ceiling `core/where` enforces — a hostile `where` must
		// not be able to blow the stack in the guard that is meant to protect it.
		if (depth > 10 || !node || typeof node !== 'object') return;
		if (Array.isArray(node)) {
			for (const child of node) walkWhere(child, depth + 1);
			return;
		}
		for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
			if (WHERE_COMPOSITE_KEYS.has(key)) {
				walkWhere(value, depth + 1);
				continue;
			}
			if (carried.has(key)) reject(key, 'a `where` clause');
		}
	};
	walkWhere(query.where, 0);

	if (Array.isArray(query.order)) {
		for (const entry of query.order) {
			const field = (entry as { field?: unknown } | null)?.field;
			if (typeof field === 'string' && carried.has(field)) reject(field, '`order`');
		}
	}
	if (Array.isArray(query.fields)) {
		for (const field of query.fields) {
			if (typeof field === 'string' && carried.has(field)) {
				reject(field, "a search's `fields` list");
			}
		}
	}
}

/** The actor recorded when nothing scoped the write. */
export const DEFAULT_ACTOR = 'system';

/** The shared change-log table every history-enabled table writes into. */
const CHANGE_LOG_TABLE = '_change_log';

/** Change-log rows deleted per sweeper invocation, per table. */
const CHANGE_LOG_SWEEP_BATCH = 1000;

/**
 * The largest operation `revertOperation()` will undo in one go.
 *
 * The whole revert runs inside a single Durable Object transaction (that is
 * what makes it atomic), and a DO transaction has a CPU budget. Matching
 * `transaction()`'s own 5,000-operation ceiling keeps the two limits from
 * surprising each other.
 */
const REVERT_OPERATION_MAX_CHANGES = 5000;

export { CHANGES_TABLE, WRITE_MARK_COLUMN } from './schema.sql.js';

/** Raw writes the catch-up could not process, set aside so they block nothing. */
const CHANGES_FAILED_TABLE = '_changes_failed';

/** Prefix of the transitional triggers that guard the JSON column move. */
const JSON_CLEAR_TRIGGER_PREFIX = '_mv_';

/** The SET fragment every library UPDATE of an entity row carries. */
const WRITE_MARK_FLIP = `"_w" = 1 - "_w"`;

/** Rows the drain consumes per transaction. */
const CHANGE_DRAIN_BATCH = 200;

/**
 * Batches an automatic drain (a read, a write, the alarm) runs before it
 * hands the rest to the alarm: 2,000 rows, a few hundred ms. Without the
 * cap, a 200k-row raw import would be caught up inside whichever request
 * happened to arrive next and could run it past the CPU limit.
 */
const CHANGE_DRAIN_AUTO_BATCHES = 10;

/** The internal dedupe log every `{ op_id }` write is recorded in. */
const OP_LOG_TABLE = '_op_log';

/**
 * How long a recorded operation stays replayable.
 *
 * Seven days is the offline outbox's horizon: a device that has been away
 * longer has almost certainly been reset or re-synced, and keeping the log
 * indefinitely would make it the largest thing in a write-heavy database.
 */
const OP_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Op-log rows deleted per sweeper invocation. */
const OP_LOG_SWEEP_BATCH = 1000;

/** How often the op-log sweeper runs when nothing is left to delete. */
const OP_LOG_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** The kinds of write the op log can record. */
export type OperationKind = 'create' | 'update' | 'delete' | 'transaction';

/** One write recorded in the op log — see {@link DatabaseServer.appliedOperation}. */
export interface AppliedOperation {
	/** The client-generated id the write carried */
	op_id: string;
	/** Which entry point applied it */
	kind: OperationKind;
	/** The entity type it wrote, or `undefined` for a multi-table `transaction()` */
	table: string | undefined;
	/** The primary key it wrote, as text, when there was exactly one */
	entity_id: string | undefined;
	/**
	 * What the write returned, as recorded. `blob()` columns come back as the
	 * {@link BLOB_OMITTED} marker rather than their bytes.
	 */
	result: unknown;
	/** When the write was applied, from the Durable Object's clock (epoch ms) */
	created_at: number;
}

/** The internal queue of store objects whose owning row is gone. */
const FILE_GC_TABLE = '_file_gc';

/** Default / maximum page size for {@link DatabaseServer.pendingFileDeletions}. */
const FILE_GC_DEFAULT_LIMIT = 100;
const FILE_GC_MAX_LIMIT = 1000;

/** The internal auto-embedding queue (DS-05) — one row per pending vector. */
const EMBED_QUEUE_TABLE = '_embed_queue';

/** How long after the last source-field change a vector regenerates, unless `embedFrom` says. */
const EMBED_DEFAULT_DEBOUNCE_MS = 5_000;

/** How many due queue rows one alarm tick embeds (one embedder call per model). */
const EMBED_BATCH_SIZE = 20;

/** After this many failed attempts a queue row is dropped (and logged). */
const EMBED_MAX_ATTEMPTS = 8;

/**
 * From this many failed attempts on, a row is retried **alone** rather than in
 * the shared per-model batch. An embedder failure fails its whole call, so one
 * poisoned text would otherwise walk up to 19 innocent rows to the attempt
 * ceiling with it; three shared failures buys the transient-outage case its
 * batching back, and past that the poison isolates — the good rows embed
 * singly and only the truly failing row reaches {@link EMBED_MAX_ATTEMPTS}.
 */
const EMBED_SINGLE_RETRY_ATTEMPTS = 3;

/**
 * The default {@link EmbedFromConfig.max_chars}: roughly what a 512-token
 * embedding window (bge-base's) holds of English text.
 */
const EMBED_DEFAULT_MAX_CHARS = 2000;

/** Retry backoff: `min(EMBED_RETRY_BASE_MS * 2^attempts, EMBED_RETRY_MAX_MS)`. */
const EMBED_RETRY_BASE_MS = 5_000;
const EMBED_RETRY_MAX_MS = 10 * 60_000;

/**
 * The function {@link DatabaseServer.registerEmbedder} takes: given the source
 * texts of one batch (all sharing one `model`, which may be `undefined` when
 * the schema named none), answer one vector per text, in order. Typically a
 * thin wrapper over Workers AI or `@delightstack/ai`'s gateway. A throw fails
 * the whole batch, which is retried with backoff — it never fails the mutation
 * that queued it, because that committed long before.
 */
export type DatabaseEmbedder = (
	texts: string[],
	model: string | undefined,
) => Promise<number[][]>;

/** One resolved `.embedFrom()` declaration, validated against its table. */
interface ResolvedEmbedConfig {
	/** The vector field the embedding is written to */
	field: string;
	/** The top-level fields the source text is built from, in declared order */
	source_fields: string[];
	/** The model name handed to the embedder (the embedder may default it) */
	model?: string;
	/** How long after the last source change the embedding regenerates */
	debounce_ms: number;
	/** The most characters of source text handed to the embedder */
	max_chars: number;
	/** The declared vector size — an embedder answer of any other length is an error */
	dimensions: number;
}

/** One `_embed_queue` row. */
interface EmbedQueueRow {
	entity_type: string;
	entity_id: string;
	field: string;
	due_at: number;
	attempts: number;
}

/**
 * One store object whose row no longer references it — a queued *intent* to
 * delete, not a guarantee that deleting is safe. See
 * {@link DatabaseServer.pendingFileDeletions}.
 */
export interface PendingFileDeletion {
	/** The queue row's own id — pass it to `releaseFileDeletion()` when done */
	id: string;
	/** The binding the object lives in: the reference's own `store`, or the field's default */
	store: string;
	/** The object key within that store */
	key: string;
	/** The entity type whose row held the reference */
	entity_type: string;
	/** The primary key of the row that held it, as text */
	entity_id: string;
	/** When the reference was dropped, from the Durable Object's clock (epoch ms) */
	deleted_at: number;
}

/** Options for {@link DatabaseServer.pendingFileDeletions} */
export interface PendingFileDeletionsOptions {
	/** Maximum rows to return (default 100, max 1000) */
	limit?: number;
}

/**
 * Marks a blob column whose bytes were deliberately not recorded in the change
 * log. See `historyPayload()` for why, and `revert()` for what it means.
 */
export const BLOB_OMITTED = '__blob_omitted';

/**
 * Read a value at a dot path. File fields are recorded at their path so a
 * reference nested inside an `object()` is still found — a flat lookup would
 * miss it, and the object it points at would never be queued for deletion.
 */
function readFieldPath(source: Record<string, unknown>, path: string): unknown {
	if (!path.includes('.')) return source[path];
	let current: unknown = source;
	for (const segment of path.split('.')) {
		if (!current || typeof current !== 'object' || Array.isArray(current))
			return undefined;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

/** The blob columns in a recorded payload whose bytes were not kept. */
function omittedBlobFields(payload: Record<string, unknown> | undefined): string[] {
	if (!payload) return [];
	return Object.entries(payload)
		.filter(
			([, value]) =>
				!!value &&
				typeof value === 'object' &&
				(value as Record<string, unknown>)[BLOB_OMITTED] === true,
		)
		.map(([key]) => key);
}

/** How often the retention sweeper runs when nothing is left to delete. */
const CHANGE_LOG_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Milliseconds in a day — the unit `history_retention_days` is expressed in. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** The three mutations a change-log row can describe. */
export type ChangeLogOperation = 'create' | 'update' | 'delete';

/**
 * One recorded mutation of a history-enabled table.
 *
 * Stored in `_change_log` with `patch_json` / `previous_json` as JSON text; the
 * `history()` / `changesSince()` APIs hand back this parsed form.
 */
export interface ChangeLogEntry {
	/** The change's own id (time-sortable) */
	id: string;
	/** The entity type (table) the change applies to */
	table: string;
	/** The primary key of the changed entity, as text */
	entity_id: string;
	/** Which mutation this row describes */
	operation: ChangeLogOperation;
	/** Who made the change — a `{ actor }` write option, or `'system'` when unscoped */
	actor: string;
	/**
	 * The operation this change was part of — a `{ operation }` write option, or
	 * `undefined` for a write that was not grouped.
	 *
	 * Rows sharing an operation id are undone as one unit by `revertOperation()`.
	 */
	operation_id?: string;
	/**
	 * What the change wrote: the full entity for a create, only the fields whose
	 * values actually changed for an update, and `undefined` for a delete.
	 */
	patch: Record<string, unknown> | undefined;
	/**
	 * What the change overwrote: `undefined` for a create, the previous values
	 * of exactly the fields in `patch` for an update, and the full entity for a
	 * delete (which is what makes a delete revertible).
	 */
	previous: Record<string, unknown> | undefined;
	/** When the change was recorded, from the Durable Object's clock (epoch ms) */
	created_at: number;
}

/**
 * Write options plus the internal escape hatch `revert()` needs. Not part of the
 * public `update()` signature: restoring a readonly column is legitimate only
 * because the row demonstrably held that value before.
 */
interface InternalWriteOptions extends WriteOptions {
	allow_readonly?: boolean;
}

/** Options accepted by {@link DatabaseServer.revert}. */
export interface RevertOptions extends WriteOptions {
	/**
	 * Restore everything except blob columns whose bytes the change log did not
	 * keep, instead of refusing. The columns are left unset, so this still fails
	 * if one of them is required. Defaults to `false` — losing blob data is not
	 * something to do by accident.
	 */
	without_blobs?: boolean;
}

/** Options accepted by every write that can be attributed to an actor. */
export interface WriteOptions {
	/**
	 * Who is performing the write. Recorded on every change-log row for tables
	 * that opted into `history`. Defaults to `'system'`.
	 *
	 * `scoped(db, actor)` is the ergonomic form of this option for a run of
	 * writes; the option itself exists because it survives the Durable Object
	 * RPC boundary, which an object carrying methods does not.
	 *
	 * NOTE: the actor does **not** currently reach `createDatabaseHandle`'s
	 * lifecycle hooks, and `DatabaseClient` has no actor of its own. Both are
	 * still to be built.
	 */
	actor?: string;
	/**
	 * An id grouping every change this write produces with the other changes of
	 * the same logical operation — an import, a bulk retag, one agent run.
	 *
	 * Recorded on each change-log row, read back with `db.operationChanges(id)`, and
	 * undone as a unit with `db.revertOperation(id)`. Undo is almost always wanted
	 * at operation granularity ("undo that import"), not row granularity, and
	 * nothing else in the log can reconstruct which 4,000 rows belonged
	 * together — timestamps and actor both group too much.
	 *
	 * Opaque to the database: any non-empty string. Blank or whitespace-only is
	 * treated as absent. Threaded exactly like {@link WriteOptions.actor}, so it
	 * also applies to bare-`db` writes made inside a scoped `batch()`.
	 */
	operation?: string;
	/**
	 * A client-generated id making this write idempotent.
	 *
	 * The first write carrying it is applied and recorded in the internal
	 * `_op_log`; every later write carrying the same id is **not applied** and
	 * returns the original result instead. That is what lets an offline outbox,
	 * a retrying agent, or a replayed queue drain send the same mutation twice
	 * without writing it twice.
	 *
	 * Mint it with `generateTimestampID()` from `@delightstack/utilities`, on the
	 * client, *before* the first attempt — an id minted per attempt deduplicates
	 * nothing.
	 *
	 * Recorded results expire after seven days; see
	 * {@link DatabaseServer.appliedOperation}.
	 */
	op_id?: string;
}

/** Options accepted by {@link DatabaseServer.create}. */
export interface CreateOptions extends WriteOptions {
	/**
	 * Honour a primary key supplied in the data instead of minting one.
	 *
	 * What makes an offline create possible: the row has to have its final
	 * identity the moment it is queued, because the edits queued behind it
	 * already name it. A key that is already taken is a `409` (`entity_exists`)
	 * rather than a silent overwrite.
	 *
	 * Only meaningful for `primary_key_type: 'string'` tables — a numeric key is
	 * the database's to assign.
	 */
	preserve_id?: boolean;
}

/** Options for {@link DatabaseServer.history} */
export interface HistoryOptions {
	/** Maximum entries to return (default 50, max 1000) */
	limit?: number;
	/** Only return changes recorded strictly before this epoch-ms timestamp */
	before?: number;
}

/** Options for {@link DatabaseServer.changesSince} */
export interface ChangesSinceOptions {
	/** Maximum entries to return (default 500, max 5000) */
	limit?: number;
	/** Restrict to a single entity type */
	table?: string;
	/**
	 * Restrict to changes recorded under one `{ operation }` id.
	 *
	 * Combines with `table`: both narrow. Use this to follow one long-running
	 * operation's progress through the same feed everything else arrives on.
	 */
	operation?: string;
}

/** Options for {@link DatabaseServer.operationChanges} */
export interface OperationChangesOptions {
	/** Maximum entries to return (default 500, max 5000) */
	limit?: number;
}

/**
 * The actor-scoped write surface returned by `scoped(db, actor)`.
 *
 * A thin façade, not a new database: every method forwards to the same
 * `DatabaseServer` with the actor threaded through, so a scoped write is
 * indistinguishable from an unscoped one apart from what the change log
 * records.
 */
export interface ScopedDatabase<DatabaseConfig extends Record<string, Database.Table>> {
	/** The actor every write through this handle is attributed to */
	readonly actor: string;
	/**
	 * The operation id every write through this handle is grouped under, or
	 * `undefined` when the handle was created without one.
	 */
	readonly operation_id: string | undefined;
	create<
		Type extends keyof DatabaseConfig & string,
		Table extends DatabaseConfig[Type],
		OutputData extends Database.Entity<Table>,
		InputData extends Omit<OutputData, 'id' | 'created_at' | 'updated_at'>,
	>(
		entity_type: Type,
		unsafe_data: InputData,
	): OutputData;
	update<
		Type extends keyof DatabaseConfig & string,
		Table extends DatabaseConfig[Type],
		OutputData extends Database.Entity<Table>,
		InputData extends DeepPartial<OutputData>,
	>(
		entity_type: Type,
		id: string | number,
		unsafe_data: InputData,
	): OutputData;
	delete<Type extends keyof DatabaseConfig & string>(
		entity_type: Type,
		id: string | number,
	): void;
	transaction(
		operations: DatabaseServerTransaction<DatabaseConfig>[],
	): DatabaseServerTransactionResult<DatabaseConfig>[];
	batch<T>(fn: () => T): T;
	revert(change_id: string): Record<string, unknown> | undefined;
	/**
	 * Raw SQL, with any write it makes caught up (search, sync, history,
	 * broadcast) and its history attributed to this handle's actor.
	 */
	exec<Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
		sql_statement: string,
		...bindings: any[]
	): Row[];
}

/**
 * Attribute every write made through the returned handle to `actor`.
 *
 * ```ts
 * const claude = scoped(db, 'agent:claude');
 * claude.update('post', id, { title });
 * ```
 *
 * The actor lands in the change log; an unattributed write is `'system'`.
 * Equivalent to passing `{ actor }` as the trailing option on each mutator —
 * this is sugar for a run of writes that share one actor (an import, an agent
 * session, a migration).
 *
 * The optional third argument groups those writes under one operation id, so the
 * whole run can be undone with `db.revertOperation(operation_id)`:
 *
 * ```ts
 * const import_id = crypto.randomUUID();
 * const importer = scoped(db, 'import', import_id);
 * for (const row of rows) importer.create('post', row);
 * // …later
 * db.revertOperation(import_id);
 * ```
 *
 * It is a plain string rather than an options object for the same reason
 * `actor` is: these are the two attributes of a scope, both opaque, and a
 * two-string signature reads at the call site (`scoped(db, 'import', id)`)
 * better than a wrapper. Blank or whitespace-only means "no operation".
 *
 * Deliberately a free function rather than a `db.as()` method: a method
 * returning `ScopedDatabase<Config>` makes `DatabaseServer` invariant in its
 * config type parameter, which breaks any consumer that widens or narrows a
 * `DatabaseServer<Config>`. A standalone helper keeps the class's variance
 * untouched.
 *
 * The handle carries methods, which cannot cross a Durable Object RPC
 * boundary — call this inside the Durable Object. From outside (a
 * `DatabaseStub`), pass `{ actor }` to the mutator directly.
 */
export function scoped<
	DatabaseConfig extends Record<string, Database.Table>,
	Meta extends Record<string, any> = Record<string, any>,
>(
	db: DatabaseServer<DatabaseConfig, Meta>,
	actor: string,
	operation?: string,
): ScopedDatabase<DatabaseConfig> {
	const resolved = actor?.trim() || DEFAULT_ACTOR;
	const resolved_operation = operation?.trim() || undefined;
	const options: WriteOptions = { actor: resolved, operation: resolved_operation };
	return {
		actor: resolved,
		operation_id: resolved_operation,
		create: (entity_type, unsafe_data) =>
			db.create(entity_type, unsafe_data as never, options) as never,
		update: (entity_type, id, unsafe_data) =>
			db.update(entity_type, id, unsafe_data as never, options) as never,
		delete: (entity_type, id) => db.delete(entity_type, id, options),
		transaction: (operations) => db.transaction(operations, options),
		batch: (fn) => db.batch(fn, options),
		revert: (change_id) => db.revert(change_id, options),
		// Inside a scoped batch, so the drain that exec() runs records history
		// under this actor and operation.
		exec: (sql_statement, ...bindings) =>
			db.batch(() => db.exec(sql_statement, ...bindings), options) as never,
	};
}

/**
 * An operation to perform in a database transaction.
 * This is typically added to an array used to batch multiple create/update/delete operations into a single transaction.
 */
export type DatabaseServerTransaction<
	DatabaseConfig extends Record<string, Database.Table>,
> =
	| {
			/** A 'create' operation which is functionally the same as calling db.create() */
			create: {
				/** The type of entity to create */
				type: keyof DatabaseConfig & string;
				/** The data for the new entity */
				data: any;
				/**
				 * Reuse the primary key and `created_at` present in `data` instead of
				 * generating fresh ones. This is what makes `revert()` able to undo a
				 * delete — the row comes back with the identity it had — and is
				 * equally useful for imports and restores. Off by default.
				 */
				preserve_id?: boolean;
			};
	  }
	| {
			/** An 'update' operation which is functionally the same as calling db.update() */
			update: {
				/** The type of entity to update */
				type: keyof DatabaseConfig & string;
				/** The ID of the entity to update */
				id: string | number;
				/** The data to update the entity with */
				data: any;
				/**
				 * Write `.readonly()` columns too, instead of stripping them.
				 * Only `revert()` sets this — it restores a state the row already
				 * held, so the usual immutability guard would drop exactly the
				 * columns it was asked to put back.
				 */
				allow_readonly?: boolean;
			};
	  }
	| {
			/** A 'delete' operation which is functionally the same as calling db.delete() */
			delete: {
				/** The type of entity to delete */
				type: keyof DatabaseConfig & string;
				/** The ID of the entity to delete */
				id: string | number;
			};
	  }
	| {
			/** A raw SQL 'exec' operation which executes the given statement with optional bindings */
			exec: {
				/** The SQL statement to execute */
				statement: string;
				/** Optional bindings for the SQL statement */
				bindings?: any[];
			};
	  };

/** A websocket entity-change notification held back until its batch commits. */
interface DeferredBroadcast {
	action: 'created' | 'updated' | 'deleted';
	entity_type: string;
	id: string | number;
	data?: unknown;
	sparse?: Record<string, unknown>;
}

export type DatabaseServerTransactionResult<
	DatabaseConfig extends Record<string, Database.Table>,
> =
	| {
			/** The result of a create, update, or delete operation */
			entity: {
				/** The type of entity involved in the operation */
				type: keyof DatabaseConfig & string;
				/** The data of the entity after the operation (undefined for deletes) */
				data?: any | undefined;
				/** The ID of the entity involved in the operation */
				id: string | number;
				/**
				 * The sparse (search-index) projection that was indexed (undefined for
				 * deletes). Broadcast to websocket clients so their local index
				 * receives exactly what the server indexed.
				 */
				sparse?: Record<string, unknown>;
				/**
				 * An update that changed nothing: no row was written, `updated_at`
				 * kept its value, and no client is told about it.
				 */
				unchanged?: true;
			};
	  }
	| {
			/** The result of a raw SQL 'exec' operation, in the form of an array of records */
			results: Record<string, SqlStorageValue>[];
	  };

/** A record of changes used to sync entities 'sparse' search data between client & server. */
export type DatabaseSyncRequest<DatabaseConfig extends Record<string, any>> = {
	/**
	 * A record of entities to fetch the changes for, each carrying its own
	 * range/limit — one request syncs any number of entity types at once.
	 * If this is undefined, it will return changes for all entities.
	 */
	entity?: {
		[Type in keyof DatabaseConfig & string]?: {
			/**
			 * A version number of the search config/schema that the client currently is using.
			 * If the server version is different, the server will return the new config/schema
			 * and the client will will reindex the data using the new schema.
			 * When omitted, no schema comparison happens (the response still carries the
			 * server's current `config_version`).
			 */
			config_version?: number;
			/** Limits the number of changes (inserts/deletes) to return in the response for this entity */
			limit?: number;
			/**
			 * The starting 'updated_at' timestamp of changes to this entity that should be returned.
			 * The 'updated_at' timestamp is changed to the current time every time any entity is created/updated/deleted.
			 * If this is provided, it will return changes in ASC order since this timestamp.
			 * If this is undefined, it will return changes in DESC order since 'end_updated_at' (or the current time if 'end_updated_at' is undefined).
			 */
			start_updated_at?: number;
			/**
			 * The ending 'updated_at' timestamp of changes to this entity that should be returned.
			 * If this is undefined and 'start_updated_at' is defined, it will return changes in ASC order since the 'start_updated_at'.
			 * If this is undefined and 'start_updated_at' is also undefined, it will return changes in DESC order before the current time.
			 * If this is defined and 'start_updated_at' is undefined, it will return changes in DESC order before this timestamp.
			 * If this is defined and 'start_updated_at' is also defined, it will return changes in ASC order between the 'start_updated_at' and 'end_updated_at'.
			 * This can be used to page the results so a bunch of results don't need to be returned at once.
			 */
			end_updated_at?: number;
			/**
			 * The client's sync ceiling for this entity. When the table's total
			 * row count exceeds it, the server withholds the page and answers
			 * with a count-only result (`deferred: true`) — the client then
			 * routes this entity's queries to the server instead of mirroring a
			 * table too large to download. Clients send this only during the
			 * backfill phase; once a table is fully mirrored, incremental pages
			 * are cheap regardless of size.
			 */
			defer_over?: number;
		};
	};
};

/** A record of changes used to sync entities 'sparse' search data between client & server. */
export type DatabaseSyncResponse<DatabaseConfig extends Record<string, any>> = {
	/**
	 * The starting 'updated_at' timestamp of all changes this sync event covers.
	 * The 'updated_at' timestamp is changed to the current time every time any entity is created/updated/deleted.
	 * This is used to determine if the client is up to date with the server.
	 */
	start_updated_at: number;
	/**
	 * The ending 'updated_at' timestamp of all changes this sync event covers.
	 * The 'updated_at' timestamp is changed to the current time every time any entity is created/updated/deleted.
	 * This is used to determine if the client is up to date with the server.
	 */
	end_updated_at: number;
	/**
	 * The epoch timestamp in ms when the first change event occurred.
	 * This will be 0 when the 'start_updated_at' equals the very first 'updated_at' timestamp in the database.
	 */
	first_updated_at: number;
	/**
	 * The epoch timestamp in ms when the last change event occurred.
	 * If this is greater than the end_updated_at timestamp, then there are more changes to be synced.
	 * To get the next set of changes, use the end_updated_at timestamp from this event as the start_updated_at for the next request
	 */
	last_updated_at: number;
	/** A record of entities that have changed since the last sync event */
	entity: {
		[Type in keyof DatabaseConfig & string]?: {
			/**
			 * The search schema. This is included only when the schema changes.
			 * When this changes, the client will completely reindex the data using the new schema.
			 */
			config?: Database.Table['config']['index_schema'];
			/** The version number of the config/schema for the search data. If this changes, the full list needs to be synced */
			config_version: number;
			/** The list of IDs of entities that have been deleted */
			deleted: (string | number)[];
			/** The list of entities that have been created */
			created: Database.SearchEntity<DatabaseConfig[Type]>[];
			/** The list of entities that have been updated */
			updated: Database.SearchEntity<DatabaseConfig[Type]>[];
			/**
			 * The starting timestamp of updates that these deletes/inserts cover for this entity
			 * This will be 0 when the client hasn't synced anything yet
			 */
			start_updated_at: number;
			/**
			 * The ending timestamp of updates that these deletes/inserts cover for this entity
			 * This is used for future sync requests to page the results so a bunch of results don't need to be returned at once.
			 * Just use the end_updated_at from this event as the start_updated_at for the next request
			 */
			end_updated_at: number;
			/**
			 * The epoch timestamp in ms when the first change event occurred for this entity.
			 * This will be 0 when the 'start_updated_at' equals the very first 'updated_at' timestamp in the database for this entity.
			 */
			first_updated_at: number;
			/**
			 * The epoch timestamp in ms when the last change event occurred for this entity
			 * If this is greater than the end_updated_at timestamp, then there are more changes to be synced.
			 * To get the next set of changes, use the end_updated_at timestamp from this event as the start_updated_at for the next request
			 */
			last_updated_at: number;
			/** The total number of rows in this entity's table. */
			total_count: number;
			/**
			 * Set when the request's `defer_over` was exceeded: the page was
			 * withheld (`created`/`updated`/`deleted` are empty and the window
			 * fields are 0 — no cursor advances). The client should treat this
			 * entity as server-answered until the count drops below its ceiling
			 * or the ceiling is raised.
			 */
			deferred?: true;
			/**
			 * Set when the server refused to sync this entity type for this
			 * client at all (a permission decision — e.g. a `beforeSync` hook on
			 * the entity's route). Nothing shipped and nothing ever will for
			 * this session: the client must stop backfilling the type and route
			 * its queries to the server. Unlike `deferred` this is not re-probed,
			 * because the answer cannot change without a new request context.
			 */
			denied?: true;
		};
	};
};

type DatabaseServerState<
	Database extends Record<string, Database.Table>,
	Meta = Record<string, any>,
> = {
	/** Additional metadata attached to this durable object */
	meta: Meta;
	/** The epoch timestamp in ms when the durable object was created */
	created_at: number;
	/** The epoch timestamp in ms when the durable object's schema was last updated */
	updated_at: number;
	/**
	 * A record of sql table configurations currently applied to the database.
	 * This is used to check if the table needs to be updated when the durable object starts up
	 * If, so the table fields will be updated to match the configuration
	 */
	table_config: {
		[TableName in keyof Database]?: Database.SqlTableConfig<Database[TableName]>;
	};
	/**
	 * The list of indexes that have been created in the database.
	 * When the config changes, the index will be updated to match the new config
	 */
	sql_indexes: Database.SqlIndexes;
	/**
	 * Per-entity-type state of the SQLite search driver.
	 *
	 * Presence of an entry means the entity type's search tables have been built
	 * at least once; `schema_signature` is the serialized search schema they were
	 * built from, so a schema change re-triggers the rebuild + config bump.
	 */
	native_search?: {
		[TableName in keyof Database]?: NativeSearchTableState;
	};
	/**
	 * Auto-embedding (DS-05) bookkeeping: `entity_type.field` → the serialized
	 * embed config the table's rows were last enqueued against. A mismatch on
	 * boot (new source fields, new model, new dimensions, or a field that never
	 * had one) re-enqueues every row of the table, which is what backfills an
	 * existing table the first time `.embedFrom()` appears on it.
	 */
	auto_embed?: Record<string, string>;
	/**
	 * Entity types whose rows have had every JSON-typed field moved out of the
	 * shared `json` overflow column into the field's own column (see "JSON
	 * columns"). Absent: the background move is still running (or has not
	 * started) for that type.
	 */
	json_columns_moved?: Record<string, true>;
	/**
	 * The last rowid moved per entity type while its move is under way, so a
	 * new instance (an eviction between slices) resumes instead of rescanning.
	 */
	json_columns_cursor?: Record<string, number>;
};

/** Per-entity-type bookkeeping of the SQLite search driver (see `native_search`). */
type NativeSearchTableState = {
	/** The search schema the tables were last rebuilt from */
	schema_signature: string;
	/** Whether the legacy `search_index` metadata has been migrated across */
	migrated: boolean;
	/**
	 * Present while a rebuild is in progress. A rebuild is chunked across wakes
	 * (constructor slice + alarm ticks) so a large corpus can never pin a single
	 * invocation past the Durable Object CPU limit; this cursor is what makes a
	 * killed or deferred rebuild resume where it left off instead of starting
	 * over. Checkpointed in the same transaction as each indexed batch.
	 */
	rebuild?: {
		/** The schema signature this rebuild is building towards */
		signature: string;
		/** The last primary key indexed — the next batch resumes after it */
		after?: string | number;
		/** Smallest `updated_at` seen so far (0 until one is seen) */
		first_updated_at: number;
		/** Largest `updated_at` seen so far */
		last_updated_at: number;
		/** Whether finalizing must bump `config_version` (i.e. clients existed) */
		bump_config_version: boolean;
	};
};

/**
 * One row of the legacy `search_index` table, read once by the migration that
 * moves its metadata into `search_state` / `search_tombstones` before the table
 * is dropped. Nothing writes this shape any more.
 */
interface LegacySearchIndexRow {
	/** The id of the legacy index row (`<entity_type>.<chunk>`) */
	id: string;
	/** The version number of the index config/schema */
	index_version: number;
	/** A JSON record of deleted entity ids → deletion epoch timestamps in ms */
	deleted_entity: string;
	/** The epoch timestamp in ms of the first change (an entity was created) */
	first_updated_at: number;
	/** The epoch timestamp in ms of the last change */
	last_updated_at: number;
}

type DeepPartial<T> = {
	[P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/** Construction options for {@link DatabaseServer}. */
export interface DatabaseServerOptions {
	/**
	 * Numbered schema/data changes, applied in order when the object wakes,
	 * before the declared schema's additive pass (new tables and columns are
	 * still added automatically). A brand-new database is created at the
	 * current schema and records every migration as applied without running
	 * it. See `Migration` for the contract.
	 */
	migrations?: Migration[];
}

/** One way the live database differs from the declared schema. */
export interface SchemaDrift {
	table: string;
	column?: string;
	index?: string;
	kind:
		| 'missing_table'
		| 'missing_column'
		| 'extra_column'
		| 'nullability'
		| 'type'
		| 'unique'
		| 'missing_index'
		| 'index_failed';
	declared?: string;
	live?: string;
	/** The migration step that would fix it */
	fix?: string;
}

/** One field's share of the search index (see `searchReport()`). */
export interface SearchFieldReport {
	field: string;
	/** Documents with a value in the field. */
	documents: number;
	/** Distinct words in the field's dictionary. */
	words: number;
	/** Words that occur in exactly one document. */
	single_use_words: number;
	/** Index entries (one per word per document): the rows each write pays for. */
	entries: number;
	/** Estimated bytes of those entries. */
	entry_bytes: number;
	/** Average distinct words indexed per document. */
	words_per_document: number;
	/** The field's `max_tokens` cap. */
	max_tokens: number | 'none';
	/** Documents whose value hit the cap (the rest of the value isn't searchable). */
	capped_documents: number;
	/** What looks wrong, in plain words, with the fix. */
	warnings: string[];
}

/** `searchReport()`: how big each table's search index is, and why. */
export interface SearchReport {
	tables: {
		entity_type: string;
		documents: number;
		entries: number;
		entry_bytes: number;
		fields: SearchFieldReport[];
	}[];
	/** Every field warning, prefixed with its table and field. */
	warnings: string[];
}

/** `schemaReport()`: migrations, drift from the declared schema, failures. */
export interface SchemaReport {
	migrations: MigrationStatus;
	drift: SchemaDrift[];
	/** Raw writes not yet caught up (normally 0). */
	pending_changes: number;
	/**
	 * Raw writes the catch-up threw on, set aside in `_changes_failed` so they
	 * block nothing. Each is an entity whose search, sync or history may be
	 * stale until it is written again.
	 */
	failed_changes: { entity_type: string; entity_id: string; error: string }[];
	/**
	 * Tables whose older rows still hold JSON fields in the overflow column
	 * rather than in the fields' own columns (the move runs in the background).
	 */
	json_columns_pending: string[];
	database_size: number;
}

/**
 * The async RPC projection of {@link DatabaseServer} — what a Durable Object
 * stub for a DatabaseServer subclass actually looks like from the caller's
 * side: the same methods and inference as the class, but every return value
 * wrapped in a Promise. Cloudflare types DO stubs opaquely, so cast once at
 * the boundary and keep full entity/query inference everywhere else:
 *
 * @example
 * // app.d.ts
 * interface Locals { db: DatabaseStub<typeof tables> }
 * // hooks.server.ts
 * event.locals.db = env.DB.get(id) as unknown as DatabaseStub<typeof tables>;
 *
 * Only RPC-serializable methods are included: the tagged-template `exec`
 * overload and `batch()` take function arguments that don't survive the RPC
 * boundary, and property getters aren't projected.
 */
export type DatabaseStub<
	DatabaseConfig extends Record<string, Database.Table>,
	Meta = Record<string, any>,
> = {
	get<
		Type extends keyof DatabaseConfig & string,
		Table extends DatabaseConfig[Type],
		Entity extends Database.Entity<DatabaseConfig[Type]>,
		ExpandedFields extends
			| Array<keyof Table['config']['foreign_keys'] & string>
			| undefined,
		Output extends ExpandedFields extends Array<any>
			? Entity & { expanded: { [K in ExpandedFields[number]]: any } }
			: Entity,
	>(
		entity_type: Type,
		id: string | number,
		expand?: ExpandedFields,
	): Promise<Output>;
	create<
		Type extends keyof DatabaseConfig & string,
		Table extends DatabaseConfig[Type],
		OutputData extends Database.Entity<Table>,
		InputData extends Omit<OutputData, 'id' | 'created_at' | 'updated_at'>,
	>(
		entity_type: Type,
		unsafe_data: InputData,
		options?: CreateOptions,
	): Promise<OutputData>;
	update<
		Type extends keyof DatabaseConfig & string,
		Table extends DatabaseConfig[Type],
		OutputData extends Database.Entity<Table>,
		InputData extends DeepPartial<OutputData>,
	>(
		entity_type: Type,
		id: string | number,
		unsafe_data: InputData,
		options?: WriteOptions,
	): Promise<OutputData>;
	delete<Type extends keyof DatabaseConfig & string>(
		entity_type: Type,
		id: string | number,
		options?: WriteOptions,
	): Promise<void>;
	list<
		Type extends keyof DatabaseConfig & string,
		Table extends DatabaseConfig[Type],
		Query extends Database.SearchQuery<Table>,
		Output extends Database.SearchQueryResults<Table, Query>,
	>(
		entity_type: Type,
		raw_query: Query,
	): Promise<Output>;
	sync(
		query?: DatabaseSyncRequest<DatabaseConfig>,
	): Promise<DatabaseSyncResponse<DatabaseConfig>>;
	transaction(
		operations: DatabaseServerTransaction<DatabaseConfig>[],
		options?: WriteOptions,
	): Promise<DatabaseServerTransactionResult<DatabaseConfig>[]>;
	exec<Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
		sql_statement: string,
		...bindings: any[]
	): Promise<Row[]>;
	execMany<
		Rows extends readonly Record<string, SqlStorageValue>[] = Record<
			string,
			SqlStorageValue
		>[],
	>(
		statements: readonly ExecStatement[],
	): Promise<{ [K in keyof Rows]: Rows[K][] }>;
	explainSql(sql_statement: string): Promise<void>;
	drainChanges(): Promise<number>;
	schemaReport(): Promise<SchemaReport>;
	searchReport(): Promise<SearchReport>;
	migrationStatus(): Promise<MigrationStatus>;
	checkMigrations(): Promise<{ id: string; ok: boolean; error?: string }[]>;
	databaseSize(): Promise<number>;
	getMeta(): Promise<Meta>;
	setMeta(data: Meta): Promise<void>;
	destroy(): Promise<void>;
	restore(timestampOrBookmark: number | string): Promise<string>;
};

/** A Durable Object for handling database requests */
export class DatabaseServer<
	DatabaseConfig extends Record<string, Database.Table>,
	Meta = Record<string, any>,
> extends SqlDatabase<Env> {
	/** Persistent state of the database server (saved/loaded in sqlite) */
	#state: DatabaseServerState<DatabaseConfig, Meta>;

	/** Reverse FK map: for each table, which other tables have FK-derived fields depending on it */
	#reverse_fk_map: Map<string, Array<{ table: string; fk_field: string }>> = new Map();

	/** The SQLite search driver — the only search engine. */
	#search_engine: SqliteSearchEngine | undefined;

	/** Search-table configs, keyed by entity type */
	#search_tables: Map<string, ServerSearchTable> = new Map();

	/**
	 * Paths held back from the wire, per entity type: vector fields (§7.0) plus
	 * every path declared `.serverOnly()`. Both are indexed
	 * here and neither is synced, so one list drives one strip.
	 */
	#unsynced_paths: Map<string, string[]> = new Map();

	/**
	 * Per-type sqlite column metadata, derived once from the (immutable) table
	 * config: the sanitized real-column set and the BOOLEAN columns needing 0/1
	 * coercion. Row-level converters run per row on bulk paths, so they must
	 * not rebuild these on every call.
	 */
	#column_meta: Map<
		string,
		{
			columns: Set<string>;
			boolean_columns: string[];
			blob_columns: string[];
			json_columns: string[];
		}
	> = new Map();

	private columnMeta(entity_type: string): {
		columns: Set<string>;
		boolean_columns: string[];
		blob_columns: string[];
		/** Columns holding a field's value as JSON text (objects, arrays, …) */
		json_columns: string[];
	} {
		let meta = this.#column_meta.get(entity_type);
		if (!meta) {
			const table_definition = (this.config[entity_type]?.config?.table_definition ??
				{}) as Record<string, string>;
			const columns = new Set<string>();
			const boolean_columns: string[] = [];
			const blob_columns: string[] = [];
			const json_columns = [
				...((this.config[entity_type]?.config as { json_fields?: string[] } | undefined)
					?.json_fields ?? []),
			];
			for (const [column, definition] of Object.entries(table_definition)) {
				columns.add(this.sanitize(column));
				if (definition?.startsWith?.('BOOLEAN')) boolean_columns.push(column);
				if (definition?.startsWith?.('BLOB')) blob_columns.push(column);
			}
			meta = { columns, boolean_columns, blob_columns, json_columns };
			this.#column_meta.set(entity_type, meta);
		}
		return meta;
	}

	/**
	 * Entity types whose search rebuild is currently running: a rebuild recomputes
	 * FK-derived fields, which can call back into this class, so it must never
	 * re-enter itself.
	 */
	#rebuild_in_flight: Set<string> = new Set();

	public get id() {
		return this.ctx.id.toString();
	}

	/**
	 * The name this instance was created with via `idFromName()`, falling back
	 * to the hex id string. Cloudflare exposes `.name` on `DurableObjectId` at
	 * runtime but not in the published types, so the cast lives here instead of
	 * in every subclass. Use it to address sibling Durable Objects that share
	 * the same key (e.g. the WebSocket room for the same org).
	 */
	public get instance_name(): string {
		return DatabaseServer.instanceName(this.ctx);
	}

	/**
	 * Static form of {@link instance_name} for use before `super()` — e.g. to
	 * build the WebSocket factory passed to the constructor:
	 *
	 * @example
	 * constructor(ctx: DurableObjectState, env: Env) {
	 * 	const room = DatabaseServer.instanceName(ctx);
	 * 	super(tables, () => env.WS.get(env.WS.idFromName(room)), ctx, env);
	 * }
	 */
	static instanceName(ctx: DurableObjectState): string {
		return (ctx.id as unknown as { name?: string }).name ?? ctx.id.toString();
	}

	/** Named alarm handlers run (isolated) by the base `alarm()` on every tick */
	#alarm_handlers = new Map<string, () => void | Promise<void>>();

	/**
	 * Registers a named alarm handler. The base {@link alarm} runs every
	 * registered handler on each tick with per-handler error isolation, so one
	 * integration's failure can't starve another's queue. Integrations like
	 * `imageProcessing()` and `aiProcessing()` register themselves — a subclass
	 * only overrides `alarm()` when it needs full control (and then owns
	 * calling the registered handlers itself).
	 */
	registerAlarm(name: string, handler: () => void | Promise<void>): void {
		this.#alarm_handlers.set(name, handler);
	}

	/** Runs every registered alarm handler, isolating failures per handler */
	async alarm(): Promise<void> {
		// A raw write made through ctx.storage.sql is otherwise only caught up
		// by the next call into this class.
		try {
			this.#drainPending();
		} catch (error) {
			console.error('Change-capture drain failed on alarm', error);
		}
		for (const [name, handler] of this.#alarm_handlers) {
			try {
				await handler();
			} catch (error) {
				console.error(`[DatabaseServer] alarm handler "${name}" threw:`, error);
			}
		}
	}

	constructor(
		private config: DatabaseConfig,
		// lazily returns the WebSocket Durable Object used for broadcasting
		// events — any object implementing the DatabaseBroadcast contract
		// (WebsocketServer in @delightstack/websocket does)
		private ws: () => DatabaseBroadcast | undefined,
		ctx: DurableObjectState,
		protected env: Env,
		options?: DatabaseServerOptions,
	) {
		super(ctx, env);

		// NOTE on foreign key enforcement: unlike vanilla SQLite (where `PRAGMA foreign_keys`
		// defaults to OFF), Durable Object SQLite is compiled by workerd with
		// `SQLITE_DEFAULT_FOREIGN_KEYS=1` (see cloudflare/workerd build/BUILD.sqlite3), so
		// foreign key constraints (e.g. ON DELETE CASCADE) are ALWAYS enforced by default.
		// We intentionally do NOT run `PRAGMA foreign_keys = ON` here: every sql.exec() runs
		// inside an implicit transaction, and per SQLite semantics that pragma is a no-op
		// within a transaction (workerd only allows toggling it inside blockConcurrencyWhile).
		// To temporarily relax enforcement within a transaction, use
		// `PRAGMA defer_foreign_keys = true` (checks are deferred until the transaction commits).
		this.exec(
			(sql) => sql`
				CREATE TABLE IF NOT EXISTS state (
					id TEXT PRIMARY KEY,
					json TEXT NOT NULL,
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NUll
				);
`,
		);

		const result = this.ctx.storage.sql.exec(
			`SELECT * FROM state WHERE id = ? LIMIT 1;`,
			'main',
		);
		const now = Date.now();
		const raw_row = result.next()?.value as
			| { id: string; json: string; created_at: number; updated_at: number }
			| undefined;
		let state: DatabaseServerState<DatabaseConfig, Meta> | undefined;
		if (raw_row) {
			const parsed = JSON.parse(raw_row.json);
			state = {
				...parsed,
				created_at: raw_row.created_at,
				updated_at: raw_row.updated_at,
			};
		}

		if (!state) {
			state = {
				created_at: now,
				updated_at: now,
				meta: {} as Meta,
				sql_indexes: [],
				table_config: {},
			};
			this.ctx.storage.sql.exec(
				`INSERT INTO state (id, json, created_at, updated_at) VALUES (?, ?, ?, ?);`,
				'main',
				JSON.stringify({
					...state,
					created_at: undefined,
					updated_at: undefined,
				}),
				now,
				now,
			);
		}
		this.#state = state;

		// Numbered migrations run first, against the schema exactly as the
		// previous version left it: a rename or a rebuild must see the old
		// columns before the additive pass below adds the new ones. A brand-new
		// database is created at the current shape, so every migration is simply
		// recorded as applied.
		const migration_status = this.runMigrations(options?.migrations ?? [], {
			baseline_if_fresh: true,
			// A state row and no table of the app's (only the library's own)
			// means an earlier wake threw before creating them: still a new
			// database. Any app table at all, declared or not, means data — a
			// table a migration is about to rename is not declared under its
			// old name.
			fresh: () => !raw_row || !this.hasAppTables(),
		});
		// While any migration is pending — failed, or shipped as `preflight` —
		// the additive pass below waits. Otherwise it would add the very columns
		// a pending migration is about to create (a rename's new name, say), and
		// that migration could then never apply; a preflight dry run would also
		// be checking a schema the pass had already changed.
		const hold_back_schema = migration_status.pending.length > 0;
		if (hold_back_schema) {
			console.warn(
				`[DatabaseServer] ${migration_status.pending.length} migration(s) pending (${migration_status.pending.join(', ')}): new tables, columns and indexes wait until they apply`,
			);
		}

		// Add tables and columns the schema declares and the database lacks.
		// This is the one kind of change made automatically: it is additive and
		// can't lose data. Everything else (nullability, types, renames, drops)
		// is a migration. Checked against the live schema, not the saved state,
		// so a migration that rebuilt or altered a table is seen as it is.
		const live_tables = new Set(
			this.ctx.storage.sql
				.exec(`SELECT name FROM sqlite_schema WHERE type = 'table';`)
				.toArray()
				.map((row) => String(row.name)),
		);
		for (const table_config of Object.values(this.config)) {
			const table_definition = table_config?.config?.table_definition;
			if (!table_definition) continue;

			// Double check the table name is safe/valid. Throw loudly instead of
			// silently skipping — a skipped table means every later query against
			// it fails with a confusing 'no such table' error.
			if (table_config.name.match(/[^a-z0-9_]/) || table_config.name.match(/^[0-9]/)) {
				throw new DelightError({
					message: `Table name '${table_config.name}' is invalid. Use lowercase letters, numbers, and underscores (must not start with a number).`,
					status: 500,
				});
			}
			const table_name = table_config.name.toLowerCase();
			const full_definition = this.fullDefinition(table_config.name);

			if (!live_tables.has(table_name)) {
				if (hold_back_schema) continue;
				const columns = Object.entries(full_definition).map(
					([column, def]) => `${this.quote(column)} ${def}`,
				);
				this.ctx.storage.transactionSync(() => {
					console.log(`Creating table ${table_name} (${columns.join(', ')})`);
					(this.#state.table_config as any)[table_name] = full_definition;
					this.ctx.storage.sql.exec(
						`CREATE TABLE IF NOT EXISTS ${this.quote(table_name)} (${columns.join(', ')});`,
					);
					this.saveState();
				});
				continue;
			}

			const live_columns = new Set(
				this.ctx.storage.sql
					.exec(`PRAGMA table_xinfo(${quoteIdentifier(table_name)});`)
					.toArray()
					.map((row) => String(row.name)),
			);
			// The library's own columns are added even while a migration holds
			// the pass back: the write marker and the overflow blob, plus — only
			// on the v3 upgrade, before this table's JSON move has ever finished
			// — the JSON field columns that move creates. Every write names them,
			// so without them an upgrade that ships with a pending migration
			// would fail every write to every table. After the upgrade a new
			// JSON field is the app's column like any other and waits, so a
			// pending rename of one can still apply.
			const upgrading = !this.#state.json_columns_moved?.[table_config.name];
			const library_owned = new Set([
				'json',
				WRITE_MARK_COLUMN,
				...(upgrading
					? ((table_config.config as { json_fields?: string[] }).json_fields ?? [])
					: []
				).map((field) => this.sanitize(field)),
			]);
			for (const [column, def] of Object.entries(full_definition)) {
				if (live_columns.has(this.sanitize(column))) continue;
				if (hold_back_schema && !library_owned.has(this.sanitize(column))) continue;
				console.log(`Adding column ${column} to table ${table_name}`);
				const alter_def = addableColumnDefinition(String(def));
				this.ctx.storage.transactionSync(() => {
					this.ctx.storage.sql.exec(
						`ALTER TABLE ${this.quote(table_name)} ADD COLUMN ${this.quote(column)} ${alter_def};`,
					);
				});
			}
			if (
				!hold_back_schema &&
				!deepEqual(this.#state.table_config?.[table_name], full_definition)
			) {
				(this.#state.table_config as any)[table_name] = full_definition;
				this.saveState();
			}
		}

		const live_indexes = new Set(
			this.ctx.storage.sql
				.exec(`SELECT name FROM sqlite_schema WHERE type = 'index';`)
				.toArray()
				.map((row) => String(row.name)),
		);
		for (const table_config of hold_back_schema ? [] : Object.values(this.config)) {
			if (!table_config?.config?.indexes) continue;
			const table_name = table_config.name.toLowerCase();

			// Create the sqlite indexes that are defined in the table config but not
			// yet created — or whose definition (columns/direction/uniqueness/
			// condition) changed since they were created, or that a migration's
			// rebuild dropped. Matching by name alone would silently keep a stale
			// index when its definition is edited in place.
			for (const index of table_config.config.indexes) {
				if (table_name !== index.table) continue;
				const index_name = this.sanitize(index.name);
				if (!index_name) continue;
				const existing = this.#state.sql_indexes.find((i) => i.name === index.name);
				// Compare the serializable projection: `existing` already survived a
				// JSON round trip, so an undefined member on the live definition would
				// otherwise read as a changed index.
				if (
					existing &&
					deepEqual(existing, JSON.parse(JSON.stringify(index))) &&
					live_indexes.has(index_name)
				) {
					continue;
				}
				const unique = index.unique ? ' UNIQUE' : '';
				console.log(
					`${existing ? 'Recreating' : 'Creating'} index ${index_name} on table ${table_name}`,
				);
				try {
					this.ctx.storage.transactionSync(() => {
						(this.#state.sql_indexes as any) = (this.#state.sql_indexes as any).filter(
							(i: any) => i.name !== index.name,
						);
						this.ctx.storage.sql.exec(
							`DROP INDEX IF EXISTS ${quoteIdentifier(index_name)};`,
						);
						const columns = index.columns
							.map(
								(col) =>
									`${this.quote(col.column)} ${col.direction === 'DESC' ? 'DESC' : 'ASC'}`,
							)
							.join(', ');
						const where = index.where ? ` WHERE ${index.where}` : '';
						this.ctx.storage.sql.exec(
							`CREATE${unique} INDEX IF NOT EXISTS ${quoteIdentifier(index_name)} ON ${this.quote(table_name)} (${columns})${where};`,
						);
						(this.#state.sql_indexes as any).push(index);
						this.saveState();
					});
				} catch (error) {
					// The classic case: a UNIQUE index the existing rows violate. That
					// used to throw out of the constructor, which takes every request
					// to this database down with it — the reads and writes that have
					// nothing to do with the index included. The index is left absent
					// (the transaction rolled back), the failure is logged and
					// reported by schemaReport(), and it is retried on the next wake.
					const message = DelightError.from(error).message;
					console.error(
						`Index ${index_name} on ${table_name} could not be created: ${message}`,
					);
					this.#index_failures.push({
						table: table_name,
						index: index_name,
						error: message,
					});
				}
			}

			// Delete indexes that are no longer in the table config.
			// Only consider indexes belonging to THIS table — otherwise each table's
			// pass would drop every other table's indexes.
			for (const existing_index of [...this.#state.sql_indexes]) {
				if (existing_index.table !== table_name) continue;
				if (table_config.config.indexes.some((i) => i.name === existing_index.name))
					continue;
				console.log(`Deleting index ${existing_index.name} on table ${table_name}`);
				this.ctx.storage.transactionSync(() => {
					(this.#state.sql_indexes as any) = (this.#state.sql_indexes as any).filter(
						(i: any) => i.name !== existing_index.name,
					);
					this.ctx.storage.sql.exec(
						`DROP INDEX IF EXISTS ${this.quote(existing_index.name)};`,
					);
					this.saveState();
				});
			}
		}

		// Build reverse FK map for cascading reindex of FK-derived fields
		for (const [table_name, table] of Object.entries(this.config)) {
			const derived = (table as any)?.config?.derived_fields as
				| Record<string, { foreign_keys?: string[] }>
				| undefined;
			if (!derived) continue;
			for (const [_, meta] of Object.entries(derived)) {
				if (!meta.foreign_keys?.length) continue;
				for (const fk_field of meta.foreign_keys) {
					const fk_meta = (table as any).config.foreign_keys[fk_field];
					if (!fk_meta) continue;
					const referenced_table = fk_meta.table as string;
					if (!this.#reverse_fk_map.has(referenced_table)) {
						this.#reverse_fk_map.set(referenced_table, []);
					}
					const entries = this.#reverse_fk_map.get(referenced_table)!;
					if (!entries.some((e) => e.table === table_name && e.fk_field === fk_field)) {
						entries.push({ table: table_name, fk_field });
					}
				}
			}
		}

		this.bootstrapChangeLog();
		this.bootstrapOpLog();
		this.bootstrapFileGC();
		this.bootstrapSearch();
		// After `bootstrapSearch()`: the backfill enqueue reads the entity tables
		// this constructor may have just created or migrated.
		this.bootstrapAutoEmbedding();
		try {
			this.bootstrapJsonColumns();
		} catch (error) {
			// Reads fall back to the blob, so a move that can't run degrades to
			// "not moved yet" (reported by schemaReport) instead of failing
			// every request. The alarm retries it.
			console.error('[DatabaseServer] JSON column move failed on wake', error);
		}
		// Last: the triggers name every live column, and anything raw SQL wrote
		// while the previous version was running is caught up before the first
		// request is served.
		this.bootstrapChangeCapture();
		try {
			this.#drainPending();
		} catch (error) {
			// Never let a catch-up failure take the object down on wake.
			console.error('[DatabaseServer] change-capture drain failed on wake', error);
		}
	}

	/* ---------------------------------------------------------------------- */
	/* JSON columns                                                           */
	/* ---------------------------------------------------------------------- */

	/**
	 * Move JSON-typed fields (objects, arrays, vectors, geopoints, files) out
	 * of the shared `json` overflow column into the columns of their own the
	 * schema now gives them.
	 *
	 * Rows written before that change hold those values in the blob. Every
	 * read already falls back to it (`toEntityValue`, the search engine's
	 * generated columns), so nothing waits on this; it exists so raw SQL can
	 * rely on `SELECT field_schema FROM document` holding the value. It runs in
	 * slices — one per wake, the rest on the alarm — because a large tenant's
	 * blobs can be gigabytes, far past one invocation's CPU budget. Each slice
	 * is a library write (the write marker flips), so nothing is re-indexed or
	 * re-synced: the values don't change, only where they live.
	 */
	private bootstrapJsonColumns(): void {
		if (!this.pendingJsonColumnTypes().length) return;
		this.registerAlarm('json_columns', () => this.continueJsonColumns());
		// Same switch as the search rebuild: a subclass that keeps its
		// constructor O(1) gets every slice on the alarm instead.
		// Below `jsonColumnMoveBytesInConstructor()` of blob (the common case)
		// the whole move runs now, before the first request is served, so raw
		// SQL never sees a column the move hasn't reached. Above it, slices.
		let remaining = true;
		if (this.searchRebuildInConstructor()) {
			if (this.pendingJsonColumnBytes() <= this.jsonColumnMoveBytesInConstructor()) {
				// Slice after slice, each its own statement and transaction, so no
				// single statement rewrites a whole large table.
				do {
					remaining = this.moveJsonColumns(this.searchRebuildRowsPerSlice());
				} while (remaining);
			} else {
				remaining = this.moveJsonColumns(this.searchRebuildRowsPerSlice());
			}
		}
		if (remaining) {
			for (const entity_type of this.pendingJsonColumnTypes()) {
				this.ensureJsonClearTriggers(entity_type);
			}
			void this.ctx.storage
				.getAlarm()
				.then((existing) => {
					const now = Date.now();
					if (existing === null || existing > now) return this.ctx.storage.setAlarm(now);
				})
				.catch((error) =>
					console.error(
						'[DatabaseServer] failed to arm the JSON column move alarm:',
						error,
					),
				);
		}
	}

	/**
	 * While a table's rows are still being moved, a raw `SET field = NULL` on a
	 * row not reached yet would look like "not moved": every read falls back to
	 * the old blob value, and the move then copies it back into the column.
	 * One trigger per JSON column catches exactly that write (`UPDATE OF` the
	 * column, leaving it NULL) and removes the field from the blob in the same
	 * statement. Library writes never trip it: they rewrite the blob without
	 * the field. Dropped when the table's move finishes.
	 */
	private ensureJsonClearTriggers(entity_type: string): void {
		const fields = (this.config[entity_type]?.config as { json_fields?: string[] })
			?.json_fields;
		if (!fields?.length) return;
		const table_name = this.sanitize(entity_type);
		for (const field of fields) {
			const column = this.sanitize(field);
			this.ctx.storage.sql.exec(
				`CREATE TRIGGER IF NOT EXISTS ${quoteIdentifier(`${JSON_CLEAR_TRIGGER_PREFIX}${table_name}_${column}`)} AFTER UPDATE OF ${quoteIdentifier(column)} ON ${quoteIdentifier(table_name)} WHEN NEW.${quoteIdentifier(column)} IS NULL AND json_valid(NEW."json") AND json_type(NEW."json", '$.${column}') IS NOT NULL BEGIN UPDATE ${quoteIdentifier(table_name)} SET "json" = json_remove("json", '$.${column}') WHERE rowid = NEW.rowid; END;`,
			);
		}
	}

	private dropJsonClearTriggers(entity_type: string): void {
		const table_name = this.sanitize(entity_type);
		for (const row of this.ctx.storage.sql
			.exec(
				`SELECT name FROM sqlite_schema WHERE type = 'trigger' AND tbl_name = ? AND name LIKE ?;`,
				table_name,
				`${JSON_CLEAR_TRIGGER_PREFIX}%`,
			)
			.toArray()) {
			this.ctx.storage.sql.exec(`DROP TRIGGER IF EXISTS ${quoteIdentifier(String(row.name))};`);
		}
	}

	/** Whether any table exists that isn't SQLite's, Cloudflare's or this library's. */
	private hasAppTables(): boolean {
		return !this.ctx.storage.sql
			.exec(
				`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND substr(name, 1, 1) != '_' AND name NOT IN ('state', 'search_fields', 'search_terms', 'search_entries', 'search_documents', 'search_postings', 'search_tokens', 'search_docs', 'search_field_stats', 'search_vectors', 'search_tombstones', 'search_state') LIMIT 1;`,
			)
			.next().done;
	}

	/** Whether a table exists right now (the schema pass can be held back). */
	private liveTableExists(table_name: string): boolean {
		return !this.ctx.storage.sql
			.exec(`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ? LIMIT 1;`, table_name)
			.next().done;
	}

	/**
	 * How much `json` blob the first wake after the upgrade moves into the
	 * new columns before serving anything. Measured in local workerd at
	 * about 240 MB/s; production storage is slower, so the default 128 MB is
	 * kept well inside a wake's CPU budget, once. Bigger databases
	 * move 1,000 rows per wake and alarm, and until then a raw read of a JSON
	 * column on a row not reached yet returns NULL (library reads fall back
	 * to the blob; raw SQL can use `COALESCE(col, json_extract(json, '$.col'))`
	 * or check `schemaReport().json_columns_pending`).
	 */
	protected jsonColumnMoveBytesInConstructor(): number {
		return 128 * 1024 * 1024;
	}

	/** Bytes of `json` blob left to move, read from the row headers. */
	private pendingJsonColumnBytes(): number {
		let bytes = 0;
		for (const entity_type of this.pendingJsonColumnTypes()) {
			const table_name = quoteIdentifier(this.sanitize(entity_type));
			const cursor = this.#state.json_columns_cursor?.[entity_type] ?? 0;
			try {
				// octet_length() reads the stored size without loading the value.
				bytes += Number(
					this.ctx.storage.sql
						.exec(
							`SELECT IFNULL(SUM(octet_length("json")), 0) AS bytes FROM ${table_name} WHERE rowid > ?;`,
							cursor,
						)
						.one().bytes,
				);
			} catch {
				return Number.POSITIVE_INFINITY;
			}
		}
		return bytes;
	}

	/** Entity types whose JSON fields are not all moved into their columns yet. */
	private pendingJsonColumnTypes(): string[] {
		const moved = this.#state.json_columns_moved ?? {};
		return Object.keys(this.config).filter((entity_type) => {
			if (moved[entity_type]) return false;
			if (!this.liveTableExists(this.sanitize(entity_type))) return false;
			const fields = (this.config[entity_type]?.config as { json_fields?: string[] })
				?.json_fields;
			return Array.isArray(fields) && fields.length > 0;
		});
	}

	/**
	 * Move up to `budget` rows. Returns whether any work remains.
	 */
	private moveJsonColumns(budget: number): boolean {
		for (const entity_type of this.pendingJsonColumnTypes()) {
			if (budget <= 0) return true;
			const fields = (this.config[entity_type].config as { json_fields: string[] })
				.json_fields;
			const table_name = quoteIdentifier(this.sanitize(entity_type));
			const cursor = this.#state.json_columns_cursor?.[entity_type] ?? 0;
			const window = this.ctx.storage.sql
				.exec(
					`SELECT MAX(rowid) AS last, COUNT(*) AS n FROM (SELECT rowid FROM ${table_name} WHERE rowid > ? ORDER BY rowid LIMIT ?);`,
					cursor,
					budget,
				)
				.next()?.value as { last?: number | null; n?: number } | undefined;
			const last = typeof window?.last === 'number' ? window.last : null;
			// A full window may still be the last one (a table of exactly
			// `budget` rows): look one row past it rather than spend a slice.
			const reached_end =
				Number(window?.n ?? 0) < budget ||
				(last !== null &&
					this.ctx.storage.sql
						.exec(`SELECT 1 FROM ${table_name} WHERE rowid > ? LIMIT 1;`, last)
						.next().done === true);
			const setCursor = (value: number | undefined) => {
				const next = { ...(this.#state.json_columns_cursor ?? {}) };
				if (value === undefined) delete next[entity_type];
				else next[entity_type] = value;
				this.#state.json_columns_cursor = next;
			};
			const markMoved = () => {
				// Every row seen: this type is done for good.
				this.#state.json_columns_moved = {
					...(this.#state.json_columns_moved ?? {}),
					[entity_type]: true,
				};
				setCursor(undefined);
				this.saveState();
				this.dropJsonClearTriggers(entity_type);
			};
			if (last === null) {
				markMoved();
				continue;
			}
			const sets = fields.map((field) => {
				const column = quoteIdentifier(this.sanitize(field));
				// `->` returns the value as JSON text (a string comes out quoted),
				// so it always passes the column's json_valid CHECK; json_extract
				// would hand back a bare string that fails it.
				return `${column} = COALESCE(${column}, "json" -> '$.${this.sanitize(field)}')`;
			});
			const removals = fields.map((field) => `'$.${this.sanitize(field)}'`).join(', ');
			const holds_any = fields
				.map((field) => `json_type("json", '$.${this.sanitize(field)}') IS NOT NULL`)
				.join(' OR ');
			this.ctx.storage.transactionSync(() => {
				this.ctx.storage.sql.exec(
					`UPDATE ${table_name} SET ${sets.join(', ')}, "json" = json_remove("json", ${removals}), ${WRITE_MARK_FLIP} WHERE rowid > ? AND rowid <= ? AND "json" IS NOT NULL AND json_valid("json") AND (${holds_any});`,
					cursor,
					last,
				);
				// The cursor commits with the rows it covers.
				if (!reached_end) {
					setCursor(last);
					this.saveState();
				}
			});
			budget -= Number(window?.n ?? 1);
			if (reached_end) markMoved();
		}
		return this.pendingJsonColumnTypes().length > 0;
	}

	/** Alarm slice of the JSON column move; re-arms until nothing is left. */
	private async continueJsonColumns(): Promise<void> {
		if (!this.pendingJsonColumnTypes().length) return;
		if (this.moveJsonColumns(this.searchRebuildRowsPerSlice())) {
			await this.ctx.storage.setAlarm(Date.now());
		}
	}

	/* ---------------------------------------------------------------------- */
	/* Change capture                                                         */
	/* ---------------------------------------------------------------------- */

	/** Indexes that could not be created on this wake (see the constructor). */
	#index_failures: { table: string; index: string; error: string }[] = [];

	/**
	 * Every column a table should have: the declared ones plus the internal
	 * `json` overflow column and the change-capture write marker.
	 */
	private fullDefinition(entity_type: string): Record<string, string> {
		const table_definition = (this.config[entity_type]?.config?.table_definition ??
			{}) as Record<string, string>;
		return {
			...table_definition,
			json: 'TEXT',
			[WRITE_MARK_COLUMN]: 'INTEGER NOT NULL DEFAULT 0',
		};
	}

	protected override declaredColumn(table: string, column: string): string | undefined {
		if (!this.config[table]) return undefined;
		return this.fullDefinition(table)[column];
	}

	protected override declaredTable(table: string): Record<string, string> | undefined {
		if (!this.config[table]) return undefined;
		return this.fullDefinition(table);
	}

	/**
	 * A migration helper is about to change this table's structure. SQLite
	 * refuses to drop or swap a column a trigger names, and the copy step must
	 * not be captured as a raw write of every row, so the change triggers come
	 * off for the duration.
	 */
	protected override beforeTableAlter(table: string): void {
		const table_name = this.sanitize(table);
		for (const suffix of ['ins', 'upd', 'del']) {
			this.ctx.storage.sql.exec(
				`DROP TRIGGER IF EXISTS ${quoteIdentifier(`${CHANGE_TRIGGER_PREFIX}${table_name}_${suffix}`)};`,
			);
		}
		// The JSON-move guards name their column, and so do the search engine's
		// generated `sv$` columns: SQLite refuses to drop or swap a column
		// either references. Both are rebuilt from the schema later in this wake
		// (bootstrapJsonColumns, bootstrapSearch), after the migrations.
		this.dropJsonClearTriggers(table);
		const generated = this.ctx.storage.sql
			.exec(`PRAGMA table_xinfo(${quoteIdentifier(table_name)});`)
			.toArray()
			.map((row) => String(row.name))
			.filter((column) => column.startsWith(GENERATED_COLUMN_PREFIX));
		for (const column of generated) {
			for (const index of this.ctx.storage.sql
				.exec(
					`SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = ? AND sql LIKE ?;`,
					table_name,
					`%${column}%`,
				)
				.toArray()) {
				this.ctx.storage.sql.exec(`DROP INDEX IF EXISTS ${quoteIdentifier(String(index.name))};`);
			}
			this.ctx.storage.sql.exec(
				`ALTER TABLE ${quoteIdentifier(table_name)} DROP COLUMN ${quoteIdentifier(column)};`,
			);
		}
	}

	/** ...and go back on, naming the table's new columns. */
	protected override afterTableAlter(table: string): void {
		if (!this.config[table]?.config?.table_definition) return;
		if (this.config[table].config.capture_raw_writes === false) return;
		if (!this.liveColumns(this.sanitize(table)).length) return;
		for (const [, ddl] of this.changeTriggerDdl(table)) this.ctx.storage.sql.exec(ddl);
	}

	/**
	 * How this database stands against the code: which migrations ran, are
	 * pending or failed, how the live tables differ from the declared schema
	 * (each difference with the migration step that fixes it), indexes that
	 * could not be built, and raw writes not yet caught up.
	 *
	 * Cheap (schema reads only). Call it on every tenant after a deploy to
	 * find the ones that need attention — a failed migration or a unique index
	 * the data violates no longer takes a database down, so this is where they
	 * show up.
	 */
	/**
	 * How big each table's search index is, field by field, with warnings for
	 * the usual mistakes: an id or key indexed as text (most of its words
	 * occur once), a field so large every save writes hundreds of index rows,
	 * values cut off by `max_tokens`. Reads the whole index once, so it is an
	 * admin call, not something to run per request.
	 */
	searchReport(): SearchReport {
		this.#drainPending();
		const report: SearchReport = { tables: [], warnings: [] };
		for (const entity_type of [...this.#search_tables.keys()].sort()) {
			const table = this.searchTable(entity_type);
			const cap = (field: string) => fieldTokenLimit(field, table.field_options);
			const fields = this.search.store.fieldReport(entity_type, cap).map((row) => {
				const words_per_document =
					row.documents > 0 ? Math.round((row.entries / row.documents) * 10) / 10 : 0;
				const warnings: string[] = [];
				if (row.words >= 200 && row.single_use_words / row.words > 0.6 && words_per_document <= 12) {
					warnings.push(
						`${Math.round((row.single_use_words / row.words) * 100)}% of its ${row.words} words occur in one document only, which is what ids, keys, codes and URLs look like as text. If nobody types words from it into search, make it .keyword() (exact match) or .carried().`,
					);
				}
				if (words_per_document >= 300) {
					warnings.push(
						`about ${Math.round(words_per_document)} index rows per document, written again on every change to them. If it is long body text, consider .serverOnly(), a lower max_tokens, or not indexing it.`,
					);
				}
				if (row.capped_documents > 0) {
					warnings.push(
						`${row.capped_documents} document(s) hit max_tokens (${cap(row.field)}): words past the cap are not searchable. Raise it with .searchable({ max_tokens }) if they need to be.`,
					);
				}
				for (const warning of warnings) {
					report.warnings.push(`${entity_type}.${row.field}: ${warning}`);
				}
				const max_tokens = cap(row.field);
				return {
					...row,
					words_per_document,
					max_tokens: max_tokens === Infinity ? ('none' as const) : max_tokens,
					warnings,
				};
			});
			report.tables.push({
				entity_type,
				documents: this.search.store.getState(entity_type)?.doc_count ?? 0,
				entries: fields.reduce((sum, field) => sum + field.entries, 0),
				entry_bytes: fields.reduce((sum, field) => sum + field.entry_bytes, 0),
				fields,
			});
		}
		return report;
	}

	schemaReport(): SchemaReport {
		const drift: SchemaDrift[] = [];
		const sql = this.ctx.storage.sql;
		const referenced_tables = new Set<string>();
		for (const entity_type of Object.keys(this.config)) {
			for (const fk of Object.values(
				(this.config[entity_type]?.config?.foreign_keys ?? {}) as Record<string, { table?: string }>,
			)) {
				if (fk?.table && fk.table !== entity_type) referenced_tables.add(this.sanitize(fk.table));
			}
		}
		for (const entity_type of Object.keys(this.config)) {
			const table = this.config[entity_type];
			if (!table?.config?.table_definition) continue;
			const table_name = this.sanitize(entity_type);
			const live = sql
				.exec(`PRAGMA table_xinfo(${quoteIdentifier(table_name)});`)
				.toArray()
				.filter((row) => Number(row.hidden ?? 0) === 0);
			if (!live.length) {
				drift.push({ table: table_name, kind: 'missing_table' });
				continue;
			}
			const declared = this.fullDefinition(entity_type);
			const live_by_name = new Map(live.map((row) => [String(row.name), row]));
			const unique_live = new Set<string>();
			for (const index of sql
				.exec(`PRAGMA index_list(${quoteIdentifier(table_name)});`)
				.toArray()) {
				if (Number(index.unique) !== 1 || String(index.origin) === 'pk') continue;
				const covered = sql
					.exec(`PRAGMA index_info(${quoteIdentifier(String(index.name))});`)
					.toArray();
				if (covered.length === 1 && String(index.origin) === 'u') {
					unique_live.add(String(covered[0].name));
				}
			}
			for (const [column, definition] of Object.entries(declared)) {
				const column_name = this.sanitize(column);
				const row = live_by_name.get(column_name);
				if (!row) {
					drift.push({
						table: table_name,
						column: column_name,
						kind: 'missing_column',
						declared: definition,
					});
					continue;
				}
				if (Number(row.pk) > 0) continue;
				const declared_type = definition.split(/\s+/)[0].toUpperCase();
				const live_type = String(row.type ?? '').toUpperCase();
				if (declared_type && live_type && declared_type !== live_type) {
					drift.push({
						table: table_name,
						column: column_name,
						kind: 'type',
						declared: declared_type,
						live: live_type,
						fix: `alterColumn('${table_name}', '${column_name}')`,
					});
				}
				const declared_not_null = /\bNOT\s+NULL\b/i.test(definition);
				const live_not_null = Number(row.notnull) === 1;
				if (declared_not_null !== live_not_null) {
					drift.push({
						table: table_name,
						column: column_name,
						kind: 'nullability',
						declared: declared_not_null ? 'NOT NULL' : 'NULL',
						live: live_not_null ? 'NOT NULL' : 'NULL',
						fix: `alterColumn('${table_name}', '${column_name}')`,
					});
				}
				const declared_unique = /\bUNIQUE\b/i.test(definition);
				if (declared_unique !== unique_live.has(column_name)) {
					drift.push({
						table: table_name,
						column: column_name,
						kind: 'unique',
						declared: declared_unique ? 'UNIQUE' : 'not unique',
						live: unique_live.has(column_name) ? 'UNIQUE' : 'not unique',
						// SQLite can't swap a UNIQUE column, and rebuildTable refuses a
						// table others reference (the drop would cascade into them).
						fix: referenced_tables.has(table_name)
							? `not fixable in place: ${table_name} is referenced by foreign keys; use a unique index (table indexes option) instead of a UNIQUE column`
							: `rebuildTable('${table_name}')`,
					});
				}
			}
			for (const column of live_by_name.keys()) {
				if (column in declared || column.startsWith('sv$')) continue;
				drift.push({
					table: table_name,
					column,
					kind: 'extra_column',
					fix: `dropColumn('${table_name}', '${column}')`,
				});
			}
			const live_indexes = new Set(
				sql
					.exec(
						`SELECT name FROM sqlite_schema WHERE type = 'index' AND tbl_name = ?;`,
						table_name,
					)
					.toArray()
					.map((row) => String(row.name)),
			);
			for (const index of table.config.indexes ?? []) {
				const name = this.sanitize(index.name);
				if (live_indexes.has(name)) continue;
				const failure = this.#index_failures.find((f) => f.index === name);
				drift.push({
					table: table_name,
					index: name,
					kind: failure ? 'index_failed' : 'missing_index',
					...(failure ? { live: failure.error } : {}),
				});
			}
		}
		return {
			migrations: this.migrationStatus(),
			drift,
			pending_changes: Number(
				sql.exec(`SELECT COUNT(*) AS n FROM ${quoteIdentifier(CHANGES_TABLE)};`).one().n,
			),
			json_columns_pending: this.pendingJsonColumnTypes(),
			failed_changes: sql
				.exec(
					`SELECT entity_type, entity_id, error FROM ${quoteIdentifier(CHANGES_FAILED_TABLE)} ORDER BY id DESC LIMIT 100;`,
				)
				.toArray()
				.map((row) => ({
					entity_type: String(row.entity_type),
					entity_id: String(row.entity_id),
					error: String(row.error),
				})),
			database_size: sql.databaseSize,
		};
	}

	/**
	 * Whether the `_changes` table and its triggers are in place. False only
	 * during construction, before `bootstrapChangeCapture()` has run.
	 */
	#change_capture_ready = false;

	/**
	 * Create the `_changes` log and one insert, update and delete trigger per
	 * entity table.
	 *
	 * The triggers are the safety net under raw SQL. A write made through
	 * `create`/`update`/`delete`/`transaction` keeps the search index, sync
	 * timestamps, history, file GC, embeddings and websocket broadcasts in step
	 * inline, in its own transaction. A write made any other way — `exec()`,
	 * `ctx.storage.sql`, a foreign-key `ON DELETE CASCADE` / `SET NULL` — used
	 * to skip all of that silently. Now its trigger appends a row to `_changes`
	 * and `drainChanges()` does the same catch-up work.
	 *
	 * Library writes are told apart without an extra billed row: inserts and
	 * updates flip the `_w` marker in the same statement (raw SQL leaves it
	 * alone, so `NEW._w IS OLD._w` / `NEW._w = 0`), and deletes write their
	 * tombstone first (raw deletes and cascades have none at the current
	 * timestamp).
	 *
	 * Triggers are re-created when their definition changes (a column was
	 * added, history was turned on) and dropped for tables no longer declared.
	 */
	private bootstrapChangeCapture(): void {
		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(CHANGES_TABLE)} (
				seq INTEGER PRIMARY KEY,
				entity_type TEXT NOT NULL,
				entity_id TEXT NOT NULL,
				op TEXT NOT NULL,
				before TEXT,
				stamped INTEGER NOT NULL DEFAULT 0
			);`,
		);
		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(CHANGES_FAILED_TABLE)} (
				id INTEGER PRIMARY KEY,
				entity_type TEXT NOT NULL,
				entity_id TEXT NOT NULL,
				error TEXT NOT NULL,
				failed_at INTEGER NOT NULL
			);`,
		);
		const existing = new Map<string, string>();
		for (const row of this.ctx.storage.sql
			.exec(
				`SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' AND name LIKE ?;`,
				`${CHANGE_TRIGGER_PREFIX}%`,
			)
			.toArray()) {
			existing.set(String(row.name), String(row.sql ?? ''));
		}
		const wanted = new Map<string, string>();
		for (const entity_type of Object.keys(this.config)) {
			if (!this.isSearchIndexed(entity_type)) continue;
			if (this.config[entity_type]?.config?.capture_raw_writes === false) continue;
			if (!this.liveTableExists(this.sanitize(entity_type))) continue;
			for (const [name, ddl] of this.changeTriggerDdl(entity_type)) wanted.set(name, ddl);
		}
		const stale = [...existing.keys()].filter(
			(name) =>
				!wanted.has(name) ||
				normalizeDdl(existing.get(name)!) !== normalizeDdl(wanted.get(name)!),
		);
		const missing = [...wanted.keys()].filter(
			(name) => !existing.has(name) || stale.includes(name),
		);
		if (stale.length || missing.length) {
			this.ctx.storage.transactionSync(() => {
				for (const name of stale) {
					this.ctx.storage.sql.exec(`DROP TRIGGER IF EXISTS ${quoteIdentifier(name)};`);
				}
				for (const name of missing) this.ctx.storage.sql.exec(wanted.get(name)!);
			});
		}
		this.#change_capture_ready = true;
	}

	/**
	 * Re-create any missing change-capture triggers. Call it after code of
	 * your own that rebuilds an entity table (a `DROP TABLE` takes the table's
	 * triggers with it); the object does this on every wake anyway.
	 */
	protected refreshChangeCapture(): void {
		this.bootstrapChangeCapture();
	}

	/**
	 * The three change-capture triggers for one entity table, as
	 * `[name, CREATE TRIGGER …]` pairs.
	 *
	 * `before` (the old row as JSON) is captured only for tables whose catch-up
	 * needs it: history (the field-level diff) and file fields (which objects
	 * the row stopped pointing at). Everything else is recomputed from the
	 * current row, so it costs nothing to store.
	 */
	private changeTriggerDdl(entity_type: string): [string, string][] {
		const table = this.config[entity_type];
		const table_name = this.sanitize(entity_type);
		// From the config rather than the bootstrapped maps: a migration helper
		// re-creates these mid-migration, before the bootstraps have run.
		return changeTriggerStatements(
			table_name,
			this.sanitize(table.config.primary_key || 'id'),
			capturesBeforeImage(table) ? this.liveColumns(table_name) : [],
		);
	}

	/** The table's stored (non-generated, non-binary, non-marker) columns. */
	private liveColumns(table_name: string): string[] {
		const blob = new Set(
			this.columnMeta(table_name).blob_columns.map((c) => this.sanitize(c)),
		);
		return this.ctx.storage.sql
			.exec(`PRAGMA table_xinfo(${quoteIdentifier(table_name)});`)
			.toArray()
			.filter((row) => Number(row.hidden ?? 0) === 0)
			.map((row) => String(row.name))
			.filter((column) => column !== WRITE_MARK_COLUMN && !blob.has(column));
	}

	/**
	 * Catch up every entity write that bypassed `DatabaseServer`: raw SQL
	 * through `exec()` or `ctx.storage.sql`, and the rows a foreign key
	 * cascaded to.
	 *
	 * For each changed row it does what the library write path does inline:
	 * stamps a fresh `updated_at` (so sync clients pick it up), re-indexes it
	 * for search (or removes it), refreshes FK-derived fields on rows that
	 * reference it, records history (attributed to the current `actor`), queues
	 * file GC and auto-embeds, and broadcasts the change. Several raw writes
	 * to one row since the last drain become one catch-up.
	 *
	 * It runs on its own at the start of every read and write through this
	 * class (one indexed `SELECT` when nothing is pending), after every
	 * `exec()`, and when the object wakes — so app code rarely needs to call
	 * it. Call it directly after writing through `ctx.storage.sql` when the
	 * next read must already see the result in search.
	 *
	 * Those automatic drains stop after 2,000 rows and leave the rest to the
	 * alarm, so one huge raw write can't stall the next request. Called
	 * directly, it drains everything.
	 *
	 * Returns the number of rows caught up.
	 */
	drainChanges(): number {
		return this.#drain(Infinity);
	}

	#drain(max_batches: number): number {
		if (!this.#change_capture_ready || this.#draining) return 0;
		this.#draining = true;
		let caught_up = 0;
		let more = false;
		try {
			for (let batch_number = 0; ; batch_number++) {
				if (batch_number >= max_batches) {
					more = true;
					break;
				}
				const pending = this.ctx.storage.sql
					.exec(
						`SELECT seq, entity_type, entity_id, op, before, stamped FROM ${quoteIdentifier(CHANGES_TABLE)} ORDER BY seq LIMIT ${CHANGE_DRAIN_BATCH};`,
					)
					.toArray();
				if (pending.length === 0) break;
				const last_seq = Number(pending[pending.length - 1].seq);
				// One catch-up per row: the first change's `before` is the row as it
				// was before any of them, and an insert anywhere in the run makes it
				// a create.
				const rows = new Map<
					string,
					{
						entity_type: string;
						entity_id: string;
						before: string | null;
						last_before: string | null;
						befores: string[];
						created: boolean;
						stamped: boolean;
					}
				>();
				for (const change of pending) {
					const key = `${change.entity_type}\u0000${change.entity_id}`;
					const stamped = Number(change.stamped ?? 0) === 1;
					const existing = rows.get(key);
					if (existing) {
						if (change.op === 'insert') existing.created = true;
						// The row as it was just before the latest change: what a
						// delete in the run removed (and whose files it orphaned).
						if (change.before !== null) {
							existing.last_before = String(change.before);
							existing.befores.push(String(change.before));
						}
						// The latest write decides whether the row's timestamp is the
						// caller's own (kept) or needs a fresh one.
						existing.stamped = stamped;
						continue;
					}
					rows.set(key, {
						entity_type: String(change.entity_type),
						entity_id: String(change.entity_id),
						before: change.before === null ? null : String(change.before),
						last_before: change.before === null ? null : String(change.before),
						befores: change.before === null ? [] : [String(change.before)],
						created: change.op === 'insert',
						stamped,
					});
				}
				const broadcasts: DeferredBroadcast[] = [];
				const batch = this.#batch_state;
				const touched = batch ?? { wrote: false };
				let row_failed = false;
				const deleted_types = new Set<string>();
				let embed_min_due: number | null = null;
				try {
					this.ctx.storage.transactionSync(() => {
						const now = new Date();
						for (const row of rows.values()) {
							// Each row in its own savepoint: one row the catch-up can't
							// process must not hold every other row (and, since the
							// drain runs at every entry point, every request) hostage.
							// It is set aside in `_changes_failed`, logged, and
							// reported by schemaReport().
							const row_broadcasts: DeferredBroadcast[] = [];
							try {
								const due = this.ctx.storage.transactionSync(() =>
									this.applyCapturedChange(
										row,
										now,
										touched,
										row_broadcasts,
										deleted_types,
									),
								);
								broadcasts.push(...row_broadcasts);
								if (due !== null)
									embed_min_due =
										embed_min_due === null ? due : Math.min(embed_min_due, due);
							} catch (error) {
								row_failed = true;
								// The row's savepoint rolled back whatever it wrote; the
								// in-memory caches may still hold it, and the rows after
								// it in this batch must not build on that.
								this.#dropStaleDictionaryCache();
								const message = DelightError.from(error).message;
								console.error(
									`[DatabaseServer] could not catch up ${row.entity_type} ${row.entity_id}: ${message}`,
								);
								this.ctx.storage.sql.exec(
									`INSERT INTO ${quoteIdentifier(CHANGES_FAILED_TABLE)} (entity_type, entity_id, error, failed_at) VALUES (?, ?, ?, ?);`,
									row.entity_type,
									row.entity_id,
									message,
									Date.now(),
								);
							}
							now.setMilliseconds(now.getMilliseconds() + 1);
						}
						for (const entity_type of deleted_types) {
							this.search.store.pruneTombstones(entity_type);
						}
						this.ctx.storage.sql.exec(
							`DELETE FROM ${quoteIdentifier(CHANGES_TABLE)} WHERE seq <= ?;`,
							last_seq,
						);
					});
				} catch (error) {
					if (!batch && touched.wrote) this.#dropStaleDictionaryCache();
					throw error;
				}
				// A rolled-back row may have touched the in-memory term dictionary.
				if (row_failed) this.#dropStaleDictionaryCache();
				if (embed_min_due !== null) this.armEmbedAlarm(embed_min_due);
				if (batch) batch.broadcasts.push(...broadcasts);
				else this.#flushCommittedBroadcasts(broadcasts);
				caught_up += rows.size;
			}
		} finally {
			this.#draining = false;
		}
		// Possibly more left: the alarm carries on (and re-arms itself until
		// the log is empty). Only ever moves the alarm earlier.
		if (more) {
			void this.ctx.storage
				.getAlarm()
				.then((existing) => {
					const now = Date.now();
					if (existing === null || existing > now) return this.ctx.storage.setAlarm(now);
				})
				.catch((error) =>
					console.error('[DatabaseServer] failed to arm the change-capture alarm:', error),
				);
		}
		return caught_up;
	}

	/**
	 * Broadcast catch-up results once they are known to have committed.
	 *
	 * A drain can run inside an app's own `ctx.storage.transactionSync()` (raw
	 * SQL written there, then `exec()` or a read catching it up). That outer
	 * transaction may still roll back after the drain returns, and a broadcast
	 * for a write that never happened plants rows on clients that no tombstone
	 * removes. So the broadcasts wait for the current synchronous run to end,
	 * then each is checked against the database: an update or create whose
	 * row no longer carries the timestamp the drain stamped, or a delete whose
	 * row is back, is dropped.
	 */
	#flushCommittedBroadcasts(broadcasts: DeferredBroadcast[]): void {
		if (!broadcasts.length) return;
		queueMicrotask(() => {
			const committed = broadcasts.filter((broadcast) => {
				const table = this.config[broadcast.entity_type];
				if (!table) return false;
				const row = this.ctx.storage.sql
					.exec(
						`SELECT "updated_at" FROM ${quoteIdentifier(this.sanitize(broadcast.entity_type))} WHERE ${quoteIdentifier(this.sanitize(table.config.primary_key || 'id'))} = ? LIMIT 1;`,
						broadcast.id,
					)
					.next()?.value as { updated_at?: number } | undefined;
				if (broadcast.action === 'deleted') return row === undefined;
				const stamped = (broadcast.data as { updated_at?: number } | undefined)?.updated_at;
				return row !== undefined && row.updated_at === stamped;
			});
			this.#flushBroadcasts(committed);
		});
	}

	/** Re-entrancy guard: catch-up work must never trigger another drain. */
	#draining = false;

	/**
	 * The cheap check run at every entry point: drain only when something is
	 * actually pending (one indexed read otherwise).
	 */
	#drainPending(): void {
		if (!this.#change_capture_ready || this.#draining) return;
		let pending: { done?: boolean };
		try {
			pending = this.ctx.storage.sql
				.exec(`SELECT 1 FROM ${quoteIdentifier(CHANGES_TABLE)} LIMIT 1;`)
				.next();
		} catch (error) {
			// The database was wiped under this instance (`ctx.storage.deleteAll()`,
			// destroy()): no tables, so nothing to catch up. Stop checking until
			// the next wake rebuilds everything.
			if (/no such table/i.test(DelightError.from(error).message)) {
				this.#change_capture_ready = false;
				return;
			}
			throw error;
		}
		if (!pending.done) this.#drain(CHANGE_DRAIN_AUTO_BATCHES);
	}

	/**
	 * Catch up one row a raw write changed. Returns the earliest auto-embed
	 * deadline it queued, if any.
	 */
	private applyCapturedChange(
		change: {
			entity_type: string;
			entity_id: string;
			before: string | null;
			last_before: string | null;
			befores: string[];
			created: boolean;
			stamped: boolean;
		},
		now: Date,
		touched: { wrote: boolean },
		broadcasts: DeferredBroadcast[],
		deleted_types: Set<string>,
	): number | null {
		const { entity_type } = change;
		const table = this.config[entity_type];
		if (!table || !this.isSearchIndexed(entity_type)) return null;
		const table_name = this.sanitize(entity_type);
		const primary_key = this.sanitize(table.config.primary_key || 'id');
		const id: string | number =
			table.config.primary_key_type === 'number'
				? Number(change.entity_id)
				: change.entity_id;
		let before_entity: Record<string, unknown> | undefined;
		if (change.before) {
			try {
				before_entity = this.toEntityValue(entity_type, JSON.parse(change.before)) as
					| Record<string, unknown>
					| undefined;
			} catch {
				before_entity = undefined;
			}
		}
		const row = this.ctx.storage.sql
			.exec(
				`SELECT * FROM ${quoteIdentifier(table_name)} WHERE ${quoteIdentifier(primary_key)} = ? LIMIT 1;`,
				id,
			)
			.next()?.value as Record<string, SqlStorageValue> | undefined;
		// The raw write's own `updated_at` is offered to the type's clock as the
		// proposed timestamp. The clock never goes backwards (it is the sync
		// cursor), so the value survives only when it is ahead of every
		// timestamp already handed out; anything at or below that would sit
		// under a client's cursor and never sync, and gets a fresh one instead.
		const proposed =
			row && change.stamped && typeof row.updated_at === 'number' && row.updated_at > 0
				? row.updated_at
				: now.getTime();
		now.setTime(this.search.store.allocateTimestamp(entity_type, proposed));
		const at = now.getTime();

		if (!row) {
			touched.wrote = true;
			this.search.removeDocument(entity_type, String(id), at);
			deleted_types.add(entity_type);
			this.cascadeReindexReferencing(entity_type, id, touched, now);
			// The row as the delete found it. It differs from `before_entity`
			// when the run also inserted or updated the row.
			let removed_entity = before_entity;
			if (change.last_before && change.last_before !== change.before) {
				try {
					removed_entity = this.toEntityValue(
						entity_type,
						JSON.parse(change.last_before),
					) as Record<string, unknown> | undefined;
				} catch {
					removed_entity = before_entity;
				}
			}
			// History replays the run: a create or an update the delete swallowed
			// is recorded first, then the delete with the row it removed.
			if (removed_entity && this.hasHistory(entity_type)) {
				const removed_payload = this.historyPayload(entity_type, removed_entity);
				if (change.created) {
					this.recordChange(entity_type, id, 'create', removed_payload, undefined, at);
				} else if (before_entity && removed_entity !== before_entity) {
					const diff = this.diffForHistory(
						this.historyPayload(entity_type, before_entity)!,
						removed_payload!,
					);
					if (Object.keys(diff.patch).length > 0) {
						this.recordChange(entity_type, id, 'update', diff.patch, diff.previous, at);
					}
				}
				this.recordChange(entity_type, id, 'delete', undefined, removed_payload, at);
			}
			this.dropAutoEmbeds(entity_type, id);
			this.enqueueFileDeletionsForRun(entity_type, id, change.befores, undefined, at);
			broadcasts.push({ action: 'deleted', entity_type, id, data: undefined });
			return null;
		}

		const entity = this.toEntityValue(entity_type, row) as Record<string, unknown>;
		// A fresh `updated_at` is what makes sync clients fetch the row again.
		// A value the raw write chose itself is kept when the clock accepted it
		// (it was ahead of everything already synced; see above).
		const keep_stamp = row.updated_at === at;
		if (!keep_stamp) entity.updated_at = at;
		const fix_created_at = !(typeof row.created_at === 'number' && row.created_at > 0);
		if (fix_created_at) entity.created_at = keep_stamp ? entity.updated_at : at;
		const sparse = table.toSparse(entity as never) as Record<string, unknown>;
		this.computeFkDerivedFields(entity_type, entity as never, sparse as never);
		const derived_fields = this.searchTable(entity_type).derived_fields;
		const sets = [WRITE_MARK_FLIP];
		const bindings: SqlStorageValue[] = [];
		if (!keep_stamp) {
			sets.push(`"updated_at" = ?`);
			bindings.push(at);
		}
		if (fix_created_at) {
			sets.push(`"created_at" = ?`);
			bindings.push(entity.created_at as number);
		}
		if (derived_fields?.size) {
			const blob: Record<string, unknown> = {};
			for (const field of derived_fields) {
				const value = sparse[field];
				if (value !== undefined && value !== null) blob[field] = value;
			}
			sets.push(`"json" = json_set(IFNULL("json", '{}'), '$."$derived"', json(?))`);
			bindings.push(JSON.stringify(blob));
		}
		// The stamp flips the write marker like every library write, so it is
		// not itself captured. Nothing to stamp (the raw write set a fresh
		// `updated_at` itself, no derived fields): no write at all.
		if (sets.length > 1) {
			this.ctx.storage.sql.exec(
				`UPDATE ${quoteIdentifier(table_name)} SET ${sets.join(', ')} WHERE ${quoteIdentifier(primary_key)} = ?;`,
				...bindings,
				id,
			);
		}
		touched.wrote = true;
		// No previous document: raw SQL changed the row behind the index's back,
		// so the store reads the old token set back from the index itself.
		this.search.indexDocument(entity_type, String(id), sparse);
		this.cascadeReindexReferencing(entity_type, id, touched, now);
		if (this.hasHistory(entity_type)) {
			if (before_entity && !change.created) {
				const diff = this.diffForHistory(
					this.historyPayload(entity_type, before_entity)!,
					this.historyPayload(entity_type, entity)!,
				);
				if (Object.keys(diff.patch).length > 0) {
					this.recordChange(entity_type, id, 'update', diff.patch, diff.previous, at);
				}
			} else if (change.created) {
				this.recordChange(
					entity_type,
					id,
					'create',
					this.historyPayload(entity_type, entity),
					undefined,
					at,
				);
			}
		}
		this.enqueueFileDeletionsForRun(entity_type, id, change.befores, entity, at);
		broadcasts.push({
			action: change.created ? 'created' : 'updated',
			entity_type,
			id,
			data: entity,
			sparse,
		});
		return this.queueAutoEmbeds(
			entity_type,
			id,
			change.created ? undefined : before_entity,
			entity,
			at,
		);
	}

	/* ---------------------------------------------------------------------- */
	/* Change log                                                             */
	/* ---------------------------------------------------------------------- */

	/** Entity types that opted into history, mapped to their retention in days. */
	#history_tables: Map<string, number> = new Map();

	/**
	 * Create the shared `_change_log` table (and its indexes) when at least one
	 * configured table opts into history, and arm the retention sweeper.
	 *
	 * Idempotent, like every other bootstrap step: it runs on every wake and
	 * does nothing once the table exists. A deployment that later turns history
	 * on for a table needs no migration — the first wake after the config change
	 * creates the table.
	 */
	private bootstrapChangeLog(): void {
		for (const [entity_type, table] of Object.entries(this.config)) {
			const history = table?.config?.history;
			if (!history?.enabled) continue;
			this.#history_tables.set(entity_type, Math.max(0, history.retention_days ?? 0));
		}
		if (this.#history_tables.size === 0) return;
		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(CHANGE_LOG_TABLE)} (
				id TEXT PRIMARY KEY,
				"table" TEXT NOT NULL,
				entity_id TEXT NOT NULL,
				operation TEXT NOT NULL,
				actor TEXT NOT NULL,
				operation_id TEXT,
				patch_json TEXT,
				previous_json TEXT,
				created_at INTEGER NOT NULL
			);`,
		);
		// (table, entity_id, created_at) serves `history()`; (created_at) serves
		// both `changesSince()` and the retention sweep. Without them each read
		// is a full scan of the log, which Cloudflare bills per row.
		this.ctx.storage.sql.exec(
			`CREATE INDEX IF NOT EXISTS "idx__change_log_entity" ON ${quoteIdentifier(CHANGE_LOG_TABLE)} ("table", entity_id, created_at);`,
		);
		this.ctx.storage.sql.exec(
			`CREATE INDEX IF NOT EXISTS "idx__change_log_created_at" ON ${quoteIdentifier(CHANGE_LOG_TABLE)} (created_at);`,
		);
		// (operation_id, created_at) serves `operationChanges()` and `revertOperation()`.
		// `revertOperation` reads the operation in reverse chronological order, so the
		// index has to carry the ordering too — otherwise undoing a 10,000-row
		// import sorts the whole log to find them.
		this.ctx.storage.sql.exec(
			`CREATE INDEX IF NOT EXISTS "idx__change_log_operation" ON ${quoteIdentifier(CHANGE_LOG_TABLE)} (operation_id, created_at);`,
		);
		this.registerAlarm('change_log_retention', () => this.sweepChangeLog());
		// Armed before `bootstrapSearch()` so a pending rebuild's immediate alarm
		// still wins: `scheduleChangeLogAlarm` never moves an existing alarm later.
		void this.scheduleChangeLogAlarm().catch((error) => {
			console.error('[DatabaseServer] failed to arm the change-log alarm:', error);
		});
	}

	/** Whether the entity type records its mutations in `_change_log`. */
	private hasHistory(entity_type: string): boolean {
		return this.#history_tables.has(entity_type);
	}

	/**
	 * The change-log projection of an entity: everything except `blob()` columns.
	 *
	 * A change log that copied binary payloads would multiply the storage cost of
	 * exactly the fields that are already the largest thing in the row (a 5 MB
	 * blob updated ten times would cost 50 MB of history), and JSON has no
	 * lossless representation for bytes anyway. `r2()` references — which are
	 * small descriptors, not payloads — are recorded normally.
	 */
	/** Vector-typed top-level fields per entity type, for the history strip. */
	#history_vector_fields: Map<string, string[]> = new Map();

	/** The entity type's vector fields — computed once, `historyPayload` is hot. */
	private historyVectorFields(entity_type: string): string[] {
		let fields = this.#history_vector_fields.get(entity_type);
		if (!fields) {
			fields = [];
			const generators = this.config[entity_type]?._ ?? {};
			for (const [field_name, generator] of Object.entries(generators)) {
				const def = (generator as { _?: { type?: string } })?._;
				if (def?.type === 'vector') fields.push(field_name);
			}
			this.#history_vector_fields.set(entity_type, fields);
		}
		return fields;
	}

	private historyPayload(
		entity_type: string,
		data: Record<string, unknown> | undefined,
	): Record<string, unknown> | undefined {
		if (!data) return undefined;
		const blob_columns = this.columnMeta(entity_type).blob_columns;
		const vector_fields = this.historyVectorFields(entity_type);
		if (blob_columns.length === 0 && vector_fields.length === 0) return data;
		const stripped = { ...data };
		// Vectors are dropped outright, marker-less — the opposite of the blob
		// treatment below, for the opposite reason. A 768-float vector is
		// ~10-15KB of JSON per recorded payload, in change logs that tables
		// like to keep forever, and unlike blob bytes it is *derived*: a
		// reverted delete restores the row without it, the restore is an
		// ordinary create, and the auto-embed queue regenerates the vector
		// from the restored source fields. Nothing is lost, so nothing needs
		// a marker to refuse over.
		for (const field of vector_fields) delete stripped[field];
		for (const column of blob_columns) {
			const value = stripped[column];
			if (value === undefined) continue;
			// Deliberately NOT the bytes. `JSON.stringify(new Uint8Array([1,2]))`
			// is `{"0":1,"1":2}` — five-ish bytes of JSON per byte of payload —
			// so recording a 1MB blob would blow past the Durable Object's 2MB
			// per-value ceiling and make the log larger than the table.
			//
			// A marker rather than a deleted key, so `revert()` can tell "this
			// column held bytes we did not keep" from "this column was empty"
			// and refuse instead of silently restoring an incomplete row.
			// Just the flag: by the time a payload reaches here the value has
			// already been encoded for storage, so any "size" recorded would be
			// the encoded length rather than the blob's, which is worse than
			// saying nothing. The marker exists to be detected, not measured.
			stripped[column] = { [BLOB_OMITTED]: true };
		}
		return stripped;
	}

	/**
	 * Append one row to `_change_log`. Called from inside the entity write
	 * transaction, so a rolled-back write leaves no history behind.
	 */
	private recordChange(
		entity_type: string,
		entity_id: string | number,
		operation: ChangeLogOperation,
		patch: Record<string, unknown> | undefined,
		previous: Record<string, unknown> | undefined,
		created_at: number,
	): void {
		this.ctx.storage.sql.exec(
			`INSERT INTO ${quoteIdentifier(CHANGE_LOG_TABLE)} (id, "table", entity_id, operation, actor, operation_id, patch_json, previous_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
			generateTimestampID(),
			entity_type,
			String(entity_id),
			operation,
			this.#actor,
			this.#operation ?? null,
			patch === undefined ? null : JSON.stringify(patch),
			previous === undefined ? null : JSON.stringify(previous),
			created_at,
		);
	}

	/**
	 * The changed half of an update: only the fields whose value actually
	 * differs, plus the previous value of each of them.
	 *
	 * Recording the whole entity twice per update would make the log larger than
	 * the table it describes within a handful of edits; a field-level diff keeps
	 * a typical single-field edit at a few dozen bytes and is exactly what
	 * `revert()` needs to put the row back.
	 */
	private diffForHistory(
		previous: Record<string, unknown>,
		next: Record<string, unknown>,
	): { patch: Record<string, unknown>; previous: Record<string, unknown> } {
		const patch: Record<string, unknown> = {};
		const before: Record<string, unknown> = {};
		const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
		for (const key of keys) {
			// `updated_at` changes on every write by definition — recording it
			// would make every diff non-empty and tell the reader nothing.
			if (key === 'updated_at') continue;
			if (deepEqual(previous[key], next[key])) continue;
			// `JSON.stringify` drops keys whose value is `undefined`, which would
			// erase the very fact this diff exists to record: that the field was
			// unset before (or was cleared by this write). Both directions are
			// normalized to `null` so the key survives the round trip and
			// `revert()` can actually put the field back — an optional field is
			// nullable, so `null` restores it faithfully.
			patch[key] = next[key] === undefined ? null : next[key];
			before[key] = previous[key] === undefined ? null : previous[key];
		}
		return { patch, previous: before };
	}

	/** Parse one raw `_change_log` row into the public {@link ChangeLogEntry}. */
	private toChangeLogEntry(row: Record<string, unknown>): ChangeLogEntry {
		const parse = (value: unknown): Record<string, unknown> | undefined => {
			if (typeof value !== 'string') return undefined;
			try {
				const parsed: unknown = JSON.parse(value);
				if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
					return undefined;
				}
				return parsed as Record<string, unknown>;
			} catch {
				return undefined;
			}
		};
		return {
			id: String(row.id),
			table: String(row.table),
			entity_id: String(row.entity_id),
			operation: String(row.operation) as ChangeLogOperation,
			actor: String(row.actor),
			operation_id:
				typeof row.operation_id === 'string' && row.operation_id
					? row.operation_id
					: undefined,
			patch: parse(row.patch_json),
			previous: parse(row.previous_json),
			created_at: Number(row.created_at) || 0,
		};
	}

	/** Throws when nothing in the config records history (so there is no table to read). */
	private assertChangeLog(): void {
		if (this.#history_tables.size > 0) return;
		throw new DelightError({
			message:
				'No table has history enabled. Pass `{ history: true }` to Database.table() for the tables you want recorded.',
			status: 400,
			code: 'history_disabled',
		});
	}

	/**
	 * The recorded changes to one entity, newest first.
	 *
	 * `before` pages backwards through time (pass the `created_at` of the oldest
	 * entry you have); `limit` caps the page at 1000.
	 */
	history(
		entity_type: keyof DatabaseConfig & string,
		id: string | number,
		options?: HistoryOptions,
	): ChangeLogEntry[] {
		this.assertChangeLog();
		this.#drainPending();
		const limit = Math.max(1, Math.min(1000, Math.trunc(options?.limit || 50)));
		const before =
			typeof options?.before === 'number' && Number.isFinite(options.before)
				? options.before
				: undefined;
		const rows =
			before === undefined
				? this.ctx.storage.sql
						.exec(
							`SELECT * FROM ${quoteIdentifier(CHANGE_LOG_TABLE)} WHERE "table" = ? AND entity_id = ? ORDER BY created_at DESC, id DESC LIMIT ${limit};`,
							entity_type,
							String(id),
						)
						.toArray()
				: this.ctx.storage.sql
						.exec(
							`SELECT * FROM ${quoteIdentifier(CHANGE_LOG_TABLE)} WHERE "table" = ? AND entity_id = ? AND created_at < ? ORDER BY created_at DESC, id DESC LIMIT ${limit};`,
							entity_type,
							String(id),
							before,
						)
						.toArray();
		return rows.map((row) => this.toChangeLogEntry(row as Record<string, unknown>));
	}

	/**
	 * Every recorded change at or after `timestamp`, oldest first — the feed
	 * shape (audit trails, outbound replication, "what happened while I was
	 * away"). Optionally narrowed to one entity type, one operation, or both.
	 */
	changesSince(timestamp: number, options?: ChangesSinceOptions): ChangeLogEntry[] {
		this.assertChangeLog();
		this.#drainPending();
		const since = Number.isFinite(timestamp) ? Math.max(0, timestamp) : 0;
		const limit = Math.max(1, Math.min(5000, Math.trunc(options?.limit || 500)));
		const conditions = ['created_at >= ?'];
		const bindings: (string | number)[] = [since];
		if (options?.table) {
			conditions.push('"table" = ?');
			bindings.push(options.table);
		}
		const operation = options?.operation?.trim();
		if (operation) {
			conditions.push('operation_id = ?');
			bindings.push(operation);
		}
		const rows = this.ctx.storage.sql
			.exec(
				`SELECT * FROM ${quoteIdentifier(CHANGE_LOG_TABLE)} WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC, id ASC LIMIT ${limit};`,
				...bindings,
			)
			.toArray();
		return rows.map((row) => this.toChangeLogEntry(row as Record<string, unknown>));
	}

	/**
	 * Every change recorded under one `{ operation }` id, oldest first — the shape of
	 * "what did that import actually do".
	 *
	 * Chronological rather than newest-first because an operation is read as a story:
	 * it is one operation, and the order the writes happened in is the order that
	 * explains it. (`revertOperation()` walks the same rows backwards.)
	 *
	 * Returns an empty array for an unknown operation id — an operation is not an entity,
	 * so "no changes recorded under this id" is an ordinary answer, not a 404.
	 * `revertOperation()` is the one that refuses, because undoing nothing when you
	 * asked to undo an import is a bug worth surfacing.
	 */
	operationChanges(
		operation_id: string,
		options?: OperationChangesOptions,
	): ChangeLogEntry[] {
		this.assertChangeLog();
		const operation = operation_id?.trim();
		if (!operation) return [];
		const limit = Math.max(1, Math.min(5000, Math.trunc(options?.limit || 500)));
		const rows = this.ctx.storage.sql
			.exec(
				`SELECT * FROM ${quoteIdentifier(CHANGE_LOG_TABLE)} WHERE operation_id = ? ORDER BY created_at ASC, id ASC LIMIT ${limit};`,
				operation,
			)
			.toArray();
		return rows.map((row) => this.toChangeLogEntry(row as Record<string, unknown>));
	}

	/** Read one change-log row by id, or throw a 404. */
	private getChange(change_id: string): ChangeLogEntry {
		this.assertChangeLog();
		const row = this.ctx.storage.sql
			.exec(
				`SELECT * FROM ${quoteIdentifier(CHANGE_LOG_TABLE)} WHERE id = ? LIMIT 1;`,
				change_id,
			)
			.next()?.value as Record<string, unknown> | undefined;
		if (!row) {
			throw new DelightError({ message: `Change ${change_id} not found`, status: 404 });
		}
		return this.toChangeLogEntry(row);
	}

	/**
	 * Undo one recorded change, restoring the state it overwrote.
	 *
	 * A reverted create deletes the row, a reverted update writes the previous
	 * values of exactly the fields it changed, and a reverted delete recreates
	 * the row with its original id and `created_at`. The revert is itself an
	 * ordinary mutation, so it appends its own change-log entry attributed to the
	 * current actor — history is append-only and a revert can be reverted.
	 *
	 * Returns the resulting entity (`undefined` when the revert deleted it).
	 */
	revert(
		change_id: string,
		options?: RevertOptions,
	): Record<string, unknown> | undefined {
		const change = this.getChange(change_id);
		const entity_type = change.table as keyof DatabaseConfig & string;
		if (!this.config[entity_type]) {
			throw new DelightError({
				message: `Entity type ${change.table} is not valid`,
				status: 400,
			});
		}
		return this.withWriteScope(options, () => {
			if (change.operation === 'create') {
				this.delete(entity_type, change.entity_id);
				return undefined;
			}
			if (!change.previous) {
				throw new DelightError({
					message: `Change ${change_id} has no previous state to restore`,
					status: 409,
				});
			}

			// Blob bytes are never recorded (see `historyPayload`), so a change
			// that touched one cannot be fully undone. Say so instead of writing
			// a row that quietly lost its payload.
			const omitted = omittedBlobFields(change.previous);
			if (omitted.length > 0 && !options?.without_blobs) {
				throw new DelightError({
					message: `Change ${change_id} cannot be reverted: the change log does not store blob bytes, so ${omitted.map((field) => `'${field}'`).join(', ')} would be lost. Pass { without_blobs: true } to restore everything else and leave ${omitted.length === 1 ? 'it' : 'them'} unset — which fails if the column is required.`,
					status: 409,
					code: 'blob_not_recoverable',
				});
			}
			const previous = { ...change.previous };
			for (const field of omitted) delete previous[field];

			if (change.operation === 'update') {
				// `allow_readonly` because a revert restores a state the row
				// legitimately held; the usual readonly strip would silently drop
				// exactly the columns the caller asked to put back.
				return this.update(entity_type, change.entity_id, previous as never, {
					...options,
					allow_readonly: true,
				}) as Record<string, unknown> | undefined;
			}
			const [result] = this.transaction([
				{ create: { type: entity_type, data: previous, preserve_id: true } },
			]);
			return result && 'entity' in result
				? (result.entity.data as Record<string, unknown>)
				: undefined;
		});
	}

	/**
	 * Undo every change recorded under one `{ operation }` id — the whole import,
	 * bulk retag or agent run — as a single atomic unit.
	 *
	 * Returns how many changes were reverted.
	 *
	 * Three properties make this different from calling `revert()` in a loop:
	 *
	 * - **Reverse chronological.** The operation is walked newest-first. This is a
	 *   correctness requirement, not a preference: an operation that creates a row and
	 *   then updates it must undo the update before the create, or the update's
	 *   revert hits a row that no longer exists (and, worse, a delete-then-create
	 *   pair replayed forwards would resurrect the wrong state).
	 * - **Atomic.** The whole walk runs inside `batch()`, so one failure — a
	 *   `blob_not_recoverable`, a foreign key, anything — rolls back every revert
	 *   in the run. A half-undone import is worse than an un-undone one.
	 * - **Revertible.** The reverts are themselves recorded, under a *new* operation
	 *   id, so `revertOperation(that_id)` redoes the original operation. Pass
	 *   `{ operation }` to choose that id (the only way to know it up front — this
	 *   returns a count, not an id); one is generated when you do not.
	 *
	 * An unknown or blank operation id throws a `DelightError` (404): asking to undo
	 * an operation and silently undoing nothing hides the real bug, which is
	 * usually an operation id that never made it onto the writes.
	 */
	revertOperation(operation_id: string, options?: RevertOptions): number {
		this.assertChangeLog();
		const operation = operation_id?.trim();
		const rows = operation
			? this.ctx.storage.sql
					.exec(
						`SELECT * FROM ${quoteIdentifier(CHANGE_LOG_TABLE)} WHERE operation_id = ? ORDER BY created_at DESC, id DESC LIMIT ${REVERT_OPERATION_MAX_CHANGES + 1};`,
						operation,
					)
					.toArray()
			: [];
		if (rows.length === 0) {
			throw new DelightError({
				message: `No changes recorded under operation ${operation_id}`,
				status: 404,
				code: 'operation_not_found',
			});
		}
		if (rows.length > REVERT_OPERATION_MAX_CHANGES) {
			throw new DelightError({
				message: `Operation ${operation} contains more than ${REVERT_OPERATION_MAX_CHANGES} changes, which cannot be reverted in one Durable Object transaction. Split the original work across several operation ids.`,
				status: 413,
				code: 'operation_too_large',
			});
		}
		const changes = rows.map((row) =>
			this.toChangeLogEntry(row as Record<string, unknown>),
		);
		// A fresh id so the reverts group as their own unit; taken from the
		// caller when supplied, since the return value is a count and there is
		// otherwise no way to learn a generated one.
		const revert_operation = options?.operation?.trim() || generateTimestampID();
		const revert_options: RevertOptions = {
			...options,
			actor: options?.actor,
			operation: revert_operation,
		};
		return this.batch(() => {
			for (const change of changes) this.revert(change.id, revert_options);
			return changes.length;
		}, revert_options);
	}

	/** Change-log rows deleted per table per sweeper invocation. */
	protected changeLogSweepBatch(): number {
		return CHANGE_LOG_SWEEP_BATCH;
	}

	/**
	 * Delete change-log rows past their table's retention window.
	 *
	 * Bounded per invocation for the same reason the legacy journal teardown is:
	 * DO SQLite deletes row by row, so an unbounded `DELETE` over a large log can
	 * exceed the CPU limit and then retry identically forever. When a sweep
	 * fills its batch the alarm is re-armed immediately; otherwise it is armed
	 * for the next daily tick.
	 */
	private async sweepChangeLog(): Promise<void> {
		if (this.#history_tables.size === 0) return;
		const batch_size = Math.max(1, Math.trunc(this.changeLogSweepBatch()));
		const now = Date.now();
		let filled_a_batch = false;
		for (const [entity_type, retention_days] of this.#history_tables) {
			// 0 means "keep forever" — the documented opt-out.
			if (!retention_days) continue;
			const cutoff = now - retention_days * DAY_MS;
			const doomed = this.ctx.storage.sql
				.exec(
					`SELECT id FROM ${quoteIdentifier(CHANGE_LOG_TABLE)} WHERE "table" = ? AND created_at < ? ORDER BY created_at ASC LIMIT ${batch_size};`,
					entity_type,
					cutoff,
				)
				.toArray();
			if (doomed.length === 0) continue;
			this.ctx.storage.transactionSync(() => {
				this.ctx.storage.sql.exec(
					`DELETE FROM ${quoteIdentifier(CHANGE_LOG_TABLE)} WHERE id IN (SELECT id FROM ${quoteIdentifier(CHANGE_LOG_TABLE)} WHERE "table" = ? AND created_at < ? ORDER BY created_at ASC LIMIT ${batch_size});`,
					entity_type,
					cutoff,
				);
			});
			console.log(
				`[DatabaseServer] change log retention: pruned ${doomed.length} ${entity_type} rows older than ${retention_days}d`,
			);
			if (doomed.length >= batch_size) filled_a_batch = true;
		}
		await this.scheduleChangeLogAlarm(filled_a_batch ? 0 : CHANGE_LOG_SWEEP_INTERVAL_MS);
	}

	/**
	 * Arm the retention sweep, without ever pushing an earlier alarm later.
	 *
	 * Alarms are a single slot shared by every registered handler, so a naive
	 * `setAlarm(now + 24h)` here would postpone a search rebuild that had armed
	 * itself for *now*. The existing alarm is read first and left alone when it
	 * already fires sooner — the base `alarm()` runs every handler, so an
	 * earlier tick sweeps too.
	 */
	private async scheduleChangeLogAlarm(
		delay_ms: number = CHANGE_LOG_SWEEP_INTERVAL_MS,
	): Promise<void> {
		const storage = this.ctx.storage as unknown as {
			setAlarm?(time: number): Promise<void> | void;
			getAlarm?(): Promise<number | null>;
		};
		if (typeof storage.setAlarm !== 'function') return;
		const target = Date.now() + Math.max(0, delay_ms);
		if (typeof storage.getAlarm === 'function') {
			const current = await storage.getAlarm();
			if (typeof current === 'number' && current > 0 && current <= target) return;
		}
		await storage.setAlarm(target);
	}

	/* ---------------------------------------------------------------------- */
	/* Operation log — `{ op_id }` dedupe                                     */
	/* ---------------------------------------------------------------------- */

	/**
	 * Whether `_op_log` is known to exist. `undefined` until the first wake-time
	 * probe or the first `{ op_id }` write answers the question.
	 */
	#op_log_ready: boolean | undefined = undefined;

	/**
	 * Notice an `_op_log` left behind by a previous deployment.
	 *
	 * Unlike `_change_log` and `_file_gc`, nothing in the *config* says whether
	 * this database ever dedupes — only the writes do, and they may not arrive
	 * for hours. Without this probe the retention sweeper would not be armed
	 * until the next `{ op_id }` write, so a Durable Object that goes quiet
	 * right after an offline drain would keep its op log forever.
	 *
	 * One `sqlite_master` lookup per wake, and only when the table is already
	 * there does anything else happen.
	 */
	private bootstrapOpLog(): void {
		const found = this.ctx.storage.sql
			.exec(
				`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1;`,
				OP_LOG_TABLE,
			)
			.toArray();
		if (found.length === 0) return;
		this.#op_log_ready = true;
		this.armOpLogSweep();
	}

	/**
	 * Create `_op_log` on first use.
	 *
	 * Created lazily rather than at bootstrap because most databases never see
	 * an `{ op_id }` write at all — an app that does not run the offline outbox
	 * would otherwise carry an empty internal table and a daily alarm for
	 * nothing.
	 *
	 * The column set is fixed here for good: the package has no migration path
	 * for its own internal tables, so `kind` / `table` / `entity_id` are
	 * recorded even though dedupe itself only needs `op_id` and `result_json` —
	 * they are what makes {@link appliedOperation} able to answer "did that
	 * write land, and on what" without re-deriving it from the caller's request.
	 */
	private ensureOpLog(): void {
		if (this.#op_log_ready) return;
		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(OP_LOG_TABLE)} (
				op_id TEXT PRIMARY KEY,
				kind TEXT NOT NULL,
				"table" TEXT,
				entity_id TEXT,
				result_json TEXT,
				created_at INTEGER NOT NULL
			);`,
		);
		// The only read order there is: the log is swept oldest-first. Lookups go
		// through the primary key.
		this.ctx.storage.sql.exec(
			`CREATE INDEX IF NOT EXISTS "idx__op_log_created_at" ON ${quoteIdentifier(OP_LOG_TABLE)} (created_at);`,
		);
		this.#op_log_ready = true;
		this.armOpLogSweep();
	}

	/** Register + schedule the TTL sweep. Idempotent (the map is keyed by name). */
	private armOpLogSweep(): void {
		this.registerAlarm('op_log_retention', () => this.sweepOpLog());
		void this.scheduleOpLogAlarm().catch((error) => {
			console.error('[DatabaseServer] failed to arm the op-log alarm:', error);
		});
	}

	/**
	 * The op log's projection of a result: JSON, with `blob()` bytes dropped.
	 *
	 * Same rule and the same reason as the change log's `historyPayload()` — a
	 * `Uint8Array` has no lossless JSON form, and the one it does have costs
	 * roughly five bytes of text per byte of payload, which would push a
	 * single-megabyte blob straight past the Durable Object's 2 MB per-value
	 * ceiling. A blob column therefore comes back from a *replayed* write as the
	 * {@link BLOB_OMITTED} marker rather than its bytes. `file()` references are
	 * small descriptors and are recorded verbatim.
	 */
	private opLogResult(
		kind: OperationKind,
		entity_type: string | undefined,
		result: unknown,
	) {
		if (result === undefined || result === null) return undefined;
		if ((kind === 'create' || kind === 'update') && entity_type) {
			return this.historyPayload(entity_type, result as Record<string, unknown>);
		}
		return result;
	}

	/** Read one recorded operation, or `undefined` when it has not been applied. */
	private readOpLog(op_id: string): AppliedOperation | undefined {
		if (!this.#op_log_ready) return undefined;
		const row = this.ctx.storage.sql
			.exec(
				`SELECT op_id, kind, "table", entity_id, result_json, created_at FROM ${quoteIdentifier(OP_LOG_TABLE)} WHERE op_id = ? LIMIT 1;`,
				op_id,
			)
			.toArray()[0] as Record<string, unknown> | undefined;
		if (!row) return undefined;
		let result: unknown = undefined;
		if (typeof row.result_json === 'string') {
			try {
				result = JSON.parse(row.result_json);
			} catch {
				result = undefined;
			}
		}
		return {
			op_id: String(row.op_id),
			kind: String(row.kind) as OperationKind,
			table: typeof row.table === 'string' && row.table ? row.table : undefined,
			entity_id:
				typeof row.entity_id === 'string' && row.entity_id ? row.entity_id : undefined,
			result,
			created_at: Number(row.created_at) || 0,
		};
	}

	/**
	 * Whether this `op_id` has already been applied, and what it returned.
	 *
	 * The read half of the dedupe log: an offline client that lost the response
	 * to a write it knows it sent can ask rather than re-sending and hoping. The
	 * result is the recorded one, so it is subject to the blob rule in
	 * {@link opLogResult} and to the seven-day retention window — an unknown
	 * `op_id` means "never applied, **or** applied more than a week ago".
	 */
	appliedOperation(op_id: string): AppliedOperation | undefined {
		const trimmed = op_id?.trim();
		if (!trimmed) return undefined;
		if (this.#op_log_ready === undefined) this.bootstrapOpLog();
		return this.readOpLog(trimmed);
	}

	/**
	 * Apply `run` exactly once for `op_id`, returning the original result on any
	 * later replay.
	 *
	 * The write and its log row commit together (`batch()` is the package's
	 * atomicity primitive, and joins an outer batch when one is open), so a
	 * rolled-back write never leaves a log row claiming it happened — and a
	 * retry of a *failed* write is therefore a real retry, not a silent no-op.
	 */
	private deduplicate<T>(
		op_id: string,
		kind: OperationKind,
		entity_type: string | undefined,
		entity_id: string | number | undefined,
		run: () => T,
	): T {
		this.ensureOpLog();
		const replay = this.readOpLog(op_id);
		if (replay) return replay.result as T;
		return this.batch(() => {
			const result = run();
			const recorded_id =
				entity_id ??
				(result && typeof result === 'object' && entity_type
					? ((result as Record<string, unknown>)[
							this.config[entity_type]?.config?.primary_key || 'id'
						] as string | number | undefined)
					: undefined);
			this.ctx.storage.sql.exec(
				`INSERT INTO ${quoteIdentifier(OP_LOG_TABLE)} (op_id, kind, "table", entity_id, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?);`,
				op_id,
				kind,
				entity_type ?? null,
				recorded_id === undefined || recorded_id === null ? null : String(recorded_id),
				JSON.stringify(this.opLogResult(kind, entity_type, result) ?? null),
				Date.now(),
			);
			return result;
		});
	}

	/** Delete op-log rows past the seven-day window, bounded like every sweep here. */
	private async sweepOpLog(): Promise<void> {
		if (!this.#op_log_ready) return;
		const cutoff = Date.now() - OP_LOG_RETENTION_MS;
		const doomed = this.ctx.storage.sql
			.exec(
				`SELECT op_id FROM ${quoteIdentifier(OP_LOG_TABLE)} WHERE created_at < ? ORDER BY created_at ASC LIMIT ${OP_LOG_SWEEP_BATCH};`,
				cutoff,
			)
			.toArray();
		if (doomed.length > 0) {
			this.ctx.storage.transactionSync(() => {
				this.ctx.storage.sql.exec(
					`DELETE FROM ${quoteIdentifier(OP_LOG_TABLE)} WHERE op_id IN (SELECT op_id FROM ${quoteIdentifier(OP_LOG_TABLE)} WHERE created_at < ? ORDER BY created_at ASC LIMIT ${OP_LOG_SWEEP_BATCH});`,
					cutoff,
				);
			});
		}
		await this.scheduleOpLogAlarm(
			doomed.length >= OP_LOG_SWEEP_BATCH ? 0 : OP_LOG_SWEEP_INTERVAL_MS,
		);
	}

	/** Arm the op-log sweep without ever pushing an earlier alarm later. */
	private async scheduleOpLogAlarm(
		delay_ms: number = OP_LOG_SWEEP_INTERVAL_MS,
	): Promise<void> {
		const storage = this.ctx.storage as unknown as {
			setAlarm?(time: number): Promise<void> | void;
			getAlarm?(): Promise<number | null>;
		};
		if (typeof storage.setAlarm !== 'function') return;
		const target = Date.now() + Math.max(0, delay_ms);
		if (typeof storage.getAlarm === 'function') {
			const current = await storage.getAlarm();
			if (typeof current === 'number' && current > 0 && current <= target) return;
		}
		await storage.setAlarm(target);
	}

	/* ---------------------------------------------------------------------- */
	/* File garbage collection                                                */
	/* ---------------------------------------------------------------------- */

	/** Entity types with `file()` columns, mapped to each column's default store. */
	#file_tables: Map<string, Record<string, { store: string }>> = new Map();

	/**
	 * Create the `_file_gc` queue when at least one configured table has a
	 * `file()` column.
	 *
	 * Same lifecycle as `bootstrapChangeLog()`: idempotent, runs on every wake,
	 * and a database with no file columns never creates the table at all —
	 * nothing can ever enqueue into it, so it would only be a row nobody reads.
	 */
	private bootstrapFileGC(): void {
		for (const [entity_type, table] of Object.entries(this.config)) {
			const file_fields = table?.config?.file_fields;
			if (!file_fields || Object.keys(file_fields).length === 0) continue;
			this.#file_tables.set(entity_type, file_fields);
		}
		if (this.#file_tables.size === 0) return;
		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(FILE_GC_TABLE)} (
				id TEXT PRIMARY KEY,
				store TEXT NOT NULL,
				key TEXT NOT NULL,
				entity_type TEXT NOT NULL,
				entity_id TEXT NOT NULL,
				deleted_at INTEGER NOT NULL
			);`,
		);
		// The only read order there is: the queue is drained oldest-first.
		this.ctx.storage.sql.exec(
			`CREATE INDEX IF NOT EXISTS "idx__file_gc_deleted_at" ON ${quoteIdentifier(FILE_GC_TABLE)} (deleted_at);`,
		);
	}

	/** The `file()` columns of an entity type, or `undefined` when it has none. */
	private fileFields(entity_type: string): Record<string, { store: string }> | undefined {
		return this.#file_tables.get(entity_type);
	}

	/**
	 * The reference in `value`, if it is one.
	 *
	 * Structural rather than `instanceof`: a reference is a plain object that
	 * came back out of the `json` column, and the only thing that matters here
	 * is whether it names an object in a store.
	 */
	private asFileReference(value: unknown): FileReference | undefined {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
		const reference = value as Partial<FileReference>;
		if (typeof reference.key !== 'string' || reference.key.length === 0) return undefined;
		return reference as FileReference;
	}

	/**
	 * Queue one now-unreferenced object for the application to delete.
	 *
	 * Called from inside the entity write transaction, like `recordChange()`, so
	 * a rolled-back write never leaves a queue row telling the app to delete an
	 * object the row still points at.
	 */
	private enqueueFileDeletion(
		entity_type: string,
		entity_id: string | number,
		reference: FileReference,
		default_store: string,
		deleted_at: number,
	): void {
		// The reference's own store wins: a row migrated to another bucket keeps
		// pointing at that bucket, and reading the field's default here would
		// hand the app a key to delete from the wrong one.
		const store = reference.store?.trim() || default_store;
		if (!store) return;
		this.ctx.storage.sql.exec(
			`INSERT INTO ${quoteIdentifier(FILE_GC_TABLE)} (id, store, key, entity_type, entity_id, deleted_at) VALUES (?, ?, ?, ?, ?, ?);`,
			generateTimestampID(),
			store,
			reference.key,
			entity_type,
			String(entity_id),
			deleted_at,
		);
	}

	/**
	 * Queue every file reference a deleted row held.
	 *
	 * The row is gone, so every object it pointed at is now unreferenced by it.
	 */
	/**
	 * File GC for a run of raw writes to one row: every object any version
	 * of the row pointed at during the run (each change's before image) and
	 * the final row no longer does. A run `insert A → update to B → delete`
	 * orphans both A and B.
	 */
	private enqueueFileDeletionsForRun(
		entity_type: string,
		entity_id: string | number,
		befores: string[],
		final_entity: Record<string, unknown> | undefined,
		deleted_at: number,
	): void {
		const file_fields = this.fileFields(entity_type);
		if (!file_fields || befores.length === 0) return;
		const versions: Record<string, unknown>[] = [];
		for (const before of befores) {
			try {
				const entity = this.toEntityValue(entity_type, JSON.parse(before));
				if (entity) versions.push(entity as Record<string, unknown>);
			} catch {
				// An unreadable image orphans nothing we can name.
			}
		}
		for (const [field, meta] of Object.entries(file_fields)) {
			const kept = final_entity
				? this.asFileReference(readFieldPath(final_entity, field))?.key
				: undefined;
			const queued = new Set<string>();
			for (const version of versions) {
				const reference = this.asFileReference(readFieldPath(version, field));
				if (!reference || reference.key === kept || queued.has(reference.key)) continue;
				queued.add(reference.key);
				this.enqueueFileDeletion(entity_type, entity_id, reference, meta.store, deleted_at);
			}
		}
	}

	private enqueueFileDeletionsForDelete(
		entity_type: string,
		entity_id: string | number,
		deleted_entity: Record<string, unknown> | undefined,
		deleted_at: number,
	): void {
		const file_fields = this.fileFields(entity_type);
		if (!file_fields || !deleted_entity) return;
		for (const [field, meta] of Object.entries(file_fields)) {
			const reference = this.asFileReference(readFieldPath(deleted_entity, field));
			if (!reference) continue;
			this.enqueueFileDeletion(entity_type, entity_id, reference, meta.store, deleted_at);
		}
	}

	/**
	 * Queue the objects an update orphaned — those whose `key` the write replaced.
	 *
	 * Keyed on `key` alone, deliberately. A write that changes only `mime`,
	 * `name` or `metadata` is describing the *same* object better, not pointing
	 * at a new one, and enqueueing there would have the application delete a file
	 * the row still uses. Changing `store` without changing `key` is likewise a
	 * migration record, not an orphaning: the same object now lives elsewhere.
	 */
	private enqueueFileDeletionsForUpdate(
		entity_type: string,
		entity_id: string | number,
		previous_entity: Record<string, unknown> | undefined,
		next_entity: Record<string, unknown> | undefined,
		deleted_at: number,
	): void {
		const file_fields = this.fileFields(entity_type);
		if (!file_fields || !previous_entity) return;
		for (const [field, meta] of Object.entries(file_fields)) {
			const before = this.asFileReference(readFieldPath(previous_entity, field));
			if (!before) continue;
			const after = next_entity
				? this.asFileReference(readFieldPath(next_entity, field))
				: undefined;
			if (after && after.key === before.key) continue;
			this.enqueueFileDeletion(entity_type, entity_id, before, meta.store, deleted_at);
		}
	}

	/** Throws when no configured table has a `file()` column (so there is no queue). */
	private assertFileGC(): void {
		if (this.#file_tables.size > 0) return;
		throw new DelightError({
			message:
				'No table has a file() column, so there is no file deletion queue. Declare one with schema.file({ store }).',
			status: 400,
			code: 'file_gc_disabled',
		});
	}

	/**
	 * Objects whose owning row is gone or has been repointed, oldest first.
	 *
	 * The database is the only component that knows both *when* a row died and
	 * *what key it held*, inside the write transaction — an application watching
	 * from outside sees the row already gone and has nothing left to read the key
	 * from. So the queue is written here, and drained there:
	 *
	 * ```ts
	 * for (const pending of db.pendingFileDeletions({ limit: 100 })) {
	 *   await env[pending.store].delete(pending.key);
	 *   db.releaseFileDeletion(pending.id);
	 * }
	 * ```
	 *
	 * Delete first, release second: a crash in between re-delivers the row, and
	 * deleting an already-deleted object is a no-op in every store worth using.
	 * The reverse order loses the object's key forever.
	 *
	 * > **This queue reports intent, not safety.** It records that *this row*
	 * > stopped referencing this key. It does **not** know whether some *other*
	 * > row still points at the same object. If your keys are content-addressed
	 * > (a SHA-256 key, a dedup layer, a "copy" that reuses the key) then two
	 * > rows can share one object, and deleting on this signal alone will break
	 * > the survivors. In that case you MUST check for remaining references
	 * > yourself before calling the store's `delete` — release the queue row
	 * > either way.
	 *
	 * Reference counting is deliberately not implemented here. File references
	 * live inside the internal `json` overflow column, so the only way for the
	 * database to find other holders of a key would be a `LIKE` scan across every
	 * row of every table with a `file()` column — expensive on a store billed per
	 * row read, and wrong besides: a `LIKE '%key%'` matches keys that merely
	 * contain each other, and matches the key appearing anywhere else in the
	 * JSON. An application that dedups by key knows its own dedup rule and can
	 * answer the question with an index; the database cannot.
	 *
	 * Throws a `DelightError` (`file_gc_disabled`, 400) when no table has a
	 * `file()` column, for the same reason the history APIs do.
	 */
	pendingFileDeletions(options?: PendingFileDeletionsOptions): PendingFileDeletion[] {
		this.assertFileGC();
		const limit = Math.max(
			1,
			Math.min(FILE_GC_MAX_LIMIT, Math.trunc(options?.limit || FILE_GC_DEFAULT_LIMIT)),
		);
		const rows = this.ctx.storage.sql
			.exec(
				`SELECT * FROM ${quoteIdentifier(FILE_GC_TABLE)} ORDER BY deleted_at ASC, id ASC LIMIT ${limit};`,
			)
			.toArray();
		return rows.map((row) => ({
			id: String(row.id),
			store: String(row.store),
			key: String(row.key),
			entity_type: String(row.entity_type),
			entity_id: String(row.entity_id),
			deleted_at: Number(row.deleted_at) || 0,
		}));
	}

	/**
	 * Drop one queue row, once the application has dealt with the object.
	 *
	 * Idempotent and silent about unknown ids: a redelivered row that was already
	 * released must not turn a successful drain into an error. Returns whether a
	 * row was actually removed, for callers that want to notice.
	 */
	releaseFileDeletion(id: string): boolean {
		this.assertFileGC();
		if (!id) return false;
		// `RETURNING` rather than a `rowsWritten` count: it is one statement, and
		// it is the only form that reports the row count identically on DO
		// SQLite and on any other SQLite the tests run against.
		const removed = this.ctx.storage.sql
			.exec(
				`DELETE FROM ${quoteIdentifier(FILE_GC_TABLE)} WHERE id = ? RETURNING id;`,
				id,
			)
			.toArray();
		return removed.length > 0;
	}

	/**
	 * Release a whole drained page in one statement — the batch form of
	 * {@link DatabaseServer.releaseFileDeletion}. Returns how many rows went.
	 */
	releaseFileDeletions(ids: readonly string[]): number {
		this.assertFileGC();
		const wanted = ids.filter(Boolean);
		if (wanted.length === 0) return 0;
		const placeholders = wanted.map(() => '?').join(', ');
		const removed = this.ctx.storage.sql
			.exec(
				`DELETE FROM ${quoteIdentifier(FILE_GC_TABLE)} WHERE id IN (${placeholders}) RETURNING id;`,
				...wanted,
			)
			.toArray();
		return removed.length;
	}

	/* ---------------------------------------------------------------------- */
	/* Auto-embedding (DS-05)                                                 */
	/* ---------------------------------------------------------------------- */

	/** Resolved `.embedFrom()` declarations, keyed by entity type. */
	#embed_configs: Map<string, ResolvedEmbedConfig[]> = new Map();

	/** The registered embedder, if any. Without one the queue simply waits. */
	#embedder: DatabaseEmbedder | undefined;

	/** Whether the "no embedder registered" warning has been logged this boot. */
	#embedder_warned = false;

	/**
	 * The earliest wake this instance has already asked the alarm for, so a
	 * burst of writes doesn't issue one `getAlarm()` round trip per row. Reset
	 * when the drain runs; correctness never depends on it — the alarm slot
	 * itself is only ever moved *earlier* (the same set-only-if-earlier rule
	 * every alarm integration here follows).
	 */
	#embed_alarm_at: number | null = null;

	/**
	 * Resolve and validate every `.embedFrom()` declaration, create the queue
	 * table, self-register the alarm handler, and enqueue the backfill.
	 *
	 * Validation lives here rather than in `table()` on purpose: only the
	 * server ever acts on `embed_from`, and the table builder runs on every
	 * client boot, where these checks would be dead bytes on the boot chunk.
	 */
	private bootstrapAutoEmbedding(): void {
		for (const [entity_type, table] of Object.entries(this.config)) {
			if (!table?._) continue;
			for (const [field_name, generator] of Object.entries(table._)) {
				const def = (generator as { _?: { type?: string } })?._ as
					| VectorField
					| undefined;
				if (!def || def.type !== 'vector' || !def.embed_from) continue;
				const embed = def.embed_from;
				if (!def.dimensions) {
					throw new DelightError({
						message: `Field '${entity_type}.${field_name}' declares embedFrom() but no dimensions. Give the vector a size: schema.vector(768).`,
						status: 400,
						code: 'invalid_schema',
					});
				}
				if (!Array.isArray(embed.source_fields) || embed.source_fields.length === 0) {
					throw new DelightError({
						message: `Field '${entity_type}.${field_name}' declares embedFrom() with no source fields.`,
						status: 400,
						code: 'invalid_schema',
					});
				}
				for (const source of embed.source_fields) {
					const source_def = (table._[source] as { _?: { type?: string } })?._;
					if (!source_def) {
						throw new DelightError({
							message: `embedFrom() source '${source}' on '${entity_type}.${field_name}' is not a declared field of '${entity_type}'.`,
							status: 400,
							code: 'invalid_schema',
						});
					}
					if (
						source === field_name ||
						source_def.type === 'vector' ||
						source_def.type === 'blob' ||
						source_def.type === 'file' ||
						source_def.type === 'object' ||
						source_def.type === 'geopoint'
					) {
						throw new DelightError({
							message: `embedFrom() source '${source}' on '${entity_type}.${field_name}' has no text to embed (${source_def.type ?? 'unknown'}). Name string, number, boolean, enum or array fields.`,
							status: 400,
							code: 'invalid_schema',
						});
					}
				}
				const list = this.#embed_configs.get(entity_type) ?? [];
				list.push({
					field: field_name,
					source_fields: [...embed.source_fields],
					model: embed.model,
					debounce_ms: Math.max(
						0,
						Math.trunc(embed.debounce_ms ?? EMBED_DEFAULT_DEBOUNCE_MS),
					),
					max_chars: Math.max(1, Math.trunc(embed.max_chars ?? EMBED_DEFAULT_MAX_CHARS)),
					dimensions: def.dimensions,
				});
				this.#embed_configs.set(entity_type, list);
			}
		}
		if (this.#embed_configs.size === 0) {
			// No declarations this boot. A *stale* signature would silently
			// suppress the backfill if an identical `.embedFrom()` ever returned
			// — the signatures say "already enqueued against this config", which
			// stopped being true the boot the declaration left. Clear them, and
			// drop the orphaned queue with them: its rows name configs that no
			// longer exist and nothing will ever drain them.
			const state = this.#state as { auto_embed?: Record<string, string> };
			if (state.auto_embed && Object.keys(state.auto_embed).length > 0) {
				delete state.auto_embed;
				this.saveState();
				this.ctx.storage.sql.exec(
					`DROP TABLE IF EXISTS ${quoteIdentifier(EMBED_QUEUE_TABLE)};`,
				);
			}
			return;
		}

		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS ${quoteIdentifier(EMBED_QUEUE_TABLE)} (
				entity_type TEXT NOT NULL,
				entity_id TEXT NOT NULL,
				field TEXT NOT NULL,
				due_at INTEGER NOT NULL,
				attempts INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (entity_type, entity_id, field)
			);`,
		);
		this.ctx.storage.sql.exec(
			`CREATE INDEX IF NOT EXISTS "idx__embed_queue_due_at" ON ${quoteIdentifier(EMBED_QUEUE_TABLE)} (due_at);`,
		);
		this.registerAlarm('auto_embed', () => this.processEmbedQueue());

		// Backfill: when a field's serialized config differs from what this
		// database last enqueued against (including "never"), every row of the
		// table is (re-)enqueued. That is what gives an existing table vectors
		// the first time `.embedFrom()` appears, and what re-embeds everything
		// when the source fields or the model change.
		const stored =
			(this.#state as { auto_embed?: Record<string, string> }).auto_embed ?? {};
		const next_signatures: Record<string, string> = {};
		let state_changed = false;
		const now = Date.now();
		for (const [entity_type, configs] of this.#embed_configs) {
			const table = this.config[entity_type]!;
			const sanitized_table = this.sanitize(entity_type);
			const primary_key = this.sanitize(table.config.primary_key || 'rowid');
			for (const config of configs) {
				const key = `${entity_type}.${config.field}`;
				next_signatures[key] = JSON.stringify({
					source_fields: config.source_fields,
					model: config.model ?? null,
					dimensions: config.dimensions,
					max_chars: config.max_chars,
				});
				if (stored[key] === next_signatures[key]) continue;
				this.ctx.storage.sql.exec(
					`INSERT INTO ${quoteIdentifier(EMBED_QUEUE_TABLE)} (entity_type, entity_id, field, due_at, attempts)
					SELECT ?, CAST(${quoteIdentifier(primary_key)} AS TEXT), ?, ?, 0 FROM ${quoteIdentifier(sanitized_table)} WHERE true
					ON CONFLICT (entity_type, entity_id, field) DO UPDATE SET due_at = excluded.due_at, attempts = 0;`,
					entity_type,
					config.field,
					now + config.debounce_ms,
				);
				state_changed = true;
			}
		}
		if (
			state_changed ||
			Object.keys(stored).length !== Object.keys(next_signatures).length
		) {
			(this.#state as { auto_embed?: Record<string, string> }).auto_embed =
				next_signatures;
			this.saveState();
		}
		// Queue rows can outlive a hibernation with no write to re-arm them.
		this.rearmEmbedAlarm();
	}

	/**
	 * Register the function that turns source text into vectors. Call it once
	 * from the Durable Object constructor, the way `imageProcessing()` and
	 * `aiProcessing()` register themselves. Until one is registered the queue
	 * accumulates and waits — a database whose AI binding is absent keeps
	 * working, it just doesn't embed.
	 */
	registerEmbedder(embedder: DatabaseEmbedder): void {
		this.#embedder = embedder;
		this.#embedder_warned = false;
		if (this.#embed_configs.size > 0) this.rearmEmbedAlarm();
	}

	/**
	 * The source text one `.embedFrom()` declaration reads off one entity:
	 * declared order, `\n` between fields, arrays joined `', '`, absent values
	 * skipped, capped at `max_chars`. Deterministic, because enqueueing
	 * compares previous to next — and the cap is part of that determinism: a
	 * change entirely past the window compares equal and re-embeds nothing,
	 * which is correct, because the embedder would never have seen it.
	 */
	private embedSourceText(
		entity: Record<string, unknown>,
		config: Pick<ResolvedEmbedConfig, 'source_fields' | 'max_chars'>,
	): string {
		const parts: string[] = [];
		for (const field of config.source_fields) {
			const value = entity[field];
			if (value === undefined || value === null) continue;
			if (typeof value === 'string') {
				if (value) parts.push(value);
				continue;
			}
			if (Array.isArray(value)) {
				const joined = value
					.filter((item) => item !== undefined && item !== null && item !== '')
					.map((item) => String(item))
					.join(', ');
				if (joined) parts.push(joined);
				continue;
			}
			parts.push(String(value));
		}
		const text = parts.join('\n').trim();
		if (text.length <= config.max_chars) return text;
		return text.slice(0, config.max_chars).trimEnd();
	}

	/**
	 * Queue (or re-queue) the entity's embeddings whose source text this write
	 * changed. Runs inside the write transaction — a rollback takes the queue
	 * rows with it — and touches nothing when no source field moved, so the hot
	 * write path pays a string compare and nothing else. Returns the earliest
	 * `due_at` it queued, for the caller to arm the alarm with *after* commit.
	 */
	private queueAutoEmbeds(
		entity_type: string,
		id: string | number,
		previous: Record<string, unknown> | undefined,
		next: Record<string, unknown>,
		now: number,
	): number | null {
		const configs = this.#embed_configs.get(entity_type);
		if (!configs) return null;
		let min_due: number | null = null;
		for (const config of configs) {
			const next_text = this.embedSourceText(next, config);
			if (previous) {
				if (this.embedSourceText(previous, config) === next_text) continue;
			} else if (!next_text) {
				// A create with nothing to embed queues nothing — there is no stale
				// vector to clear on a row that never had one.
				continue;
			}
			const due_at = now + config.debounce_ms;
			this.ctx.storage.sql.exec(
				`INSERT INTO ${quoteIdentifier(EMBED_QUEUE_TABLE)} (entity_type, entity_id, field, due_at, attempts) VALUES (?, ?, ?, ?, 0)
				ON CONFLICT (entity_type, entity_id, field) DO UPDATE SET due_at = excluded.due_at, attempts = 0;`,
				entity_type,
				String(id),
				config.field,
				due_at,
			);
			min_due = min_due === null ? due_at : Math.min(min_due, due_at);
		}
		return min_due;
	}

	/** Drop a deleted entity's pending embeds. Runs inside the delete transaction. */
	private dropAutoEmbeds(entity_type: string, id: string | number): void {
		if (!this.#embed_configs.has(entity_type)) return;
		this.ctx.storage.sql.exec(
			`DELETE FROM ${quoteIdentifier(EMBED_QUEUE_TABLE)} WHERE entity_type = ? AND entity_id = ?;`,
			entity_type,
			String(id),
		);
	}

	/**
	 * Ask the shared alarm slot for a wake at `at`, only ever moving it
	 * earlier — the rule every alarm integration here follows, so none can
	 * starve another. Fire-and-forget: callers are synchronous write paths.
	 */
	private armEmbedAlarm(at: number): void {
		if (this.#embed_alarm_at !== null && this.#embed_alarm_at <= at) return;
		this.#embed_alarm_at = at;
		void this.ctx.storage
			.getAlarm()
			.then((existing) => {
				if (existing === null || existing > at) return this.ctx.storage.setAlarm(at);
			})
			.catch((error) =>
				console.error('[DatabaseServer] failed to arm auto-embed alarm:', error),
			);
	}

	/** Arm the alarm for the queue's earliest row, if it has one. */
	private rearmEmbedAlarm(): void {
		if (this.#embed_configs.size === 0) return;
		const row = this.ctx.storage.sql
			.exec(`SELECT MIN(due_at) AS due FROM ${quoteIdentifier(EMBED_QUEUE_TABLE)};`)
			.next()?.value as { due?: number | null } | undefined;
		if (typeof row?.due === 'number') this.armEmbedAlarm(row.due);
	}

	/**
	 * Drain due queue rows: read each row's current source text, embed one
	 * batch per model, write each vector back quietly, and re-arm for whatever
	 * remains. Registered on the base alarm registry as `'auto_embed'`.
	 *
	 * Failure isolation: an embedder throw re-queues its batch with backoff
	 * (capped by {@link EMBED_MAX_ATTEMPTS}); the mutation that queued the row
	 * committed long ago and is never at risk.
	 */
	private async processEmbedQueue(): Promise<void> {
		if (this.#embed_configs.size === 0) return;
		this.#embed_alarm_at = null;
		const now = Date.now();
		const due = this.ctx.storage.sql
			.exec(
				`SELECT entity_type, entity_id, field, due_at, attempts FROM ${quoteIdentifier(EMBED_QUEUE_TABLE)} WHERE due_at <= ? ORDER BY due_at ASC LIMIT ${EMBED_BATCH_SIZE};`,
				now,
			)
			.toArray() as unknown as EmbedQueueRow[];
		if (due.length === 0) {
			this.rearmEmbedAlarm();
			return;
		}
		if (!this.#embedder) {
			// Deliberately no re-arm: without an embedder a re-armed alarm is a
			// busy loop. `registerEmbedder()` re-arms when one appears.
			if (!this.#embedder_warned) {
				this.#embedder_warned = true;
				console.warn(
					`[DatabaseServer] ${due.length} auto-embed row(s) due but no embedder is registered — call db.registerEmbedder() from the Durable Object constructor.`,
				);
			}
			return;
		}

		// Resolve each row against the live entity. Rows whose entity is gone,
		// whose config vanished, or whose source text emptied are settled here
		// without an embedder call.
		interface EmbedJob {
			row: EmbedQueueRow;
			config: ResolvedEmbedConfig;
			text: string;
		}
		const jobs: EmbedJob[] = [];
		for (const row of due) {
			const config = this.#embed_configs
				.get(row.entity_type)
				?.find((candidate) => candidate.field === row.field);
			if (!config) {
				this.settleEmbedRow(row);
				continue;
			}
			const entity = this.readEntityRaw(row.entity_type, row.entity_id);
			if (!entity) {
				this.settleEmbedRow(row);
				continue;
			}
			const text = this.embedSourceText(entity, config);
			if (!text) {
				// The sources emptied out after a vector existed: clear it, so an
				// erased title stops answering vector queries.
				try {
					this.writeEmbeddedVector(row.entity_type, row.entity_id, row.field, null);
					this.settleEmbedRow(row);
				} catch (error) {
					this.retryEmbedRow(row, now, error);
				}
				continue;
			}
			jobs.push({ row, config, text });
		}

		// One embedder call per model over the resolved jobs — except rows that
		// have already failed EMBED_SINGLE_RETRY_ATTEMPTS times, which retry
		// **alone**: a failure fails its whole call, so a poisoned text in a
		// shared batch would walk every innocent row to the drop ceiling with
		// it. Isolated, the good rows embed and only the poison keeps failing.
		const groups: EmbedJob[][] = [];
		const batched = new Map<string, EmbedJob[]>();
		for (const job of jobs) {
			if (job.row.attempts >= EMBED_SINGLE_RETRY_ATTEMPTS) {
				groups.push([job]);
				continue;
			}
			const key = job.config.model ?? '';
			const group = batched.get(key) ?? [];
			group.push(job);
			batched.set(key, group);
		}
		groups.push(...batched.values());
		for (const group of groups) {
			const model = group[0].config.model;
			let vectors: number[][];
			try {
				vectors = await this.#embedder(
					group.map((job) => job.text),
					model,
				);
			} catch (error) {
				for (const job of group) this.retryEmbedRow(job.row, now, error);
				continue;
			}
			for (let i = 0; i < group.length; i++) {
				const job = group[i];
				const vector = vectors?.[i];
				if (!Array.isArray(vector) || vector.length !== job.config.dimensions) {
					this.retryEmbedRow(
						job.row,
						now,
						new Error(
							`embedder answered ${Array.isArray(vector) ? vector.length : typeof vector} for '${job.row.entity_type}.${job.row.field}' (${job.config.dimensions} expected)`,
						),
					);
					continue;
				}
				// A NaN/Infinity entry survives JSON round-trips as `null` and
				// poisons every dot product it touches — refuse it whole rather
				// than store a vector that ranks as garbage.
				if (
					!vector.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
				) {
					this.retryEmbedRow(
						job.row,
						now,
						new Error(
							`embedder answered a non-finite entry for '${job.row.entity_type}.${job.row.field}'`,
						),
					);
					continue;
				}
				try {
					this.writeEmbeddedVector(
						job.row.entity_type,
						job.row.entity_id,
						job.row.field,
						vector,
					);
					this.settleEmbedRow(job.row);
				} catch (error) {
					this.retryEmbedRow(job.row, now, error);
				}
			}
		}
		this.rearmEmbedAlarm();
	}

	/**
	 * Remove a handled queue row — unless a write during the (async) embed
	 * pushed `due_at` out again, in which case the newer intent survives.
	 */
	private settleEmbedRow(row: EmbedQueueRow): void {
		this.ctx.storage.sql.exec(
			`DELETE FROM ${quoteIdentifier(EMBED_QUEUE_TABLE)} WHERE entity_type = ? AND entity_id = ? AND field = ? AND due_at = ?;`,
			row.entity_type,
			row.entity_id,
			row.field,
			row.due_at,
		);
	}

	/**
	 * Push a failed queue row out with exponential backoff, dropping (and
	 * logging) it past {@link EMBED_MAX_ATTEMPTS}. The `due_at` guard leaves
	 * the row alone when a concurrent write already re-queued it fresh.
	 */
	private retryEmbedRow(row: EmbedQueueRow, now: number, error: unknown): void {
		const attempts = row.attempts + 1;
		if (attempts >= EMBED_MAX_ATTEMPTS) {
			console.error(
				`[DatabaseServer] auto-embed for ${row.entity_type}/${row.entity_id}.${row.field} dropped after ${attempts} attempts:`,
				error,
			);
			this.settleEmbedRow(row);
			return;
		}
		const backoff = Math.min(
			EMBED_RETRY_BASE_MS * 2 ** (attempts - 1),
			EMBED_RETRY_MAX_MS,
		);
		this.ctx.storage.sql.exec(
			`UPDATE ${quoteIdentifier(EMBED_QUEUE_TABLE)} SET attempts = ?, due_at = ? WHERE entity_type = ? AND entity_id = ? AND field = ? AND due_at = ?;`,
			attempts,
			now + backoff,
			row.entity_type,
			row.entity_id,
			row.field,
			row.due_at,
		);
	}

	/** The raw entity for embedding reads — `undefined` rather than a 404 throw. */
	private readEntityRaw(
		entity_type: string,
		id: string | number,
	): Record<string, unknown> | undefined {
		const table = this.config[entity_type];
		if (!table) return undefined;
		const row = this.ctx.storage.sql
			.exec(
				`SELECT * FROM ${quoteIdentifier(this.sanitize(entity_type))} WHERE ${quoteIdentifier(this.sanitize(table.config.primary_key || 'rowid'))} = ? LIMIT 1;`,
				id,
			)
			.next()?.value as Record<string, SqlStorageValue> | undefined;
		return this.toEntityValue(entity_type, row) as Record<string, unknown> | undefined;
	}

	/**
	 * Write one regenerated vector — **quietly**. The vector is a derived
	 * projection: writing it through the public `update()` would bump
	 * `updated_at` (re-syncing a row whose synced fields did not change), append
	 * a change-log row (768 floats of noise per regeneration, in tables whose
	 * history is kept forever), and broadcast — all for a value the wire strips
	 * anyway (§7.0). So this rewrites the row's columns byte-for-byte except the
	 * vector, restores the `$derived` blob `toSqliteValue` doesn't know about,
	 * and refreshes the search index, all in one transaction.
	 */
	private writeEmbeddedVector(
		entity_type: string,
		id: string | number,
		field: string,
		vector: number[] | null,
	): void {
		const table = this.config[entity_type];
		if (!table) return;
		const sanitized_table = this.sanitize(entity_type);
		const primary_key = this.sanitize(table.config.primary_key || 'rowid');
		const row = this.ctx.storage.sql
			.exec(
				`SELECT * FROM ${quoteIdentifier(sanitized_table)} WHERE ${quoteIdentifier(primary_key)} = ? LIMIT 1;`,
				id,
			)
			.next()?.value as Record<string, SqlStorageValue> | undefined;
		if (!row) return;
		try {
			this.ctx.storage.transactionSync(() => {
				const previous_sparse = this.sparseFromRow(
					entity_type,
					row as Record<string, unknown>,
				);
				const entity = this.toEntityValue(entity_type, row) as
					| Record<string, unknown>
					| undefined;
				if (!entity) return;
				if (vector === null) delete entity[field];
				else entity[field] = vector;
				const updates = Object.entries(this.toSqliteValue(entity_type, entity as never)!);
				const set_clause = [
					...updates.map(([column]) => `${this.quote(column)} = ?`),
					WRITE_MARK_FLIP,
				].join(', ');
				this.ctx.storage.sql.exec(
					`UPDATE ${quoteIdentifier(sanitized_table)} SET ${set_clause} WHERE ${quoteIdentifier(primary_key)} = ?;`,
					...updates.map(([, value]) => value),
					id,
				);
				const sparse = table.toSparse(entity) as Record<string, unknown>;
				const derived = parseDerivedBlob(readJsonDerived(row as Record<string, unknown>));
				for (const [key, value] of Object.entries(derived)) {
					if (value !== undefined && value !== null) sparse[key] = value;
				}
				// `toSqliteValue` rebuilt the `json` column without `$derived`;
				// this puts the (unchanged) blob back, like the update branch does.
				this.persistDerivedFields(entity_type, id, sparse);
				this.search.indexDocument(entity_type, String(id), sparse, previous_sparse);
			});
		} catch (error) {
			// The transaction rolled back but the in-memory dictionary cache may
			// already hold ids the rollback discarded — same rule as transaction().
			this.#dropStaleDictionaryCache();
			throw error;
		}
	}

	/* ---------------------------------------------------------------------- */
	/* Actor attribution                                                      */
	/* ---------------------------------------------------------------------- */

	/** The actor the current write is attributed to. */
	#actor: string = DEFAULT_ACTOR;

	/** The operation id the current write's change rows are grouped under, if any. */
	#operation: string | undefined = undefined;

	/** Who the currently running write is attributed to (`'system'` when unscoped). */
	public get actor(): string {
		return this.#actor;
	}

	/**
	 * The operation id the currently running write's change rows are grouped under,
	 * or `undefined` outside a batched scope.
	 */
	public get operation_id(): string | undefined {
		return this.#operation;
	}

	/**
	 * Run `fn` with the given actor and operation id in effect, restoring the
	 * previous pair after.
	 *
	 * Both are ambient for the duration, which is what makes a write through the
	 * bare `db` inside a scoped `batch()` inherit them. An absent value *resets*
	 * rather than inherits — `{ actor: 'x' }` with no `batch` runs unbatched even
	 * inside a batched scope — so a scope always means exactly what it says.
	 *
	 * Safe without any async bookkeeping because every write path here is
	 * synchronous — Durable Object SQLite is — so nothing can interleave between
	 * the assignment and the restore. Nested scopes stack correctly.
	 */
	private withWriteScope<T>(options: WriteOptions | undefined, fn: () => T): T {
		// Each field inherits from the surrounding scope independently. Resetting
		// the unspecified one would mean `{ operation }` alone silently re-attributes
		// the write to 'system' inside a `scoped()` run — losing exactly the
		// attribution the actor feature exists to provide. At the top level
		// `#actor` is already DEFAULT_ACTOR and `#operation` is undefined, so
		// inheriting and defaulting coincide there.
		const resolved_actor = options?.actor?.trim() || this.#actor;
		const resolved_operation = options?.operation?.trim() || this.#operation;
		const previous_actor = this.#actor;
		const previous_operation = this.#operation;
		this.#actor = resolved_actor;
		this.#operation = resolved_operation;
		try {
			return fn();
		} finally {
			this.#actor = previous_actor;
			this.#operation = previous_operation;
		}
	}

	/** Whether `options` asks for a write scope at all (nothing to push when not). */
	private hasWriteScope(options: WriteOptions | undefined): boolean {
		return options?.actor !== undefined || options?.operation !== undefined;
	}

	/**
	 * Persist `#state` into the `state` row (id 'main'). `created_at`/`updated_at`
	 * live in their own columns, so they are stripped from the JSON blob —
	 * re-serializing them would shadow the columns on the next load.
	 */
	private saveState(): void {
		this.ctx.storage.sql.exec(
			`UPDATE state SET json = ?, updated_at = ? WHERE id = ?;`,
			JSON.stringify({ ...this.#state, created_at: undefined, updated_at: undefined }),
			Date.now(),
			'main',
		);
	}

	/* ---------------------------------------------------------------------- */
	/* Search driver (plan §7)                                                */
	/* ---------------------------------------------------------------------- */

	/** Whether the entity type has a search index (every table with a SQL table does). */
	private isSearchIndexed(entity_type: string): boolean {
		return this.#search_tables.has(entity_type);
	}

	/** The search engine. */
	private get search(): SqliteSearchEngine {
		if (!this.#search_engine) {
			throw new DelightError({
				message: 'The search engine is not initialized for this database.',
				status: 500,
				code: 'search_unavailable',
			});
		}
		return this.#search_engine;
	}

	/** The driver's view of one entity table. */
	private searchTable(entity_type: string): ServerSearchTable {
		const table = this.#search_tables.get(entity_type);
		if (!table) {
			throw new DelightError({
				message: `Entity type ${entity_type} does not have a search index.`,
				status: 500,
				code: 'search_unavailable',
			});
		}
		return table;
	}

	/**
	 * Create the search tables, migrate generated columns and (on the first wake
	 * after an upgrade or a schema change) rebuild every table's search rows from
	 * its entity rows.
	 *
	 * Everything here is idempotent and runs on every Durable Object wake; the
	 * expensive part — the rebuild — is gated on a persisted schema signature, so
	 * it happens once per schema, not once per wake. A Durable Object that has
	 * never run this code (i.e. one upgrading from the in-memory engine) has no
	 * signature for any table, so every table migrates its metadata, rebuilds and
	 * bumps its `config_version` exactly once, and the legacy tables are dropped
	 * at the end of that same wake.
	 */
	private bootstrapSearch(): void {
		const indexed_types: string[] = [];
		for (const [entity_type, table_config] of Object.entries(this.config)) {
			if (!table_config?.config?.table_definition) continue;
			indexed_types.push(entity_type);
		}
		if (indexed_types.length === 0) return;

		this.#search_engine = new SqliteSearchEngine(this.ctx.storage.sql, {
			now: () => Date.now(),
		});
		this.#search_engine.bootstrap();

		// Read once, before anything is migrated: the drop at the end must be
		// decided by what this wake *found*, not by what it left behind.
		const legacy_present = this.legacySearchTablesExist();

		// One row budget SHARED by every entity type this wake — the cap exists
		// to bound the invocation's CPU, and five types each spending a full
		// per-type slice would multiply it right back past the limit.
		let budget = this.searchRebuildRowsPerSlice();

		for (const entity_type of indexed_types) {
			const source = this.config[entity_type] as unknown as SearchTableSource;
			const table = buildServerSearchTable(entity_type, source);
			this.#search_tables.set(entity_type, table);
			this.#search_engine.register(table);
			// A table the held-back schema pass hasn't created yet (a migration is
			// pending; see the constructor) has nothing to index or rebuild yet.
			if (!this.liveTableExists(table.table_name)) continue;
			this.migrateGeneratedColumns(table);
			this.createUpdatedAtIndex(table);
			// Read before the migration creates one: a type with no state row and no
			// legacy row has never been synced by anyone, so the rebuild below has no
			// client to invalidate and must not bump `config_version`.
			const had_state = this.#search_engine.store.getState(entity_type) !== undefined;
			this.migrateSearchMetadata(entity_type, legacy_present);

			const signature = this.searchSchemaSignature(entity_type);
			const built = this.#state.native_search?.[entity_type];
			const pending = built?.rebuild;
			// `false` keeps the constructor O(1): pending work is only recorded
			// here and all slices/teardown run in alarm invocations, so an
			// over-budget unit of work kills an alarm attempt (retried, and
			// harmless to requests) instead of killing every wake of the object.
			const inline = this.searchRebuildInConstructor();
			if (pending?.signature === signature) {
				// A prior wake's rebuild was deferred — or the Durable Object was
				// killed mid-rebuild (e.g. by the CPU limit). Resume from the
				// checkpointed cursor instead of clearing and starting over: without
				// this, a corpus too large for one wake's slice would restart from
				// row one on every wake and never finish.
				if (inline && budget > 0)
					budget -= this.runRebuild(entity_type, budget).processed;
			} else if (built?.schema_signature !== signature) {
				// Begin even with no budget left — the clear + cursor must land so
				// the stale index is never served as if it matched the new schema.
				this.beginRebuild(entity_type, signature, had_state || legacy_present);
				if (inline && budget > 0)
					budget -= this.runRebuild(entity_type, budget).processed;
			} else if (pending) {
				// A cursor for a schema that is already built — stale; drop it.
				this.setSearchTableState(entity_type, { ...built, rebuild: undefined });
			}
		}

		this.registerAlarm('search_rebuild', () => this.continueRebuilds());
		{
			// One line per cold wake: what migration work (if any) is outstanding.
			const pending_types = indexed_types.filter(
				(entity_type) => this.#state.native_search?.[entity_type]?.rebuild !== undefined,
			);
			if (pending_types.length > 0 || legacy_present) {
				console.log(
					`[DatabaseServer] bootstrap: pending rebuilds [${pending_types.join(', ')}], legacy tables ${legacy_present ? 'present' : 'gone'}`,
				);
			}
		}
		if (
			this.searchRebuildInConstructor() &&
			!this.hasPendingRebuilds() &&
			legacy_present
		) {
			// One bounded teardown chunk; the alarm below continues the rest.
			this.dropLegacySearchTables(indexed_types);
		}
		if (this.hasPendingRebuilds() || this.legacySearchTablesExist()) {
			// Can't await in the constructor; the alarm write is fire-and-forget.
			void this.scheduleRebuildAlarm().catch((error) => {
				console.error('[DatabaseServer] failed to arm the search rebuild alarm:', error);
			});
		}
	}

	/** The serialized search schema an entity type's tables must be built from. */
	private searchSchemaSignature(entity_type: string): string {
		const table = this.searchTable(entity_type);
		// Only what changes the index contents: a field's weight ranks at query
		// time, its token cap decides what is indexed.
		const max_tokens = Object.entries(table.field_options ?? {})
			.filter(([, options]) => options.max_tokens !== undefined)
			.map(([field, options]) => [field, options.max_tokens === Infinity ? 'all' : options.max_tokens])
			.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
		return JSON.stringify({
			schema: table.schema,
			primary_key: table.primary_key,
			derived: [...(table.derived_fields ?? [])].sort(),
			...(max_tokens.length ? { max_tokens } : {}),
			// The on-disk index layout: a new format rebuilds every type once.
			format: SEARCH_INDEX_FORMAT,
		});
	}

	/** Whether any entity type still has a rebuild cursor to advance. */
	private hasPendingRebuilds(): boolean {
		return [...this.#search_tables.keys()].some(
			(entity_type) => this.#state.native_search?.[entity_type]?.rebuild !== undefined,
		);
	}

	/** Whether this Durable Object still carries the pre-native search tables. */
	private legacySearchTablesExist(): boolean {
		return (
			this.ctx.storage.sql
				.exec(
					`SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('search_index', 'search_journal');`,
				)
				.toArray().length > 0
		);
	}

	/**
	 * Drop `search_index` and `search_journal` — but only once every configured
	 * table has both migrated its metadata off them and rebuilt its search rows.
	 *
	 * Ordering is the whole safety argument. The legacy rows are the *only* copy
	 * of the tombstone map and the sync window bounds, so they may not be dropped
	 * before `migrateSearchMetadata` has committed that data into `search_state` /
	 * `search_tombstones`, and the search tables must already be populated (a
	 * rebuild reads entity rows only, so it never needs the legacy tables — but a
	 * half-bootstrapped wake must be able to try again). A throw anywhere in the
	 * bootstrap loop therefore skips this entirely and the next wake retries with
	 * the legacy tables still in place; the persisted `migrated` flags make that
	 * retry cheap. Once dropped, `legacySearchTablesExist()` is false forever and
	 * this is never reached again.
	 */
	/** Legacy `search_journal` rows cleared per invocation of the teardown. */
	protected legacyJournalDropBatch(): number {
		return LEGACY_JOURNAL_DROP_BATCH;
	}

	private dropLegacySearchTables(indexed_types: readonly string[]): void {
		for (const entity_type of indexed_types) {
			const state = this.#state.native_search?.[entity_type];
			if (!state?.migrated || !state.schema_signature) return;
		}
		// DO SQLite executes DROP TABLE (and every large delete) row by row, so
		// dropping a legacy journal holding one msgpack row per document in one
		// transaction can exceed the CPU limit — and then retry identically on
		// every wake, forever (this wedged a production mailbox right after its
		// rebuild finished). Empty the journal in bounded chunks first — the
		// rebuild alarm keeps calling back here until it is gone — and only run
		// the now-cheap DROPs once the tail chunk fits.
		const journal_exists =
			this.ctx.storage.sql
				.exec(
					`SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'search_journal';`,
				)
				.toArray().length > 0;
		if (journal_exists) {
			const batch_size = Math.max(1, Math.trunc(this.legacyJournalDropBatch()));
			const batch = this.ctx.storage.sql
				.exec(`SELECT rowid FROM search_journal LIMIT ${batch_size};`)
				.toArray().length;
			if (batch > 0) {
				// Log BEFORE the delete: an over-budget chunk dies silently
				// otherwise, indistinguishable from never reaching this code.
				console.log(
					`[DatabaseServer] legacy search_journal teardown: clearing ${batch} rows`,
				);
				this.ctx.storage.transactionSync(() => {
					this.ctx.storage.sql.exec(
						`DELETE FROM search_journal WHERE rowid IN (SELECT rowid FROM search_journal LIMIT ${batch_size});`,
					);
				});
			}
			if (batch >= batch_size) {
				console.log(
					`[DatabaseServer] legacy search_journal teardown: cleared ${batch} rows (continues at alarm)`,
				);
				return;
			}
		}
		this.ctx.storage.transactionSync(() => {
			this.ctx.storage.sql.exec(`DROP TABLE IF EXISTS search_index;`);
			this.ctx.storage.sql.exec(`DROP TABLE IF EXISTS search_journal;`);
		});
	}

	/**
	 * Add/drop the VIRTUAL generated columns the declared child, geopoint and
	 * derived paths need, diffing against `PRAGMA table_xinfo` (NOT `table_info`,
	 * which hides VIRTUAL columns — see `sql_where.ts`). The 100-column budget is
	 * checked before any DDL runs, so an over-wide schema fails with a
	 * descriptive `DelightError` instead of an opaque SQLite error mid-migration.
	 */
	private migrateGeneratedColumns(table: ServerSearchTable): void {
		let existing_columns = this.ctx.storage.sql
			.exec(`PRAGMA table_xinfo(${quoteIdentifier(table.table_name)});`)
			.toArray()
			.map((row) => String((row as { name?: unknown }).name ?? ''))
			.filter(Boolean);
		if (existing_columns.length === 0) return;
		const desired = planGeneratedColumns(whereContext(table));
		// A generated column is matched by name, but its expression can change
		// under the same name — it did when JSON fields moved into columns of
		// their own (the expression now reads the field's column first). The
		// table's stored SQL holds each generated column's definition; any that
		// no longer matches is dropped here and re-added below.
		const table_sql = normalizeDdl(
			String(
				this.ctx.storage.sql
					.exec(
						`SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?;`,
						table.table_name,
					)
					.next()?.value?.sql ?? '',
			),
		);
		const stale = desired.filter(
			(spec) =>
				spec.expression !== undefined &&
				existing_columns.includes(spec.column) &&
				!table_sql.includes(normalizeDdl(`GENERATED ALWAYS AS (${spec.expression})`)),
		);
		if (stale.length) {
			this.ctx.storage.transactionSync(() => {
				for (const spec of stale) {
					this.ctx.storage.sql.exec(
						`DROP INDEX IF EXISTS ${quoteIdentifier(spec.index_name)};`,
					);
					this.ctx.storage.sql.exec(
						`ALTER TABLE ${quoteIdentifier(table.table_name)} DROP COLUMN ${quoteIdentifier(spec.column)};`,
					);
				}
			});
			const dropped = new Set(stale.map((spec) => spec.column));
			existing_columns = existing_columns.filter((column) => !dropped.has(column));
		}
		const migration = planGeneratedColumnMigration({
			table_name: table.table_name,
			desired,
			existing_columns,
			json_column: table.json_column,
		});
		if (migration.statements.length === 0) return;
		this.ctx.storage.transactionSync(() => {
			for (const statement of migration.statements) {
				this.ctx.storage.sql.exec(statement);
			}
		});
	}

	/**
	 * `(updated_at, <pk>)` per entity table — the index behind both the
	 * default `order: updated_at DESC` query and the rewritten sync paging (§7.4).
	 * `updated_at` is reserved/auto-managed, so no user-declared index can cover it.
	 */
	private createUpdatedAtIndex(table: ServerSearchTable): void {
		this.ctx.storage.sql.exec(
			`CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`idx_${table.table_name}_updated_at`)} ON ${quoteIdentifier(table.table_name)} ("updated_at", ${quoteIdentifier(table.primary_key)});`,
		);
	}

	/**
	 * One-time, idempotent move of the per-index metadata off the legacy
	 * `search_index` row: `deleted_entity` → `search_tombstones`, and
	 * `config_version`/`first_updated_at`/`last_updated_at` → `search_state`.
	 *
	 * Runs before the rebuild (which bumps `config_version` on top of the
	 * migrated one) and before the legacy tables are dropped. A Durable Object
	 * created after the native engine landed has no legacy row — and, once the
	 * tables are dropped, no legacy *table* — so it only ensures a `search_state`
	 * row exists.
	 */
	private migrateSearchMetadata(entity_type: string, legacy_present: boolean): void {
		if (this.#state.native_search?.[entity_type]?.migrated) return;
		const rows = legacy_present
			? (this.ctx.storage.sql
					.exec(`SELECT * FROM search_index WHERE id = ?`, `${entity_type}.0`)
					.toArray() as unknown as LegacySearchIndexRow[])
			: [];
		const legacy = rows[0];
		this.ctx.storage.transactionSync(() => {
			const store = this.search.store;
			const first = Number(legacy?.first_updated_at) || 0;
			const last = Number(legacy?.last_updated_at) || 0;
			store.ensureState(entity_type, first || last || 0);
			if (legacy) {
				this.ctx.storage.sql.exec(
					`UPDATE search_state SET config_version = ?, first_updated_at = ?, last_updated_at = ? WHERE entity_type = ?;`,
					Number(legacy.index_version) || 1,
					first,
					last,
					entity_type,
				);
				let deleted: Record<string, number> = {};
				try {
					deleted = JSON.parse(legacy.deleted_entity || '{}') as Record<string, number>;
				} catch {
					/* a corrupt tombstone map migrates as empty — the config bump resyncs clients */
				}
				for (const [doc_id, deleted_at] of Object.entries(deleted)) {
					store.writeTombstone(entity_type, doc_id, Number(deleted_at) || 0);
				}
			}
		});
		const existing = this.#state.native_search?.[entity_type];
		this.setSearchTableState(entity_type, {
			schema_signature: existing?.schema_signature ?? '',
			migrated: true,
			rebuild: existing?.rebuild,
		});
	}

	/** Persist one entity type's search bookkeeping into the `state` row. */
	private setSearchTableState(entity_type: string, value: NativeSearchTableState): void {
		const native_search = { ...this.#state.native_search } as Record<
			string,
			NativeSearchTableState
		>;
		native_search[entity_type] = value;
		(this.#state as { native_search?: unknown }).native_search = native_search;
		this.saveState();
	}

	/**
	 * How many entity rows one invocation may re-index — shared across ALL
	 * pending entity types — before deferring the rest of a rebuild to an alarm
	 * tick. A row cap — not a wall-clock budget —
	 * because workerd freezes `Date.now()` during synchronous execution, so
	 * elapsed time is unobservable from inside the loop. At even a pessimistic
	 * several ms per large document this stays far below the 30s Durable Object
	 * CPU limit. A method rather than a field so a subclass override is already
	 * in effect during the base constructor's bootstrap slice (subclass field
	 * initializers would run too late). Lower it for unusually heavy documents.
	 */
	protected searchRebuildRowsPerSlice(): number {
		return 1000;
	}

	/**
	 * Whether the constructor may run rebuild slices / legacy-teardown chunks
	 * inline (the default), or must only record pending work and arm the alarm.
	 *
	 * `true` keeps small corpora fully synchronous: a fresh table is searchable
	 * the moment the object constructs. `false` makes the constructor O(1) —
	 * the right choice for heavy corpora, because a unit of work that exceeds
	 * the CPU limit then kills an alarm attempt (which retries, and never
	 * blocks a request) instead of killing every single wake of the object,
	 * which no deploy can recover from.
	 */
	protected searchRebuildInConstructor(): boolean {
		return true;
	}

	/**
	 * Clear and rebuild an entity type's search rows from the entity table — the
	 * universal repair path, and what a Durable Object runs on its first wake
	 * after upgrading from the in-memory engine.
	 *
	 * This entry point runs to completion in one invocation (tests and explicit
	 * repairs want that); the bootstrap instead calls `beginRebuild` +
	 * `runRebuild` with a row cap so a corpus of any size is chunked across
	 * wakes and alarm ticks.
	 */
	private rebuildSearchTables(entity_type: string, bump_config_version = true): void {
		if (this.#rebuild_in_flight.has(entity_type)) return;
		this.beginRebuild(
			entity_type,
			this.searchSchemaSignature(entity_type),
			bump_config_version,
		);
		this.runRebuild(entity_type, Infinity);
	}

	/**
	 * Clear an entity type's search tables and persist a fresh rebuild cursor,
	 * atomically — so a wake that dies after this point resumes an empty-but-
	 * tracked rebuild rather than serving a cleared index it believes is built.
	 * Until `runRebuild` finishes, queries see a partially built index; that is
	 * tolerable because finalizing bumps `config_version`, which makes every
	 * client discard its copy and resync the complete corpus.
	 */
	private beginRebuild(
		entity_type: string,
		signature: string,
		bump_config_version: boolean,
	): void {
		const built = this.#state.native_search?.[entity_type];
		this.ctx.storage.transactionSync(() => {
			this.search.clearSearchTables(entity_type);
			this.setSearchTableState(entity_type, {
				schema_signature: built?.schema_signature ?? '',
				migrated: built?.migrated ?? false,
				rebuild: {
					signature,
					first_updated_at: 0,
					last_updated_at: 0,
					bump_config_version,
				},
			});
		});
	}

	/**
	 * Advance an entity type's pending rebuild by up to `max_rows` rows,
	 * finalizing it if the end of the table is reached. Returns whether the
	 * rebuild is complete (`true` when nothing was pending at all) and how many
	 * rows this call processed, so callers can spend one shared budget across
	 * entity types.
	 *
	 * It deliberately does NOT use `SqliteSearchEngine.rebuildBatch`: that helper
	 * reads documents straight out of the row (assuming `$derived` is already
	 * persisted), whereas a table that predates the SQLite engine has never
	 * written a `$derived` sub-object. This loop re-derives and *backfills* it,
	 * so one pass both populates the postings and makes the rows self-describing
	 * for every later query.
	 *
	 * Paged by primary key in 200-row transactions, with the rebuild cursor
	 * checkpointed inside each batch's transaction — a killed invocation resumes
	 * at the last committed batch boundary.
	 */
	private runRebuild(
		entity_type: string,
		max_rows: number,
	): { complete: boolean; processed: number } {
		if (this.#rebuild_in_flight.has(entity_type))
			return { complete: false, processed: 0 };
		const built = this.#state.native_search?.[entity_type];
		const rebuild = built?.rebuild;
		if (!built || !rebuild) return { complete: true, processed: 0 };
		this.#rebuild_in_flight.add(entity_type);
		const table = this.searchTable(entity_type);
		const source = this.config[entity_type];
		const primary_key = quoteIdentifier(table.primary_key);
		const table_name = quoteIdentifier(table.table_name);
		const BATCH_SIZE = 200;
		try {
			// Referenced rows repeat heavily across a rebuild — memoize them.
			const ref_cache = new Map<string, Record<string, any> | undefined>();
			let { after, first_updated_at, last_updated_at } = rebuild;
			let processed = 0;
			let complete = false;
			while (!complete && processed < max_rows) {
				const limit = Math.min(BATCH_SIZE, max_rows - processed);
				const rows =
					after === undefined
						? this.ctx.storage.sql
								.exec(
									`SELECT * FROM ${table_name} ORDER BY ${primary_key} ASC LIMIT ${limit};`,
								)
								.toArray()
						: this.ctx.storage.sql
								.exec(
									`SELECT * FROM ${table_name} WHERE ${primary_key} > ? ORDER BY ${primary_key} ASC LIMIT ${limit};`,
									after,
								)
								.toArray();
				if (rows.length === 0) {
					complete = true;
					break;
				}
				// Log BEFORE the batch transaction: a batch that exceeds the CPU
				// limit dies without committing, so this line is the only trace of
				// which batch (type + cursor) is the poison one.
				console.log(
					`[DatabaseServer] rebuild ${entity_type}: batch of ${rows.length} after ${after ?? '<start>'}`,
				);
				this.ctx.storage.transactionSync(() => {
					for (const row of rows) {
						const entity = this.toEntityValue(entity_type, row) as any;
						if (!entity) continue;
						const key = entity[table.primary_key];
						after = key as string | number;
						const sparse = source.toSparse(entity) as Record<string, unknown>;
						this.computeFkDerivedFields(entity_type, entity, sparse, ref_cache);
						this.persistDerivedFields(entity_type, key, sparse);
						this.search.indexDocument(entity_type, String(key), sparse);
						const updated_at = Number(entity.updated_at) || 0;
						if (updated_at > last_updated_at) last_updated_at = updated_at;
						if (updated_at && (!first_updated_at || updated_at < first_updated_at)) {
							first_updated_at = updated_at;
						}
					}
					this.setSearchTableState(entity_type, {
						schema_signature: built.schema_signature,
						migrated: built.migrated,
						rebuild: { ...rebuild, after, first_updated_at, last_updated_at },
					});
				});
				processed += rows.length;
				if (rows.length < limit) complete = true;
			}
			if (!complete) {
				console.log(
					`[DatabaseServer] search rebuild of ${entity_type} deferred after ${processed} rows (resumes at alarm)`,
				);
				return { complete: false, processed };
			}
			this.ctx.storage.transactionSync(() => {
				const store = this.search.store;
				store.ensureState(entity_type, first_updated_at);
				const state = store.getState(entity_type);
				this.ctx.storage.sql.exec(
					`UPDATE search_state SET first_updated_at = ?, last_updated_at = ? WHERE entity_type = ?;`,
					first_updated_at ||
						(state?.first_updated_at && state.first_updated_at !== 0
							? state.first_updated_at
							: 0),
					Math.max(last_updated_at, state?.last_updated_at ?? 0),
					entity_type,
				);
				// The corpus was just rebuilt from scratch — every client that already
				// holds a copy must discard it and resync (§9 Phase 3). A first-ever
				// bootstrap has no such client, and bumping there would hand every new
				// deployment a gratuitous version 2.
				if (rebuild.bump_config_version) store.bumpConfigVersion(entity_type);
				this.setSearchTableState(entity_type, {
					schema_signature: rebuild.signature,
					migrated: true,
				});
			});
			// The drop is gated on EVERY configured type having finished (a missing
			// state entry fails the gate), so with staggered rebuilds it runs
			// exactly once — after the last one finalizes. Derived from the config,
			// not `#search_tables`: mid-bootstrap that map only holds the types
			// registered so far, and a drop before a later type's metadata
			// migration would destroy its only copy of the legacy tombstones.
			if (this.legacySearchTablesExist()) {
				this.dropLegacySearchTables(
					Object.entries(this.config)
						.filter(([, table]) => table?.config?.table_definition)
						.map(([name]) => name),
				);
			}
			return { complete: true, processed };
		} finally {
			this.#rebuild_in_flight.delete(entity_type);
			this.search.store.clearDictionaryCache();
		}
	}

	/**
	 * Alarm tick: advance every pending rebuild by one slice, re-arming while
	 * any remains. Registered as the `search_rebuild` alarm handler — a subclass
	 * that overrides `alarm()` must call `super.alarm()` (or run the registered
	 * handlers itself), or a deferred rebuild never completes.
	 */
	private async continueRebuilds(): Promise<void> {
		// The slice budget is shared by every pending type, exactly as in the
		// bootstrap — per-type budgets would multiply one tick's CPU by the
		// number of pending types. A type left unfunded this tick stays pending
		// and is first in line once earlier types finish.
		let budget = this.searchRebuildRowsPerSlice();
		let pending = false;
		for (const entity_type of this.#search_tables.keys()) {
			if (!this.#state.native_search?.[entity_type]?.rebuild) continue;
			if (budget <= 0) {
				pending = true;
				continue;
			}
			const result = this.runRebuild(entity_type, budget);
			budget -= result.processed;
			if (!result.complete) pending = true;
		}
		// Rebuilds done but the legacy tables linger: their teardown is chunked
		// for the same CPU-limit reason as the rebuild, so keep ticking until
		// the tables are actually gone.
		if (!pending && this.legacySearchTablesExist()) {
			this.dropLegacySearchTables(
				Object.entries(this.config)
					.filter(([, table]) => table?.config?.table_definition)
					.map(([name]) => name),
			);
			if (this.legacySearchTablesExist()) pending = true;
		}
		if (pending) await this.scheduleRebuildAlarm();
	}

	/**
	 * Arm the Durable Object alarm to continue a deferred rebuild immediately.
	 *
	 * Unconditional on purpose. The tempting guard — skip when `getAlarm()`
	 * already reads at-or-before now — is a wedge: after workerd abandons a
	 * crash-looping alarm, `getAlarm()` keeps returning that stale PAST
	 * timestamp even though nothing will ever fire, and the guard then skips
	 * re-arming forever (this stranded a production rebuild that could only
	 * advance one constructor slice per cold start). Re-setting is idempotent,
	 * revives an abandoned alarm, and only ever moves a real future alarm
	 * earlier — an early fire is benign for well-behaved handlers (they check
	 * their own queues and re-arm). Guarded for test harnesses whose storage
	 * façade has no alarm support.
	 */
	private async scheduleRebuildAlarm(): Promise<void> {
		const storage = this.ctx.storage as unknown as {
			setAlarm?(time: number): Promise<void> | void;
		};
		if (typeof storage.setAlarm !== 'function') return;
		await storage.setAlarm(Date.now());
	}

	/**
	 * Write the row's derived (same-table and FK-derived) values into the reserved
	 * `$derived` sub-object of its `json` column (§7.0).
	 *
	 * Derived fields have no SQLite column of their own, so this persistence is
	 * what makes them filterable/sortable (via generated columns over
	 * `json_extract(json, '$."$derived".field')`), shippable by sync with no
	 * recomputation, and recoverable by a rebuild. Callers must already be inside
	 * the entity write transaction.
	 */
	private persistDerivedFields(
		entity_type: string,
		id: string | number,
		sparse: Record<string, unknown>,
	): void {
		const table = this.searchTable(entity_type);
		const fields = table.derived_fields;
		if (!fields || fields.size === 0) return;
		const derived: Record<string, unknown> = {};
		for (const field of fields) {
			const value = sparse[field];
			if (value !== undefined && value !== null) derived[field] = value;
		}
		this.ctx.storage.sql.exec(
			`UPDATE ${quoteIdentifier(table.table_name)} SET "json" = json_set(IFNULL("json", '{}'), '$."$derived"', json(?)), ${WRITE_MARK_FLIP} WHERE ${quoteIdentifier(table.primary_key)} = ?;`,
			JSON.stringify(derived),
			id,
		);
	}

	/**
	 * The sparse document as the wire ships it (sync AND sparse `list()`
	 * responses): vector fields and server-only searchable fields removed.
	 *
	 * One place, both engines (§7.0). The server keeps indexing the full sparse
	 * doc — this strip is the *wire* contract, and it is client-observable: an
	 * app that used to read `entity.embedding` off a synced entity no longer can.
	 * A field declared `.serverOnly()` is held back the same
	 * way and for the same reason: it is indexed where it lives and too large to
	 * copy to every device.
	 */
	private toSyncDocument(
		entity_type: string,
		doc: Record<string, unknown>,
	): Record<string, unknown> {
		let paths = this.#unsynced_paths.get(entity_type);
		if (!paths) {
			const config = this.config[entity_type]?.config;
			paths = [
				...vectorFieldPaths(config?.index_schema),
				...(config?.server_indexed_fields ?? []),
			];
			this.#unsynced_paths.set(entity_type, paths);
		}
		return stripUnsyncedFields(doc, paths);
	}

	/**
	 * The synced/indexed sparse projection of one raw entity row.
	 *
	 * `toSparse` over the parsed entity, with the persisted `$derived` values
	 * merged back on top — byte-identical to what the write path indexed, with
	 * zero recomputation (§7.5).
	 */
	private sparseFromRow(
		entity_type: string,
		row: Record<string, unknown>,
	): Record<string, unknown> {
		// Parse the `json` overflow column once — `toEntityValue` and the
		// `$derived` read below both need it, and sync pages run this per document.
		let json_fields: Record<string, unknown> | undefined;
		const raw_json = row.json;
		if (typeof raw_json === 'string' && raw_json.length > 0) {
			try {
				const parsed: unknown = JSON.parse(raw_json);
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
					json_fields = parsed as Record<string, unknown>;
				}
			} catch {
				// Corrupt json column — `toEntityValue` re-parses and logs it loudly
			}
		}
		const entity = this.toEntityValue(entity_type, row as any, json_fields) as any;
		const sparse = this.config[entity_type].toSparse(entity) as Record<string, unknown>;
		const derived = parseDerivedBlob(json_fields?.$derived);
		for (const [field, value] of Object.entries(derived)) {
			if (value !== undefined && value !== null) sparse[field] = value;
		}
		return sparse;
	}

	/** Dev RPC fetch handler — dispatches `POST /rpc` with `{ method, args }` to public methods. */
	async fetch(request: Request) {
		const url = new URL(request.url);
		// The RPC dispatcher can invoke ANY public method, including exec()
		// (arbitrary SQL) and destroy(). It exists only for local development
		// tooling and must never be reachable in production.
		if (!this.env.DEV) {
			return new Response(JSON.stringify({ message: 'Not found', status: 404 }), {
				status: 404,
				headers: { 'content-type': 'application/json' },
			});
		}
		if (url.pathname === '/rpc' && request.method === 'POST') {
			const body = (await request.json()) as { method?: string; args?: unknown[] };
			if (body?.method && body?.args) {
				// Resolve dotted paths (e.g. 'ai.complete' → this.ai.complete)
				const parts = body.method.split('.');
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				// oxlint-disable-next-line typescript/no-this-alias
				let target: any = this;
				for (let i = 0; i < parts.length - 1; i++) {
					target = target?.[parts[i]];
					if (!target) break;
				}
				const fn = target?.[parts[parts.length - 1]];
				if (typeof fn === 'function') {
					try {
						const result = await fn.apply(target, body.args);
						return new Response(JSON.stringify(result ?? null), {
							headers: { 'content-type': 'application/json' },
						});
					} catch (error: unknown) {
						return DelightError.from(error).toResponse();
					}
				}
			}
		}
		return new Response(JSON.stringify({ message: 'Not found', status: 404 }), {
			status: 404,
			headers: { 'content-type': 'application/json' },
		});
	}

	/**
	 * Gets an entity from the database with the given type/id
	 * An array of expand fields can be provided to expand the entity with the given fields
	 * @example expand: ['creator_id'] -> adds the full creator data to the entity in {expanded: {creator_id: {...}}}
	 */
	get<
		Type extends keyof DatabaseConfig & string,
		Table extends DatabaseConfig[Type],
		Entity extends Database.Entity<DatabaseConfig[Type]>,
		ExpandedFields extends
			| Array<keyof Table['config']['foreign_keys'] & string>
			| undefined,
		Output extends ExpandedFields extends Array<any>
			? Entity & { expanded: { [K in ExpandedFields[number]]: any } }
			: Entity,
	>(entity_type: Type, id: string | number, expand?: ExpandedFields): Output {
		this.#drainPending();
		const table = this.config[entity_type];
		if (!table) {
			throw new DelightError({
				message: `Entity type ${entity_type} is not valid`,
				status: 400,
			});
		}
		const sanitized_table = this.sanitize(entity_type);
		const primary_key = this.sanitize(table.config.primary_key || 'rowid');
		let data: Entity | undefined;
		try {
			const result = this.ctx.storage.sql.exec(
				`SELECT * FROM ${quoteIdentifier(sanitized_table)} WHERE ${quoteIdentifier(primary_key)} = ? LIMIT 1`,
				id,
			);
			data = this.toEntityValue(entity_type, result.next()?.value);
		} catch (error) {
			console.error('Database error fetching entity:', error);
			throw new DelightError({
				message: 'Database error occurred while fetching entity',
				status: 500,
			});
		}
		if (!data) {
			const entity_name = this.sanitize(entity_type);
			throw new DelightError({ message: `${entity_name} not found`, status: 404 });
		}

		// Expand the requested fields
		const expanded: Record<string, any> = {};
		if (expand?.length) {
			expand.forEach((field) => {
				if (!field || !(field in data)) return;
				if (!(data as any)[field] && (data as any)[field] !== 0) return;
				if (typeof (data as any)[field] === 'object') return;
				const foreign_key =
					table.config.foreign_keys[field as keyof typeof table.config.foreign_keys];
				if (!foreign_key) return;
				try {
					const foreign_key_table = this.sanitize(foreign_key.table);
					const foreign_key_column = this.sanitize(foreign_key.column);
					const foreign_key_result = this.ctx.storage.sql.exec(
						`SELECT * FROM ${quoteIdentifier(foreign_key_table)} WHERE ${quoteIdentifier(foreign_key_column)} = ? LIMIT 1`,
						(data as any)[field],
					);
					const row = foreign_key_result.next()?.value;
					if (!row) return;
					const entity = this.toEntityValue(
						foreign_key.table as keyof DatabaseConfig & string,
						row,
					);
					if (entity) expanded[field] = entity;
				} catch {
					throw new DelightError({
						message: 'Database error occurred while fetching entity expansions',
						status: 500,
					});
				}
			});
		}
		if (Object.keys(expanded).length) return { ...data, expanded } as Output;
		return data as unknown as Output;
	}

	/**
	 * Creates the entity with the given type/table and data.
	 * This will also parse the data to ensure it's valid (throws an error if not).
	 */
	create<
		Type extends keyof DatabaseConfig & string,
		Table extends DatabaseConfig[Type],
		OutputData extends Database.Entity<Table>,
		InputData extends Omit<OutputData, 'id' | 'created_at' | 'updated_at'>,
	>(entity_type: Type, unsafe_data: InputData, options?: CreateOptions): OutputData {
		const run = (): OutputData => {
			const [result] = this.transaction(
				[
					{
						create: {
							type: entity_type,
							data: unsafe_data,
							...(options?.preserve_id ? { preserve_id: true } : {}),
						},
					},
				],
				{ ...options, op_id: undefined },
			);
			if (!result || !('entity' in result)) {
				throw new DelightError({
					message: 'Database transaction did not return created entity',
					status: 500,
				});
			}
			return result.entity.data as OutputData;
		};
		const op_id = options?.op_id?.trim();
		if (!op_id) return run();
		return this.deduplicate<OutputData>(op_id, 'create', entity_type, undefined, run);
	}

	/**
	 * Updates the entity with the given type/table, id, and data.
	 * This does a deep partial update, so only the fields provided in the data will be updated.
	 * This will also parse the data to ensure it's valid (throws an error if not).
	 */
	update<
		Type extends keyof DatabaseConfig & string,
		Table extends DatabaseConfig[Type],
		OutputData extends Database.Entity<Table>,
		InputData extends DeepPartial<OutputData>,
	>(
		entity_type: Type,
		id: string | number,
		unsafe_data: InputData,
		options?: InternalWriteOptions,
	): OutputData {
		const run = (): OutputData => {
			const [result] = this.transaction(
				[
					{
						update: {
							type: entity_type,
							id,
							data: unsafe_data,
							...(options?.allow_readonly ? { allow_readonly: true } : {}),
						},
					},
				],
				{ ...options, op_id: undefined },
			);
			if (!result || !('entity' in result)) {
				throw new DelightError({
					message: 'Database transaction did not return updated entity',
					status: 500,
				});
			}
			return result.entity.data as OutputData;
		};
		const op_id = options?.op_id?.trim();
		if (!op_id) return run();
		return this.deduplicate<OutputData>(op_id, 'update', entity_type, id, run);
	}

	/**
	 * Deletes the entity with the given id. Throws a 404 when it doesn't exist
	 * — the check lives here (one indexed read, in-process) so HTTP handlers
	 * don't need a whole extra RPC round trip just to answer "was there
	 * anything to delete", and so delete() matches update()'s 404 behavior.
	 */
	delete<Type extends keyof DatabaseConfig & string>(
		entity_type: Type,
		id: string | number,
		options?: WriteOptions,
	): void {
		const op_id = options?.op_id?.trim();
		if (op_id) {
			// A replayed delete must NOT 404. The row is gone precisely because
			// this operation already removed it, so re-raising "not found" would
			// turn a successful drain into a permanent failure in the outbox.
			this.deduplicate(op_id, 'delete', entity_type, id, () => {
				this.delete(entity_type, id, { ...options, op_id: undefined });
				return null;
			});
			return;
		}
		const table = this.config[entity_type];
		if (table) {
			const sanitized_table = this.sanitize(entity_type);
			const primary_key = this.sanitize(table.config.primary_key || 'rowid');
			const existing = this.ctx.storage.sql
				.exec(
					`SELECT 1 FROM ${quoteIdentifier(sanitized_table)} WHERE ${quoteIdentifier(primary_key)} = ? LIMIT 1`,
					id,
				)
				.next();
			if (existing.done) {
				throw new DelightError({
					message: `${sanitized_table} not found`,
					status: 404,
				});
			}
		}
		this.transaction([{ delete: { type: entity_type, id } }], options);
	}

	/**
	 * Returns a list of changes that have happened to all entities since the given epoch timestamp (in ms).
	 * This is used to sync the client-side search indexes with the server-side search indexes.
	 * To only get changes for specific entity types, provide the 'entity' parameter with the entity types to get changes for.
	 */
	sync(
		query?: DatabaseSyncRequest<DatabaseConfig>,
	): DatabaseSyncResponse<DatabaseConfig> {
		this.#drainPending();
		const results: DatabaseSyncResponse<DatabaseConfig> = {
			start_updated_at: 0,
			end_updated_at: 0,
			first_updated_at: 0,
			last_updated_at: 0,
			entity: {},
		};

		// Add the changes to the results for each entity type
		for (const entity_type in this.config) {
			// When the request names specific entity types, only those are returned —
			// computing the others wastes work and the client would ignore them anyway
			if (query?.entity && !(entity_type in query.entity)) continue;
			if (!this.config[entity_type]) continue;
			if (!this.isSearchIndexed(entity_type)) continue;
			results.entity[entity_type] = this.syncEntity(
				entity_type,
				query?.entity?.[entity_type],
			) as (typeof results.entity)[typeof entity_type];
		}
		// Top-level bounds are the union of the per-entity windows (mins treat 0 /
		// missing as "no data" rather than "epoch").
		for (const entity of Object.values(results.entity)) {
			if (!entity) continue;
			if (
				entity.first_updated_at &&
				(!results.first_updated_at || entity.first_updated_at < results.first_updated_at)
			) {
				results.first_updated_at = entity.first_updated_at;
			}
			if (
				entity.start_updated_at &&
				(!results.start_updated_at || entity.start_updated_at < results.start_updated_at)
			) {
				results.start_updated_at = entity.start_updated_at;
			}
			if (entity.last_updated_at > results.last_updated_at) {
				results.last_updated_at = entity.last_updated_at;
			}
			if (entity.end_updated_at > results.end_updated_at) {
				results.end_updated_at = entity.end_updated_at;
			}
		}
		return results;
	}

	/**
	 * Lists the entities of the given type that match the given query
	 * If the 'sparse' field in the query is true, it will use the sparse search index with '.searchable()' fields
	 * If the 'sparse' field in the query is false, it will use the full values from the database
	 */
	list<
		Type extends keyof DatabaseConfig & string,
		Table extends DatabaseConfig[Type],
		Query extends Database.SearchQuery<Table>,
		Output extends Database.SearchQueryResults<Table, Query>,
	>(entity_type: Type, raw_query: Query): Output {
		this.#drainPending();
		const table = this.config[entity_type];
		if (!table || !this.isSearchIndexed(entity_type)) {
			throw new DelightError({
				message: `Entity type ${entity_type} does not have a search index`,
				status: 400,
			});
		}
		let sparse = raw_query.sparse ?? true;
		let previous_cursor_data: Omit<Database.SearchQuery<Table>, 'cursor'> | undefined;
		if (raw_query.cursor) {
			try {
				previous_cursor_data = JSON.parse(
					atob(raw_query.cursor.replace(/-/g, '+').replace(/_/g, '/')),
				);
				if (previous_cursor_data) {
					delete (previous_cursor_data as any)['cursor'];
					if (raw_query.sparse === undefined) {
						sparse = previous_cursor_data.sparse ?? true;
					}
				}
			} catch {
				/* intentionally empty: malformed cursor falls back to raw_query */
			}
		}
		const base_query = previous_cursor_data || raw_query;

		// Relevance queries (a search term or a vector) rank by score when no
		// explicit order is given — an empty order[] is the engine's score path.
		// Only plain browse queries get the recency default; injecting it into a
		// term search would silently override BM25/boost ranking with updated_at.
		const has_relevance =
			!!(base_query.term as string | undefined)?.trim() || !!base_query.vector;
		// DoS clamps: `tolerance` drives a Levenshtein scan over the token
		// dictionary and `offset` forces the engine to materialize/skip that many
		// entries — both are attacker-reachable numbers, so both get hard ceilings.
		const raw_tolerance = (base_query as { tolerance?: unknown }).tolerance;
		const tolerance =
			typeof raw_tolerance === 'number' && Number.isFinite(raw_tolerance)
				? Math.min(3, Math.max(0, Math.trunc(raw_tolerance)))
				: undefined;
		const raw_offset = (base_query as { offset?: unknown }).offset;
		const offset =
			typeof raw_offset === 'number' && Number.isFinite(raw_offset)
				? Math.min(100_000, Math.max(0, Math.trunc(raw_offset)))
				: undefined;
		// Carried fields are absent from `index_schema`, so every surface below
		// would reject them as "unknown". Catch them here instead, with an error
		// that names the real reason. Both the caller's query and a (forgeable)
		// cursor's are checked — `base_query` is whichever of the two is in play.
		assertNotCarried(table.config.carried_fields, raw_query as never);
		assertNotCarried(table.config.carried_fields, base_query as never);

		// Accept plain-value where shorthands (`{folder: 'inbox'}`) on enum and
		// number fields, normalizing them into operation objects.
		let where = normalizeWhere(
			base_query.where as Record<string, unknown> | undefined,
			table.config.index_schema as Record<string, unknown>,
		);
		// SECURITY: a cursor is unsigned, attacker-forgeable base64 — it must
		// never be able to *widen* the caller's query. A route-level `beforeList`
		// hook injects row-level restrictions into `raw_query.where` (the
		// documented auth pattern), so whenever both a cursor and a caller `where`
		// are present the caller's restriction is ANDed back in. Re-ANDing a
		// clause the cursor already carries is an idempotent restriction, so
		// legitimate keyset cursors (which wrap the original where in an `and`
		// list) paginate identically — and the flatten/dedupe below keeps a
		// well-formed cursor's `where` from growing page over page.
		if (previous_cursor_data && raw_query.where) {
			const caller_where = normalizeWhere(
				raw_query.where as Record<string, unknown>,
				table.config.index_schema as Record<string, unknown>,
			) as Record<string, unknown>;
			const cursor_where = where as Record<string, unknown> | undefined;
			if (!cursor_where || Object.keys(cursor_where).length === 0) {
				where = caller_where;
			} else if (
				Object.keys(cursor_where).length === 1 &&
				Array.isArray(cursor_where.and)
			) {
				// The keyset-cursor shape: `{and: [original_where, keyset...]}`.
				// Append the caller's restriction unless an identical clause is
				// already in the list (the normal page-2+ case).
				const caller_json = JSON.stringify(caller_where);
				if (!cursor_where.and.some((clause) => JSON.stringify(clause) === caller_json)) {
					where = { and: [...cursor_where.and, caller_where] };
				}
			} else if (JSON.stringify(cursor_where) !== JSON.stringify(caller_where)) {
				where = { and: [cursor_where, caller_where] };
			}
		}
		const query = {
			order: has_relevance ? [] : [{ field: 'updated_at', direction: 'DESC' }],
			...base_query,
			where: where as never,
			term: base_query.term,
			tolerance,
			offset,
			cursor: undefined,
			sparse,
			limit: Math.max(
				1,
				Math.min(base_query.limit || (sparse ? 100 : 10), sparse ? 5000 : 100),
			),
		} satisfies Database.SearchQuery<Table>;
		// A cursor minted before `q` left the typed API can still carry it — drop it
		// so it never round-trips back into a freshly generated cursor.
		delete (query as { q?: string }).q;
		query.order.forEach(({ field }) => {
			if (!table.config.sortable_fields.includes(field)) {
				throw new DelightError({
					message: `Invalid order field ${field}. Must be one of ${table.config.sortable_fields.join(', ')}.`,
					status: 400,
				});
			}
		});

		/** Generates a cursor based on the last item in the query result list */
		const generateCursor = (last_item: any, offset?: number) => {
			if (!last_item) return;
			let where = structuredClone(query.where) || {};
			const use_offset =
				query.offset !== undefined ||
				!query.order?.length ||
				query.order.some(
					({ field }) =>
						// Using 'where' clauses for pagination is not supported for non-scalar types
						((table.config.index_schema as Record<string, unknown>)[field] !== 'number' &&
							(table.config.index_schema as Record<string, unknown>)[field] !==
								'number[]') ||
						// Check to make sure the fields aren't using the 'dot' notation for nested fields
						!!field.match(/[^a-z0-9_]/gi) ||
						// Check to make sure the last item has a value for the order field
						last_item[field] === undefined ||
						last_item[field] === null,
				);
			if (use_offset) {
				return btoa(JSON.stringify({ ...query, cursor: undefined, offset }))
					.replace(/\+/g, '-')
					.replace(/\//g, '_');
			}
			// Use where clauses to create the cursor for pagination instead of offsets
			// because offsets are less efficient for large datasets
			query.order.forEach(({ field, direction }) => {
				if (!('and' in where)) {
					const previous_where = structuredClone(where);
					(where as any) = {};
					(where as any).and = [previous_where];
				}
				const existing_clause_index = (where as any).and.findIndex(
					(clause: any) => !!clause[field] && !clause[field]?.between,
				);
				const value = last_item[field] || 0;
				if (existing_clause_index === -1) {
					(where as any).and.push({
						[field]: direction === 'ASC' ? { gt: value } : { lt: value },
					});
				} else {
					(where as any).and[existing_clause_index][field] =
						direction === 'ASC' ? { gt: value } : { lt: value };
				}
			});
			return btoa(
				JSON.stringify({ ...query, where, cursor: undefined, offset: undefined }),
			)
				.replace(/\+/g, '-')
				.replace(/\//g, '_');
		};

		// The driver answers the whole query from SQL + the postings tables (§7.5).
		const engine_query: SearchQuery = {
			...(query as SearchQuery),
			sparse: undefined,
			cursor: undefined,
		};
		delete engine_query.sparse;
		delete engine_query.cursor;
		const results: SearchQueryResults<ServerDocument> = this.search.list(
			entity_type,
			engine_query,
		);

		const derived_fields = this.searchTable(entity_type).derived_fields;
		let hits: {
			id: string;
			score: number;
			document: unknown;
			highlights?: Record<string, { text: string; ranges: [number, number][] }>;
		}[];
		if (sparse) {
			// `engine.list` hydrates from the entity row, so a hit's document carries
			// every column plus the whole `json` payload. The sparse contract is the
			// indexed projection, so project it back down — `toSparse` over the
			// document, with the (already hoisted) derived values re-attached, which
			// is exactly what the write path indexed and what sync ships — minus
			// vector fields, which never leave the server (§4.9): the same wire
			// strip sync applies, since an embedding is dead weight in a response.
			hits = results.hits.map((hit) => {
				const document = table.toSparse(hit.document as never) as Record<string, unknown>;
				for (const field of derived_fields ?? []) {
					const value = (hit.document as Record<string, unknown>)[field];
					if (value !== undefined && value !== null) document[field] = value;
				}
				return {
					id: hit.id,
					score: hit.score,
					document: this.toSyncDocument(entity_type, document),
					// Snippets of searched fields, `.serverOnly()` ones included: a
					// window around the match, which is what a result list shows.
					...(hit.highlights ? { highlights: hit.highlights } : {}),
				};
			});
		} else {
			// `engine.list` already hydrated each hit from a full SELECT * of the
			// entity row (columns + `json` overflow, `$derived` hoisted, `sv$`
			// skipped) — re-fetching per hit would be a pure N+1. The document only
			// needs the same normalization `toEntityValue` applies to a raw row:
			// derived search values removed, nulls dropped, BOOLEANs coerced.
			hits = results.hits.map((hit) => {
				const entity = { ...(hit.document as Record<string, unknown>) };
				for (const field of derived_fields ?? []) delete entity[field];
				for (const key in entity) {
					if (entity[key] === null) delete entity[key];
				}
				for (const column of this.columnMeta(entity_type).boolean_columns) {
					if (typeof entity[column] === 'number') entity[column] = !!entity[column];
				}
				return {
					id: hit.id,
					score: hit.score,
					document: entity,
					...(hit.highlights ? { highlights: hit.highlights } : {}),
				};
			});
		}

		return {
			count: results.count,
			elapsed: results.elapsed,
			hits,
			facets: results.facets,
			cursor:
				hits.length >= query.limit
					? generateCursor(
							hits[hits.length - 1]?.document,
							// Cumulative: a cursor-decoded query already carries the offset
							// that produced this page, so the next page starts after both.
							((query as { offset?: number }).offset ?? 0) + hits.length,
						)
					: undefined,
		} as Output;
	}

	/**
	 * `sync()` for one entity type (§7.5, "sync pagination divorce").
	 *
	 * Paging is a direct, index-driven SQL walk of the entity table over
	 * `(updated_at, <pk>)` rather than a search-engine query — the change that
	 * removed the >1000-doc deferred-removal data-loss class. Half-open windows
	 * ([from, to) descending, (from, to] ascending), the "never split equal
	 * timestamps" trim with grow-and-retry, deletions merged into the same
	 * timeline (from `search_tombstones`), and window bounds / `config_version`
	 * read from `search_state`.
	 */
	private syncEntity(
		entity_type: string,
		entity_query:
			| NonNullable<DatabaseSyncRequest<DatabaseConfig>['entity']>[keyof DatabaseConfig &
					string]
			| undefined,
	) {
		const table = this.config[entity_type];
		const search_table = this.searchTable(entity_type);
		const state = this.search.store.getState(entity_type) ?? {
			config_version: 1,
			first_updated_at: 0,
			last_updated_at: 0,
			doc_count: 0,
		};
		const requested_limit = entity_query?.limit || 0;
		const limit = Math.min(5000, requested_limit > 0 ? requested_limit : 5000);
		const schema_changed =
			entity_query?.config_version !== undefined &&
			entity_query.config_version !== state.config_version;

		// The maintained counter, NOT a COUNT(*): Cloudflare bills DO SQLite by
		// rows scanned, so counting a 100k-row table would cost 100k billed
		// reads per sync page — on exactly the tables the ceiling exists for.
		const total_count = state.doc_count;

		// The client's sync ceiling: a table larger than `defer_over` is not
		// worth mirroring, so withhold the page and answer with the count only.
		// No cursor advances (window fields are 0), and a schema change still
		// ships the new config so the client can adopt the version without
		// downloading the corpus it will never hold.
		const defer_over = entity_query?.defer_over;
		if (
			defer_over !== undefined &&
			Number.isFinite(defer_over) &&
			total_count > defer_over
		) {
			return {
				deleted: [],
				created: [],
				updated: [],
				config_version: state.config_version || 1,
				first_updated_at: state.first_updated_at || 0,
				last_updated_at: state.last_updated_at || 0,
				start_updated_at: 0,
				end_updated_at: 0,
				total_count,
				deferred: true as const,
				config: schema_changed ? table.config.index_schema : undefined,
			};
		}
		const from = schema_changed ? 0 : (entity_query?.start_updated_at ?? 0);
		const to = schema_changed
			? Number.MAX_SAFE_INTEGER
			: (entity_query?.end_updated_at ?? Number.MAX_SAFE_INTEGER);
		const descending = schema_changed || entity_query?.start_updated_at === undefined;

		const table_name = quoteIdentifier(search_table.table_name);
		const primary_key = quoteIdentifier(search_table.primary_key);
		const direction = descending ? 'DESC' : 'ASC';
		// The half-open windows, verbatim: descending covers [from, to), ascending
		// covers (from, to], so a client can feed a response's end_updated_at back
		// as the next request's start without duplicating or losing the boundary.
		const windowBounds = (column: string) =>
			descending
				? to === Number.MAX_SAFE_INTEGER
					? { sql: `"${column}" >= ?`, params: [from] }
					: { sql: `"${column}" >= ? AND "${column}" < ?`, params: [from, to] }
				: to === Number.MAX_SAFE_INTEGER
					? { sql: `"${column}" > ?`, params: [from] }
					: { sql: `"${column}" > ? AND "${column}" <= ?`, params: [from, to] };
		const bounds = windowBounds('updated_at');
		const fetchDocs = (fetch_limit: number) =>
			this.ctx.storage.sql
				.exec(
					`SELECT * FROM ${table_name} WHERE ${bounds.sql} ORDER BY "updated_at" ${direction}, ${primary_key} ${direction} LIMIT ${Math.max(1, Math.trunc(fetch_limit))};`,
					...bounds.params,
				)
				.toArray();

		// The same window on the deletion timeline, bounded IN SQL: the
		// `(entity_type, deleted_at)` index serves exactly the rows in range.
		// Fetching every tombstone (up to TOMBSTONE_CAP) and filtering here
		// used to bill up to 10k row reads per sync page on delete-heavy
		// tables — Cloudflare charges DO SQLite per row scanned.
		const tombstone_bounds = windowBounds('deleted_at');
		const tombstones = this.ctx.storage.sql
			.exec(
				`SELECT doc_id, deleted_at FROM search_tombstones INDEXED BY search_tombstones_by_time WHERE entity_type = ? AND ${tombstone_bounds.sql};`,
				entity_type,
				...tombstone_bounds.params,
			)
			.toArray();

		type Change = { ts: number; deleted_id?: string; row?: Record<string, unknown> };
		let fetch_limit = limit + 1;
		let rows = fetchDocs(fetch_limit);
		let included: Change[];
		for (;;) {
			const changes: Change[] = [];
			for (const row of rows) {
				changes.push({ ts: Number(row.updated_at) || 0, row });
			}
			for (const row of tombstones) {
				changes.push({ ts: Number(row.deleted_at) || 0, deleted_id: String(row.doc_id) });
			}
			changes.sort((a, b) => (descending ? b.ts - a.ts : a.ts - b.ts));

			// Trim to the limit, but never split changes that share a timestamp —
			// the boundary is exclusive on the next page, so splitting equal
			// timestamps across pages would permanently skip the cut-off changes.
			included = changes.slice(0, limit);
			for (let i = limit; i < changes.length; i++) {
				if (changes[i].ts !== included[included.length - 1]?.ts) break;
				included.push(changes[i]);
			}
			if (included.length < changes.length || rows.length < fetch_limit) break;
			fetch_limit *= 2;
			rows = fetchDocs(fetch_limit);
		}

		const deleted: (string | number)[] = [];
		const updated: Record<string, unknown>[] = [];
		const created: Record<string, unknown>[] = [];
		let start_updated_at = Infinity;
		let end_updated_at = 0;
		for (const change of included) {
			if (change.deleted_id !== undefined) {
				deleted.push(change.deleted_id);
			} else {
				const doc = this.toSyncDocument(
					entity_type,
					this.sparseFromRow(entity_type, change.row!),
				);
				if (!change.ts || doc.created_at === doc.updated_at) created.push(doc);
				else updated.push(doc);
			}
			if (!change.ts) continue;
			if (change.ts < start_updated_at) start_updated_at = change.ts;
			if (change.ts > end_updated_at) end_updated_at = change.ts;
		}

		return {
			deleted,
			created,
			updated,
			config_version: state.config_version || 1,
			first_updated_at: state.first_updated_at || 0,
			last_updated_at: state.last_updated_at || 0,
			start_updated_at: start_updated_at === Infinity ? 0 : start_updated_at,
			end_updated_at,
			total_count,
			config: schema_changed ? table.config.index_schema : undefined,
		};
	}

	/** Returns the latest org data */
	getMeta() {
		if (!this.#state?.meta) {
			throw new DelightError({
				message: `No metadata found in Durable Object. Use setMeta() to add it to this durable object`,
				status: 500,
			});
		}
		return this.#state.meta;
	}

	/** Updates the durable object metadata with the given data and saves it to the database */
	setMeta(data: Meta) {
		this.#state.meta = data;
		this.saveState();
	}

	/** Deletes all the database tables and data. @dangerous */
	destroy() {
		this.ctx.storage.transactionSync(() => {
			const tables = this.ctx.storage.sql
				.exec(
					`SELECT * FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
				)
				.toArray();
			if (tables.length) {
				// `PRAGMA foreign_keys` is a no-op inside a transaction (and sql.exec always runs
				// in one), so use `defer_foreign_keys` instead. It postpones FK checks until the
				// transaction commits (by which point all tables are gone) and resets automatically.
				this.ctx.storage.sql.exec(
					`PRAGMA defer_foreign_keys = true; ${tables
						.map((v) => `DROP TABLE IF EXISTS ${quoteIdentifier(String(v.name ?? ''))}`)
						.join('; ')};`,
				);
			}
		});
		this.ctx.storage.deleteAlarm();
		this.ctx.storage.deleteAll();
		this.ctx.abort('Destroyed database');
	}

	/** Restores the database to the given timestamp (if a number) or bookmark (if a string). @dangerous */
	async restore(timestampOrBookmark: number | string) {
		const bookmark =
			typeof timestampOrBookmark === 'string'
				? timestampOrBookmark
				: await this.ctx.storage.getBookmarkForTime(timestampOrBookmark);
		const new_bookmark = await this.ctx.storage.onNextSessionRestoreBookmark(bookmark);
		console.log(
			`Restored to ${timestampOrBookmark}. Undo restore with bookmark: ${new_bookmark}`,
		);
		this.ctx.abort(`Restored database to ${new_bookmark}`);
		return new_bookmark;
	}

	/**
	 * Runs the given SQL statement directly on the database. @dangerous
	 * This can be used to run any SQL statement, including those that modify the database schema or data.
	 * Be very careful when using this function, as the sql_statement is not sanitized in any way.
	 * Use the ...bindings parameter to safely pass in any user-provided data.
	 */
	exec<Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
		query_function: SqlQueryFn,
	): Row[];
	/**
	 * Calls the given callback function with a template literal function.
	 * The callback should return a tagged template literal
	 * It will be converted into an SQL query string & list of values.
	 * @example
	 		const results = db.exec((sql) => {
				const name = 'brian';
				const company = 'ABC Real Estate';
				const age = 30;
				return sql`INSERT INTO users (name, age) VALUES (${name}, ${age})`;
			});
	 */
	exec<Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
		sql_statement: string,
		...bindings: any[]
	): Row[];
	exec(
		sql_statement_or_query_function: string | SqlQueryFn,
		...bindings: any[]
	): Record<string, SqlStorageValue>[] {
		if (typeof sql_statement_or_query_function === 'string') {
			const rows = this.ctx.storage.sql
				.exec(sql_statement_or_query_function, ...bindings)
				.toArray();
			// A raw write is caught up (search, sync, history, broadcast) before
			// exec() returns. Checked after every statement, reads included: one
			// string can hold several (`SELECT 1; DELETE …`), and the check is a
			// single indexed read.
			this.#drainPending();
			return rows;
		}
		const parsed = sql_statement_or_query_function(prepareSql);
		if (!parsed) {
			throw new DelightError({
				message: `Must return a tagged template literal to build SQL queries`,
				status: 400,
			});
		}
		if (!(parsed as any)?.__safelyInterpretedSql__) {
			throw new DelightError({
				message: `Must use the 'sql' tagged template literal to build SQL queries`,
				status: 400,
			});
		}
		const { query, values } = parsed;
		const start = performance.now();
		const result = this.ctx.storage.sql.exec(query, ...values);
		// Don't log the bound values — they may contain user data (PII, secrets)
		console.log(
			`Ran query in ${performance.now() - start}ms: ${query.replace(/\t+/g, '')}`,
			`(${values.length} bound values)`,
		);
		const rows = result.toArray();
		this.#drainPending();
		return rows;
	}

	/**
	 * {@link SqlDatabase.execMany}, after catching up any pending raw writes,
	 * like every other read here: a stamped `updated_at` or the search tables
	 * read in the batch then reflect them.
	 */
	override execMany<
		Rows extends readonly Record<string, SqlStorageValue>[] = Record<
			string,
			SqlStorageValue
		>[],
	>(statements: readonly ExecStatement[]): { [K in keyof Rows]: Rows[K][] } {
		this.#drainPending();
		return super.execMany<Rows>(statements);
	}

	/**
	 * Handles a batch of operations in a single transaction.
	 * If any operation fails, the entire transaction is rolled back.
	 * The order of operations is preserved - which means that later operations can depend on earlier ones.
	 * For example, you can create an entity and then update it in the same transaction.
	 * Or, you can create an entity with a foreign key to another entity created earlier in the transaction.
	 */
	transaction(
		operations: DatabaseServerTransaction<DatabaseConfig>[],
		options?: WriteOptions,
	): DatabaseServerTransactionResult<DatabaseConfig>[] {
		const op_id = options?.op_id?.trim();
		if (op_id) {
			return this.deduplicate(op_id, 'transaction', undefined, undefined, () =>
				this.transaction(operations, { ...options, op_id: undefined }),
			);
		}
		if (this.hasWriteScope(options)) {
			return this.withWriteScope(options, () => this.transaction(operations));
		}
		if (!operations || !Array.isArray(operations) || operations.length === 0) return [];
		// Earlier raw writes first, so the inline write path reads (and the
		// index holds) the row as it actually is.
		this.#drainPending();
		if (operations.length > 5000) {
			throw new DelightError({
				message: `Too many operations in a single transaction. Maximum is 5000.`,
				status: 400,
			});
		}
		const results: DatabaseServerTransactionResult<DatabaseConfig>[] = [];
		const now = new Date();

		// Inside a batch() the outer call owns the write flag (and the rollback
		// handling) — every nested write accumulates into it.
		const batch = this.#batch_state;
		const touched = batch ?? { wrote: false };
		// Tombstone retention is enforced once per type per transaction, not per
		// delete op — `pruneTombstones` starts with a COUNT(*) over up to
		// TOMBSTONE_CAP rows, which a 5000-row bulk delete would otherwise pay
		// 5000 times.
		const deleted_types = new Set<string>();
		// The earliest auto-embed deadline this transaction queued; the alarm is
		// armed after commit (arming is async, the transaction is not).
		let embed_min_due: number | null = null;
		const noteEmbedDue = (due: number | null) => {
			if (due === null) return;
			embed_min_due = embed_min_due === null ? due : Math.min(embed_min_due, due);
		};
		const runOperations = () => {
			for (const op of operations) {
				if ('exec' in op) {
					const { statement, bindings } = op.exec;
					const result = this.ctx.storage.sql
						.exec(statement, ...(bindings || []))
						.toArray();
					results.push({ results: result });
					// Catch the raw write up now, while the row is exactly as it
					// left it: a later op in this transaction that writes the same
					// row would otherwise be recorded twice in history (once by
					// itself, once inside the drain's before/after diff). A
					// rollback undoes the drain with everything else; its
					// broadcasts are re-checked after commit, and the flag below
					// drops the term cache the drain may have touched.
					touched.wrote = true;
					this.#drainPending();
					continue;
				}

				if ('create' in op) {
					const { type: entity_type, data: unsafe_data, preserve_id } = op.create;
					const table = this.config[entity_type];
					if (!table || !this.isSearchIndexed(entity_type)) {
						throw new DelightError({
							message: `Entity type ${entity_type} is not valid`,
							status: 400,
						});
					}
					const sanitized_table = this.sanitize(entity_type);
					const primary_key = this.sanitize(table.config.primary_key || 'rowid');
					const data_copy = { ...unsafe_data };
					// `preserve_id` keeps the caller's identity — the restore/import
					// path (and what makes reverting a delete give the row back rather
					// than a copy of it). Everything else still strips them.
					const restored_id = preserve_id ? data_copy[primary_key] : undefined;
					const restored_created_at = preserve_id ? data_copy.created_at : undefined;
					// Without this the insert hits a raw SQLite `UNIQUE constraint
					// failed`, which carries no status and reads like an internal
					// fault rather than "that row is already there" — the shape a
					// double-revert or a re-run import actually produces.
					if (restored_id !== undefined && restored_id !== null) {
						const existing = this.ctx.storage.sql
							.exec(
								`SELECT 1 FROM ${quoteIdentifier(sanitized_table)} WHERE ${quoteIdentifier(primary_key)} = ? LIMIT 1`,
								restored_id as SqlStorageValue,
							)
							.next();
						if (!existing.done) {
							throw new DelightError({
								message: `${entity_type} ${String(restored_id)} already exists`,
								status: 409,
								code: 'entity_exists',
							});
						}
					}
					delete data_copy.id;
					delete data_copy[primary_key];
					delete data_copy.created_at;
					delete data_copy.updated_at;
					this.ensureMonotonicTimestamp(now, entity_type);

					// Parse the data to ensure it's valid (throws an error if not)
					const input_data = table.parse({
						...data_copy,
						[primary_key]:
							restored_id ??
							(table.config.primary_key_type === 'string' ? generateTimestampID() : 0),
						created_at:
							typeof restored_created_at === 'number'
								? restored_created_at
								: now.getTime(),
						updated_at: now.getTime(),
					}) as any;

					// For numeric primary keys, we let the database auto-increment the ID
					if (table.config.primary_key_type === 'number' && restored_id === undefined) {
						input_data[primary_key] = undefined;
					}

					const updates = Object.entries(this.toSqliteValue(entity_type, input_data)!);
					// The write marker: 1 tells the insert trigger this row came
					// through the library and needs no catch-up.
					updates.push([WRITE_MARK_COLUMN, 1]);
					const bindings = updates.map(([_, value]) => value);
					const columns = updates.map(([column]) => this.quote(column)).join(', ');
					const values = updates.map(() => '?').join(', ');
					const query_sql = `INSERT INTO ${quoteIdentifier(sanitized_table)} (${columns}) VALUES (${values}) RETURNING *;`;
					const result = this.ctx.storage.sql.exec(query_sql, ...bindings);
					const output_data = this.toEntityValue(entity_type, result.one()) as any;
					const sparse_entity = table.toSparse(output_data);
					this.computeFkDerivedFields(entity_type, output_data, sparse_entity as any);
					const created_id = output_data[primary_key] ?? output_data.id;
					// Derived values first: `indexDocument` and every later read of the
					// row expect them to be in `$derived` already.
					this.persistDerivedFields(entity_type, created_id, sparse_entity as any);
					// Marked touched BEFORE the index write: if `indexDocument` throws
					// mid-way, the transaction rolls back but the in-memory dictionary
					// cache was already mutated — the rollback handler must still drop it.
					touched.wrote = true;
					this.search.indexDocument(
						entity_type,
						String(created_id),
						sparse_entity as Record<string, unknown>,
					);
					this.cascadeReindexReferencing(
						entity_type,
						output_data[primary_key] || output_data.id,
						touched,
						now,
					);
					// Inside this transaction, so a rollback un-queues it with the row.
					noteEmbedDue(
						this.queueAutoEmbeds(
							entity_type,
							created_id,
							undefined,
							output_data as Record<string, unknown>,
							now.getTime(),
						),
					);
					// Inside the same transaction as the row: a rolled-back create must
					// not leave history claiming it happened.
					if (this.hasHistory(entity_type)) {
						this.recordChange(
							entity_type,
							created_id,
							'create',
							this.historyPayload(entity_type, output_data),
							undefined,
							now.getTime(),
						);
					}
					results.push({
						entity: {
							type: entity_type,
							data: output_data,
							id: output_data[primary_key] || output_data.id,
							sparse: sparse_entity as Record<string, unknown>,
						},
					});
					now.setMilliseconds(now.getMilliseconds() + 1); // Ensure unique timestamps
					continue;
				}

				if ('update' in op) {
					const { type: entity_type, id, data: unsafe_data, allow_readonly } = op.update;
					const table = this.config[entity_type];
					if (!table || !this.isSearchIndexed(entity_type)) {
						throw new DelightError({
							message: `Entity type ${entity_type} is not valid`,
							status: 400,
						});
					}
					const data_copy = { ...unsafe_data };
					delete data_copy.id;
					delete data_copy.created_at;
					delete data_copy.updated_at;
					// Readonly fields cannot be changed after creation — strip them like
					// the other auto-managed fields (use a raw `exec` op to override).
					// `revert()` opts out: it is restoring a value the row already
					// held, and stripping would silently skip the column it was
					// asked to put back.
					if (!allow_readonly) {
						for (const readonly_field of table.config.readonly_fields || []) {
							delete data_copy[readonly_field];
						}
					}
					const sanitized_table = this.sanitize(entity_type);
					const primary_key = this.sanitize(table.config.primary_key || 'rowid');
					// One SELECT serves both consumers below — `get()` followed by
					// `readPersistedDerived()` would read the same row twice.
					const current_row = this.ctx.storage.sql
						.exec(
							`SELECT * FROM ${quoteIdentifier(sanitized_table)} WHERE ${quoteIdentifier(primary_key)} = ? LIMIT 1`,
							id,
						)
						.next()?.value as Record<string, SqlStorageValue> | undefined;
					const current_data = this.toEntityValue(entity_type, current_row);
					if (!current_data) {
						throw new DelightError({
							message: `${sanitized_table} not found`,
							status: 404,
						});
					}
					// The previously-indexed sparse doc, for the store's `df`/field-stat
					// decrements (§7.2 step 2). Derived values come from what was actually
					// persisted, never a recomputation: a cascade may have changed the
					// referenced rows since, and a wrong "previous" corrupts the statistics.
					const previous_sparse = {
						...(table.toSparse(current_data as any) as Record<string, unknown>),
						...(this.searchTable(entity_type).derived_fields?.size
							? parseDerivedBlob(readJsonDerived(current_row as Record<string, unknown>))
							: {}),
					};
					let input_data = structuredClone(current_data);
					const deepMerge = (current: any, next: any) => {
						if (next === undefined) return current;
						if (
							typeof current !== 'object' ||
							current === null ||
							Array.isArray(current) ||
							typeof next !== 'object' ||
							Array.isArray(next) ||
							next === null ||
							// Binary values are opaque, not records: merging a
							// Uint8Array key-by-key would splice two buffers together
							// index by index instead of replacing one with the other.
							isBinary(current) ||
							isBinary(next)
						) {
							return next;
						}
						const keys = new Set([...Object.keys(current), ...Object.keys(next)]);
						for (const key of keys) {
							current[key] = deepMerge(current[key], next[key]);
						}
						return current;
					};

					input_data = table.parse({
						...deepMerge(input_data, data_copy),
						[primary_key]: (current_data as any)[primary_key],
						updated_at: now.getTime(),
						created_at: (current_data as any).created_at,
					}) as any;

					// SET only the columns whose stored value actually changes (plus
					// updated_at, which always does). Naming an unchanged column in SET
					// still rewrites every index entry that covers it, and Durable
					// Objects bill each one as a written row.
					const updates = Object.entries(
						this.toSqliteValue(entity_type, input_data)!,
					).filter(
						([column, value]) =>
							column === 'updated_at' ||
							!current_row ||
							!(column === 'json'
								? sameOverflowBlob(current_row[column], value)
								: sameStoredValue(current_row[column], value)),
					);
					// Nothing but the timestamp would change: write nothing. The row,
					// its index entries and the sync clock stay as they are (an
					// autosave of unchanged content used to cost 3 billed rows and
					// a resync on every client).
					if (current_row && updates.every(([column]) => column === 'updated_at')) {
						results.push({
							entity: {
								type: entity_type,
								data: current_data,
								id: (current_data as any)[primary_key] || (current_data as any).id || id,
								unchanged: true,
							},
						});
						continue;
					}
					// Only now that the row will change: advancing the type's clock
					// is itself a billed write.
					this.ensureMonotonicTimestamp(now, entity_type);
					for (const entry of updates) {
						if (entry[0] === 'updated_at') entry[1] = now.getTime();
					}
					const bindings = [...updates.map(([_, value]) => value), id];
					const updateFields = [
						...updates.map(([column]) => `${this.quote(column)} = ?`),
						WRITE_MARK_FLIP,
					].join(', ');
					const query_sql = `UPDATE ${quoteIdentifier(sanitized_table)} SET ${updateFields} WHERE ${quoteIdentifier(primary_key)} = ? RETURNING *;`;
					const result = this.ctx.storage.sql.exec(query_sql, ...bindings);
					const output_data = this.toEntityValue(entity_type, result.one()) as any;
					const sparse_entity = table.toSparse(output_data);
					this.computeFkDerivedFields(entity_type, output_data, sparse_entity as any);
					this.persistDerivedFields(entity_type, id, sparse_entity as any);
					// Before the index write — see the create branch.
					touched.wrote = true;
					this.search.indexDocument(
						entity_type,
						id.toString(),
						sparse_entity as Record<string, unknown>,
						previous_sparse,
					);
					this.cascadeReindexReferencing(
						entity_type,
						output_data[primary_key] || output_data.id || id,
						touched,
						now,
					);
					// Inside this transaction, so a rollback un-queues it with the row.
					noteEmbedDue(
						this.queueAutoEmbeds(
							entity_type,
							output_data[primary_key] || output_data.id || id,
							current_data as Record<string, unknown>,
							output_data as Record<string, unknown>,
							now.getTime(),
						),
					);
					if (this.hasHistory(entity_type)) {
						const diff = this.diffForHistory(
							this.historyPayload(entity_type, current_data as never)!,
							this.historyPayload(entity_type, output_data)!,
						);
						// A no-op update writes no history: a save button that changed
						// nothing must not manufacture an audit entry.
						if (Object.keys(diff.patch).length > 0) {
							this.recordChange(
								entity_type,
								output_data[primary_key] || output_data.id || id,
								'update',
								diff.patch,
								diff.previous,
								now.getTime(),
							);
						}
					}
					// Inside the same transaction, for the same reason history is:
					// a rolled-back update must not leave the app instructions to
					// delete an object the row still points at.
					this.enqueueFileDeletionsForUpdate(
						entity_type,
						output_data[primary_key] || output_data.id || id,
						current_data as Record<string, unknown>,
						output_data as Record<string, unknown>,
						now.getTime(),
					);

					results.push({
						entity: {
							type: entity_type,
							data: output_data,
							id: output_data[primary_key] || output_data.id || id,
							sparse: sparse_entity as Record<string, unknown>,
						},
					});
					now.setMilliseconds(now.getMilliseconds() + 1); // Ensure unique timestamps
					continue;
				}

				if ('delete' in op) {
					const { type: entity_type, id } = op.delete;
					const table = this.config[entity_type];
					if (!table || !this.isSearchIndexed(entity_type)) {
						throw new DelightError({
							message: `Entity type ${entity_type} is not valid`,
							status: 400,
						});
					}
					const sanitized_table = this.sanitize(entity_type);
					const primary_key = this.sanitize(table.config.primary_key || 'rowid');
					this.ensureMonotonicTimestamp(now, entity_type);
					// The whole row, read only when something will actually consume
					// it: restoring a delete is the one revert that needs the entity
					// in full, and the file GC queue needs the keys the row held.
					// A table with neither must not pay for a SELECT nobody reads.
					const deleted_entity =
						this.hasHistory(entity_type) || this.#file_tables.has(entity_type)
							? (this.toEntityValue(
									entity_type,
									this.ctx.storage.sql
										.exec(
											`SELECT * FROM ${quoteIdentifier(sanitized_table)} WHERE ${quoteIdentifier(primary_key)} = ? LIMIT 1`,
											id,
										)
										.next()?.value,
								) as Record<string, unknown> | undefined)
							: undefined;
					// `removeDocument` writes the tombstone that feeds the sync deletion
					// timeline. Marked touched first — see the create branch. It runs
					// BEFORE the row's DELETE: the delete trigger recognises a library
					// delete by this tombstone (stamped with the timestamp just
					// allocated), so it must already exist when the trigger fires.
					// Rows a foreign key cascades to have none, so they are captured.
					touched.wrote = true;
					this.search.removeDocument(entity_type, id.toString(), now.getTime());
					this.ctx.storage.sql.exec(
						`DELETE FROM ${quoteIdentifier(sanitized_table)} WHERE ${quoteIdentifier(primary_key)} = ?`,
						id,
					);
					deleted_types.add(entity_type);
					this.cascadeReindexReferencing(entity_type, id, touched, now);
					if (deleted_entity && this.hasHistory(entity_type)) {
						this.recordChange(
							entity_type,
							id,
							'delete',
							undefined,
							this.historyPayload(entity_type, deleted_entity),
							now.getTime(),
						);
					}
					// A gone row has nothing left to embed.
					this.dropAutoEmbeds(entity_type, id);
					// Every object the row pointed at is now unreferenced by it.
					// Enqueued inside this transaction, so a rollback takes the
					// queue rows with it.
					this.enqueueFileDeletionsForDelete(
						entity_type,
						id,
						deleted_entity,
						now.getTime(),
					);
					results.push({
						entity: {
							type: entity_type,
							data: undefined,
							id,
						},
					});
					now.setMilliseconds(now.getMilliseconds() + 1); // Ensure unique timestamps
					continue;
				}

				// An operation of no known shape used to be skipped silently, so a
				// typo (`{ type: 'create', … }`) committed nothing and reported
				// success.
				throw new DelightError({
					message: `Unknown transaction operation: expected one of create, update, delete or exec, got ${JSON.stringify(Object.keys(op ?? {}))}`,
					status: 400,
				});
			}
			for (const entity_type of deleted_types) {
				this.search.store.pruneTombstones(entity_type);
			}
		};

		// The search rows are written inside the same transaction as the entity
		// rows (§7.2), so persistence needs nothing after the commit.
		try {
			this.ctx.storage.transactionSync(runOperations);
		} catch (error) {
			// Inside a batch the outer call owns rollback handling (its transaction
			// may still roll back writes this one committed).
			if (!batch && touched.wrote) this.#dropStaleDictionaryCache();
			throw error;
		}

		// After commit: the queue rows are durable now, so the (async) alarm ask
		// can no longer race a rollback. Inside a batch the outer transaction may
		// still roll back — a spuriously armed alarm drains to a no-op.
		if (embed_min_due !== null) this.armEmbedAlarm(embed_min_due);

		// Catch up what this transaction wrote around the library: raw `exec`
		// operations, and rows SQLite changed on its own (ON DELETE CASCADE /
		// SET NULL children). Now that it has committed, so no broadcast can
		// precede a rollback. One indexed read when nothing is pending.
		this.#drainPending();

		// Broadcast entity changes via WebSocket (fire-and-forget, after the
		// transaction commits). Inside a batch() the outer transaction can still
		// roll back, so broadcasts are deferred until the batch commits — a
		// broadcast for a rolled-back create would plant a doc on clients that no
		// tombstone ever removes.
		const broadcasts: DeferredBroadcast[] = [];
		for (let i = 0; i < operations.length; i++) {
			const result = results[i];
			if (!result || !('entity' in result) || result.entity.unchanged) continue;
			const op = operations[i];
			const action = 'create' in op ? 'created' : 'update' in op ? 'updated' : 'deleted';
			broadcasts.push({
				action,
				entity_type: result.entity.type,
				id: result.entity.id,
				data: result.entity.data,
				sparse: result.entity.sparse,
			});
		}
		if (batch) {
			batch.broadcasts.push(...broadcasts);
		} else {
			this.#flushBroadcasts(broadcasts);
		}

		return results;
	}

	/**
	 * State of the currently open batch(): non-null only inside a batch, so it
	 * doubles as the nested-batch marker. `wrote` records whether any indexed
	 * entity was written (a rollback must then drop the in-memory dictionary
	 * cache); `broadcasts` holds websocket notifications until the batch commits.
	 */
	#batch_state: { wrote: boolean; broadcasts: DeferredBroadcast[] } | null = null;

	#flushBroadcasts(broadcasts: DeferredBroadcast[]): void {
		if (!broadcasts.length) return;
		try {
			const ws_do = this.ws();
			if (!ws_do) return;
			const changes = broadcasts.map((b) => ({
				action: b.action,
				entity_type: b.entity_type,
				id: b.id,
				data: b.data,
				// The broadcast `sparse` document is a sync page of one: clients
				// index it verbatim, so it carries the same §7.0 vector strip.
				sparse: b.sparse ? this.toSyncDocument(b.entity_type, b.sparse) : b.sparse,
			}));
			if (ws_do.entitiesChanged) {
				// One DO-to-DO RPC per flush — a bulk transaction must not make one
				// call per mutated entity.
				ws_do.entitiesChanged(changes);
			} else if (ws_do.entityChanged) {
				// A deployed websocket DO from before the batched contract method
				for (const c of changes) {
					ws_do.entityChanged(c.action, c.entity_type, c.id, c.data, c.sparse);
				}
			}
		} catch {
			// WebSocket broadcast failure must never block database operations
		}
	}

	/**
	 * Run several imperative writes (create/update/delete/transaction) as ONE
	 * durable unit: the whole batch commits atomically (the callback runs inside
	 * an outer `transactionSync`, so a throw rolls back the entity rows AND their
	 * search rows together) and websocket broadcasts flush only after it commits.
	 *
	 * The callback MUST be synchronous — an await inside would let other DO
	 * events interleave into the open transaction.
	 */
	batch<T>(fn: () => T, options?: WriteOptions): T {
		if (options?.op_id?.trim()) {
			// A callback's return value is arbitrary — it can be a class instance,
			// a cursor, `undefined` — so there is nothing the op log could record
			// and hand back on replay. Dedupe that returns the wrong thing is
			// worse than no dedupe, so this is a loud refusal.
			throw new DelightError({
				message:
					'`batch()` cannot carry an `op_id` — its return value is arbitrary and cannot be recorded for replay. Put the `op_id` on `transaction()` or on the individual create/update/delete calls.',
				status: 400,
				code: 'op_id_unsupported',
			});
		}
		if (this.hasWriteScope(options)) {
			return this.withWriteScope(options, () => this.batch(fn));
		}
		if (this.#batch_state) return fn(); // nested batch — join the outer one
		const state = { wrote: false, broadcasts: [] as DeferredBroadcast[] };
		this.#batch_state = state;
		try {
			let result: T;
			try {
				result = this.ctx.storage.transactionSync(fn);
			} catch (error) {
				if (state.wrote) this.#dropStaleDictionaryCache();
				throw error;
			}
			this.#flushBroadcasts(state.broadcasts);
			return result;
		} finally {
			this.#batch_state = null;
		}
	}

	/**
	 * Drops the cached term dictionaries after a rolled-back transaction that
	 * wrote indexed entities.
	 *
	 * The search rows themselves roll back with the entity rows — they are
	 * written in the same SQLite transaction (§7.2). The dictionaries are an
	 * in-memory read cache that the rolled-back writes already mutated in place,
	 * so they must be dropped for the next search to reload from SQLite.
	 */
	#dropStaleDictionaryCache() {
		this.#search_engine?.store.clearDictionaryCache();
	}

	/**
	 * Computes FK-derived field values for a sparse entity object.
	 * Fetches referenced entities from SQLite and calls derived functions with refs.
	 *
	 * `ref_cache` memoizes referenced rows across calls within one bulk
	 * operation (index rebuild, cascade reindex) — many entities typically
	 * point at the same few referenced rows, and re-running the row →
	 * entity conversion (JSON.parse of the overflow column) per entity is
	 * the dominant repeated cost.
	 */
	private computeFkDerivedFields(
		entity_type: string,
		entity_data: Record<string, any>,
		sparse: Record<string, any>,
		ref_cache?: Map<string, Record<string, any> | undefined>,
	): void {
		const table = this.config[entity_type as keyof DatabaseConfig] as any;
		const derived = table?.config?.derived_fields as
			| Record<string, { foreign_keys?: string[] }>
			| undefined;
		if (!derived) return;

		// Collect which FK fields need fetching
		const fk_fields = new Set<string>();
		for (const meta of Object.values(derived)) {
			if (meta.foreign_keys?.length) {
				meta.foreign_keys.forEach((fk: string) => fk_fields.add(fk));
			}
		}
		if (fk_fields.size === 0) return;

		// Fetch each referenced entity
		const refs: Record<string, Record<string, any> | undefined> = {};
		for (const fk_field of fk_fields) {
			const fk_value = entity_data[fk_field];
			if (fk_value == null) {
				refs[fk_field] = undefined;
				continue;
			}
			const fk_meta = table.config.foreign_keys[fk_field] as any;
			if (!fk_meta) {
				refs[fk_field] = undefined;
				continue;
			}
			const cache_key = `${fk_meta.table}.${fk_meta.column}:${fk_value}`;
			if (ref_cache?.has(cache_key)) {
				refs[fk_field] = ref_cache.get(cache_key);
				continue;
			}
			try {
				const result = this.ctx.storage.sql.exec(
					`SELECT * FROM ${this.quote(fk_meta.table)} WHERE ${this.quote(fk_meta.column)} = ? LIMIT 1`,
					fk_value,
				);
				const row = result.one();
				refs[fk_field] = row
					? (this.toEntityValue(fk_meta.table, row) as any)
					: undefined;
			} catch {
				refs[fk_field] = undefined;
			}
			ref_cache?.set(cache_key, refs[fk_field]);
		}

		// Compute each FK-derived field
		const table_config = table._ as Record<string, any>;
		for (const [field_name, meta] of Object.entries(derived)) {
			if (!meta.foreign_keys?.length) continue;
			const field = table_config[field_name]?._;
			if (!field?.derived_fn) continue;
			try {
				const value = field.derived_fn(entity_data, refs);
				if (value != null) {
					sparse[field_name] = value;
				} else {
					delete sparse[field_name];
				}
			} catch {
				delete sparse[field_name];
			}
		}
	}

	/**
	 * Ensures the working timestamp of a transaction is strictly greater than the
	 * last change recorded for the entity type. `updated_at` is the sync cursor:
	 * if a new write received a timestamp <= an already-synced change (clock skew,
	 * or a previous multi-op transaction that advanced its timestamps past the
	 * wall clock), clients that synced past that point would never receive it.
	 *
	 * The invariant lives in `search_state.last_updated_at`, read AND advanced
	 * inside the entity write transaction (§7.5).
	 */
	private ensureMonotonicTimestamp(now: Date, entity_type: string) {
		now.setTime(this.search.store.allocateTimestamp(entity_type, now.getTime()));
	}

	/**
	 * Reindexes all records in other tables that reference the given entity via FK-derived fields.
	 * Called after create/update/delete so dependent search indexes stay current.
	 */
	private cascadeReindexReferencing(
		entity_type: string,
		entity_id: string | number,
		touched: { wrote: boolean },
		now: Date,
	): void {
		const dependents = this.#reverse_fk_map.get(entity_type);
		if (!dependents?.length) return;

		// Every dependent row references the same triggering entity (and usually
		// the same handful of other rows) — memoize them instead of re-fetching
		// and re-parsing per dependent row
		const ref_cache = new Map<string, Record<string, any> | undefined>();

		for (const dep of dependents) {
			const dep_table = this.config[dep.table as keyof DatabaseConfig] as any;
			if (!dep_table || !this.isSearchIndexed(dep.table)) continue;

			// Find all records in dep.table where dep.fk_field = entity_id
			const rows = this.ctx.storage.sql
				.exec(
					`SELECT * FROM ${this.quote(dep.table)} WHERE ${this.quote(dep.fk_field)} = ?`,
					entity_id,
				)
				.toArray();

			for (const row of rows) {
				const dep_entity = this.toEntityValue(
					dep.table as keyof DatabaseConfig & string,
					row,
				) as any;
				if (!dep_entity) continue;

				const dep_pk = dep_table.config.primary_key || 'id';
				const dep_id = String(dep_entity[dep_pk]);

				// Skip the entity that triggered the cascade (self-referencing FKs) —
				// it was already reindexed by the operation itself
				if (dep.table === entity_type && dep_id === String(entity_id)) continue;

				// Recompute the dependent's derived values BEFORE touching the row:
				// most writes to a referenced entity change nothing any derived fn
				// reads, and an unaffected dependent must stay silent — a spurious
				// `updated_at` bump would force every sync client to re-download it.
				const base_sparse = dep_table.toSparse(dep_entity) as Record<string, unknown>;
				const previous_derived = parseDerivedBlob(
					readJsonDerived(row as Record<string, unknown>),
				);
				const previous_sparse = { ...base_sparse, ...previous_derived };
				const next_sparse = { ...base_sparse };
				this.computeFkDerivedFields(dep.table, dep_entity, next_sparse, ref_cache);
				const derived_fields = this.searchTable(dep.table).derived_fields;
				let derived_changed = false;
				for (const field of derived_fields ?? []) {
					if (!derivedValueEquals(previous_sparse[field], next_sparse[field])) {
						derived_changed = true;
						break;
					}
				}
				if (!derived_changed) continue;

				// Bump the dependent row's updated_at: its derived search fields just
				// changed, and sync clients only receive documents whose updated_at
				// falls inside the requested window. Without this, FK-derived changes
				// would update the server index but never reach synced clients.
				// The monotonic allocator IS `search_state.last_updated_at`, advanced in
				// this same transaction.
				const ts = this.search.store.allocateTimestamp(dep.table, now.getTime());
				dep_entity.updated_at = ts;

				// Recompute sparse (same-table derived first, then FK-derived)
				const sparse = dep_table.toSparse(dep_entity) as any;
				this.computeFkDerivedFields(dep.table, dep_entity, sparse, ref_cache);

				// Timestamp bump and `$derived` persist (persistDerivedFields' blob
				// shape) land in ONE statement — two UPDATEs of the same row per
				// dependent doubles the write cost of large fan-outs.
				const derived_blob: Record<string, unknown> = {};
				for (const field of derived_fields ?? []) {
					const value = sparse[field];
					if (value !== undefined && value !== null) derived_blob[field] = value;
				}
				this.ctx.storage.sql.exec(
					`UPDATE ${this.quote(dep.table)} SET "updated_at" = ?, "json" = json_set(IFNULL("json", '{}'), '$."$derived"', json(?)), ${WRITE_MARK_FLIP} WHERE ${this.quote(dep_pk)} = ?`,
					ts,
					JSON.stringify(derived_blob),
					dep_entity[dep_pk],
				);

				// The postings update is the §7.2 write path with the row's previously
				// persisted `$derived` as the "previous" doc, all in this transaction.
				// Before the index write — a mid-call throw must still invalidate the
				// dictionary cache on rollback.
				touched.wrote = true;
				this.search.indexDocument(dep.table, dep_id, sparse, previous_sparse);
			}
		}
	}

	/**
	 * Converts the given sqlite record to an entity.
	 * This is necessary because some fields are stored in the 'json' column as a JSON object.
	 * Sqlite doesn't support deep objects natively, so we store them as JSON strings.
	 */
	private toEntityValue<
		Type extends keyof DatabaseConfig & string,
		Table extends DatabaseConfig[Type],
		Data extends Database.Entity<Table>,
	>(
		entity_type: Type,
		value?: Record<string, SqlStorageValue>,
		parsed_json?: Record<string, unknown>,
	): Data | undefined {
		if (!entity_type) {
			throw new DelightError({
				message: `Entity type ${entity_type} is not valid`,
				status: 400,
			});
		}
		if (!value || typeof value !== 'object') return;
		let json_fields: Record<string, unknown> = parsed_json ?? {};
		try {
			if (!parsed_json) json_fields = JSON.parse((value?.json as string) || '{}');
		} catch (error) {
			// A corrupt `json` column must not crash the whole request; fall back to the
			// plain sqlite columns and surface the corruption loudly in the logs.
			const primary_key = this.config[entity_type]?.config?.primary_key || 'rowid';
			console.error(
				`Failed to parse 'json' column for entity type '${entity_type}' (${primary_key}: ${String(value?.[primary_key] ?? value?.rowid ?? 'unknown')})`,
				error,
			);
		}
		const temp: Record<string, unknown> = { ...value };
		// JSON columns hold their field as JSON text. A row written before
		// fields had columns of their own still carries the value in the
		// overflow blob until the background move reaches it, so the blob
		// fills in whatever its column doesn't have yet.
		const json_columns = this.columnMeta(entity_type).json_columns;
		for (const column of json_columns) {
			const raw = temp[column];
			if (typeof raw === 'string') {
				try {
					temp[column] = JSON.parse(raw);
				} catch {
					temp[column] = null;
				}
			}
		}
		for (const [key, field_value] of Object.entries(json_fields)) {
			if (temp[key] === undefined || temp[key] === null) temp[key] = field_value;
		}
		delete (temp as any).json;
		delete (temp as any)[WRITE_MARK_COLUMN];
		// `$derived` is the search engine's reserved sub-object of the `json`
		// column (§7.0): FK/same-table derived search values with no column of
		// their own. It is index/sync machinery, never app-visible entity data.
		delete (temp as any).$derived;
		for (const key in temp) {
			// `sv$` columns are the search engine's generated sort/filter columns —
			// SELECT * returns them, but they are index machinery, not entity data.
			if (temp[key] === null || key.startsWith('sv$')) delete temp[key];
		}
		// Convert BOOLEAN columns back from sqlite's 0/1 to real booleans
		for (const column of this.columnMeta(entity_type).boolean_columns) {
			if (typeof temp[column] === 'number') (temp as any)[column] = !!temp[column];
		}
		return temp as Data;
	}

	/**
	 * Converts the given entity to a sqlite record.
	 * This is necessary because some fields are stored in the 'json' column as a JSON object.
	 */
	private toSqliteValue<
		Type extends keyof DatabaseConfig & string,
		Table extends DatabaseConfig[Type],
		Data extends Database.Entity<Table>,
	>(entity_type: Type, input_data?: Data): Record<string, SqlStorageValue> | undefined {
		const table = this.config[entity_type];
		if (!table) {
			throw new DelightError({
				message: `Entity type ${entity_type} is not valid`,
				status: 400,
			});
		}
		if (!input_data) return;
		const column_names = this.columnMeta(entity_type).columns;
		// Every caller passes the entity's complete new state, so a column whose
		// field is absent from it is a field that was removed: NULL, not "leave
		// whatever is there". (When objects and arrays shared the rebuilt `json`
		// blob this fell out for free; with columns of their own it must be said.)
		const absent: Record<string, null> = {};
		for (const column of column_names) {
			if (!(column in input_data)) absent[column] = null;
		}
		return {
			...absent,
			...Object.entries(input_data).reduce((acc, [key, value]) => {
				if (column_names.has(key)) {
					if (value === undefined || value === null) {
						(acc as any)[key] = null;
					} else if (value instanceof Date) {
						// Convert to the column's declared type: string fields get ISO
						// text in their declared format, everything else gets epoch ms
						const field = table._[key]?._;
						if (field?.type === 'string') {
							const iso = value.toISOString();
							(acc as any)[key] =
								field.format === 'date'
									? iso.slice(0, 10)
									: field.format === 'time'
										? iso.slice(11, 19)
										: iso;
						} else {
							(acc as any)[key] = value.getTime();
						}
					} else if (typeof value === 'boolean') {
						// Durable Object SQLite only accepts null/number/string/ArrayBuffer bindings
						(acc as any)[key] = value ? 1 : 0;
					} else if (typeof value === 'object') {
						(acc as any)[key] = JSON.stringify(value);
					} else {
						(acc as any)[key] = value;
					}
				}
				return acc;
			}, {}),
			json: JSON.stringify(
				Object.entries(input_data).reduce((acc, [key, value]) => {
					if (!column_names.has(key)) (acc as any)[key] = value;
					return acc;
				}, {}),
			),
		};
	}

	/**
	 * Sanitizes the given string to be used as a table name or column name in SQL queries.
	 * Removes any characters that are not lowercase letters, numbers, or underscores.
	 * It also ensures that the string does not start with a number because that can cause issues in SQL.
	 * We do this for peace of mind, even though the input should already be trustworthy.
	 * The table/column names are derived from the table config, which are controlled by the developer,
	 * So we should be able to trust them. But better safe than sorry.
	 */
	private sanitize(string: string) {
		if (!string || typeof string !== 'string') return '';
		return string
			.toLowerCase()
			.replace(/[^a-z0-9_]/g, '')
			.replace(/^[0-9]+/, '');
	}

	/**
	 * Sanitizes AND double-quotes an identifier for interpolation into SQL.
	 * `sanitize` alone is the injection guard; the quotes are what let a
	 * consumer name a table `transaction` or a column `order` without the
	 * generated statement becoming a syntax error. Only the SQL text gets
	 * quotes — names compared against `sqlite_schema`/`PRAGMA table_info`
	 * output must keep using `sanitize`, which returns them unquoted.
	 */
	private quote(string: string) {
		return quoteIdentifier(this.sanitize(string));
	}
}

/* -------------------------------------------------------------------------- */
/* Native-search module helpers                                               */
/* -------------------------------------------------------------------------- */

/**
 * "Same derived value" for the cascade's no-op check. `$derived` blobs only
 * ever hold values a derived fn returned and `persistDerivedFields` kept, so
 * null/undefined/absent are one state and objects compare by JSON identity.
 */
/** Whitespace-insensitive comparison key for a stored trigger/index definition. */
function normalizeDdl(sql: string): string {
	return sql.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim();
}

/**
 * Whether a column's stored value equals the value an update would write.
 *
 * Both sides are SQLite storage values (`toSqliteValue` output vs. the row as
 * read), so this is identity for scalars and a byte comparison for BLOBs.
 * A false "changed" only costs a redundant SET; a false "unchanged" would drop
 * a write, so anything unrecognised counts as changed.
 */
/**
 * Whether the `json` overflow blob is unchanged. The stored one also holds
 * the `$derived` sub-object (written separately after every update), which
 * the freshly built one never has; ignoring it lets an update that changes
 * nothing be recognised on tables with derived fields too. Errs toward
 * "changed" (key order, unparsable text).
 */
function sameOverflowBlob(stored: unknown, next: unknown): boolean {
	if (sameStoredValue(stored, next)) return true;
	if (typeof stored !== 'string') return false;
	if (next !== null && next !== undefined && typeof next !== 'string') return false;
	try {
		const parsed = JSON.parse(stored) as Record<string, unknown>;
		if (!parsed || typeof parsed !== 'object' || !('$derived' in parsed)) return false;
		delete parsed.$derived;
		const rest = JSON.stringify(parsed);
		return next === null || next === undefined ? rest === '{}' : rest === next;
	} catch {
		return false;
	}
}

function sameStoredValue(stored: unknown, next: unknown): boolean {
	if (stored === next) return true;
	if (
		(stored === null || stored === undefined) &&
		(next === null || next === undefined)
	) {
		return true;
	}
	const stored_bytes = binaryView(stored);
	const next_bytes = binaryView(next);
	if (stored_bytes && next_bytes) {
		if (stored_bytes.byteLength !== next_bytes.byteLength) return false;
		for (let i = 0; i < stored_bytes.byteLength; i++) {
			if (stored_bytes[i] !== next_bytes[i]) return false;
		}
		return true;
	}
	return false;
}

function binaryView(value: unknown): Uint8Array | undefined {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}
	return undefined;
}

/**
 * Whether a value is binary data rather than a plain record.
 *
 * `deepMerge` walks objects key by key; a `Uint8Array` is an object with
 * numeric keys, so merging one into another would splice the two buffers
 * index by index instead of replacing one with the other.
 */
function isBinary(value: unknown): boolean {
	return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function derivedValueEquals(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a === undefined || a === null) return b === undefined || b === null;
	if (b === undefined || b === null) return false;
	if (typeof a === 'object' || typeof b === 'object') {
		return JSON.stringify(a) === JSON.stringify(b);
	}
	return false;
}

/** The raw `$derived` value of a row's `json` column, if it has one. */
function readJsonDerived(row: Record<string, unknown>): unknown {
	const raw = row.json;
	if (typeof raw !== 'string' || raw.length === 0) return undefined;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
		return (parsed as Record<string, unknown>).$derived;
	} catch {
		return undefined;
	}
}

/**
 * Every vector-typed path in a (possibly nested) search schema, dot-joined.
 *
 * `vector[768]` is the only declared type whose values never leave the server
 * (§4.9), so this is the closed list the sync strip below works from.
 */
function vectorFieldPaths(schema: unknown, prefix = ''): string[] {
	if (!schema || typeof schema !== 'object') return [];
	const paths: string[] = [];
	for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (typeof value === 'string') {
			if (value.startsWith('vector[')) paths.push(path);
			continue;
		}
		paths.push(...vectorFieldPaths(value, path));
	}
	return paths;
}

/**
 * A sparse document with its unsynced fields removed (§7.0's carve-out).
 *
 * The server indexes the full sparse doc; sync ships — and the client indexes —
 * *sparse doc minus these paths*. Two kinds qualify, for one reason: the value
 * is indexed where it already lives and is too heavy to copy to every device.
 * Vector fields, because an embedding is by far the largest thing in a
 * document and vector search is server-only; and fields declared
 * `.serverOnly()`, typically a full body of text. Returns
 * the input untouched when there are none, so the common table pays one
 * array-length check; otherwise it returns a **copy**, since callers may hand
 * us a document that must not be mutated.
 */
function stripUnsyncedFields(
	doc: Record<string, unknown>,
	unsynced_paths: readonly string[],
): Record<string, unknown> {
	if (unsynced_paths.length === 0) return doc;
	const stripped: Record<string, unknown> = { ...doc };
	for (const path of unsynced_paths) {
		const segments = path.split('.');
		let container: Record<string, unknown> | undefined = stripped;
		for (let index = 0; index < segments.length - 1 && container; index++) {
			const next: unknown = container[segments[index]];
			if (!next || typeof next !== 'object' || Array.isArray(next)) {
				container = undefined;
				break;
			}
			// Copy on the way down — a nested object is shared with the caller's doc.
			const copy: Record<string, unknown> = { ...(next as Record<string, unknown>) };
			container[segments[index]] = copy;
			container = copy;
		}
		if (container) delete container[segments[segments.length - 1]];
	}
	return stripped;
}

/** Normalize a persisted `$derived` sub-object (JSON text or already parsed). */
function parseDerivedBlob(value: unknown): Record<string, unknown> {
	if (value === null || value === undefined) return {};
	let parsed: unknown = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			return {};
		}
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
	return parsed as Record<string, unknown>;
}
