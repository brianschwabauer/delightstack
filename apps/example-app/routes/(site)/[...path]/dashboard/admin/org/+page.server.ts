export async function load({ locals }) {
	const { results: list } = await locals.auth.__dangerouslyRunSql__(
		`SELECT * FROM org LIMIT 1000`,
	);
	return { list };
}
