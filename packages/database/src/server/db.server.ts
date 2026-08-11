import { DurableObject } from 'cloudflare:workers';
import { prepareSql, SqlQueryFn } from './sql.helper';
import {
	AnyOrama,
	create as createOrama,
	remove as removeFromOrama,
	insertMultiple as insertMultipleIntoOrama,
	insert as insertIntoOrama,
	load as loadOrama,
	search as searchOrama,
	Results,
	save as saveOrama,
} from '@orama/orama';
import { encode as encodeMsgPack, decode as decodeMsgPack } from '@msgpack/msgpack';
import { deepEqual } from 'fast-equals';
import type { Database } from '../schema/schema';
import { normalizeWhere } from '../search-query';
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
				/** Optional event data associated with the creation */
				event?: { user_id: string };
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
				/** Optional event data associated with the update */
				event?: { user_id: string };
			};
	  }
	| {
			/** A 'delete' operation which is functionally the same as calling db.delete() */
			delete: {
				/** The type of entity to delete */
				type: keyof DatabaseConfig & string;
				/** The ID of the entity to delete */
				id: string | number;
				/** Optional event data associated with the deletion */
				event?: { user_id: string };
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
				 * The sparse (search-index) projection that was inserted into Orama
				 * (undefined for deletes). Broadcast to websocket clients so their
				 * local index receives exactly what the server indexed.
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
	/** Limits the number of changes (inserts/deletes) to return in the response */
	limit?: number;
	/**
	 * The starting 'updated_at' timestamp of all changes that should be returned.
	 * The 'updated_at' timestamp is changed to the current time every time any entity is created/updated/deleted.
	 * If this is provided, it will return changes in ASC order since this timestamp.
	 * If this is undefined, it will return changes in DESC order since 'end_updated_at' (or the current time if 'end_updated_at' is undefined).
	 */
	start_updated_at?: number;
	/**
	 * The ending 'updated_at' timestamp of all changes that should be returned.
	 * If this is undefined and 'start_updated_at' is defined, it will return changes in ASC order since the 'start_updated_at'.
	 * If this is undefined and 'start_updated_at' is also undefined, it will return changes in DESC order before the current time.
	 * If this is defined and 'start_updated_at' is undefined, it will return changes in DESC order before this timestamp.
	 * If this is defined and 'start_updated_at' is also defined, it will return changes in ASC order between the 'start_updated_at' and 'end_updated_at'.
	 * This can be used to page the results so a bunch of results don't need to be returned at once.
	 */
	end_updated_at?: number;
	/**
	 * A record of entities to fetch the changes for.
	 * This is used to get more granular changes for a specific entity type instead of all entities.
	 * If this is undefined, it will return changes for all entities.
	 */
	entity?: {
		[Type in keyof DatabaseConfig & string]?: {
			/**
			 * A version number of the config/schema of the orama library that the client currently is using.
			 * If the server version is different, the server will return the new config/schema
			 * and the client will will reindex the data using the new schema.
			 */
			config_version: number;
			/** Limits the number of changes (inserts/deletes) to return in the response for this entity */
			limit?: number;
			/**
			 * The starting 'updated_at' timestamp of changes to this entity that should be returned.
			 * This overrides the 'start_updated_at' timestamp for the entire sync event.
			 * The 'updated_at' timestamp is changed to the current time every time any entity is created/updated/deleted.
			 * If this is provided, it will return changes in ASC order since this timestamp.
			 * If this is undefined, it will return changes in DESC order since 'end_updated_at' (or the current time if 'end_updated_at' is undefined).
			 */
			start_updated_at?: number;
			/**
			 * The ending 'updated_at' timestamp of changes to this entity that should be returned.
			 * This overrides the 'end_updated_at' timestamp for the entire sync event.
			 * If this is undefined and 'start_updated_at' is defined, it will return changes in ASC order since the 'start_updated_at'.
			 * If this is undefined and 'start_updated_at' is also undefined, it will return changes in DESC order before the current time.
			 * If this is defined and 'start_updated_at' is undefined, it will return changes in DESC order before this timestamp.
			 * If this is defined and 'start_updated_at' is also defined, it will return changes in ASC order between the 'start_updated_at' and 'end_updated_at'.
			 * This can be used to page the results so a bunch of results don't need to be returned at once.
			 */
			end_updated_at?: number;
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
			 * The schema/config used to setup the Orama library for searching. This is included only when the Orama schema changes.
			 * When this changes, the client will completely reindex the data using the new schema.
			 */
			config?: Database.Table['config']['orama'];
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
};

interface SearchIndex {
	/** A record of deleted entity ids with their deletion epoch timestamps in ms */
	deleted_entity: Record<string, number>;
	/**
	 * The last epoch timestamp in ms when an event occurred to the index (an entity was created/updated/deleted).
	 * This is useful to know so we don't have to check if anything has changed after this timestamp.
	 */
	last_updated_at: number;
	/**
	 * The first epoch timestamp in ms of the first change (an entity was created).
	 * This is used to know when the first event occurred for sync purposes.
	 */
	first_updated_at: number;
	/**
	 * The version number of the search config/schema used to create the index.
	 * This number automatically increments every time the config/schema changes.
	 */
	config_version: number;
	/** The orama search index for the table. This is preloaded with all documents */
	orama: AnyOrama;
}

interface SearchIndexTableSchema {
	/** The ID of the orama index (typically the table name), with a numeric suffix */
	id: string;
	/** The BLOB data of the orama index (may be split across multiple rows if too large) */
	index_data?: ArrayBuffer;
	/** The JSON string of the orama config used to create the index */
	index_config: string;
	/** The version number of the index config/schema (incremented every time the config changes) */
	index_version: number;
	/** The format of the stored index data (msgpack or json) */
	index_format: 'msgpack' | 'json';
	/** The JSON string of a record of deleted entity ids with their deletion epoch timestamps in ms */
	deleted_entity: string;
	/** The epoch timestamp in ms of the first change (an entity was created) */
	first_updated_at: number;
	/** The epoch timestamp in ms of the last change (an entity was created/updated/deleted) */
	last_updated_at: number;
}

type DeepPartial<T> = {
	[P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/** A Durable Object for handling database requests */
export class DatabaseServer<
	DatabaseConfig extends Record<string, Database.Table>,
	Meta = Record<string, any>,
> extends DurableObject<Env> {
	/**
	 * Maximum delete tombstones kept per entity index. Tombstones are needed so
	 * incrementally-syncing clients learn about deletions; past this cap the
	 * oldest half is pruned and the index config version is bumped, which routes
	 * clients holding pre-prune cursors through the full-resync path instead.
	 */
	static MAX_DELETE_TOMBSTONES = 10_000;

	/** Persistent state of the database server (saved/loaded in sqlite) */
	#state: DatabaseServerState<DatabaseConfig, Meta>;

	/** A record of search indexes for each table */
	#search_index: {
		[TableName in keyof DatabaseConfig]?: SearchIndex;
	} = {};

	/** In-flight index rebuilds, used to prevent re-entrant/duplicate rebuilds of the same table */
	#index_rebuild_in_flight: {
		[TableName in keyof DatabaseConfig]?: SearchIndex;
	} = {};

	/** Reverse FK map: for each table, which other tables have FK-derived fields depending on it */
	#reverse_fk_map: Map<string, Array<{ table: string; fk_field: string }>> = new Map();

	public get id() {
		return this.ctx.id.toString();
	}

	constructor(
		private config: DatabaseConfig,
		private ws: () =>
			| {
					entityChanged(
						action: 'created' | 'updated' | 'deleted',
						entity_type: string,
						id: string | number,
						data?: unknown,
						user_id?: string,
						sparse?: unknown,
					): void;
			  }
			| undefined, // lazily returns the WebSocket Durable Object that is used for broadcasting events
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
				CREATE TABLE IF NOT EXISTS search_index (
					id TEXT PRIMARY KEY,
					index_data BLOB NOT NULL,
					index_config TEXT NOT NULL,
					index_version INTEGER NOT NULL,
					index_format TEXT NOT NULL,
					deleted_entity TEXT NOT NULL,
					first_updated_at INTEGER NOT NULL,
					last_updated_at INTEGER NOT NULL
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
					this.ctx.storage.sql.exec(
						`UPDATE state SET json = ?, updated_at = ? WHERE id = ?;`,
						JSON.stringify({
							...this.#state,
							created_at: undefined,
							updated_at: undefined,
						}),
						Date.now(),
						'main',
					);
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
					this.ctx.storage.sql.exec(
						`UPDATE state SET json = ?, updated_at = ? WHERE id = ?;`,
						JSON.stringify({
							...this.#state,
							created_at: undefined,
							updated_at: undefined,
						}),
						Date.now(),
						'main',
					);
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
				// Same serializable-projection rule as the orama config check below:
				// `existing` already survived a JSON round trip, so an undefined member
				// on the live definition would otherwise read as a changed index.
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
					this.ctx.storage.sql.exec(
						`UPDATE state SET json = ?, updated_at = ? WHERE id = ?;`,
						JSON.stringify({
							...this.#state,
							created_at: undefined,
							updated_at: undefined,
						}),
						Date.now(),
						'main',
					);
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
					this.ctx.storage.sql.exec(
						`UPDATE state SET json = ?, updated_at = ? WHERE id = ?;`,
						JSON.stringify({
							...this.#state,
							created_at: undefined,
							updated_at: undefined,
						}),
						Date.now(),
						'main',
					);
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
	 * Gets multiple entities from the database in a batch.
	 * Groups requests by entity type and uses `WHERE id IN (...)` for efficiency.
	 * Returns results in the same order as the input array.
	 * Throws a 404 if any entity is not found.
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
	>(
		requests: Array<{
			entity_type: Type;
			id: string | number;
			expand?: ExpandedFields;
		}>,
	): Output[];

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
	>(entity_type: Type, id: string | number, expand?: ExpandedFields): Output;

	get(entity_type_or_requests: any, id?: string | number, expand?: any): any {
		// Batch overload: array of requests
		if (Array.isArray(entity_type_or_requests)) {
			return this.getBatch(entity_type_or_requests);
		}
		// Single entity overload
		return this.getSingle(entity_type_or_requests, id!, expand);
	}

	/** Internal: batch get implementation */
	private getBatch(
		requests: Array<{
			entity_type: string;
			id: string | number;
			expand?: string[];
		}>,
	): any[] {
		if (!requests.length) return [];

		// Group by entity_type for efficient batching
		const groups = new Map<
			string,
			Array<{ index: number; id: string | number; expand?: string[] }>
		>();
		for (let i = 0; i < requests.length; i++) {
			const req = requests[i];
			let group = groups.get(req.entity_type);
			if (!group) {
				group = [];
				groups.set(req.entity_type, group);
			}
			group.push({ index: i, id: req.id, expand: req.expand });
		}

		const results: any[] = Array.from({ length: requests.length });

		for (const [entity_type, group] of groups) {
			const table = this.config[entity_type];
			if (!table) {
				throw new DelightError({
					message: `Entity type ${entity_type} is not valid`,
					status: 400,
				});
			}
			const sanitized_table = this.sanitize(entity_type);
			const primary_key = this.sanitize(table.config.primary_key || 'rowid');
			const ids = group.map((g) => g.id);
			const placeholders = ids.map(() => '?').join(', ');

			try {
				const cursor = this.ctx.storage.sql.exec(
					`SELECT * FROM ${sanitized_table} WHERE ${primary_key} IN (${placeholders})`,
					...ids,
				);

				// Index fetched rows by their primary key
				const fetched = new Map<string | number, any>();
				for (const row of cursor) {
					const entity = this.toEntityValue(entity_type, row);
					if (entity) {
						fetched.set((entity as any)[table.config.primary_key || 'id'], entity);
					}
				}

				// Map results back in order and handle expansions
				for (const { index, id, expand } of group) {
					const data = fetched.get(id);
					if (!data) {
						const entity_name = this.sanitize(entity_type);
						throw new DelightError({ message: `${entity_name} not found`, status: 404 });
					}
					if (expand?.length) {
						// Delegate to getSingle for expansion (expansions are typically few)
						results[index] = this.getSingle(entity_type, id, expand);
					} else {
						results[index] = data;
					}
				}
			} catch (error: any) {
				if (error?.status) throw error;
				console.error('Database error fetching entities:', error);
				throw new DelightError({
					message: 'Database error occurred while fetching entities',
					status: 500,
				});
			}
		}

		return results;
	}

	/** Internal: single get implementation */
	private getSingle<
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
					let temp = foreign_key_result.next()?.value;
					if (!temp) return;
					temp = { ...temp, ...JSON.parse((temp?.json as any) || '{}') };
					delete (temp as any).json;
					for (const key in temp) {
						if (temp[key] === null) delete temp[key];
					}
					expanded[field] = temp as Entity;
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

	/** Deletes the entity with the given id */
	delete<Type extends keyof DatabaseConfig & string>(
		entity_type: Type,
		id: string | number,
	): void {
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
			start_updated_at: query?.start_updated_at || 0,
			end_updated_at: query?.end_updated_at || 0,
			first_updated_at: 0,
			last_updated_at: 0,
			entity: {},
		};

		// Add the changes to the results for each entity type
		for (const entity_type in this.config) {
			// When the request names specific entity types, only those are returned —
			// computing the others wastes work and the client would ignore them anyway
			if (query?.entity && !(entity_type in query.entity)) continue;
			const index = this.getIndex(entity_type);
			if (!index || !this.config[entity_type]) continue;
			const orama = index.orama;
			const requested_limit = query?.entity?.[entity_type]?.limit || query?.limit || 0;
			const limit = Math.min(5000, requested_limit > 0 ? requested_limit : 5000);
			const schema_changed =
				query?.entity?.[entity_type]?.config_version !== undefined &&
				query?.entity?.[entity_type]?.config_version !== index.config_version;
			const from = schema_changed
				? 0
				: (query?.entity?.[entity_type]?.start_updated_at ??
					query?.start_updated_at ??
					0);
			const to = schema_changed
				? Number.MAX_SAFE_INTEGER
				: (query?.entity?.[entity_type]?.end_updated_at ??
					query?.end_updated_at ??
					Number.MAX_SAFE_INTEGER);
			const descending =
				schema_changed ||
				(query?.entity?.[entity_type]?.start_updated_at ?? query?.start_updated_at) ===
					undefined;

			// Get the list of changes from the orama index between the from/to
			// timestamps. Fetch limit+1 (and grow if needed) so the trim below can
			// see whether the doc at the cut boundary shares its timestamp with
			// docs past the cut — Orama applies the limit itself, so asking for
			// exactly `limit` would truncate an equal-timestamp run before the
			// "never split equal timestamps" logic ever saw it.
			const search_params = (fetch_limit: number) => ({
				limit: fetch_limit,
				sortBy: {
					property: 'updated_at',
					order: (descending ? 'DESC' : 'ASC') as 'DESC' | 'ASC',
				},
				where: {
					// Between is inclusive on both ends, so we adjust it to be exclusive:
					// when descending, the window is [from, to); when ascending, (from, to].
					// This lets a client use the response's end_updated_at as the next
					// request's start_updated_at without receiving duplicates.
					updated_at:
						to === Number.MAX_SAFE_INTEGER
							? descending
								? { gte: from }
								: { gt: from }
							: {
									between: (descending ? [from, to - 1] : [from + 1, to]) as [
										number,
										number,
									],
								},
				},
			});
			let fetch_limit = limit + 1;
			let result = searchOrama(orama, search_params(fetch_limit));
			if (result instanceof Promise) continue; // orama search should always be sync here, this is for type safety

			// Deleted entries must use the same half-open window as the orama query
			// above, otherwise a delete exactly on the boundary is duplicated or lost.
			const inWindow = descending
				? (ts: number) => ts >= from && (to === Number.MAX_SAFE_INTEGER || ts < to)
				: (ts: number) => ts > from && ts <= to;

			// Merge document changes and deletions into a single timeline so the
			// limit and the reported start/end window apply to ALL changes. Computing
			// the window from deletions outside the page (or beyond a limit-truncated
			// page) would make paging clients skip the changes in between.
			type Change = { ts: number; deleted_id?: string; doc?: any };
			const sync_primary_key = this.config[entity_type].config.primary_key || 'id';
			let included: Change[];
			for (;;) {
				const changes: Change[] = [];
				for (const item of result.hits) {
					if (!item.document || !item.id) continue;
					// Orama (<= 3.1.18) can return ghost hits with an empty document for
					// previously removed docs (stale entries in its internal indexes) —
					// never ship those to clients
					if ((item.document as any)[sync_primary_key] === undefined) continue;
					changes.push({ ts: item.document.updated_at || 0, doc: item.document });
				}
				for (const [id, deleted_at] of Object.entries(index.deleted_entity)) {
					if (!inWindow(deleted_at)) continue;
					changes.push({ ts: deleted_at, deleted_id: id });
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

				// If the equal-timestamp extension consumed every fetched change AND
				// the doc fetch was full, more docs sharing the boundary timestamp may
				// exist beyond the fetch — grow it and re-trim (legacy data only:
				// writes get strictly-monotonic timestamps, so this loop is normally
				// a single pass).
				if (included.length < changes.length || result.hits.length < fetch_limit) {
					break;
				}
				fetch_limit *= 2;
				const grown = searchOrama(orama, search_params(fetch_limit));
				if (grown instanceof Promise) break;
				result = grown;
			}

			const deleted = [] as (string | number)[];
			const updated = [] as Database.SearchEntity<DatabaseConfig[typeof entity_type]>[];
			const created = [] as Database.SearchEntity<DatabaseConfig[typeof entity_type]>[];
			let start_updated_at = Infinity;
			let end_updated_at = 0;
			for (const change of included) {
				if (change.deleted_id !== undefined) {
					deleted.push(change.deleted_id);
				} else if (!change.ts || change.doc.created_at === change.doc.updated_at) {
					created.push(
						change.doc as Database.SearchEntity<DatabaseConfig[typeof entity_type]>,
					);
				} else {
					updated.push(
						change.doc as Database.SearchEntity<DatabaseConfig[typeof entity_type]>,
					);
				}
				if (!change.ts) continue;
				if (change.ts < start_updated_at) start_updated_at = change.ts;
				if (change.ts > end_updated_at) end_updated_at = change.ts;
			}

			results.entity[entity_type] = {
				deleted,
				created,
				updated,
				config_version: index.config_version || 1,
				first_updated_at: index.first_updated_at || 0,
				last_updated_at: index.last_updated_at || 0,
				start_updated_at: start_updated_at === Infinity ? 0 : start_updated_at,
				end_updated_at,
				config: schema_changed ? this.config[entity_type].config.orama : undefined,
			};
		}
		results.first_updated_at = Math.min(
			Infinity,
			...Object.values(results.entity).map(
				(entity) => entity?.first_updated_at || Infinity,
			),
		);
		results.last_updated_at = Math.max(
			0,
			...Object.values(results.entity).map((entity) => entity?.last_updated_at || 0),
		);
		results.start_updated_at = Math.min(
			Infinity,
			...Object.values(results.entity).map(
				(entity) => entity?.start_updated_at || Infinity,
			),
		);
		results.end_updated_at = Math.max(
			0,
			...Object.values(results.entity).map((entity) => entity?.end_updated_at || 0),
		);
		results.first_updated_at = isFinite(results.first_updated_at)
			? results.first_updated_at
			: 0;
		results.start_updated_at = isFinite(results.start_updated_at)
			? results.start_updated_at
			: 0;
		return results;
	}

	/**
	 * Lists the entities of the given type that match the given query
	 * If the 'sparse' field in the query is true, it will use the sparse search index with '.searchable()' fields (from orama)
	 * If the 'sparse' field in the query is false, it will use the full values from the database
	 */
	list<
		Type extends keyof DatabaseConfig & string,
		Table extends DatabaseConfig[Type],
		Query extends Database.SearchQuery<Table>,
		Output extends Database.SearchQueryResults<Table, Query>,
	>(entity_type: Type, raw_query: Query): Output {
		const index = this.getIndex(entity_type);
		const table = this.config[entity_type];
		if (!index || !table) {
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
		// Resolve q alias: use q as term when term is not set
		const base_query = previous_cursor_data || raw_query;
		const resolved_term = base_query.term ?? base_query.q;

		const query = {
			order: [{ key: 'updated_at', direction: 'DESC' }],
			...base_query,
			// Accept plain-value where shorthands (`{folder: 'inbox'}`) on enum and
			// number properties — Orama requires operation objects there and its
			// throw otherwise surfaced as a 500.
			where: normalizeWhere(
				base_query.where as Record<string, unknown> | undefined,
				table.config.orama.schema as Record<string, unknown>,
			) as never,
			term: resolved_term,
			q: undefined,
			cursor: undefined,
			sparse,
			limit: Math.max(
				1,
				Math.min(base_query.limit || (sparse ? 100 : 10), sparse ? 5000 : 100),
			),
		} satisfies Database.SearchQuery<Table>;
		query.order.forEach(({ key }) => {
			if (!table.config.sortable_fields.includes(key)) {
				throw new DelightError({
					message: `Invalid order key ${key}. Must be one of ${table.config.sortable_fields.join(', ')}.`,
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
					({ key }) =>
						// Using 'where' clauses for pagination is not supported for non-scalar types
						(table.config.orama.schema[key] !== 'number' &&
							(table.config.orama.schema[key] as any) !== 'number[]') ||
						// Check to make sure the keys aren't using the 'dot' notation for nested fields
						!!key.match(/[^a-z0-9_]/gi) ||
						// Check to make sure the last item has a value for the order key
						last_item[key] === undefined ||
						last_item[key] === null,
				);
			if (use_offset) {
				return btoa(JSON.stringify({ ...query, cursor: undefined, offset }))
					.replace(/\+/g, '-')
					.replace(/\//g, '_');
			}
			// Use where clauses to create the cursor for pagination instead of offsets
			// because offsets are less efficient for large datasets
			query.order.forEach(({ key, direction }) => {
				if (!('and' in where)) {
					const previous_where = structuredClone(where);
					(where as any) = {};
					(where as any).and = [previous_where];
				}
				const existing_clause_index = (where as any).and.findIndex(
					(clause: any) => !!clause[key] && !clause[key]?.between,
				);
				const value = last_item[key] || 0;
				if (existing_clause_index === -1) {
					(where as any).and.push({
						[key]: direction === 'ASC' ? { gt: value } : { lt: value },
					});
				} else {
					(where as any).and[existing_clause_index][key] =
						direction === 'ASC' ? { gt: value } : { lt: value };
				}
			});
			return btoa(
				JSON.stringify({ ...query, where, cursor: undefined, offset: undefined }),
			)
				.replace(/\+/g, '-')
				.replace(/\//g, '_');
		};

		let results: Results<any>;
		try {
			results = searchOrama<AnyOrama>(index.orama, {
				...query,
				properties: (query.properties as any) || '*',
				limit: query.limit,
				term: query.term,
				mode: (query.term && query.vector
					? 'hybrid'
					: query.vector
						? 'vector'
						: 'fulltext') as any,
				includeVectors: false,
				sortBy:
					query.order.length === 1
						? {
								property: query.order[0].key,
								order: (query.order[0].direction || 'ASC').toUpperCase() as
									| 'ASC'
									| 'DESC',
							}
						: ([_aId, aScore, aDoc], [_bId, bScore, bDoc]) => {
								for (const ord of query.order) {
									const aValue = aDoc[ord.key];
									const bValue = bDoc[ord.key];
									if (typeof aValue === 'string' && typeof bValue === 'string') {
										const comparison = aValue.localeCompare(bValue, undefined, {
											numeric: true,
											ignorePunctuation: true,
										});
										if (comparison !== 0) {
											return (ord.direction || 'ASC').toUpperCase() === 'ASC'
												? comparison
												: -comparison;
										}
									}
									if (aValue < bValue) {
										return (ord.direction || 'ASC').toUpperCase() === 'ASC' ? -1 : 1;
									}
									if (aValue > bValue) {
										return (ord.direction || 'ASC').toUpperCase() === 'ASC' ? 1 : -1;
									}
								}
								return bScore - aScore;
							},
			}) as Results<any>;
		} catch (err) {
			// A malformed filter is the caller's mistake, not a server fault —
			// surface Orama's filter validation as a 400 instead of a 500.
			const code = (err as { code?: string }).code;
			if (code === 'UNKNOWN_FILTER_PROPERTY' || code === 'INVALID_FILTER_OPERATION') {
				throw new DelightError({ message: (err as Error).message, status: 400 });
			}
			throw err;
		}

		// Drop ghost hits (empty documents Orama can return for removed docs)
		const list_primary_key = (table.config.primary_key || 'id') as string;
		const ghost_count = results.hits.length;
		let hits = results.hits.filter(
			(hit) => hit.document && (hit.document as any)[list_primary_key] !== undefined,
		);
		const dropped_ghosts = ghost_count - hits.length;
		if (!sparse) {
			// If the query is not sparse, we need to fetch the full entities from the database
			hits = results.hits.map((hit) => {
				const primary_key = (table.config.primary_key || 'id') as keyof Table;
				const id = (hit.document[primary_key] as any) || hit.id;
				try {
					const full_entity = this.get(entity_type, id);
					return { ...hit, document: full_entity };
				} catch {
					return { ...hit, document: null };
				}
			}) as any;
		}

		return {
			count: Math.max(0, results.count - dropped_ghosts),
			elapsed: results.elapsed,
			hits,
			facets: results.facets,
			cursor:
				// Compare against the pre-filter hit count: a page that filled the
				// limit before ghost-filtering may still have more results after it
				ghost_count >= query.limit
					? generateCursor(hits[hits.length - 1]?.document, ghost_count)
					: undefined,
		} as Output;
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
		this.ctx.storage.sql.exec(
			`UPDATE state SET json = ?, updated_at = ? WHERE id = ?;`,
			JSON.stringify({
				...this.#state,
				created_at: undefined,
				updated_at: undefined,
			}),
			Date.now(),
			'main',
		);
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

		const indexes_to_save: Set<string> = new Set();
		this.ctx.storage.transactionSync(() => {
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
					const index = this.getIndex(entity_type);
					if (!table || !index) {
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
					this.ensureMonotonicTimestamp(now, index);

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
					insertIntoOrama(index.orama, sparse_entity);
					// Clear any delete tombstone for this id (the id may be reused, e.g.
					// numeric rowids) so sync clients don't apply a stale delete to it
					delete index.deleted_entity[String(output_data[primary_key] ?? output_data.id)];
					index.last_updated_at = Math.max(index.last_updated_at, now.getTime());
					if (!index.first_updated_at) index.first_updated_at = now.getTime();
					indexes_to_save.add(entity_type);
					this.cascadeReindexReferencing(
						entity_type,
						output_data[primary_key] || output_data.id,
						indexes_to_save,
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
					const index = this.getIndex(entity_type);
					if (!table || !index) {
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
					this.ensureMonotonicTimestamp(now, index);
					const current_data = this.get(entity_type, id); // will throw a 404 if not found
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
					removeFromOrama(index.orama, id.toString());
					insertIntoOrama(index.orama, sparse_entity);
					delete index.deleted_entity[id.toString()];
					index.last_updated_at = Math.max(index.last_updated_at, now.getTime());
					if (!index.first_updated_at) index.first_updated_at = now.getTime();
					indexes_to_save.add(entity_type);
					this.cascadeReindexReferencing(
						entity_type,
						output_data[primary_key] || output_data.id || id,
						indexes_to_save,
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
					const index = this.getIndex(entity_type);
					if (!table || !index) {
						throw new DelightError({
							message: `Entity type ${entity_type} is not valid`,
							status: 400,
						});
					}
					const sanitized_table = this.sanitize(entity_type);
					const primary_key = this.sanitize(table.config.primary_key || 'rowid');
					this.ensureMonotonicTimestamp(now, index);
					this.ctx.storage.sql.exec(
						`DELETE FROM ${sanitized_table} WHERE ${primary_key} = ?`,
						id,
					);
					removeFromOrama(index.orama, id.toString());
					index.deleted_entity[id.toString()] = now.getTime();
					this.pruneTombstones(index);
					index.last_updated_at = Math.max(index.last_updated_at, now.getTime());
					if (!index.first_updated_at) index.first_updated_at = now.getTime();
					indexes_to_save.add(entity_type);
					this.cascadeReindexReferencing(entity_type, id, indexes_to_save, now);
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

			// Save all modified indexes — or, inside a batch(), defer the (expensive,
			// full-index) serialization to the batch's single outer commit.
			if (this.#deferred_index_saves) {
				indexes_to_save.forEach((t) => this.#deferred_index_saves!.add(t));
			} else {
				indexes_to_save.forEach((entity_type) => this.saveIndex(entity_type));
			}
		});

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
		if (this.#deferred_broadcasts) {
			this.#deferred_broadcasts.push(...broadcasts);
		} else {
			this.#flushBroadcasts(broadcasts);
		}

		return results;
	}

	#deferred_index_saves: Set<string> | null = null;
	#deferred_broadcasts: DeferredBroadcast[] | null = null;

	#flushBroadcasts(broadcasts: DeferredBroadcast[]): void {
		if (!broadcasts.length) return;
		try {
			const ws_do = this.ws();
			if (ws_do?.entityChanged) {
				for (const b of broadcasts) {
					ws_do.entityChanged(b.action, b.entity_type, b.id, b.data, undefined, b.sparse);
				}
			}
		} catch {
			// WebSocket broadcast failure must never block database operations
		}
	}

	/**
	 * Run several imperative writes (create/update/delete/transaction) as ONE
	 * durable unit: every touched entity's search index serializes once at the
	 * end instead of once per write (index serialization is a full-index msgpack
	 * encode — per-write saves make an N-write ingest O(N²)), and the whole
	 * batch commits atomically (the callback runs inside an outer
	 * `transactionSync`, so a throw rolls back SQL AND index together).
	 * Websocket broadcasts flush only after the batch commits.
	 *
	 * The callback MUST be synchronous — an await inside would let other DO
	 * events interleave into the open transaction.
	 */
	batch<T>(fn: () => T): T {
		if (this.#deferred_index_saves) return fn(); // nested batch — join the outer one
		this.#deferred_index_saves = new Set();
		this.#deferred_broadcasts = [];
		try {
			const result = this.ctx.storage.transactionSync(() => {
				const value = fn();
				this.#deferred_index_saves!.forEach((t) => this.saveIndex(t as never));
				return value;
			});
			this.#flushBroadcasts(this.#deferred_broadcasts);
			return result;
		} finally {
			this.#deferred_index_saves = null;
			this.#deferred_broadcasts = null;
		}
	}

	/** Loads & returns the orama search instance of the given entity type */
	private getIndex<Type extends keyof DatabaseConfig & string>(
		entity_type: Type,
	): SearchIndex | undefined {
		if (this.#search_index[entity_type]) return this.#search_index[entity_type];
		if (!this.config?.[entity_type]) return;

		const search_index_rows = this.ctx.storage.sql
			.exec(`SELECT * FROM search_index WHERE id LIKE ?`, `${entity_type}.%`)
			.toArray() as unknown as SearchIndexTableSchema[];

		// If no index found, or if we need to rebuild it
		if (!search_index_rows.length) return this.rebuildIndex(entity_type);

		let stored_config;
		const current_config = this.config[entity_type].config.orama;
		const stored_index_version = search_index_rows[0].index_version || 1;
		const stored_index_format = search_index_rows[0].index_format || 'json';
		try {
			stored_config = JSON.parse(search_index_rows[0].index_config || '{}');
		} catch {
			return this.rebuildIndex(entity_type);
		}

		// Check if the config has changed. If so, we need to increment the version and rebuild the index.
		// Compare the SERIALIZABLE projection of the current config: the live object
		// carries function members (e.g. components.getDocumentIndexId, injected by
		// Database.table for every table) that JSON.stringify silently dropped when
		// the config was persisted. Comparing the raw object against the stored JSON
		// therefore failed on EVERY DO cold start, bumping the version each wake —
		// and every version bump makes every client discard its local index and
		// re-download the entire dataset, forever.
		if (!deepEqual(stored_config, JSON.parse(JSON.stringify(current_config)))) {
			return this.rebuildIndex(entity_type, stored_index_version + 1);
		}

		// Load the index data
		let search_index_config: any = undefined;
		if (stored_index_format === 'json') {
			const decoder = new TextDecoder();
			try {
				// Combine the chunks
				const chunks: string[] = [];
				for (const row of search_index_rows) {
					if (!row?.index_data) continue;
					chunks.push(decoder.decode(new Uint8Array(row.index_data)));
				}
				search_index_config = JSON.parse(chunks.join(''));
			} catch (e) {
				console.error('Error loading json index chunks:', e);
				return this.rebuildIndex(entity_type);
			}
		}
		if (stored_index_format === 'msgpack') {
			try {
				// Combine the chunks
				const size = search_index_rows.reduce((acc, row) => {
					if (!row?.index_data) return acc;
					return acc + row.index_data.byteLength;
				}, 0);
				const combined = new Uint8Array(size);
				let offset = 0;
				for (const row of search_index_rows) {
					if (!row?.index_data) continue;
					combined.set(new Uint8Array(row.index_data), offset);
					offset += row.index_data.byteLength;
					delete row.index_data; // free up memory
				}
				search_index_config = decodeMsgPack(combined);
			} catch (e) {
				console.error('Error loading msgpack index chunks:', e);
				return this.rebuildIndex(entity_type);
			}
		}

		const orama = createOrama(current_config);
		try {
			loadOrama(orama, search_index_config);
			// Persisted docs from older saves carry `null` where toSparse used to
			// write explicit `undefined` keys (msgpack has no undefined). Orama's
			// remove() crashes on null array properties (`value.length`), which made
			// every update/delete of an affected doc throw after a restart. Strip
			// null values so those docs behave like the sparse docs written today.
			const docs = (
				orama as { data?: { docs?: { docs?: Record<string, Record<string, unknown>> } } }
			).data?.docs?.docs;
			if (docs) {
				for (const doc of Object.values(docs)) {
					if (!doc) continue;
					for (const key of Object.keys(doc)) {
						if (doc[key] === null) delete doc[key];
					}
				}
			}
		} catch (error) {
			console.error('Error loading orama index:', error);
			return this.rebuildIndex(entity_type);
		}

		this.#search_index[entity_type] = {
			deleted_entity: JSON.parse(search_index_rows[0].deleted_entity || '{}'),
			last_updated_at: search_index_rows[0].last_updated_at || 0,
			first_updated_at: search_index_rows[0].first_updated_at || 0,
			config_version: search_index_rows[0].index_version || 1,
			orama,
		};

		return this.#search_index[entity_type];
	}

	/** Rebuilds the index from scratch for the given entity type */
	private rebuildIndex<Type extends keyof DatabaseConfig & string>(
		entity_type: Type,
		version = 1,
	): SearchIndex {
		// In-flight guard: if a rebuild for this entity type is already underway, reuse it
		// instead of starting a second rebuild. getIndex()/rebuildIndex() are fully
		// synchronous (so a promise would break the sync call sites), but a rebuild can
		// re-enter this code path indirectly (e.g. toSparse/derived-field hooks or dependent
		// table syncs calling back into getIndex), which would otherwise rebuild twice.
		const in_flight = this.#index_rebuild_in_flight[entity_type];
		if (in_flight) return in_flight;

		const orama = createOrama(this.config[entity_type].config.orama);
		const index = {
			deleted_entity: {},
			last_updated_at: 0,
			first_updated_at: 0,
			config_version: version,
			orama,
		} satisfies SearchIndex;
		this.#index_rebuild_in_flight[entity_type] = index;
		this.#search_index[entity_type] = index;

		try {
			// Load all entities from the database
			const sanitized_table = this.sanitize(entity_type);
			const table = this.config[entity_type];
			const rows = this.ctx.storage.sql.exec(`SELECT * FROM ${sanitized_table}`);

			// Rows don't change mid-rebuild (the DO is single-threaded and this is
			// fully synchronous), so referenced rows can be memoized across entities
			const ref_cache = new Map<string, Record<string, any> | undefined>();
			const entities: any[] = [];
			for (const row of rows) {
				const entity = this.toEntityValue(entity_type, row) as any;
				if (entity) {
					const sparse = table.toSparse(entity as any) as any;
					this.computeFkDerivedFields(entity_type as string, entity, sparse, ref_cache);
					entities.push(sparse);
					if (entity.updated_at && entity.updated_at > index.last_updated_at) {
						index.last_updated_at = entity.updated_at;
					}
					if (
						entity.updated_at &&
						(!index.first_updated_at || entity.updated_at < index.first_updated_at)
					) {
						index.first_updated_at = entity.updated_at;
					}
				}
			}

			if (entities.length > 0) {
				insertMultipleIntoOrama(orama, entities);
			}

			this.saveIndex(entity_type);
		} catch (error) {
			// Don't cache a half-built index if the rebuild failed
			delete this.#search_index[entity_type];
			throw error;
		} finally {
			delete this.#index_rebuild_in_flight[entity_type];
		}
		return index;
	}

	/** Saves the current state of the index of the given entity type to the database */
	private saveIndex<Type extends keyof DatabaseConfig & string>(entity_type: Type) {
		const index = this.#search_index[entity_type];
		if (!index) return;
		const raw_data = saveOrama(index.orama);
		const index_format: 'msgpack' | 'json' = 'msgpack';
		const binary = encodeMsgPack(raw_data, { maxDepth: 4096 });
		const chunk_size = 1900 * 1000; // 1.9MB safely under 2MB limit
		const index_config = JSON.stringify(this.config[entity_type].config.orama);
		const deleted_json = JSON.stringify(index.deleted_entity);
		// Never let a huge tombstone/config map push the first chunk size to <= 0,
		// which would make the chunking loop below spin forever on empty slices
		const first_chunk_size = Math.max(
			1024,
			chunk_size - (deleted_json.length + index_config.length),
		);

		// Cleanup old chunks
		this.ctx.storage.sql.exec(
			`DELETE FROM search_index WHERE id LIKE ?`,
			`${entity_type}.%`,
		);

		let i = 0;
		let saved_bytes = 0;
		while (saved_bytes < binary.length) {
			const chunk = binary.slice(
				saved_bytes,
				saved_bytes + (i === 0 ? first_chunk_size : chunk_size),
			);
			this.ctx.storage.sql.exec(
				`INSERT INTO search_index (id, index_data, index_config, index_version, index_format, deleted_entity, first_updated_at, last_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				`${entity_type}.${i}`,
				chunk,
				i === 0 ? index_config : '{}',
				index.config_version || 1,
				index_format,
				i === 0 ? deleted_json : '{}',
				index.first_updated_at || 0,
				index.last_updated_at || 0,
			);
			saved_bytes += chunk.length;
			i++;
		}
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
	 * Bounds the delete-tombstone map for an index. When it grows past
	 * MAX_DELETE_TOMBSTONES, the oldest half is pruned and the config version is
	 * bumped: clients whose sync cursor predates the pruned deletes can no
	 * longer be given a complete delete list, and the version bump makes them
	 * do a full resync (the same well-tested path used for schema changes).
	 */
	private pruneTombstones(index: SearchIndex) {
		const max = (this.constructor as typeof DatabaseServer).MAX_DELETE_TOMBSTONES;
		const entries = Object.entries(index.deleted_entity);
		if (entries.length <= max) return;
		entries.sort((a, b) => a[1] - b[1]);
		index.deleted_entity = Object.fromEntries(
			entries.slice(Math.ceil(entries.length / 2)),
		);
		index.config_version = (index.config_version || 1) + 1;
	}

	/**
	 * Ensures the working timestamp of a transaction is strictly greater than the
	 * last change recorded for the given index. `updated_at` is the sync cursor:
	 * if a new write received a timestamp <= an already-synced change (clock skew,
	 * or a previous multi-op transaction that advanced its timestamps past the
	 * wall clock), clients that synced past that point would never receive it.
	 */
	private ensureMonotonicTimestamp(now: Date, index: SearchIndex) {
		if (now.getTime() <= index.last_updated_at) {
			now.setTime(index.last_updated_at + 1);
		}
	}

	/**
	 * Reindexes all records in other tables that reference the given entity via FK-derived fields.
	 * Called after create/update/delete so dependent search indexes stay current.
	 */
	private cascadeReindexReferencing(
		entity_type: string,
		entity_id: string | number,
		indexes_to_save: Set<string>,
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
			const dep_index = this.getIndex(dep.table as keyof DatabaseConfig & string);
			if (!dep_table || !dep_index) continue;

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

				// Bump the dependent row's updated_at: its derived search fields just
				// changed, and sync clients only receive documents whose updated_at
				// falls inside the requested window. Without this, FK-derived changes
				// would update the server index but never reach synced clients.
				const ts =
					dep_index.last_updated_at >= now.getTime()
						? dep_index.last_updated_at + 1
						: now.getTime();
				this.ctx.storage.sql.exec(
					`UPDATE ${this.sanitize(dep.table)} SET updated_at = ? WHERE ${this.sanitize(dep_pk)} = ?`,
					ts,
					dep_entity[dep_pk],
				);
				dep_entity.updated_at = ts;

				// Recompute sparse (same-table derived first, then FK-derived)
				const sparse = dep_table.toSparse(dep_entity) as any;
				this.computeFkDerivedFields(dep.table, dep_entity, sparse, ref_cache);

				// Update Orama
				try {
					removeFromOrama(dep_index.orama, dep_id);
				} catch {
					// May not exist yet
				}
				insertIntoOrama(dep_index.orama, sparse);
				dep_index.last_updated_at = Math.max(dep_index.last_updated_at, ts);
				if (!dep_index.first_updated_at) dep_index.first_updated_at = ts;
				indexes_to_save.add(dep.table);
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
	>(entity_type: Type, value?: Record<string, SqlStorageValue>): Data | undefined {
		if (!entity_type) {
			throw new DelightError({
				message: `Entity type ${entity_type} is not valid`,
				status: 400,
			});
		}
		if (!value || typeof value !== 'object') return;
		let json_fields: Record<string, unknown> = {};
		try {
			json_fields = JSON.parse((value?.json as string) || '{}');
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
		for (const key in temp) {
			if (temp[key] === null) delete temp[key];
		}
		// Convert BOOLEAN columns back from sqlite's 0/1 to real booleans
		const table_definition = this.config[entity_type]?.config?.table_definition as
			| Record<string, string>
			| undefined;
		if (table_definition) {
			for (const [column, definition] of Object.entries(table_definition)) {
				if (!definition?.startsWith?.('BOOLEAN')) continue;
				if (typeof temp[column] === 'number') (temp as any)[column] = !!temp[column];
			}
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
		const column_names = Object.keys(table.config.table_definition).map((col) =>
			this.sanitize(col),
		);
		return {
			...Object.entries(input_data).reduce((acc, [key, value]) => {
				if (column_names.includes(key)) {
					if (value === undefined || value === null) {
						(acc as any)[key] = null;
					} else if (value instanceof Date) {
						(acc as any)[key] = value.toISOString();
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
					if (!column_names.includes(key)) (acc as any)[key] = value;
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
