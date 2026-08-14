/** Converts a tagged template literal into an SQL query string & list of values */
export function prepareSql(strings: TemplateStringsArray, ...values: any[]) {
	let query = '';
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
