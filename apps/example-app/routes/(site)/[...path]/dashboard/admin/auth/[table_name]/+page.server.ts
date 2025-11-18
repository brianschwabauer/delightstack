export async function load({ locals, params }) {
	const table_name = params.table_name;
	const { results: list } = await locals.auth.__dangerouslyRunSql__(
		`SELECT * FROM ${table_name} LIMIT 1000`,
	);
	const { results: table_info } = await locals.auth.__dangerouslyRunSql__(
		`PRAGMA table_info(${table_name})`,
	);
	return { list, table_info };
}
