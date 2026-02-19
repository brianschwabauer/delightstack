import {
	SqlDatabaseSchema,
	SqlEntityQueryResultData,
	SqlTable,
	SqlTableRow,
} from './sql.helper';
import { prepareSql, SqlEntityQuery, SqlQueryFn } from './sql.helper';
import { generateTimestampID } from '@delightstack/utilities';

/** A helper class for writing/getting data to/from CloudFlare D1 using SQL commands */
export class SqlServer<Schema extends SqlDatabaseSchema = SqlDatabaseSchema> {
	constructor(private storage: DurableObjectStorage) {}

	/**
	 * Creates a new row with the given data in the given table.
	 * Uses the given ID if provided, otherwise generates a new one.
	 * If 'null' is given as an ID, it will use the table's auto-increment feature.
	 * @returns the ID of the newly created item
	 */
	insert<
		Table extends SqlTable<Schema>,
		TableData extends SqlTableRow<Schema, Table>,
		NullableData extends {
			[key in keyof TableData]: TableData[key] extends NonNullable<TableData[key]>
				? TableData[key]
				: TableData[key] | null;
		},
		Data extends Omit<NullableData, 'id' | 'created_at' | 'updated_at'> & {
			created_at?: number;
			updated_at?: number;
		},
		ID extends TableData['id'] extends string
			? string | undefined
			: TableData['id'] extends number
				? number | null
				: string | number | undefined,
	>(table: Table, id: ID, data: Data) {
		// Sanitize the table name (this shouldn't be necessary because 'table' should be trustworthy)
		// We're doing this just to be safe and for peace of mind
		const sanitizedTable = (table || '').toLowerCase().replace(/[^a-z_]/g, '');
		if (!sanitizedTable) {
			throw { status: 400, message: 'Missing database table name' };
		}
		const updates = Object.entries({
			...data,
			created_at: data.created_at || Date.now(),
			updated_at: data.updated_at || Date.now(),
		})
			.map(([key, value]) => {
				if (key === undefined || value === undefined) return;
				// Peace of mind sql injection prevention (even though this should already be safe)
				const column = key.toLowerCase().replace(/[^a-z_]/g, '');
				if (column === 'id') return;
				const val = this.formatData(value);
				return [column, val];
			})
			.filter((v) => !!v);
		if (!updates.length) {
			throw { status: 400, message: 'No data provided to insert' };
		}
		if (id !== null) updates.push(['id', id ?? generateTimestampID()]);
		const bindings = updates.map(([_, value]) => value);
		const columns = updates.map(([column]) => column).join(', ');
		const values = updates.map(() => '?').join(', ');
		const query = `INSERT INTO ${sanitizedTable} (${columns}) VALUES (${values}) RETURNING *;`;
		const start = performance.now();
		const result = this.exec<SqlTableRow<Schema, Table>>(query, ...bindings);
		console.log(
			`Ran insert query in ${performance.now() - start}ms: ${query}`,
			bindings.join(', '),
		);
		return result.one();
	}

	/** Updates a row in the table with the given data & ID */
	update<
		Table extends SqlTable<Schema>,
		TableData extends SqlTableRow<Schema, Table>,
		NullableData extends {
			[key in keyof TableData]: TableData[key] extends NonNullable<TableData[key]>
				? TableData[key]
				: TableData[key] | null;
		},
		Data extends Omit<NullableData, 'id' | 'created_at' | 'updated_at'> & {
			created_at?: number;
			updated_at?: number;
		},
		ID extends NullableData['id'] extends string | number
			? NullableData['id']
			: string | number,
	>(table: Table, id: ID, data: Partial<Data>) {
		// Sanitize the table name (this shouldn't be necessary because 'table' should be trustworthy)
		// We're doing this just to be safe and for peace of mind
		const sanitizedTable = (table || '').toLowerCase().replace(/[^a-z_]/g, '');
		if (!sanitizedTable) {
			throw { status: 400, message: 'Missing database table name' };
		}
		if (!id) throw { status: 400, message: 'Item ID not provided' };

		const updates = Object.entries({
			...data,
			updated_at: data.updated_at || Date.now(),
		})
			.map(([key, value]) => {
				if (key === undefined || value === undefined) return;
				// Peace of mind sql injection prevention (even though this should already be safe)
				const column = key.toLowerCase().replace(/[^a-z_]/g, '');
				if (column === 'id') return;
				const val = this.formatData(value);
				return [column, val];
			})
			.filter((v) => !!v);
		if (!updates.length) {
			throw { status: 400, message: 'No data provided to update' };
		}
		const bindings = [...updates.map(([_, value]) => value), id];
		const updateFields = updates.map(([column]) => `${column} = ?`).join(', ');
		const query = `UPDATE ${sanitizedTable} SET ${updateFields} WHERE id = ? RETURNING *;`;
		const start = performance.now();
		const result = this.exec<SqlTableRow<Schema, Table>>(query, ...bindings);
		console.log(
			`Ran update query in ${performance.now() - start}ms: ${query}`,
			bindings.join(', '),
		);
		return result.one();
	}

	/** Deletes a row in the table with the given ID */
	delete<
		Table extends SqlTable<Schema>,
		ID extends SqlTableRow<Schema, Table>['id'] extends string | number
			? SqlTableRow<Schema, Table>['id']
			: string | number,
	>(table: Table, id: ID) {
		// Sanitize the table name (this shouldn't be necessary because 'table' should be trustworthy)
		// We're doing this just to be safe and for peace of mind
		const sanitizedTable = table.toLowerCase().replace(/[^a-z_]/g, '');
		if (!sanitizedTable) {
			throw { status: 400, message: `Must provide a table to delete from` };
		}
		if (!id) {
			throw { status: 400, message: `Must provide an ID to delete` };
		}
		const result = this.exec(
			`DELETE FROM ${sanitizedTable} WHERE id = ? RETURNING *`,
			id,
		);
		return result.one();
	}

	/**
	 * Lists the items in the given table based on the given query and returns them
	 * @returns void (throws an error if the query fails)
	 * @example
	 		const results = db.list('users');
	 *
	 */
	list<
		Table extends SqlTable<Schema>,
		TableData extends SqlTableRow<Schema, Table>,
		Query extends SqlEntityQuery<TableData>,
		OutputData extends SqlEntityQueryResultData<TableData, Query>,
	>(table: Table, query?: Query): OutputData[] {
		const result = this.query<Table, TableData, Query, OutputData>(table, query);
		return result.toArray();
	}

	/**
	 * Queries the items in the given table and returns the database cursor
	 * @returns void (throws an error if the query fails)
	 * @example
	 		const results = db.query('users');
			const firstResult = results.next();
	 *
	 */
	query<
		Table extends SqlTable<Schema>,
		TableData extends SqlTableRow<Schema, Table>,
		Query extends SqlEntityQuery<TableData>,
		OutputData extends SqlEntityQueryResultData<TableData, Query>,
	>(table: Table, query?: Query) {
		// Sanitize the table name (this shouldn't be necessary because 'table' should be trustworthy)
		// We're doing this just to be safe and for peace of mind
		const sanitizedTable = table.toLowerCase().replace(/[^a-z_]/g, '');
		let select = `SELECT * FROM ${sanitizedTable}`;
		let order = ``;
		let where = ``;
		let limit = ``;
		let offset = ``;
		let values: any[] = [];

		// Select the appropriate columns
		if (query?.select?.length) {
			const columns = query.select
				.map((column) =>
					// Peace of mind sql injection prevention
					column.toLowerCase().replace(/[^a-z_]/g, ''),
				)
				.join(', ');
			select = `SELECT ${columns} FROM ${sanitizedTable}`;
		}

		// Order the results based on the given query
		if (query?.order?.length) {
			order = `ORDER BY ${query.order
				.map(({ key, direction }) => {
					// Peace of mind sql injection prevention
					const sanitizedColumn = key.toLowerCase().replace(/[^a-z_]/g, '');
					return `${sanitizedColumn} ${direction || 'ASC'}`;
				})
				.join(', ')}`;
		}

		// Filter the results by the where clauses
		if (query?.where) {
			function buildWhereClause(
				where: SqlEntityQuery<TableData>['where'],
			): { clause: string; values: any[] } | undefined {
				if (!where) return;
				if ('and' in where) {
					const clauses = where.and.map(buildWhereClause).filter((v) => !!v);
					if (!clauses.length) return;
					if (clauses.length === 1) return clauses[0];
					return {
						clause: `(${clauses.flatMap((c) => c.clause).join(' AND ')})`,
						values: clauses.flatMap((c) => c.values),
					};
				}
				if ('or' in where) {
					const clauses = where.or.map(buildWhereClause).filter((v) => !!v);
					if (!clauses.length) return;
					if (clauses.length === 1) return clauses[0];
					return {
						clause: `(${clauses.flatMap((c) => c.clause).join(' OR ')})`,
						values: clauses.flatMap((c) => c.values),
					};
				}
				// Sanitize the key (this shouldn't be necessary because 'table' should be trustworthy)
				// We're doing this just to be safe and for peace of mind
				const sanitizedKey = where.key.toLowerCase().replace(/[^a-z_]/g, '');

				// Bitwise AND operator
				if (where.is === '&=') {
					if (
						typeof where.value !== 'number' ||
						isNaN(where.value) ||
						!isFinite(where.value)
					) {
						throw {
							status: 400,
							message: `Invalid value for bitwise AND operator`,
						};
					}
					return {
						clause: `(${sanitizedKey} & ${where.value}) == ${where.value}`,
						values: [],
					};
				}
				if (where.is === '=' && (where.value ?? null) === null) {
					return { clause: `${sanitizedKey} IS NULL`, values: [] };
				}
				if (where.is === '!=' && (where.value ?? null) === null) {
					return { clause: `${sanitizedKey} IS NOT NULL`, values: [] };
				}
				if (
					!['=', '!=', '>', '<', '>=', '<=', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN'].includes(
						where.is,
					)
				) {
					return;
				}
				if (where.is === 'LIKE' || where.is === 'NOT LIKE') {
					// Escape LIKE wildcards (%, _, \) in user input so they match literally
					const escaped = String(where.value)
						.replace(/\\/g, '\\\\')
						.replace(/%/g, '\\%')
						.replace(/_/g, '\\_');
					return {
						clause: `${sanitizedKey} ${where.is} ? ESCAPE '\\'`,
						values: [escaped],
					};
				}
				return { clause: `${sanitizedKey} ${where.is} ?`, values: [where.value] };
			}
			// Build the where clause
			const built = buildWhereClause(query.where);
			if (built) {
				where = `WHERE ${built.clause}`;
				values.push(...built.values);
			}
		}

		// Limit the results based on the given query
		if (query?.limit) {
			const sanitizedNumber = parseInt(query.limit.toString().replace(/[^0-9]/g, ''), 10);
			if (sanitizedNumber > 0) limit = `LIMIT ${sanitizedNumber}`;
		}

		// Offset the results based on the given query
		if (query?.offset) {
			const sanitizedNumber = parseInt(
				query.offset.toString().replace(/[^0-9]/g, ''),
				10,
			);
			if (sanitizedNumber > 0) offset = `OFFSET ${sanitizedNumber}`;
			if (!limit) limit = `LIMIT 100`;
		}

		const queryStr = [select, where, order, limit, offset].filter(Boolean).join(' ');
		const start = performance.now();
		const result = this.exec<OutputData>(queryStr, ...values);
		console.log(
			`Ran query in ${performance.now() - start}ms: ${queryStr}`,
			values.join(', '),
		);
		return result;
	}

	/**
	 * Finds the item with the given ID in the given table and returns it
	 * @returns void (throws an error if the query fails)
	 * @example
	 		const results = db.get('users', '123');
	 *
	 */
	get<
		Table extends SqlTable<Schema>,
		Data extends SqlTableRow<Schema, Table>,
		ID extends SqlTableRow<Schema, Table>['id'] extends string | number
			? SqlTableRow<Schema, Table>['id']
			: string | number,
	>(table: Table, id: ID): Data {
		// Sanitize the table name (this shouldn't be necessary because 'table' should be trustworthy)
		// We're doing this just to be safe and for peace of mind
		const sanitizedTable = table.toLowerCase().replace(/[^a-z_]/g, '');
		const result = this.exec<Data>(
			`SELECT * FROM ${sanitizedTable} WHERE id = ? LIMIT 1`,
			id,
		);
		const data = result.next()?.value;
		if (!data) {
			const tableName = table.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
			throw { status: 404, message: `${tableName} not found` };
		}
		return data;
	}

	/**
	 * Runs the given query function, which should return a tagged template literal
	 * that will be converted into an SQL query string & list of values.
	 * @param queryFn Returns a tagged template literal that will be converted into an SQL query string & list of values
	 * @returns no results - which is useful for update/delete/insert operations (throws an error if the query fails)
	 * @example
	 		const results = db.run((sql) => {
				const name = 'brian';
				const company = 'ABC Real Estate';
				const age = 30;
				return sql`INSERT INTO users (name, age) VALUES (${name}, ${age})`;
			});
	 *
	 */
	run<T extends Record<string, SqlStorageValue>>(queryFn: SqlQueryFn) {
		const parsed = queryFn(prepareSql);
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
		const result = this.exec<T>(query, ...values.map(this.formatData));
		console.log(
			`Ran query in ${performance.now() - start}ms: ${query.replace(/\t+/g, '')}`,
			values.join(', '),
		);
		return result;
	}

	/**
	 * Starts a transaction and runs the given function. If an error is thrown in the closure, the transaction is rolled back.
	 * @example
	 		const results = db.transaction(() => {
				const name = 'brian';
				const company = 'ABC Real Estate';
				const age = 30;
				const email = 'a@a.com';
				db.run((sql) => {
					return sql`INSERT INTO user (name, age) VALUES (${name}, ${age})`;
				});
				db.run((sql) => {
					return sql`INSERT INTO user_auth (email) VALUES (${email})`;
				});
				if (somethingsNotRight) {
					throw { status: 400, message: 'Something went wrong' };
				}
			});
	 *
	 */
	transaction(transactionFn: () => void) {
		this.storage.transactionSync(transactionFn);
	}

	/**
	 * Sets the error message that will be used if the follow functions throw and error
	 * @returns a proxy of this object that will throw the given error message if any of the functions throw an error
	 * @example
	 * const db = new SqlServer(storage).setError('Something went wrong').get('user', '123');
	 * // throws: { status: 500, message: 'Something went wrong', detail: 'User not found' }
	 */
	setError(message: string, status?: number): Omit<this, 'setErrorMessage'> {
		return new Proxy(this, {
			get(target, prop: keyof SqlServer<Schema>) {
				if (typeof target[prop] === 'function') {
					return (...args: any[]) => {
						try {
							return (target[prop] as any)(...args);
						} catch (error: any) {
							throw {
								status: status || error?.status || 500,
								message,
								detail: error ? error.toString() : undefined,
							};
						}
					};
				}
				return target[prop];
			},
		});
	}

	/** Restores the database to the given timestamp (if a number) or a bookmark (if a string) */
	async restore(timestampOrBookmark: number | string) {
		const bookmark =
			typeof timestampOrBookmark === 'string'
				? timestampOrBookmark
				: await this.storage.getBookmarkForTime(timestampOrBookmark);
		const new_bookmark = await this.storage.onNextSessionRestoreBookmark(bookmark);
		console.log(
			`Restored to ${timestampOrBookmark}. Undo restore with bookmark: ${new_bookmark}`,
		);
		return new_bookmark;
	}

	/** Formats the given data and returns a valid database value (for SQLite) */
	private formatData(data: any): boolean | number | string | null | ArrayBuffer {
		if (data === null || data === undefined) return null;
		if (typeof data === 'number') return data;
		if (typeof data === 'string') return data;
		if (typeof data === 'boolean') return data;
		if (data instanceof ArrayBuffer || data instanceof Blob) return data as any;
		if (data instanceof Date) return data.getTime();
		if (typeof data === 'object') return JSON.stringify(data);
		throw { status: 400, message: `Invalid data type: ${typeof data}` };
	}

	/** Executes the given query and writes better error messages than the default sqlite ones */
	private exec<T extends Record<string, SqlStorageValue>>(
		query: string,
		...bindings: any[]
	): SqlStorageCursor<T> {
		try {
			const result = this.storage.sql.exec<T>(query, ...bindings);
			return result;
		} catch (error: any) {
			console.log(
				'Database error while running query',
				error?.message || 'Unknown error',
				'\n',
				query.replace(/\t+/g, ''),
			);
			throw {
				status: 500,
				message: `Uh oh, a database error occurred. Please try again later.`,
				detail: error?.message || `Unknown database error`,
			};
		}
	}
}
