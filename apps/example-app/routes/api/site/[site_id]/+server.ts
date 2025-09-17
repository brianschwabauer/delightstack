import { requireAuthScope } from '$lib/server';
import { parseSchema } from '@packages/lib';
import { apiError } from '@packages/lib';
import { Site } from '@packages/types';
import { json } from '@sveltejs/kit';

export async function GET({ locals, params }) {
	requireAuthScope('site:read');
	const { site_id } = params;
	const { db } = locals;
	if (!db) throw apiError({ status: 500, message: 'Database not found' });
	const site = await db.get('site', site_id);
	return json(site);
}

export async function PATCH({ locals, params, request }) {
	requireAuthScope(['site:edit', 'site:write']);
	const { site_id } = params;
	const { authState, db, auth } = locals;
	if (!db) throw apiError({ status: 500, message: 'Database not found' });
	if (!authState.orgID) {
		throw apiError({ status: 500, message: 'Auth state not found' });
	}
	if (!authState.isAllowed('site:edit')) {
		const site = await db.get('site', site_id);
		if (site.creator_id !== authState.id) {
			throw apiError({
				status: 401,
				message: `You don't have permission to update sites created by other users`,
			});
		}
	}
	const unsafe_data = await request.json<any>().catch(() => undefined);
	const current_site = await db.get('site', site_id);
	const data = parseSchema(Site.omit({ id: true, updated_at: true, created_at: true }), {
		...current_site,
		...unsafe_data,
	});
	const url = new URL(data.url);
	data.domain = url.hostname;
	data.path = url.pathname;
	if (url.href !== current_site.url) {
		await auth.unreserveGlobalKey(current_site.url, authState.orgID);
		await auth.reserveGlobalKey(url.href, authState.orgID);
	}

	// const site = await db.update('site', site_id, data);
	// return json(site);
	return json(undefined);
}

export async function DELETE({ locals, params }) {
	requireAuthScope(['site:edit', 'site:write']);
	const { site_id } = params;
	const { authState, db, auth } = locals;
	if (!db) throw apiError({ status: 500, message: 'Database not found' });
	if (!authState.orgID) {
		throw apiError({ status: 500, message: 'Auth state not found' });
	}
	if (!authState.isAllowed('site:edit')) {
		const site = await db.get('site', site_id);
		if (site.creator_id !== authState.id) {
			throw apiError({
				status: 401,
				message: `You don't have permission to delete sites created by other users`,
			});
		}
	}
	const current_site = await db.get('site', site_id);
	await auth.unreserveGlobalKey(current_site.url, authState.orgID);
	// await db.delete('site', site_id);
	return new Response(null, { status: 204 });
}
