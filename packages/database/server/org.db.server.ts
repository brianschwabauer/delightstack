import { DurableObject } from 'cloudflare:workers';
import { SqlServer } from './sql.server';
import {
	ApiError,
	apiError,
	encodeSearchCursor,
	generateID,
	parseSchema,
} from '@packages/lib';
import {
	ApiQuery,
	Org,
	EntityType,
	Entity,
	EntityDatabaseSchema,
	ENTITY,
	DATABASE_TABLES_RECORD,
	ORAMA_CONFIG,
	OramaConfig,
	Mutable,
	SparseEntityType,
	WebSocketEntityCreatedEvent,
	WebSocketEntityUpdatedEvent,
	WebSocketEntityDeletedEvent,
	EntitySearchParams,
	EntitySearchResponse,
	EntitySearchResults,
	EntitySearchSyncRequest,
	EntitySearchSync,
	SqliteDatabaseColumnDefinition,
	DATABASE_CONFIGS,
	SqliteConfig,
	SparseEntity,
	WebSocketIndexSyncEvent,
} from '@packages/types';
import { SqlEntityQuery, SqlTableRow } from './sql.helper';
import {
	create as createOrama,
	getByID as getByIdFromOrama,
	removeMultiple as removeMultipleIntoOrama,
	insertMultiple as insertMultipleIntoOrama,
	insert as insertIntoOrama,
	load as loadOrama,
	search as searchOrama,
	Orama,
	RawData,
	save as saveOrama,
} from '@orama/orama';

/** A database schema tables affiliate with an organization (durable object sqlite) */
export type OrgDatabaseSchema = {
	state: {
		id: string;
		org_id?: string;
		json: string;
		created_at: number;
		updated_at: number;
	};
};

type OrgDatabaseServerState = Omit<OrgDatabaseSchema['state'], 'json'> & {
	json: {
		/** The org's information */
		org?: Org;
		/** A record of table names and their current schema versions. Used to check if each table needs to be updated/created */
		table_version?: Record<string, number>;
		/**
		 * A list of changes that the user has made, but they haven't been saved into KV yet.
		 * This is necessary because we want strong consistency and if the durable object crashes
		 * before saving to KV we need to be able to replay the changes
		 */
		unconfirmed_changes?: ({
			/** The type of entity that was changed */
			entity_type: string;
			/** The ID of the entity that was changed */
			entity_id: string;
		} & (
			| {
					/** The epoch timestamp in ms when the entity was deleted */
					deleted_at: number;
			  }
			| {
					/** The updated entity data (used for creates/updates) */
					entity: any;
			  }
		))[];
	};
};

/** A record of search indexes that can be used to search using the Orama library */
type OrgDatabaseServerIndexes = {
	[EntityType in Mutable<keyof typeof ORAMA_CONFIG>]?: {
		config: OramaConfig;
		orama: Orama<(typeof ORAMA_CONFIG)[EntityType]['schema']>;
		/** The epoch timestamp in ms when the last event occurred for this entity. Includes 'delete' timestamps */
		last_updated_at: number;
		/**
		 * A record of entity ids and the epoch timestamp in ms when they were deleted
		 * This is neccessary to sync deleted entities to other clients
		 */
		deleted: Record<string, number>;
	};
};

/** A Durable Object for handling database requests */
export class OrgDatabaseServer extends DurableObject {
	private sql = new SqlServer<EntityDatabaseSchema & OrgDatabaseSchema>(this.ctx.storage);
	#org_id: string | undefined;
	#ws_id: DurableObjectId | undefined;
	#state: OrgDatabaseServerState | undefined;
	#org: Org | undefined;

	/** The ID of the organization this server is interacting with  */
	private get org_id() {
		if (this.#org_id) return this.#org_id;
		throw apiError({
			status: 500,
			message: `No org_id found in Durable Object. Use updateOrg() to add it to this durable object`,
		});
	}

	/** The instance of the durable object that can be used to broadcast messages to all websocket listeners */
	private get ws() {
		if (!this.#ws_id) this.#ws_id = this.env.WS.idFromName(this.org_id);
		return this.env.WS.get(this.#ws_id);
	}

	constructor(
		ctx: DurableObjectState,
		protected env: Env,
	) {
		super(ctx, env);
		this.initializeDB();
	}

	/** The fetch event handler that should only be called in protected environments */
	async fetch(input: string | URL | Request, init?: RequestInit) {
		const url = input instanceof Request ? new URL(input.url) : new URL(input);
		const method = input instanceof Request ? input.method : init?.method || 'GET';
		if (url.pathname === '/rpc' && method === 'POST') {
			const body: any = await (input instanceof Request ? input.json() : init?.body);
			if (body?.method && body?.args && body.method in this) {
				try {
					const result = (this as any)[body.method](...body.args);
					const response = result instanceof Promise ? await result : result;
					return new Response(JSON.stringify(response), {
						headers: { 'content-type': 'application/json' },
					});
				} catch (error: any) {
					const responseError = ApiError.from(error);
					return new Response(responseError.toJSON(), {
						status: responseError.status || 500,
						headers: { 'content-type': 'application/json' },
					});
				}
			}
		}
		return new Response(JSON.stringify({ status: 404, message: 'Not found' }), {
			status: 404,
		});
	}

	/**
	 * Gets the entity with the given id
	 * An array of expand fields can be provided to expand the entity with the given fields
	 * @example expand: ['creator_id'] -> adds the full creator data to the entity in {expanded: {creator_id: {...}}}
	 */
	async get<Type extends EntityType>(
		entity: Type,
		id: string,
		expand?: string[],
	): Promise<Entity<Type>> {
		const parser = ENTITY[entity];
		if (!parser) {
			throw apiError({
				status: 501,
				message: `Get operation not implemented for ${entity}`,
			});
		}
		let data: Entity<Type> = this.sql.get(entity, id);
		try {
			data = { ...data, ...JSON.parse(data.json || '{}') };
			delete data.json;
			for (const key in data) {
				if (data[key] === null) delete data[key];
			}
		} catch (error) {}
		data = parseSchema(parser, data);

		let expanded: Record<string, any> | undefined;
		if (expand?.length) {
			expand.forEach((field) => {
				if (!field || !(field in data)) return;
				const table = DATABASE_TABLES_RECORD[entity];
				if (!table) return;
				const column = table[field as keyof typeof table];
				if (!column) return;
				const sqlStatement = column as SqliteDatabaseColumnDefinition;
				const referencedMatch = sqlStatement.match(/REFERENCES\s+(\w+)\s*\((\w+)\)/);
				if (!referencedMatch) return;
				const referencedTable = referencedMatch[1] as keyof EntityDatabaseSchema;
				const referencedColumn = referencedMatch[2];
				try {
					const results = this.sql.query(referencedTable, {
						limit: 1,
						where: {
							key: referencedColumn as any,
							is: '=',
							value: (data as any)[field],
						},
					});
					let referencedData = results.next()?.value;
					if (!referencedData) return;
					referencedData = {
						...referencedData,
						...JSON.parse(referencedData.json || '{}'),
					};
					delete referencedData?.json;
					if (!expanded) expanded = {};
					expanded[field] = referencedData;
				} catch (error) {
					// ignore
				}
			});
		}
		if (expanded) return { ...data, expanded };
		return data;
	}

	/** Creates the entity with the given data */
	async create<
		Type extends EntityType,
		InputData extends Omit<Entity<EntityType>, 'id' | 'created_at' | 'updated_at'>,
		OutputData extends Entity<EntityType>,
	>(
		entity_type: Type,
		unsafe_data: InputData,
		event?: { event_id?: string; user_id: string },
	): Promise<OutputData> {
		if (!unsafe_data) throw apiError({ status: 400, message: 'No data given' });
		const parser = ENTITY[entity_type];
		if (!parser || !DATABASE_TABLES_RECORD[entity_type]) {
			throw apiError({
				status: 501,
				message: `Create operation not implemented for ${entity_type}`,
			});
		}
		delete (unsafe_data as any).id;
		delete (unsafe_data as any).created_at;
		delete (unsafe_data as any).updated_at;
		const id = generateID();
		const now = Date.now();
		const data: Entity<Type> = parseSchema(parser, {
			...unsafe_data,
			id,
			created_at: now,
			updated_at: now,
		});
		data.id = id;
		const columnNames = Object.keys(DATABASE_TABLES_RECORD[entity_type]);
		const db_data = {
			...Object.entries(data).reduce((acc, [key, value]) => {
				if (columnNames.includes(key)) (acc as any)[key] = value;
				return acc;
			}, {}),
			json: JSON.stringify({
				...Object.entries(data).reduce((acc, [key, value]) => {
					if (!columnNames.includes(key)) (acc as any)[key] = value;
					return acc;
				}, {}),
			}),
		};
		await this.initIndexes();
		this.sql.transaction(() => {
			this.sql.insert(entity_type, <any>id, <any>db_data);
			this.onEntityChange({
				event: 'entity:created',
				event_id: event?.event_id,
				entity_type,
				entity_id: data.id,
				entity: data,
				user_id: event?.user_id || '',
			});
		});
		return data as OutputData;
	}

	/** Updates the entity with the given id and data */
	async update<
		Type extends EntityType,
		InputData extends Omit<Entity<EntityType>, 'id' | 'created_at' | 'updated_at'>,
		OutputData extends Entity<EntityType>,
	>(
		entity_type: Type,
		id: string,
		unsafe_data: InputData,
		event?: { event_id?: string; user_id: string },
	): Promise<OutputData> {
		if (!unsafe_data) throw apiError({ status: 400, message: 'No updates given' });
		const parser = ENTITY[entity_type];
		if (!parser || !DATABASE_TABLES_RECORD[entity_type]) {
			throw apiError({
				status: 501,
				message: `Update operation not implemented for ${entity_type}`,
			});
		}
		delete (unsafe_data as any).id;
		delete (unsafe_data as any).created_at;
		delete (unsafe_data as any).updated_at;
		const current_data = this.sql.get(entity_type, id);
		for (const key in current_data) {
			if (current_data[key] === null) delete current_data[key];
		}
		const data: Entity<Type> = parseSchema(parser, {
			...current_data,
			...unsafe_data,
			updated_at: Date.now(),
		});
		data.id = id;
		const columnNames = Object.keys(DATABASE_TABLES_RECORD[entity_type]);
		const db_data = {
			...Object.entries(data).reduce((acc, [key, value]) => {
				if (columnNames.includes(key)) (acc as any)[key] = value;
				return acc;
			}, {}),
			json: JSON.stringify({
				...Object.entries(data).reduce((acc, [key, value]) => {
					if (!columnNames.includes(key)) (acc as any)[key] = value;
					return acc;
				}, {}),
			}),
		};
		await this.initIndexes();
		this.sql.transaction(() => {
			this.sql.update(entity_type, <any>id, <any>db_data);
			this.onEntityChange({
				event: 'entity:updated',
				event_id: event?.event_id,
				entity_type,
				entity_id: data.id,
				entity: data,
				user_id: event?.user_id || '',
			});
		});
		return data as OutputData;
	}

	/** Deletes the entity with the given id */
	async delete<Type extends EntityType>(
		entity_type: Type,
		id: string,
		event?: { event_id?: string; user_id: string },
	) {
		if (!DATABASE_TABLES_RECORD[entity_type]) {
			throw apiError({
				status: 501,
				message: `Delete operation not implemented for ${entity_type}`,
			});
		}
		const current_entity = await this.get(entity_type, id);
		await this.initIndexes();
		this.sql.transaction(() => {
			this.sql.delete(entity_type, id);
			this.onEntityChange({
				event: 'entity:deleted',
				event_id: event?.event_id,
				entity_type,
				entity_id: id,
				user_id: event?.user_id || '',
				entity: current_entity,
			});
		});
	}

	/** Queries the 'sparse' orama database for the entities that match the given query */
	async listSparse<Type extends SparseEntityType>(
		entity_type: Type,
		query?: EntitySearchParams<Type>,
	): Promise<EntitySearchResults<Type>> {
		const index = await this.getIndex(entity_type);
		if (!index) {
			throw apiError({
				status: 501,
				message: `Search not implemented for ${entity_type}`,
			});
		}
		const defaultSortBy = index.config.schema.updated_at
			? ({ property: 'updated_at', order: 'DESC' } as const)
			: undefined;
		let results = searchOrama(
			index.orama,
			query || { limit: 100, sortBy: defaultSortBy },
		);
		if (results instanceof Promise) results = await results;
		return results;
	}

	/** Lists the entities from the database with the given query */
	listFull<
		Type extends EntityType,
		Data extends SqlTableRow<EntityDatabaseSchema, Type>,
		Query extends SqlEntityQuery<Data>,
	>(entity_type: Type, query: Query): Data[] {
		if (!DATABASE_TABLES_RECORD[entity_type]) {
			throw apiError({
				status: 501,
				message: `List operation not implemented for ${entity_type}`,
			});
		}
		const results = this.sql.list(entity_type, {
			...(query as any),
			limit: Math.min(100, query?.limit || 20),
		});
		return results as Data[];
	}

	/** Returns a list of changes that have happened to all entities since the given epoch timestamp (in ms) */
	async listChanges(query?: EntitySearchSyncRequest): Promise<EntitySearchSync> {
		await this.initIndexes();
		if (!this.#indexes) {
			throw apiError({
				status: 500,
				message: `Couldn't find any indexes to list changes from`,
			});
		}

		const results: EntitySearchSync = {
			start_updated_at: query?.start_updated_at || 0,
			end_updated_at: query?.end_updated_at || 0,
			first_updated_at: 0,
			last_updated_at: 0,
			entity: {},
		};

		// Find the entity types the user is requesting to get changes for
		const entity_types_to_sync = Object.keys(this.#indexes).filter((_entity_type) => {
			const entity_type = _entity_type as SparseEntityType;
			if (query?.entity && !(entity_type in query.entity)) return false;
			return true;
		}) as SparseEntityType[];

		// Add the changes to the results for each entity type
		for (const entity_type of entity_types_to_sync) {
			const index = this.#indexes[entity_type];
			if (!index) continue;
			const orama = index.orama;
			const limit = Math.min(
				5000,
				query?.entity?.[entity_type]?.limit || query?.limit || 5000,
			);
			const from =
				query?.entity?.[entity_type]?.start_updated_at ?? query?.start_updated_at ?? 0;
			const to =
				query?.entity?.[entity_type]?.end_updated_at ??
				query?.end_updated_at ??
				Number.MAX_SAFE_INTEGER;
			const schema_changed =
				query?.entity?.[entity_type]?.schema_version !== undefined &&
				query?.entity?.[entity_type]?.schema_version !== index.config.version;
			const descending =
				schema_changed ||
				(query?.entity?.[entity_type]?.start_updated_at ?? query?.start_updated_at) ===
					undefined;

			// Get the list of changes from the orama index between the from/to timestamps
			let result = searchOrama(orama, {
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
			result = result instanceof Promise ? await result : result;
			const inserts = result.hits.map((hit) => hit.document);

			// Get the list of deleted entities from the index between the from/to timestamps
			const deletes = Object.entries(index.deleted).reduce((acc, [id, time]) => {
				if (time > from && time <= to) acc.push(id);
				return acc;
			}, [] as string[]);

			// Find the first and last updated_at timestamps from the index
			let first_entity = searchOrama(orama, {
				limit: 1,
				sortBy: {
					property: 'updated_at',
					order: 'ASC',
				},
			});
			first_entity = first_entity instanceof Promise ? await first_entity : first_entity;
			let last_entity = searchOrama(orama, {
				limit: 1,
				sortBy: {
					property: 'updated_at',
					order: 'DESC',
				},
			});
			last_entity = last_entity instanceof Promise ? await last_entity : last_entity;

			// Add the entity data to the results
			const first_updated_at = first_entity.hits[0]?.document?.updated_at || 0;
			const last_updated_at = Math.max(
				last_entity.hits[0]?.document?.updated_at || 0,
				...Object.values(index.deleted),
			);
			const start_updated_at = Math.min(
				...deletes.map((id) => index.deleted[id]),
				...inserts.map((insert) => insert.updated_at),
			);
			const end_updated_at = Math.max(
				...deletes.map((id) => index.deleted[id]),
				...inserts.map((insert) => insert.updated_at),
			);
			results.entity[entity_type] = {
				deletes,
				inserts,
				schema_version: index.config.version,
				first_updated_at,
				last_updated_at,
				start_updated_at,
				end_updated_at,
				config: schema_changed
					? {
							schema: index.config.schema,
							version: index.config.version,
							sort: index.config.sort,
						}
					: undefined,
			};
		}
		results.first_updated_at = Math.min(
			...Object.values(results.entity).map((entity) => entity.first_updated_at),
		);
		results.last_updated_at = Math.max(
			0,
			...Object.values(results.entity).map((entity) => entity.last_updated_at),
		);
		results.start_updated_at = Math.min(
			...Object.values(results.entity).map((entity) => entity.start_updated_at),
		);
		results.end_updated_at = Math.max(
			0,
			...Object.values(results.entity).map((entity) => entity.end_updated_at),
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
	 * If the 'sparse' field in the query is true, it will use the sparse search index
	 * If the 'sparse' field in the query is false, it will use the full values from the database
	 */
	async list<
		Type extends SparseEntityType | EntityType,
		Query extends Partial<ApiQuery>,
		Sparse extends Query['sparse'] extends true
			? Type extends SparseEntityType
				? true
				: false
			: false,
		Output extends EntitySearchResponse<Type, Sparse>,
	>(entity_type: Type, raw_query: Query): Promise<Output> {
		await this.initIndexes();
		const index =
			this.#indexes && entity_type in this.#indexes
				? this.#indexes[entity_type as SparseEntityType]
				: undefined;
		const sparse = raw_query.sparse || !!raw_query.term;
		const query = {
			order: [{ key: 'updated_at', direction: 'DESC' }],
			...raw_query,
			limit: Math.max(
				1,
				Math.min(raw_query.limit || (sparse ? 100 : 10), sparse ? 5000 : 100),
			),
			sparse,
		};
		const databaseProperties = Object.entries(DATABASE_TABLES_RECORD[entity_type]).reduce(
			(acc, [key, value]) => {
				const sqlStatement = value as SqliteDatabaseColumnDefinition;
				const sqlOperation = sqlStatement.replace(/\s.*$/, '');
				switch (sqlOperation) {
					case 'INTEGER':
					case 'REAL':
					case 'NUMERIC':
						acc[key] = 'number';
						break;
					case 'BOOLEAN':
						acc[key] = 'boolean';
						break;
					case 'BLOB':
					case 'NULL':
						break;
					default:
						acc[key] = 'string';
				}
				return acc;
			},
			{} as Record<string, 'number' | 'string' | 'boolean'>,
		);
		const sortableProperties =
			index?.orama?.data?.sorting?.sortablePropertiesWithTypes || databaseProperties;
		const searchableProperties =
			index?.orama?.data?.index?.searchablePropertiesWithTypes || databaseProperties;
		const queryProperties = Array.from(
			new Set(Object.keys({ ...searchableProperties, ...sortableProperties })),
		);
		query.order.forEach((order) => {
			if (!queryProperties.includes(order.key)) {
				throw apiError({
					status: 400,
					message: `Invalid order key ${order.key}. Must be one of ${queryProperties.join(', ')}.`,
				});
			}
		});
		query.where?.forEach((where) => {
			if (!queryProperties.includes(where.key)) {
				throw apiError({
					status: 400,
					message: `Invalid where key ${where.key}. Must be one of ${queryProperties.join(', ')}.`,
				});
			}
		});

		/** Generates a cursor based on the last item in the query result list */
		const generateCursor = (last_item: any) => {
			if (!last_item) return;
			const where = query.where || [];
			let updated_where = false;
			query.order.forEach((order) => {
				const type = sortableProperties[order.key];
				if (type === 'number' || type === 'string') {
					const new_where: ApiQuery['where'][number] = {
						key: order.key,
						is: order.direction === 'ASC' ? '>' : '<',
						value: last_item[order.key],
					};
					const existing = where.find(
						(w) => w.key === order.key && w.is === new_where.is,
					);
					if (!existing) where.push(new_where);
					else existing.value = new_where.value;
					updated_where = true;
				}
			});
			return updated_where ? encodeSearchCursor({ ...query, where }) : undefined;
		};

		if (query.sparse && index) {
			const result = await this.listSparse(entity_type as SparseEntityType, {
				limit: query.limit,
				offset: query.offset,
				term: query.term,
				sortBy: query.order?.[0]?.key
					? {
							property: query.order[0].key,
							order: query.order[0].direction.toUpperCase() as 'ASC' | 'DESC',
						}
					: undefined,
				where: query.where?.length
					? query.where.reduce(
							(acc, where) => {
								const type =
									searchableProperties[where.key] || sortableProperties[where.key];
								if (!type) return acc;
								if (type !== 'number') {
									(acc as any)[where.key] = where.value;
									return acc;
								}
								if ((acc as any)[where.key]) {
									if (where.is === '=') {
										(acc as any)[where.key] = { eq: where.value };
									} else if (where.is === '<' || where.is === '<=') {
										if ((acc as any)[where.key].gt || (acc as any)[where.key].gte) {
											(acc as any)[where.key].between = [
												(acc as any)[where.key].gt || (acc as any)[where.key].gte,
												where.value,
											];
											delete (acc as any)[where.key].gt;
											delete (acc as any)[where.key].gte;
										}
									} else if (where.is === '>' || where.is === '>=') {
										if ((acc as any)[where.key].lt || (acc as any)[where.key].lte) {
											(acc as any)[where.key].between = [
												where.value,
												(acc as any)[where.key].lt || (acc as any)[where.key].lte,
											];
											delete (acc as any)[where.key].lt;
											delete (acc as any)[where.key].lte;
										}
									}
									return acc;
								}
								if (where.is === '=') {
									(acc as any)[where.key] = { eq: where.value };
								} else if (where.is === '<') {
									(acc as any)[where.key] = { lt: where.value };
								} else if (where.is === '<=') {
									(acc as any)[where.key] = { lte: where.value };
								} else if (where.is === '>') {
									(acc as any)[where.key] = { gt: where.value };
								} else if (where.is === '>=') {
									(acc as any)[where.key] = { gte: where.value };
								}
								return acc;
							},
							{} as NonNullable<EntitySearchParams<SparseEntityType>['where']>,
						)
					: undefined,
			});
			return {
				count: result.count,
				list: result.hits.map((hit) => {
					if (query.select?.length) {
						const selected: any = {};
						query.select.forEach((key) => {
							selected[key] = hit.document[key as keyof typeof hit.document];
						});
						return selected;
					}
					return hit.document;
				}),
				hasMore: result.hits.length >= query.limit,
				cursor:
					result.hits.length >= query.limit
						? generateCursor(result.hits[result.hits.length - 1]?.document)
						: undefined,
			} as Output;
		}

		// The query is not sparse, so we can use the full database
		const results = this.listFull(entity_type, {
			limit: query.limit,
			offset: query.offset,
			select: query.select as any,
			order: query.order.map((order) => ({
				key: order.key as any,
				direction: order.direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC',
			})),
			where: !query.where?.length ? undefined : { and: query.where as any },
		});
		return {
			count: results.length,
			list: results.map((data) => {
				for (const key in data) {
					if (data[key] === null) delete data[key];
				}
				const parsed = parseSchema(ENTITY[entity_type], {
					...data,
					...JSON.parse(data.json || '{}'),
				});
				return parsed;
			}),
			hasMore: results.length >= query.limit,
			cursor:
				results.length >= query.limit
					? generateCursor(results[results.length - 1])
					: undefined,
		} as Output;
	}

	/** Returns the latest org data */
	getOrg() {
		if (!this.#org) {
			throw apiError({
				status: 500,
				message: `No org found in Durable Object. Use updateOrg() to add it to this durable object`,
			});
		}
		return this.#org;
	}

	/** Updates the org with the given data and saves it to the database */
	async updateOrg(data: Partial<Org>, event?: { event_id?: string; user_id: string }) {
		if (this.#org) {
			this.#org = {
				...this.#org,
				...data,
				created_at: this.#org.created_at,
				updated_at: data.updated_at || Date.now(),
			};
			Object.keys(data).forEach((key) => {
				if ((data as any)[key] === null) {
					delete (this.#org as any)[key];
				}
			});
		} else {
			if (!data.id)
				throw apiError({ message: 'Org ID is required to initialize organization' });
			if (!data.name) {
				throw apiError({
					message: 'Organization name is required to initialize organization',
				});
			}
			if (data.capability === undefined) {
				throw apiError({
					message: 'Organization capability is required to initialize organization',
				});
			}
			if (data.storage_usage === undefined) {
				throw apiError({
					message: 'Organization storage_usage is required to initialize organization',
				});
			}
			if (data.storage === undefined) {
				throw apiError({
					message: 'Organization storage is required to initialize organization',
				});
			}
			this.#org = {
				...(data as Org),
				created_at: Date.now(),
				updated_at: data.updated_at || Date.now(),
			};
		}
		this.#org_id = this.#org.id || this.#org_id!;
		const auth = this.env.AUTH.get(this.env.AUTH.idFromName('main'));
		await auth.updateOrg(this.#org_id!, {
			name: this.#org.name,
			json: JSON.stringify(this.#org),
		});
		this.ws.broadcast({
			event: 'entity:updated',
			event_id: event?.event_id,
			entity_type: 'org',
			entity_id: this.#org.id,
			entity: this.#org,
			user_id: event?.user_id || '',
		});
		this.saveState();
	}

	/** Deletes all the database tables and org data. @dangerous */
	deleteOrg() {
		const tables = this.sql
			.run(
				(sql) =>
					sql`SELECT * FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
			)
			.toArray();
		this.sql.run(() => {
			return {
				query: `PRAGMA foreign_keys = OFF; ${tables.map((v) => `DROP TABLE IF EXISTS ${v.name}`).join('; ')}; PRAGMA foreign_keys = ON;`,
				values: [],
				__safelyInterpretedSql__: true,
			};
		});
		this.#state = undefined;
		this.#org = undefined;
		this.#org_id = undefined;
		this.#ws_id = undefined;
	}

	/** Restores the database to the given timestamp (if a number) or bookmark (if a string). @dangerous */
	async restore(timestampOrBookmark: number | string) {
		const undo_bookmark = await this.sql.restore(timestampOrBookmark);
		this.ctx.abort(`Restored database to ${undo_bookmark}`);
		return undo_bookmark;
	}

	/** Runs the given SQL statement directly on the database. @dangerous */
	__dangerouslyRunSql__(sql_statement: string) {
		const result = this.sql.run(() => {
			return {
				query: sql_statement,
				values: [],
				__safelyInterpretedSql__: true,
			};
		});
		return { results: result.toArray() };
	}

	/**
	 * Called anytime an entity changes. Used to update search indexes and broadcast events
	 * IMPORTANT: This function is called in a transaction, so it must be synchronous
	 * The indexes should be loaded (via this.loadIndexes()) before this function is called
	 */
	private onEntityChange(
		event:
			| WebSocketEntityCreatedEvent
			| WebSocketEntityUpdatedEvent
			| WebSocketEntityDeletedEvent,
	) {
		const operation =
			event.event === 'entity:created'
				? 'create'
				: event.event === 'entity:updated'
					? 'update'
					: 'delete';
		const time =
			(operation === 'delete' ? undefined : event.entity?.updated_at) || Date.now();
		const last_updated_at = time;
		const previous_updated_at = Math.max(
			0,
			...Object.values(this.#indexes || {}).map((index) =>
				typeof index.last_updated_at === 'number' && isFinite(index.last_updated_at)
					? index.last_updated_at
					: 0,
			),
		);
		const index = this.#indexes?.[event.entity_type as SparseEntityType];

		// If the index doesn't exist, this must be an entity that doesn't support searching via orama
		if (!index) {
			// Broadcast the event to all clients
			this.ws.broadcast(event);
			return;
		}

		index.last_updated_at = last_updated_at;
		if (operation === 'delete') {
			if (!index.deleted) index.deleted = {};
			index.deleted[event.entity_id] = time;
		}

		// Save the unconfirmed changes to the SQL database for strong consistency
		// Eventually, when the 'alarm' is triggered, the unsaved changes will be removed from the state/sql db
		// and saved to the KV database
		if (this.#state) {
			if (!this.#state.json.unconfirmed_changes) {
				this.#state.json.unconfirmed_changes = [];
			}
			const already_added_to_state = this.#state.json.unconfirmed_changes.some(
				(v) => (v.entity_type === event.entity_type && v.entity_id) === event.entity_id,
			);
			if (!already_added_to_state) {
				this.#state.json.unconfirmed_changes.push({
					entity_type: event.entity_type,
					entity_id: event.entity_id,
					...(operation === 'delete' || !('entity' in event)
						? { deleted_at: time }
						: { entity: event.entity }),
				});
			}
			this.saveState();
		}

		const sparse_entities = this.getSparseEntitiesFromEvent(
			event.entity_type as SparseEntityType,
			operation,
			event.entity_id,
			event.entity,
		);
		const sync_entity: WebSocketIndexSyncEvent['entity'] = {};
		for (const sparse_entity of sparse_entities || []) {
			const index = this.#indexes?.[sparse_entity.entity_type];
			if (!index) continue;
			if (!sync_entity[sparse_entity.entity_type]) {
				sync_entity[sparse_entity.entity_type] = {
					schema_version: index.config.version,
					deletes: [],
					inserts: [],
				};
			}

			// This index was updated, so we need to update the last_updated_at timestamp
			index.last_updated_at = Math.max(
				index.last_updated_at || 0,
				sparse_entity.operation === 'delete'
					? time
					: sparse_entity.entity.updated_at || 0,
			);

			if (sparse_entity.operation === 'delete' || sparse_entity.operation === 'update') {
				// Remove the entities from the index that were deleted or updated
				const already_added_to_deletes = sync_entity[
					sparse_entity.entity_type
				]!.deletes.includes(sparse_entity.entity_id);
				if (!already_added_to_deletes) {
					sync_entity[sparse_entity.entity_type]!.deletes.push(sparse_entity.entity_id);
				}
				removeMultipleIntoOrama(index.orama, [sparse_entity.entity_id]);
			}

			// Insert the entities into the index that were created or updated
			if (sparse_entity.operation === 'create' || sparse_entity.operation === 'update') {
				const already_added_to_inserts = sync_entity[
					sparse_entity.entity_type
				]!.inserts.some((e: any) => e.id === sparse_entity.entity_id);
				if (!already_added_to_inserts) {
					sync_entity[sparse_entity.entity_type]!.inserts.push(sparse_entity.entity);
				}
				insertIntoOrama(index.orama, sparse_entity.entity);
			}
		}

		// Broadcast the event to all clients
		this.ws.broadcast(event);

		if (sparse_entities?.length) {
			// Save the indexes to KV in 10 seconds (to prevent a ton of unnecessary writes)
			this.delaySaveIndexesToKv();
			// Broadcast the sync event to all clients
			this.ws.broadcast({
				event: 'index:sync',
				event_id: event.event_id,
				user_id: event.user_id,
				previous_updated_at,
				last_updated_at,
				entity: sync_entity,
			} satisfies WebSocketIndexSyncEvent);
		}
	}

	/** Returns a list of sparse entities that have changed when the given event occurs */
	private getSparseEntitiesFromEvent<Type extends keyof typeof ORAMA_CONFIG>(
		entity_type: Type,
		operation: 'create' | 'update' | 'delete',
		entity_id: string,
		entity: Entity<Type>,
	) {
		type UpdatedSparseEntity<T extends SparseEntityType> = {
			entity_type: T;
			entity: SparseEntity<T>;
			entity_id: string;
			operation: 'create' | 'update' | 'delete';
		};

		// Get the list of foreign entities that need to be updated based on this event
		const foreign_entities: UpdatedSparseEntity<SparseEntityType>[] = [];
		for (const _foreign_table in ORAMA_CONFIG) {
			const foreign_entity_type = _foreign_table as SparseEntityType;
			// Skip the same entity type - it's handled above. We only need to handle foreign tables here
			if (foreign_entity_type === entity_type) continue;

			const foreign_index = ORAMA_CONFIG[foreign_entity_type];
			const foreign_orama = this.#indexes?.[foreign_entity_type]?.orama;
			if (!foreign_index?.transform || !foreign_orama) continue;

			// Loop through the fields of the foreign table to see if there are any that refer to this entity
			for (const _field in foreign_index.transform) {
				const foreign_field = _field as keyof typeof foreign_index.transform;
				const foreign_transform = foreign_index.transform[foreign_field] as NonNullable<
					OramaConfig['transform']
				>[string];
				if (!foreign_transform?.transform || !foreign_transform?.foreignKey) continue;
				if (foreign_transform.table !== entity_type) continue;

				// Find the ID of the foreign entity that needs to be updated because this entity changed
				const foreign_id = entity[foreign_transform.foreignKey];
				const existing_foreign_entity = foreign_entities.find(
					(foreign_entity) => foreign_entity.entity.id === foreign_id,
				);
				if (existing_foreign_entity) {
					(existing_foreign_entity.entity as any)[foreign_field] =
						foreign_transform.transform(entity, {
							operation,
							prev_sparse_entity: existing_foreign_entity,
						});
					(existing_foreign_entity.entity as any).updated_at = Math.max(
						0,
						entity.updated_at || 0,
						(existing_foreign_entity.entity as any).updated_at || 0,
					);
					continue;
				}

				// Get the latest version of the foreign entity from the orama index
				const foreign_entity = getByIdFromOrama(foreign_orama, foreign_id);
				if (!foreign_entity) continue;
				(foreign_entity as any)[foreign_field] = foreign_transform.transform(entity, {
					operation,
					prev_sparse_entity: foreign_entity,
				});
				(foreign_entity as any).updated_at = Math.max(
					0,
					entity.updated_at || 0,
					(foreign_entity as any).updated_at || 0,
				);
				foreign_entities.push({
					entity_type: foreign_entity_type,
					entity: foreign_entity,
					operation: 'update',
					entity_id: foreign_id,
				});
			}
		}

		// If the entity is being deleted, we don't need to update it in the index
		// But there might be foreign entities that need to be updated based on this deletion
		const index = this.#indexes?.[entity_type];
		if (operation === 'delete' || !index) return foreign_entities;

		// Remove the keys that are not in the sparse entity type
		const sparse_entity = { ...entity } as SparseEntity<Type>;
		const prev_sparse_entity = getByIdFromOrama(index.orama, entity_id);
		Object.keys(sparse_entity).forEach((key) => {
			if (!index.config.schema[key]) delete (sparse_entity as any)[key];
		});

		// Transform the keys of the sparse entity based on the index config
		Object.keys(index.config.transform || {}).forEach((_key) => {
			const key = _key as keyof SparseEntity<SparseEntityType>;
			if (
				index.config.transform?.[key]?.transform &&
				!index.config.transform[key].table &&
				!index.config.transform[key].foreignKey
			) {
				sparse_entity[key] = index.config.transform![key].transform(entity, {
					operation,
					prev_sparse_entity,
				});
			}
		});
		return [
			{ entity_type, entity: sparse_entity, entity_id, operation },
			...foreign_entities,
		] as UpdatedSparseEntity<SparseEntityType>[];
	}

	/** A record of search indexes that can be used to search using the Orama library */
	#indexes: OrgDatabaseServerIndexes | undefined = undefined;

	/** Initializes and loads the orama search indexes */
	private async initIndexes() {
		if (this.#indexes) return;
		const encoded_indexes = await this.env.KV.getWithMetadata<
			{
				[EntityType in keyof typeof ORAMA_CONFIG]?: {
					config: OramaConfig;
					index: RawData;
					deleted: Record<string, number>;
				};
			},
			{ updated_at: number }
		>(`/api/org/${this.org_id}/index`, { type: 'json' });

		let indexesUpdated = false;
		for (const _type in encoded_indexes?.value || {}) {
			const type = _type as keyof typeof ORAMA_CONFIG;
			if (!ORAMA_CONFIG[type]) {
				// The index used to exist in KV for some reason, but has since been removed
				// from the config. This means we need to remove it from the indexes.
				indexesUpdated = true;
				continue;
			}
		}
		this.#indexes = Object.entries(ORAMA_CONFIG).reduce((acc, [key, value]) => {
			const type = key as keyof typeof ORAMA_CONFIG;
			acc[type] = {
				deleted: {},
				last_updated_at: 0,
				config: value,
				orama: createOrama({
					schema: value.schema,
					sort: value.sort,
				}) as any,
			};
			return acc;
		}, {} as OrgDatabaseServerIndexes);

		for (const _type in ORAMA_CONFIG) {
			const type = _type as keyof typeof ORAMA_CONFIG;
			const index = this.#indexes[type]!;
			const encoded_index = encoded_indexes?.value?.[type];
			const should_recreate_index =
				!encoded_index || ORAMA_CONFIG[type].version !== encoded_index.config.version;

			if (should_recreate_index) {
				// Recreate the index from the database by getting all the entities
				const { inserts, deletes } = this.createIndexFromScratch(type);
				if (deletes.length) removeMultipleIntoOrama(index.orama, deletes);
				if (inserts.length) insertMultipleIntoOrama(index.orama, inserts);
			} else {
				// Load the index from KV
				loadOrama(index.orama, encoded_index.index);
			}

			// Update the index with the list of unconfirmed changes
			const unconfirmed_changes = (this.#state?.json?.unconfirmed_changes || []).filter(
				(val) => val.entity_type === type,
			);
			const unconfirmed_deletes = unconfirmed_changes.filter(
				(val) => 'deleted_at' in val,
			);
			const unconfirmed_inserts = unconfirmed_changes.filter((val) => 'entity' in val);
			if (unconfirmed_deletes.length) {
				const deletes = unconfirmed_deletes.map((v) => v.entity_id);
				removeMultipleIntoOrama(index.orama, deletes);
			}
			if (unconfirmed_inserts.length) {
				const updates = unconfirmed_inserts.map((v) => v.entity_id);
				removeMultipleIntoOrama(index.orama, updates);
				const inserts = unconfirmed_inserts.map((v) => v.entity);
				insertMultipleIntoOrama(index.orama, inserts);
			}

			// Check if the index was updated. If so, we need to save it to KV
			if (
				unconfirmed_deletes.length ||
				unconfirmed_inserts.length ||
				should_recreate_index
			) {
				indexesUpdated = true;
			}

			// Get the last updated entity from the (not up-to-date) index
			let last_updated_entity = searchOrama(index.orama, {
				limit: 1,
				sortBy: {
					property: 'updated_at',
					order: 'DESC',
				},
			});
			last_updated_entity =
				last_updated_entity instanceof Promise
					? await last_updated_entity
					: last_updated_entity;

			// Get the record of deleted entity IDs from the previously saved index & the unsaved deletes
			const deleted = {
				...encoded_index?.deleted,
				...unconfirmed_deletes.reduce(
					(acc, v) => {
						acc[v.entity_id] = v.deleted_at;
						return acc;
					},
					{} as Record<string, number>,
				),
			};
			this.#indexes[type]!.deleted = deleted;
			this.#indexes[type]!.last_updated_at = Math.max(
				0,
				...Object.values(deleted),
				last_updated_entity?.hits?.[0]?.document?.updated_at || 0,
			);
		}
		if (indexesUpdated) this.ctx.waitUntil(this.saveIndexesToKv());
	}

	/** Creates the inserts/deletes needed to create an index of the given entity type */
	private createIndexFromScratch<Type extends keyof typeof ORAMA_CONFIG>(
		entity_type: Type,
	): { inserts: SparseEntity<Type>[]; deletes: string[] } {
		const entities = this.sql.list(entity_type, {
			limit: 100000,
		});
		const inserts: SparseEntity<Type>[] = [];
		const deletes: string[] = [];

		for (const item of entities) {
			const parser = ENTITY[entity_type];
			if (!parser) continue;
			let data: Entity<Type> = item;
			try {
				data = { ...data, ...JSON.parse(data.json || '{}') };
				delete data.json;
				data = parseSchema(parser, data);
			} catch (error) {
				continue;
			}
			const sparse_entities = this.getSparseEntitiesFromEvent(
				entity_type,
				'create',
				data.id,
				data,
			);
			sparse_entities?.forEach((sparse_entity) => {
				const operation = sparse_entity.operation;
				if (operation === 'delete' || operation === 'update') {
					deletes.push(sparse_entity.entity_id);
				}
				if (operation === 'create' || operation === 'update') {
					inserts.push(sparse_entity.entity as SparseEntity<Type>);
				}
			});
		}

		return { inserts, deletes };
	}

	/** Loads the current index data from KV */
	private async getIndex<EntityType extends keyof typeof ORAMA_CONFIG>(
		entity: EntityType,
	): Promise<undefined | OrgDatabaseServerIndexes[EntityType]> {
		await this.initIndexes();
		return this.#indexes?.[entity];
	}

	/** Sets an alarm to save the current indexes state to KV after 10 seconds */
	private delaySaveIndexesToKv() {
		if (this.env.DEV) {
			this.saveIndexesToKv();
		} else {
			this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now() + 1000 * 10));
		}
	}

	/**
	 * Saves the current index data to KV when the durable object is woken up from an alarm
	 * This is used to buffer the writes to KV and prevent a ton of unnecessary writes
	 * Instead of writing every time an entity is created, we write at most every 10 seconds
	 * by setting an alarm when a change is made
	 */
	async alarm(alarmInfo?: AlarmInvocationInfo): Promise<void> {
		await this.initIndexes();
		await this.saveIndexesToKv();
	}

	/** Saves the current index state to KV. Assumes that the index state is up to date */
	private async saveIndexesToKv() {
		await this.initIndexes();
		if (!this.#indexes) return;
		const indexes = Object.entries(this.#indexes).reduce(
			(acc, [key, value]) => {
				if (value) {
					(acc as any)[key] = {
						...value,
						orama: undefined,
						config: {
							version: value.config.version,
							schema: value.config.schema,
							sort: value.config.sort,
						},
						index: saveOrama(value.orama),
					};
				}
				return acc;
			},
			{} as {
				[EntityType in keyof typeof ORAMA_CONFIG]?: {
					config: OramaConfig;
					index: RawData;
					deleted?: Record<string, number>;
				};
			},
		);
		await this.env.KV.put(`/api/org/${this.org_id}/index`, JSON.stringify(indexes), {
			metadata: {
				updated_at: Date.now(),
			},
		});

		// Remove the unconfirmed changes from the state
		if (this.#state?.json?.unconfirmed_changes) {
			this.#state.json.unconfirmed_changes = undefined;
			this.saveState();
		}
	}

	/** Initializes the database by running the queries to get the necessary db schema */
	private initializeDB() {
		console.log('Initializing Org Database');
		this.sql.run(
			(sql) => sql`
				CREATE TABLE IF NOT EXISTS state (
					id TEXT PRIMARY KEY,
					org_id TEXT,
					json TEXT NOT NULL,
					created_at INTEGER NOT NULL,
					updated_at INTEGER NOT NUll
				);
			`,
		);
		let state;
		try {
			state = this.sql.get('state', 'main');
		} catch (error) {
			state = this.sql.insert('state', 'main', { json: '{}' });
		}
		this.#state = { ...state, json: JSON.parse(state.json) };
		this.#org_id = this.#state.org_id;
		this.#org = this.#state.json.org;

		// Upgrade the database to the latest schema if necessary
		let databaseTablesUpdated = false;
		DATABASE_CONFIGS.forEach((config) => {
			console.log('Upgrading database tables', config);
			(config.tables as SqliteConfig['tables']).forEach((table) => {
				console.log('Table:', table);
				if (
					!table.name ||
					table.version === this.#state!.json.table_version?.[table.name]
				)
					return;
				console.log(`Upgrading table ${table.name} to version ${table.version}`);
				const existingTableInfo = this.__dangerouslyRunSql__(
					`PRAGMA table_info(${table.name})`,
				);
				const existingColumns = existingTableInfo.results.map((column) => column.name);
				console.log(`Existing columns for ${table.name}: ${existingColumns.join(', ')}`);
				if (!existingColumns.length) {
					const columns = Object.keys(table.columns).map(
						(column) =>
							`${column} ${table.columns[column as keyof typeof table.columns]}`,
					);
					console.log(`Creating table ${table.name} (${columns.join(', ')})`);
					this.__dangerouslyRunSql__(
						`CREATE TABLE IF NOT EXISTS ${table.name} (${columns.join(', ')})`,
					);
					databaseTablesUpdated = true;
					return;
				}
				const addColumns = Object.keys(table.columns)
					.filter((column) => !existingColumns.includes(column))
					.map((column) => {
						const columnSqlStatement =
							table.columns[column as keyof (typeof table)['columns']];
						return `ALTER TABLE ${table.name} ADD COLUMN ${column} ${columnSqlStatement}`;
					});
				if (addColumns.length) {
					console.log(`Adding columns to ${table.name}`, addColumns);
					this.sql.transaction(() => {
						addColumns.forEach((addColumn) => {
							this.__dangerouslyRunSql__(addColumn);
						});
					});
					databaseTablesUpdated = true;
				}
			});
			(config.indexes as SqliteConfig['indexes']).forEach((index) => {
				if (
					!index.name ||
					index.version === this.#state!.json.table_version?.[index.name]
				)
					return;
				console.log(
					`Creating index ${index.name} ${index.table}(${index.columns.join(', ')})`,
				);
				const unique = (index as SqliteConfig['indexes'][number]).unique ? ' UNIQUE' : '';
				this.__dangerouslyRunSql__(
					`DROP INDEX IF EXISTS ${index.name};
					CREATE INDEX ${index.name} ON ${index.table} (${index.columns.join(', ')})${unique};`,
				);
				databaseTablesUpdated = true;
			});
		});

		// Update the state with the new table versions
		if (databaseTablesUpdated) {
			this.#state.json = {
				...this.#state.json,
				table_version: {
					...this.#state.json.table_version,
					...Object.fromEntries(
						DATABASE_CONFIGS.flatMap((config) =>
							config.tables?.map((table) => [table.name, table.version]),
						),
					),
				},
			};
			console.log('Updated tables', this.#state);
			this.saveState();
		}
	}

	/** Saves the current org state to the database. This should be called on any updates to the org */
	private saveState() {
		if (!this.#state) return;
		this.sql.update('state', 'main', {
			org_id: this.#org_id,
			json: JSON.stringify(this.#state.json),
		});
	}
}
