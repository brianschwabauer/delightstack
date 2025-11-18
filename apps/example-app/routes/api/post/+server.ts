import { requireAuthScope } from '$lib/server/security.server.js';
import { apiError, decodeSearchQuery } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function GET({ locals, url }) {
	const { db } = locals;
	requireAuthScope('content:read');
	if (!db) throw apiError({ status: 500, message: 'Database not found' });
	const query = decodeSearchQuery(url.searchParams);
	const posts = await db.list('post', query);
	return json(posts);
}

export async function POST({ locals, request }) {
	requireAuthScope('content:write');
	const { db } = locals;
	if (!db) throw apiError({ status: 500, message: 'Database not found' });
	const data = await request.json<any>().catch(() => undefined);
	const post = await db.create('post', data);
	return json(post);
}
