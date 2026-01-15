import { DurableObject } from 'cloudflare:workers';
import { SqlServer } from './sql.server';
import { prepareSql, SqlEntityQuery, SqlQueryFn, SqlTableRow } from './sql.helper';
import {
	AnyOrama,
	create as createOrama,
	getByID as getByIdFromOrama,
	remove as removeFromOrama,
	insertMultiple as insertMultipleIntoOrama,
	insert as insertIntoOrama,
	load as loadOrama,
	search as searchOrama,
	Results,
	save as saveOrama,
} from '@orama/orama';
import type { Database } from '../schema/schema';
import { generateID } from '@delightstack/utilities';

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
			config?: Database.SearchConfig<DatabaseConfig[Type]>;
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
	deleted: Record<string, number>;
	/** The last epoch timestamp in ms when the index was updated (and entity was created/updated/deleted) */
	last_updated_at: number;
	/**
	 * The version number of the search config/schema used to create the index.
	 * This number automatically increments every time the config/schema changes.
	 */
	config_version: number;
	/** The orama search index for the table. This is preloaded with all documents */
	orama: AnyOrama;
}

type DeepPartial<T> = {
	[P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/** A Durable Object for handling database requests */
export class DatabaseServer<
	DatabaseConfig extends Record<string, Database.Table>,
	Meta = Record<string, any>,
> extends DurableObject<Env> {
	/** Persistent state of the database server (saved/loaded in sqlite) */
	#state: DatabaseServerState<DatabaseConfig, Meta>;

	/** A record of search indexes for each table */
	#search_index: {
		[TableName in keyof DatabaseConfig]?: SearchIndex;
	} = {};

	public get id() {
		return this.ctx.id.toString();
	}

	constructor(
		private config: DatabaseConfig,
		private ws: () => any, // lazily returns the WebSocket Durable Object that is used for broadcasting events
		ctx: DurableObjectState,
		protected env: Env,
	) {
		super(ctx, env);

		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS state (
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
		let state = result.next()?.value as
			| DatabaseServerState<DatabaseConfig, Meta>
			| undefined;

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

			// Double check the table name is safe/valid (just in case)
			if (table_config.name.match(/[^a-z_]/)) continue;
			const existing_table_def = this.#state?.table_config?.[table_config.name];
			const table_name = table_config.name.toLowerCase();

			// The table hasn't been created yet
			if (!existing_table_def) {
				const columns = Object.entries(table_definition).map(
					([column, def]) => `${column} ${def}`,
				);
				this.ctx.storage.transactionSync(() => {
					console.log(`Creating table ${table_name} (${columns.join(', ')})`);
					(this.#state.table_config as any)[table_name] =
						table_config.config.table_definition;
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
			for (const [column, def] of Object.entries(table_definition)) {
				if (existing_table_def[column as keyof typeof existing_table_def]) continue;
				console.log(`Adding column ${column} to table ${table_name}`);
				this.ctx.storage.transactionSync(() => {
					(this.#state.table_config as any)[table_name][column] = def;
					this.ctx.storage.sql.exec(
						`ALTER TABLE ${table_name} ADD COLUMN ${column} ${def};`,
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

			// Create the sqlite indexes that are defined in the table config but not yet created
			for (const index of table_config.config.indexes) {
				if (this.#state.sql_indexes.some((i) => i.name === index.name)) continue;
				if (table_name !== index.table) continue;
				const unique = index.unique ? ' UNIQUE' : '';
				console.log(`Creating index ${index.name} on table ${table_name}`);
				this.ctx.storage.transactionSync(() => {
					(this.#state.sql_indexes as any).push(index);
					const columns = index.columns
						.map((col) => `${col.column} ${col.direction || 'ASC'}`)
						.join(', ');
					this.ctx.storage.sql.exec(
						`CREATE INDEX IF NOT EXISTS ${index.name} ON ${table_name} (${columns})${unique};`,
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

			// Delete indexes that are no longer in the table config
			for (const existing_index of this.#state.sql_indexes) {
				if (table_config.config.indexes.some((i) => i.name === existing_index.name))
					continue;
				console.log(`Deleting index ${existing_index.name} on table ${table_name}`);
				this.ctx.storage.transactionSync(() => {
					(this.#state.sql_indexes as any) = (this.#state.sql_indexes as any).filter(
						(i: any) => i.name !== existing_index.name,
					);
					this.ctx.storage.sql.exec(`DROP INDEX IF EXISTS ${existing_index.name};`);
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
			throw {
				status: 400,
				message: `Entity type ${entity_type} is not valid`,
			};
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
			throw { status: 500, message: 'Database error occurred while fetching entity' };
		}
		if (!data) {
			const entity_name = this.sanitize(entity_type);
			throw { status: 404, message: `${entity_name} not found` };
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
				} catch (error) {
					throw {
						status: 500,
						message: 'Database error occurred while fetching entity expansions',
					};
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
			throw {
				status: 500,
				message: 'Database transaction did not return created entity',
			};
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
			throw {
				status: 500,
				message: 'Database transaction did not return updated entity',
			};
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

			// Get the list of changes from the orama index between the from/to timestamps
			const result = searchOrama(orama, {
				limit,
				sortBy: {
					property: 'updated_at',
					order: descending ? 'DESC' : 'ASC',
				},
				where: {
					updated_at: {
						// Between is inclusive on both ends, so we need to adjust it so it's exclusive
						// When it's descending, we need to make the 'to' timestamp exclusive
						// When it's ascending, we need to make the 'from' timestamp exclusive
						...(to === Number.MAX_SAFE_INTEGER
							? descending
								? { gte: from }
								: { gt: from }
							: { between: descending ? [from, to - 1] : [from + 1, to] }),
					},
				},
			});
			if (result instanceof Promise) continue; // orama search should always be sync here, this is for type safety

			// Find the first and last updated_at timestamps from the index
			const first_entity = searchOrama(orama, {
				limit: 1,
				sortBy: {
					property: 'updated_at',
					order: 'ASC',
				},
			});
			if (first_entity instanceof Promise) continue; // orama search should always be sync here, this is for type safety
			const last_entity = searchOrama(orama, {
				limit: 1,
				sortBy: {
					property: 'updated_at',
					order: 'DESC',
				},
			});
			if (last_entity instanceof Promise) continue; // orama search should always be sync here, this is for type safety

			const deleted = [] as (string | number)[];
			const updated = [] as Database.SearchEntity<DatabaseConfig[typeof entity_type]>[];
			const created = [] as Database.SearchEntity<DatabaseConfig[typeof entity_type]>[];
			const first_updated_at = first_entity.hits[0]?.document?.updated_at || 0;
			let last_updated_at = last_entity.hits[0]?.document?.updated_at || 0;
			let start_updated_at = Infinity;
			let end_updated_at = 0;

			// Add the created/updated entities to the results
			for (const item of result.hits) {
				if (!item.document || !item.id) continue;
				if (
					!item.document.updated_at ||
					item.document.created_at === item.document.updated_at
				) {
					created.push(
						item.document as Database.SearchEntity<DatabaseConfig[typeof entity_type]>,
					);
				} else {
					updated.push(
						item.document as Database.SearchEntity<DatabaseConfig[typeof entity_type]>,
					);
				}
				if (!item.document.updated_at) continue;
				if (item.document.updated_at < start_updated_at) {
					start_updated_at = item.document.updated_at;
				}
				if (item.document.updated_at > end_updated_at) {
					end_updated_at = item.document.updated_at;
				}
				if (item.document.updated_at > last_updated_at) {
					last_updated_at = item.document.updated_at;
				}
			}

			// Add the deleted entities to the results
			for (const [id, deleted_at] of Object.entries(index.deleted)) {
				if (deleted_at > from && deleted_at <= to) deleted.push(id);
				if (deleted_at < start_updated_at) start_updated_at = deleted_at;
				if (deleted_at > end_updated_at) end_updated_at = deleted_at;
				if (deleted_at > last_updated_at) last_updated_at = deleted_at;
			}

			results.entity[entity_type] = {
				deleted,
				created,
				updated,
				config_version: index.config_version,
				first_updated_at,
				last_updated_at,
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
			throw {
				status: 400,
				message: `Entity type ${entity_type} does not have a search index`,
			};
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
			} catch (error) {}
		}
		const query = {
			order: [{ key: 'updated_at', direction: 'DESC' }],
			...(previous_cursor_data || raw_query),
			cursor: undefined,
			sparse,
			limit: Math.max(
				1,
				Math.min(
					(previous_cursor_data || raw_query).limit || (sparse ? 100 : 10),
					sparse ? 5000 : 100,
				),
			),
		} satisfies Database.SearchQuery<Table>;
		query.order.forEach(({ key }) => {
			if (!table.config.sortable_fields.includes(key)) {
				throw {
					status: 400,
					message: `Invalid order key ${key}. Must be one of ${table.config.sortable_fields.join(', ')}.`,
				};
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
				const existing_clause_index = (query.where as any).and.findIndex(
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

		const results = searchOrama<AnyOrama>(index.orama, {
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
							order: (query.order[0].direction || 'ASC').toUpperCase() as 'ASC' | 'DESC',
						}
					: ([aId, aScore, aDoc], [bId, bScore, bDoc]) => {
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

		let hits = results.hits;
		if (!sparse) {
			// If the query is not sparse, we need to fetch the full entities from the database
			hits = results.hits.map((hit) => {
				const primary_key = (table.config.primary_key || 'id') as keyof Table;
				const id = (hit.document[primary_key] as any) || hit.id;
				try {
					const full_entity = this.get(entity_type, id);
					return { ...hit, document: full_entity };
				} catch (error) {
					return { ...hit, document: null };
				}
			}) as any;
		}

		return {
			count: results.count,
			elapsed: results.elapsed,
			hits,
			facets: results.facets,
			cursor:
				hits.length >= query.limit
					? generateCursor(hits[hits.length - 1]?.document, hits.length)
					: undefined,
		} as Output;
	}

	/** Returns the latest org data */
	getMeta() {
		if (!this.#state?.meta) {
			throw {
				status: 500,
				message: `No metadata found in Durable Object. Use setMeta() to add it to this durable object`,
			};
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
				this.ctx.storage.sql.exec(
					`PRAGMA foreign_keys = OFF; ${tables.map((v) => `DROP TABLE IF EXISTS ${v.name}`).join('; ')}; PRAGMA foreign_keys = ON;`,
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
			throw {
				status: 400,
				message: `Must return a tagged template literal to build SQL queries`,
			};
		}
		if (!(parsed as any)?.__safelyInterpretedSql__) {
			throw {
				status: 400,
				message: `Must use the 'sql' tagged template literal to build SQL queries`,
			};
		}
		const { query, values } = parsed;
		const start = performance.now();
		const result = this.ctx.storage.sql.exec(query, ...values);
		console.log(
			`Ran query in ${performance.now() - start}ms: ${query.replace(/\t+/g, '')}`,
			values.join(', '),
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
			throw {
				status: 400,
				message: `Too many operations in a single transaction. Maximum is 5000.`,
			};
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
						throw {
							status: 400,
							message: `Entity type ${entity_type} is not valid`,
						};
					}
					const data_copy = { ...unsafe_data };
					delete data_copy.id;
					delete data_copy.created_at;
					delete data_copy.updated_at;
					const sanitized_table = this.sanitize(entity_type);
					const primary_key = this.sanitize(table.config.primary_key || 'rowid');

					// Parse the data to ensure it's valid (throws an error if not)
					const input_data = table.parse({
						...data_copy,
						[primary_key]: table.config.primary_key_type === 'string' ? generateID() : 0,
						created_at: now.toISOString(),
						updated_at: now.toISOString(),
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
					insertIntoOrama(index.orama, sparse_entity);
					indexes_to_save.add(entity_type);
					results.push({
						entity: {
							type: entity_type,
							data: output_data,
							id: output_data[primary_key] || output_data.id,
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
						throw {
							status: 400,
							message: `Entity type ${entity_type} is not valid`,
						};
					}
					const data_copy = { ...unsafe_data };
					delete data_copy.id;
					delete data_copy.created_at;
					delete data_copy.updated_at;
					const sanitized_table = this.sanitize(entity_type);
					const primary_key = this.sanitize(table.config.primary_key || 'rowid');
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
						updated_at: now.toISOString(),
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
					removeFromOrama(index.orama, id.toString());
					insertIntoOrama(index.orama, sparse_entity);
					indexes_to_save.add(entity_type);

					results.push({
						entity: {
							type: entity_type,
							data: output_data,
							id: output_data[primary_key] || output_data.id || id,
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
						throw {
							status: 400,
							message: `Entity type ${entity_type} is not valid`,
						};
					}
					const sanitized_table = this.sanitize(entity_type);
					const primary_key = this.sanitize(table.config.primary_key || 'rowid');
					this.ctx.storage.sql.exec(
						`DELETE FROM ${sanitized_table} WHERE ${primary_key} = ?`,
						id,
					);
					removeFromOrama(index.orama, id.toString());
					index.deleted[id.toString()] = now.getTime();
					indexes_to_save.add(entity_type);
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

			// Save all modified indexes
			indexes_to_save.forEach((entity_type) => this.saveIndex(entity_type));
		});

		return results;
	}

	/** Loads & returns the orama search instance of the given entity type */
	private getIndex<Type extends keyof DatabaseConfig & string>(
		entity_type: Type,
	): SearchIndex | undefined {
		if (this.#search_index[entity_type]) return this.#search_index[entity_type];
		if (!this.config?.[entity_type]) return;
		this.#search_index[entity_type] = {
			deleted: {},
			last_updated_at: 0,
			config_version: 1,
			orama: createOrama(this.config[entity_type].config.orama),
		};

		// TODO: Load the index data from sqlite.
		// Since the indexes can be larger than the max row size (2MB), we need to split the index data into multiple rows
		// We also need to get the 'deleted' record from the database and the last_updated_at timestamp
		// When the data is retrieved from sqlite, we can load it into the orama instance using 'loadOrama'
		// This can all be done synchronously since sqlite is synchronous in Durable Objects
		// We also need to compare the config saved in sqlite vs the current config to see if we need to recreate the index from scratch
		// If the configs don't match, we need to recreate the index from scratch - by fetching all entities from the database and inserting them into the index
		// And then saving the index data back to sqlite

		return this.#search_index[entity_type];
	}

	/** Saves the current state of the index of the given entity type to the database */
	private saveIndex<Type extends keyof DatabaseConfig & string>(entity_type: Type) {
		const index = this.#search_index[entity_type];
		if (!index) return;
		const raw_data = saveOrama(index.orama);
		// TODO: Save the raw_data to sqlite.
		// Since the index data can be larger than the max row size (2MB), we need to split the index data into multiple rows
		// index.deleted also needs to be saved to the database
		// The config data & config_version should also be saved to the database
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
			throw {
				status: 400,
				message: `Entity type ${entity_type} is not valid`,
			};
		}
		if (!value || typeof value !== 'object') return;
		let temp = { ...value, ...JSON.parse((value?.json as any) || '{}') };
		delete (temp as any).json;
		for (const key in temp) {
			if (temp[key] === null) delete temp[key];
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
			throw {
				status: 400,
				message: `Entity type ${entity_type} is not valid`,
			};
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
					} else if (typeof value === 'object') {
						(acc as any)[key] = JSON.stringify(value);
					} else {
						(acc as any)[key] = value;
					}
				}
				return acc;
			}, {}),
			json: JSON.stringify({
				...Object.entries(input_data).reduce((acc, [key, value]) => {
					if (!column_names.includes(key)) (acc as any)[key] = value;
					return acc;
				}, {}),
			}),
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
