import { requireAuthScope } from '$lib/server';
import { DelightError, parseSchema } from '@delightstack/utilities';
import { decodeSearchQuery } from '@delightstack/database';
import { Site } from '@packages/types';
import { json } from '@sveltejs/kit';

export async function GET({ locals, url }) {
	requireAuthScope('site:read');
	const { db } = locals;
	if (!db) throw new DelightError({ message: 'Database not found', status: 500 });
	const query = decodeSearchQuery(url.searchParams);
	// const sites = await db.list('site', query);
	// return json(sites);
	return json(undefined);
}

export async function POST({ locals, request }) {
	requireAuthScope('site:write');
	const { db, auth, authState } = locals;
	if (!db) throw new DelightError({ message: 'Database not found', status: 500 });
	if (!authState.orgID) {
		throw new DelightError({ message: 'Auth state not found', status: 500 });
	}
	const unsafe_data = await request.json<any>().catch(() => undefined);
	const data = parseSchema(
		Site.omit({ id: true, updated_at: true, created_at: true }),
		unsafe_data,
	);
	const url = new URL(data.url);
	data.domain = url.hostname;
	data.path = url.pathname;
	await auth.reserveGlobalKey(url.href, authState.orgID);

	// const site = await db.create('site', data);
	// return json(site);
	return json(undefined);
}
