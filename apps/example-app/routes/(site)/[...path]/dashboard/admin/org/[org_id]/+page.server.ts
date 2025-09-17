import { dev } from '$app/environment';
import { proxyDurableObject } from '$lib/utility/rpc.helper';
import { redirect } from '@sveltejs/kit';

export async function load({ locals, params, platform }) {
	const org_id = params.org_id;
	const db_id = platform ? platform.env.DB.idFromName(org_id) : undefined;
	const db_stub = db_id ? platform!.env.DB.get(db_id) : undefined;
	const db =
		dev && db_stub ? proxyDurableObject<NonNullable<App.Locals['db']>>(db_stub) : db_stub;
	if (!db) throw redirect(404, `/dashboard/admin/org`);
	const org = await locals.auth.getOrg(org_id);
	if (!org) throw redirect(404, `/dashboard/admin/org`);
	const { results: tables } = await db.__dangerouslyRunSql__(
		`SELECT * FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
	);
	const { results: indexes } = await db.__dangerouslyRunSql__(
		`SELECT * FROM sqlite_schema WHERE type = 'index' AND name NOT LIKE 'sqlite_%'`,
	);
	return { tables, indexes };
}
