import { DurableObject } from 'cloudflare:workers';
import { prepareSql, SqlQueryFn } from './sql.helper';
import { deepEqual } from 'fast-equals';
import type { Database } from '../schema/schema';
import type { DatabaseBroadcast } from '../contract';
import { normalizeWhere } from '../search-query';
import type { SearchQuery, SearchQueryResults } from '../search/core/types';
import {
	SqliteSearchEngine,
	whereContext,
	type ServerDocument,
	type ServerSearchTable,
} from '../search/server/engine';
import {
	planGeneratedColumnMigration,
	planGeneratedColumns,
	quoteIdentifier,
} from '../search/server/sql_where';
import {
	buildServerSearchTable,
	type SearchTableSource,
} from '../search/server/table_config';
import { generateTimestampID, DelightError } from '@delightstack/utilities';

interface Env {
	DEV: boolean;
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
		[TableName in keyof Database]?: {
			/** The search schema the tables were last rebuilt from */
			schema_signature: string;
			/** Whether the legacy `search_index` metadata has been migrated across */
			migrated: boolean;
		};
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
	): Promise<OutputData>;
	delete<Type extends keyof DatabaseConfig & string>(
		entity_type: Type,
		id: string | number,
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
	): Promise<DatabaseServerTransactionResult<DatabaseConfig>[]>;
	exec(
		sql_statement: string,
		...bindings: any[]
	): Promise<Record<string, SqlStorageValue>[]>;
	getMeta(): Promise<Meta>;
	setMeta(data: Meta): Promise<void>;
	destroy(): Promise<void>;
	restore(timestampOrBookmark: number | string): Promise<string>;
};

/** A Durable Object for handling database requests */
export class DatabaseServer<
	DatabaseConfig extends Record<string, Database.Table>,
	Meta = Record<string, any>,
> extends DurableObject<Env> {
	/** Persistent state of the database server (saved/loaded in sqlite) */
	#state: DatabaseServerState<DatabaseConfig, Meta>;

	/** Reverse FK map: for each table, which other tables have FK-derived fields depending on it */
	#reverse_fk_map: Map<string, Array<{ table: string; fk_field: string }>> = new Map();

	/** The SQLite search driver — the only search engine. */
	#search_engine: SqliteSearchEngine | undefined;

	/** Search-table configs, keyed by entity type */
	#search_tables: Map<string, ServerSearchTable> = new Map();

	/** Vector-typed schema paths per entity type — the sync strip list (§7.0) */
	#vector_paths: Map<string, string[]> = new Map();

	/**
	 * Per-type sqlite column metadata, derived once from the (immutable) table
	 * config: the sanitized real-column set and the BOOLEAN columns needing 0/1
	 * coercion. Row-level converters run per row on bulk paths, so they must
	 * not rebuild these on every call.
	 */
	#column_meta: Map<string, { columns: Set<string>; boolean_columns: string[] }> =
		new Map();

	private columnMeta(entity_type: string): {
		columns: Set<string>;
		boolean_columns: string[];
	} {
		let meta = this.#column_meta.get(entity_type);
		if (!meta) {
			const table_definition = (this.config[entity_type]?.config?.table_definition ??
				{}) as Record<string, string>;
			const columns = new Set<string>();
			const boolean_columns: string[] = [];
			for (const [column, definition] of Object.entries(table_definition)) {
				columns.add(this.sanitize(column));
				if (definition?.startsWith?.('BOOLEAN')) boolean_columns.push(column);
			}
			meta = { columns, boolean_columns };
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

		// Add/update sqlite database tables based on the current configuration
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
			const existing_table_def = this.#state?.table_config?.[table_config.name];
			const table_name = table_config.name.toLowerCase();

			// Ensure the internal `json` column (for overflow/non-column fields) is in the definition
			const full_definition = { ...table_definition, json: 'TEXT' as const };

			// The table hasn't been created yet
			if (!existing_table_def) {
				const columns = Object.entries(full_definition).map(
					([column, def]) => `${column} ${def}`,
				);
				this.ctx.storage.transactionSync(() => {
					console.log(`Creating table ${table_name} (${columns.join(', ')})`);
					(this.#state.table_config as any)[table_name] = full_definition;
					this.ctx.storage.sql.exec(
						`CREATE TABLE IF NOT EXISTS ${table_name} (${columns.join(', ')});`,
					);
					this.saveState();
				});
				continue;
			}

			// The table has already been created, check if we need to add columns
			// Note: we don't support removing/renaming columns for now (as it can lead to data loss)
			for (const [column, def] of Object.entries(full_definition)) {
				if (existing_table_def[column as keyof typeof existing_table_def]) continue;
				console.log(`Adding column ${column} to table ${table_name}`);
				// SQLite refuses to ADD a NOT NULL column to a table with rows unless
				// the column carries a DEFAULT. Backfill with the type's zero value —
				// entity reads go through parse(), which applies the schema's real
				// default anyway; this only satisfies SQLite for existing rows.
				let alter_def = String(def);
				if (/NOT NULL/i.test(alter_def) && !/DEFAULT/i.test(alter_def)) {
					const zero = /INTEGER|REAL|NUMERIC/i.test(alter_def) ? '0' : "''";
					alter_def = `${alter_def} DEFAULT ${zero}`;
				}
				this.ctx.storage.transactionSync(() => {
					(this.#state.table_config as any)[table_name][column] = def;
					this.ctx.storage.sql.exec(
						`ALTER TABLE ${table_name} ADD COLUMN ${column} ${alter_def};`,
					);
					this.saveState();
				});
			}
		}

		for (const table_config of Object.values(this.config)) {
			if (!table_config?.config?.indexes) continue;
			const table_name = table_config.name.toLowerCase();

			// Create the sqlite indexes that are defined in the table config but not
			// yet created — or whose definition (columns/direction/uniqueness)
			// changed since they were created. Matching by name alone would
			// silently keep a stale index when its definition is edited in place.
			for (const index of table_config.config.indexes) {
				if (table_name !== index.table) continue;
				const existing = this.#state.sql_indexes.find((i) => i.name === index.name);
				// Compare the serializable projection: `existing` already survived a
				// JSON round trip, so an undefined member on the live definition would
				// otherwise read as a changed index.
				if (existing && deepEqual(existing, JSON.parse(JSON.stringify(index)))) continue;
				const unique = index.unique ? ' UNIQUE' : '';
				const index_name = this.sanitize(index.name);
				if (!index_name) continue;
				console.log(
					`${existing ? 'Recreating' : 'Creating'} index ${index_name} on table ${table_name}`,
				);
				this.ctx.storage.transactionSync(() => {
					if (existing) {
						(this.#state.sql_indexes as any) = (this.#state.sql_indexes as any).filter(
							(i: any) => i.name !== index.name,
						);
						this.ctx.storage.sql.exec(`DROP INDEX IF EXISTS ${index_name};`);
					}
					(this.#state.sql_indexes as any).push(index);
					const columns = index.columns
						.map(
							(col) =>
								`${this.sanitize(col.column)} ${col.direction === 'DESC' ? 'DESC' : 'ASC'}`,
						)
						.join(', ');
					this.ctx.storage.sql.exec(
						`CREATE INDEX IF NOT EXISTS ${index_name} ON ${table_name} (${columns})${unique};`,
					);
					this.saveState();
				});
			}

			// Delete indexes that are no longer in the table config.
			// Only consider indexes belonging to THIS table — otherwise each table's
			// pass would drop every other table's indexes.
			for (const existing_index of this.#state.sql_indexes) {
				if (existing_index.table !== table_name) continue;
				if (table_config.config.indexes.some((i) => i.name === existing_index.name))
					continue;
				console.log(`Deleting index ${existing_index.name} on table ${table_name}`);
				this.ctx.storage.transactionSync(() => {
					(this.#state.sql_indexes as any) = (this.#state.sql_indexes as any).filter(
						(i: any) => i.name !== existing_index.name,
					);
					this.ctx.storage.sql.exec(
						`DROP INDEX IF EXISTS ${this.sanitize(existing_index.name)};`,
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

		this.bootstrapSearch();
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

		for (const entity_type of indexed_types) {
			const source = this.config[entity_type] as unknown as SearchTableSource;
			const table = buildServerSearchTable(entity_type, source);
			this.#search_tables.set(entity_type, table);
			this.#search_engine.register(table);
			this.migrateGeneratedColumns(table);
			this.createUpdatedAtIndex(table);
			// Read before the migration creates one: a type with no state row and no
			// legacy row has never been synced by anyone, so the rebuild below has no
			// client to invalidate and must not bump `config_version`.
			const had_state = this.#search_engine.store.getState(entity_type) !== undefined;
			this.migrateSearchMetadata(entity_type, legacy_present);

			const signature = JSON.stringify({
				schema: table.schema,
				primary_key: table.primary_key,
				derived: [...(table.derived_fields ?? [])].sort(),
			});
			const built = this.#state.native_search?.[entity_type];
			if (built?.schema_signature === signature) continue;
			this.rebuildSearchTables(entity_type, had_state || legacy_present);
			this.setSearchTableState(entity_type, {
				schema_signature: signature,
				migrated: true,
			});
		}

		if (legacy_present) this.dropLegacySearchTables(indexed_types);
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
	private dropLegacySearchTables(indexed_types: readonly string[]): void {
		for (const entity_type of indexed_types) {
			const state = this.#state.native_search?.[entity_type];
			if (!state?.migrated || !state.schema_signature) return;
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
		const existing_columns = this.ctx.storage.sql
			.exec(`PRAGMA table_xinfo(${quoteIdentifier(table.table_name)});`)
			.toArray()
			.map((row) => String((row as { name?: unknown }).name ?? ''))
			.filter(Boolean);
		if (existing_columns.length === 0) return;
		const migration = planGeneratedColumnMigration({
			table_name: table.table_name,
			desired: planGeneratedColumns(whereContext(table)),
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
		this.setSearchTableState(entity_type, {
			schema_signature: this.#state.native_search?.[entity_type]?.schema_signature ?? '',
			migrated: true,
		});
	}

	/** Persist one entity type's search bookkeeping into the `state` row. */
	private setSearchTableState(
		entity_type: string,
		value: { schema_signature: string; migrated: boolean },
	): void {
		const native_search = { ...this.#state.native_search } as Record<
			string,
			{ schema_signature: string; migrated: boolean }
		>;
		native_search[entity_type] = value;
		(this.#state as { native_search?: unknown }).native_search = native_search;
		this.saveState();
	}

	/**
	 * Clear and rebuild an entity type's search rows from the entity table.
	 *
	 * The universal repair path, and what a Durable Object runs on its first wake
	 * after upgrading from the in-memory engine. It deliberately does NOT use
	 * `SqliteSearchEngine.rebuildBatch`: that helper reads documents straight out
	 * of the row (assuming `$derived` is already persisted), whereas a table that
	 * predates the SQLite engine has never written a `$derived` sub-object. This
	 * loop re-derives and *backfills* it, so one pass both populates the postings
	 * and makes the rows self-describing for every later query.
	 *
	 * Batched across transactions (paged by primary key) so a large table never
	 * holds one enormous write open.
	 */
	private rebuildSearchTables(entity_type: string, bump_config_version = true): void {
		if (this.#rebuild_in_flight.has(entity_type)) return;
		this.#rebuild_in_flight.add(entity_type);
		const table = this.searchTable(entity_type);
		const source = this.config[entity_type];
		const primary_key = quoteIdentifier(table.primary_key);
		const table_name = quoteIdentifier(table.table_name);
		const BATCH_SIZE = 200;
		try {
			this.ctx.storage.transactionSync(() => {
				this.search.clearSearchTables(entity_type);
			});
			// Referenced rows repeat heavily across a rebuild — memoize them.
			const ref_cache = new Map<string, Record<string, any> | undefined>();
			let after: string | number | undefined;
			let first_updated_at = 0;
			let last_updated_at = 0;
			for (;;) {
				const rows =
					after === undefined
						? this.ctx.storage.sql
								.exec(
									`SELECT * FROM ${table_name} ORDER BY ${primary_key} ASC LIMIT ${BATCH_SIZE};`,
								)
								.toArray()
						: this.ctx.storage.sql
								.exec(
									`SELECT * FROM ${table_name} WHERE ${primary_key} > ? ORDER BY ${primary_key} ASC LIMIT ${BATCH_SIZE};`,
									after,
								)
								.toArray();
				if (rows.length === 0) break;
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
				});
				if (rows.length < BATCH_SIZE) break;
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
				if (bump_config_version) store.bumpConfigVersion(entity_type);
			});
		} finally {
			this.#rebuild_in_flight.delete(entity_type);
			this.search.store.clearDictionaryCache();
		}
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
			`UPDATE ${quoteIdentifier(table.table_name)} SET "json" = json_set(IFNULL("json", '{}'), '$."$derived"', json(?)) WHERE ${quoteIdentifier(table.primary_key)} = ?;`,
			JSON.stringify(derived),
			id,
		);
	}

	/**
	 * The sparse document as the wire ships it (sync AND sparse `list()`
	 * responses): vector fields removed.
	 *
	 * One place, both engines (§7.0). The server keeps indexing the full sparse
	 * doc — this strip is the *wire* contract, and it is client-observable: an
	 * app that used to read `entity.embedding` off a synced entity no longer can.
	 */
	private toSyncDocument(
		entity_type: string,
		doc: Record<string, unknown>,
	): Record<string, unknown> {
		let paths = this.#vector_paths.get(entity_type);
		if (!paths) {
			paths = vectorFieldPaths(this.config[entity_type]?.config?.index_schema);
			this.#vector_paths.set(entity_type, paths);
		}
		return stripVectorFields(doc, paths);
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
				`SELECT * FROM ${sanitized_table} WHERE ${primary_key} = ? LIMIT 1`,
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
						`SELECT * FROM ${foreign_key_table} WHERE ${foreign_key_column} = ? LIMIT 1`,
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
	>(entity_type: Type, unsafe_data: InputData): OutputData {
		const [result] = this.transaction([
			{ create: { type: entity_type, data: unsafe_data } },
		]);
		if (!result || !('entity' in result)) {
			throw new DelightError({
				message: 'Database transaction did not return created entity',
				status: 500,
			});
		}
		return result.entity.data as OutputData;
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
	>(entity_type: Type, id: string | number, unsafe_data: InputData): OutputData {
		const [result] = this.transaction([
			{ update: { type: entity_type, id, data: unsafe_data } },
		]);
		if (!result || !('entity' in result)) {
			throw new DelightError({
				message: 'Database transaction did not return updated entity',
				status: 500,
			});
		}
		return result.entity.data as OutputData;
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
	): void {
		const table = this.config[entity_type];
		if (table) {
			const sanitized_table = this.sanitize(entity_type);
			const primary_key = this.sanitize(table.config.primary_key || 'rowid');
			const existing = this.ctx.storage.sql
				.exec(`SELECT 1 FROM ${sanitized_table} WHERE ${primary_key} = ? LIMIT 1`, id)
				.next();
			if (existing.done) {
				throw new DelightError({
					message: `${sanitized_table} not found`,
					status: 404,
				});
			}
		}
		this.transaction([{ delete: { type: entity_type, id } }]);
	}

	/**
	 * Returns a list of changes that have happened to all entities since the given epoch timestamp (in ms).
	 * This is used to sync the client-side search indexes with the server-side search indexes.
	 * To only get changes for specific entity types, provide the 'entity' parameter with the entity types to get changes for.
	 */
	sync(
		query?: DatabaseSyncRequest<DatabaseConfig>,
	): DatabaseSyncResponse<DatabaseConfig> {
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
		let hits: { id: string; score: number; document: unknown }[];
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
				return { id: hit.id, score: hit.score, document: entity };
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
					`PRAGMA defer_foreign_keys = true; ${tables.map((v) => `DROP TABLE IF EXISTS ${v.name}`).join('; ')};`,
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
	exec(query_function: SqlQueryFn): Record<string, SqlStorageValue>[];
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
	exec(sql_statement: string, ...bindings: any[]): Record<string, SqlStorageValue>[];
	exec(
		sql_statement_or_query_function: string | SqlQueryFn,
		...bindings: any[]
	): Record<string, SqlStorageValue>[] {
		if (typeof sql_statement_or_query_function === 'string') {
			return this.ctx.storage.sql
				.exec(sql_statement_or_query_function, ...bindings)
				.toArray();
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
		return result.toArray();
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
	): DatabaseServerTransactionResult<DatabaseConfig>[] {
		if (!operations || !Array.isArray(operations) || operations.length === 0) return [];
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
		const runOperations = () => {
			for (const op of operations) {
				if ('exec' in op) {
					const { statement, bindings } = op.exec;
					const result = this.ctx.storage.sql
						.exec(statement, ...(bindings || []))
						.toArray();
					results.push({ results: result });
					continue;
				}

				if ('create' in op) {
					const { type: entity_type, data: unsafe_data } = op.create;
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
					const sanitized_table = this.sanitize(entity_type);
					const primary_key = this.sanitize(table.config.primary_key || 'rowid');
					this.ensureMonotonicTimestamp(now, entity_type);

					// Parse the data to ensure it's valid (throws an error if not)
					const input_data = table.parse({
						...data_copy,
						[primary_key]:
							table.config.primary_key_type === 'string' ? generateTimestampID() : 0,
						created_at: now.getTime(),
						updated_at: now.getTime(),
					}) as any;

					// For numeric primary keys, we let the database auto-increment the ID
					if (table.config.primary_key_type === 'number') {
						input_data[primary_key] = undefined;
					}

					const updates = Object.entries(this.toSqliteValue(entity_type, input_data)!);
					const bindings = updates.map(([_, value]) => value);
					const columns = updates.map(([column]) => column).join(', ');
					const values = updates.map(() => '?').join(', ');
					const query_sql = `INSERT INTO ${sanitized_table} (${columns}) VALUES (${values}) RETURNING *;`;
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
					const { type: entity_type, id, data: unsafe_data } = op.update;
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
					// the other auto-managed fields (use a raw `exec` op to override)
					for (const readonly_field of table.config.readonly_fields || []) {
						delete data_copy[readonly_field];
					}
					const sanitized_table = this.sanitize(entity_type);
					const primary_key = this.sanitize(table.config.primary_key || 'rowid');
					this.ensureMonotonicTimestamp(now, entity_type);
					// One SELECT serves both consumers below — `get()` followed by
					// `readPersistedDerived()` would read the same row twice.
					const current_row = this.ctx.storage.sql
						.exec(`SELECT * FROM ${sanitized_table} WHERE ${primary_key} = ? LIMIT 1`, id)
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
							next === null
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

					const updates = Object.entries(this.toSqliteValue(entity_type, input_data)!);
					const bindings = [...updates.map(([_, value]) => value), id];
					const updateFields = updates
						.map(([column]) => `${this.sanitize(column)} = ?`)
						.join(', ');
					const query_sql = `UPDATE ${sanitized_table} SET ${updateFields} WHERE ${primary_key} = ? RETURNING *;`;
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
					this.ctx.storage.sql.exec(
						`DELETE FROM ${sanitized_table} WHERE ${primary_key} = ?`,
						id,
					);
					// `removeDocument` writes the tombstone that feeds the sync deletion
					// timeline. Marked touched first — see the create branch.
					touched.wrote = true;
					this.search.removeDocument(entity_type, id.toString(), now.getTime());
					deleted_types.add(entity_type);
					this.cascadeReindexReferencing(entity_type, id, touched, now);
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

		// Broadcast entity changes via WebSocket (fire-and-forget, after the
		// transaction commits). Inside a batch() the outer transaction can still
		// roll back, so broadcasts are deferred until the batch commits — a
		// broadcast for a rolled-back create would plant a doc on clients that no
		// tombstone ever removes.
		const broadcasts: DeferredBroadcast[] = [];
		for (let i = 0; i < operations.length; i++) {
			const result = results[i];
			if (!result || !('entity' in result)) continue;
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
	batch<T>(fn: () => T): T {
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
					`SELECT * FROM ${this.sanitize(fk_meta.table)} WHERE ${this.sanitize(fk_meta.column)} = ? LIMIT 1`,
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
					`SELECT * FROM ${this.sanitize(dep.table)} WHERE ${this.sanitize(dep.fk_field)} = ?`,
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
					`UPDATE ${this.sanitize(dep.table)} SET updated_at = ?, "json" = json_set(IFNULL("json", '{}'), '$."$derived"', json(?)) WHERE ${this.sanitize(dep_pk)} = ?`,
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
		const temp = { ...value, ...json_fields };
		delete (temp as any).json;
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
		return {
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
}

/* -------------------------------------------------------------------------- */
/* Native-search module helpers                                               */
/* -------------------------------------------------------------------------- */

/**
 * "Same derived value" for the cascade's no-op check. `$derived` blobs only
 * ever hold values a derived fn returned and `persistDerivedFields` kept, so
 * null/undefined/absent are one state and objects compare by JSON identity.
 */
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
 * A sparse document with its vector fields removed (§7.0's one carve-out).
 *
 * The server indexes the full sparse doc; sync ships — and the client indexes —
 * *sparse doc minus vector fields*, because vector search is server-only and an
 * embedding is by far the heaviest thing in a document. Returns the input
 * untouched when the table declares no vectors, so the common table pays one
 * array-length check; otherwise it returns a **copy**, since callers may hand
 * us a document that must not be mutated.
 */
function stripVectorFields(
	doc: Record<string, unknown>,
	vector_paths: readonly string[],
): Record<string, unknown> {
	if (vector_paths.length === 0) return doc;
	const stripped: Record<string, unknown> = { ...doc };
	for (const path of vector_paths) {
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
