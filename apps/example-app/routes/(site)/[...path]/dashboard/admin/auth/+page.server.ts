export async function load({ locals }) {
	const { results: tables } = await locals.auth.__dangerouslyRunSql__(
		`SELECT * FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
	);
	const { results: indexes } = await locals.auth.__dangerouslyRunSql__(
		`SELECT * FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_%'`,
	);
	return { tables, indexes };
}
