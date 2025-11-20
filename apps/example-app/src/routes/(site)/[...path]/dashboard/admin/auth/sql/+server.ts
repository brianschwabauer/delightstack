import { json } from '@sveltejs/kit';

const SUPER_ADMINS = ['brian@brianschwabauer.com', 'brianschwabauer1@gmail.com'];

export async function POST({ locals, request }) {
	if (
		!SUPER_ADMINS.includes(locals.authState.email || '') ||
		!locals.authState.verified
	) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const body = await request.json<{ sql: string }>();
	if (!body?.sql) return json({ error: 'No SQL provided' }, { status: 400 });
	const result = await locals.auth.__dangerouslyRunSql__(body.sql);
	return json(result);
}
