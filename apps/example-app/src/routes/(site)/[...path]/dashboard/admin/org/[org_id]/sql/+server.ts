import { dev } from '$app/environment';
import { proxyDurableObject } from '$lib/utility/rpc.helper.js';
import { json } from '@sveltejs/kit';

const SUPER_ADMINS = ['brian@brianschwabauer.com', 'brianschwabauer1@gmail.com'];

export async function POST({ locals, request, params, platform }) {
	if (
		!SUPER_ADMINS.includes(locals.authState.email || '') ||
		!locals.authState.verified
	) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	const org_id = params.org_id;
	const org = await locals.auth.getOrg(org_id);
	if (!org) json({ error: 'No org found' }, { status: 404 });
	const db_id = platform ? platform.env.DB.idFromName(org_id) : undefined;
	const db_stub = db_id ? platform!.env.DB.get(db_id) : undefined;
	const db =
		dev && db_stub ? proxyDurableObject<NonNullable<App.Locals['db']>>(db_stub) : db_stub;
	if (!db) return json({ error: 'No database found' }, { status: 404 });
	const body = await request.json<{ sql: string }>();
	if (!body?.sql) return json({ error: 'No SQL provided' }, { status: 400 });
	const result = await db.__dangerouslyRunSql__(body.sql);
	return json(result);
}
