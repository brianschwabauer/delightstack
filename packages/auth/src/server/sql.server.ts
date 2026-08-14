import { prepareSql, type SqlQueryFn } from '@delightstack/database';
import { DelightError, generateTimestampID } from '@delightstack/utilities';


/** A schema object representing the tables, columns, and rows of a database */
export type SqlDatabaseSchema = {
	[table: string]: {
		[column: string]: SqlStorageValue;
	};
};

/** A name of a table in the database schema */
export type SqlTable<Schema = SqlDatabaseSchema> = Extract<keyof Schema, string>;

/** The object data representing an entry in the database schema */
export type SqlTableRow<
	Schema extends SqlDatabaseSchema,
	Table extends SqlTable<Schema>,
> = Schema[Table];

/** A column name extracted from the given database schema & table */
export type SqlTableColumn<
	Schema extends SqlDatabaseSchema,
	Table extends SqlTable<Schema>,
> = Extract<keyof SqlTableRow<Schema, Table>, string>;

/** The data type of a cell in a database with the given schema, table, and column */
export type SqlTableCell<
	Schema extends SqlDatabaseSchema,
	Table extends SqlTable<Schema>,
	Column extends SqlTableColumn<Schema, Table>,
> = Schema[Table][Column];

/** An object that can be used to generate an sqlite query where clause */
export type SqlEntityQueryWhereClause<
	Table extends Record<string, SqlStorageValue> = {},
> =
	| {
			/** The list of clauses that each row must match to be included in the results */
			and: SqlEntityQueryWhereClause<Table>[];
	  }
	| {
			/** The list of clauses that each row must match at least one of to be included in the results */
			or: SqlEntityQueryWhereClause<Table>[];
	  }
	| {
			/** The column to check against */
			key: Extract<keyof Table, string>;
			/**
			 * How the column's value will be compared to the given value
			 * - `=`: equal
			 * - `!=`: not equal
			 * - `>`: greater than
			 * - `<`: less than
			 * - `>=`: greater than or equal
			 * - `<=`: less than or equal
			 * - `&=`: bitwise AND
			 * - `LIKE`: value is "like" the value in the table
			 * - `NOT LIKE`: value is "not like" the value in the tabe
			 * - `IN`: value is "in" the array
			 * - `NOT IN`: value is "not in" the array
			 */
			is:
				| '='
				| '!='
				| '>'
				| '<'
				| '>='
				| '<='
				| '&='
				| 'LIKE'
				| 'NOT LIKE'
				| 'IN'
				| 'NOT IN';
			/** The value to compare against */
			value: any;
	  };

/** Data in an object form used to make a string sqlite query */
export interface SqlEntityQuery<Table extends Record<string, SqlStorageValue> = {}> {
	/** The order the data should be returned in */
	order?: {
		key: Extract<keyof Table, string>;
		direction?: 'ASC' | 'DESC';
	}[];

	/** The max amount of results that should be returned */
	limit?: number;

	/** The amount of results that should be skipped */
	offset?: number;

	/** The filters that should be applied to the query results */
	where?: SqlEntityQueryWhereClause<Table>;

	/** The columns that should be returned in the results */
	select?: Extract<keyof Table, string>[];
}

/**
 * The shape of each item that will be returned from the given query.
 * Uses the 'select' field to limit to limit which columns are returned.
 */
export type SqlEntityQueryResultData<
	TableData extends Record<string, SqlStorageValue>,
	Query extends SqlEntityQuery<TableData>,
	OutputData extends Query['select'] extends (keyof TableData)[]
		? Pick<TableData, Query['select'][number]>
		: TableData = Query['select'] extends (keyof TableData)[]
		? Pick<TableData, Query['select'][number]>
		: TableData,
> = OutputData;

/**
 * Sanitizes a table/column identifier: lowercase letters, numbers, and
 * underscores only, and never starting with a number. The identifiers come
 * from the typed schema so they should already be safe — this is peace of mind.
 */
function sanitizeIdentifier(name: string): string {
	return (name || '').toLowerCase().replace(/[^a-z0-9_]/g, '').replace(/^[0-9]+/, '');
}

/** A helper class for reading/writing rows in a Durable Object SQLite database using SQL commands */
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
		const sanitizedTable = sanitizeIdentifier(table);
		if (!sanitizedTable) {
			throw new DelightError({ message: 'Missing database table name', status: 400 });
		}
		const updates = Object.entries({
			...data,
			created_at: data.created_at || Date.now(),
			updated_at: data.updated_at || Date.now(),
		})
			.map(([key, value]) => {
				if (key === undefined || value === undefined) return;
				// Peace of mind sql injection prevention (even though this should already be safe)
				const column = sanitizeIdentifier(key);
				if (column === 'id') return;
				const val = this.formatData(value);
				return [column, val];
			})
			.filter((v) => !!v);
		if (!updates.length) {
			throw new DelightError({ message: 'No data provided to insert', status: 400 });
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
			`(${bindings.length} bound values)`,
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
		const sanitizedTable = sanitizeIdentifier(table);
		if (!sanitizedTable) {
			throw new DelightError({ message: 'Missing database table name', status: 400 });
		}
		if (!id) throw new DelightError({ message: 'Item ID not provided', status: 400 });

		const updates = Object.entries({
			...data,
			updated_at: data.updated_at || Date.now(),
		})
			.map(([key, value]) => {
				if (key === undefined || value === undefined) return;
				// Peace of mind sql injection prevention (even though this should already be safe)
				const column = sanitizeIdentifier(key);
				if (column === 'id') return;
				const val = this.formatData(value);
				return [column, val];
			})
			.filter((v) => !!v);
		if (!updates.length) {
			throw new DelightError({ message: 'No data provided to update', status: 400 });
		}
		const bindings = [...updates.map(([_, value]) => value), id];
		const updateFields = updates.map(([column]) => `${column} = ?`).join(', ');
		const query = `UPDATE ${sanitizedTable} SET ${updateFields} WHERE id = ? RETURNING *;`;
		const start = performance.now();
		const result = this.exec<SqlTableRow<Schema, Table>>(query, ...bindings);
		console.log(
			`Ran update query in ${performance.now() - start}ms: ${query}`,
			`(${bindings.length} bound values)`,
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
		const sanitizedTable = sanitizeIdentifier(table);
		if (!sanitizedTable) {
			throw new DelightError({
				message: 'Must provide a table to delete from',
				status: 400,
			});
		}
		if (!id) {
			throw new DelightError({ message: 'Must provide an ID to delete', status: 400 });
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
		const sanitizedTable = sanitizeIdentifier(table);
		let select = `SELECT * FROM ${sanitizedTable}`;
		let order = ``;
		let where = ``;
		let limit = ``;
		let offset = ``;
		const values: any[] = [];

		// Select the appropriate columns
		if (query?.select?.length) {
			const columns = query.select.map(sanitizeIdentifier).join(', ');
			select = `SELECT ${columns} FROM ${sanitizedTable}`;
		}

		// Order the results based on the given query
		if (query?.order?.length) {
			order = `ORDER BY ${query.order
				.map(({ key, direction }) => {
					// Peace of mind sql injection prevention
					const sanitizedColumn = sanitizeIdentifier(key);
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
				const sanitizedKey = sanitizeIdentifier(where.key);

				// Bitwise AND operator
				if (where.is === '&=') {
					if (
						typeof where.value !== 'number' ||
						isNaN(where.value) ||
						!isFinite(where.value)
					) {
						throw new DelightError({
							message: 'Invalid value for bitwise AND operator',
							status: 400,
						});
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
			`(${values.length} bound values)`,
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
		const sanitizedTable = sanitizeIdentifier(table);
		const result = this.exec<Data>(
			`SELECT * FROM ${sanitizedTable} WHERE id = ? LIMIT 1`,
			id,
		);
		const data = result.next()?.value;
		if (!data) {
			const tableName = table.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
			throw new DelightError({ message: `${tableName} not found`, status: 404 });
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
			throw new DelightError({
				message: 'Must return a tagged template literal to build SQL queries',
				status: 400,
			});
		}
		if (!(parsed as any)?.__safelyInterpretedSql__) {
			throw new DelightError({
				message: "Must use the 'sql' tagged template literal to build SQL queries",
				status: 400,
			});
		}
		const { query, values } = parsed;
		const start = performance.now();
		const result = this.exec<T>(query, ...values.map(this.formatData));
		console.log(
			`Ran query in ${performance.now() - start}ms: ${query.replace(/\t+/g, '')}`,
			`(${values.length} bound values)`,
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
							throw new DelightError({
								message,
								status: status || error?.status || 500,
								detail: error ? error.toString() : undefined,
							});
						}
					};
				}
				return target[prop];
			},
		});
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
		throw new DelightError({ message: `Invalid data type: ${typeof data}`, status: 400 });
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
			throw new DelightError({
				message: 'Uh oh, a database error occurred. Please try again later.',
				status: 500,
				detail: error?.message || 'Unknown database error',
			});
		}
	}
}
