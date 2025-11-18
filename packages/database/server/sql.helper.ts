/** Converts a tagged template literal into an SQL query string & list of values */
export function prepareSql(strings: TemplateStringsArray, ...values: any[]) {
	let query = '';
	if (strings.length < 2) {
		return {
			query: strings[0],
			values: [],
			__safelyInterpretedSql__: true,
		} as { query: string; values: any[] };
	}
	strings.forEach((string, i) => {
		if (i >= strings.length - 1) {
			query += string;
		} else {
			query += string + `?${i + 1}`;
		}
	});
	return {
		query,
		values: values.map((v) => (v === undefined ? null : v)),
		__safelyInterpretedSql__: true,
	} as { query: string; values: any[] };
}

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

/**
 * A tagged template literal for composing SQL queries in a safe manner (prevents SQL injection)
 * @example sql`SELECT * FROM users`;
 */
export type SqlTaggedTemplate = typeof prepareSql;

/** A prepared SQL query that can be run against the database (prevents SQL injection) */
export type SqlPreparedQuery = ReturnType<typeof prepareSql>;

/**
 * A function that will be called with the sql tagged template function.
 * It should return a prepared SQL query (or array of queries) that can be run against the database
 */
export type SqlQueryFn = (sql: SqlTaggedTemplate) => SqlPreparedQuery;

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

/** The result of a query to the database */
export interface SqlEntityQueryResult<
	Table extends Record<string, SqlStorageValue> = {},
> {
	/** Whether there are more results that match the query */
	hasMore: boolean;

	/** The total amount of results that match the query */
	total: number;

	/** The results that match the query */
	list: Table[];

	/** The cursor to use to get the next set of results */
	cursor?: string;
}
