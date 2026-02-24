import { requireAuthScope } from '$lib/server/security.server.js';
import { DelightError, decodeSearchQuery } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function GET({ locals, url }) {
	const { db } = locals;
	requireAuthScope('content:read');
	if (!db) throw new DelightError({ message: 'Database not found', status: 500 });
	const query = decodeSearchQuery(url.searchParams);
	const posts = await db.list('post', query);
	return json(posts);
}

export async function POST({ locals, request }) {
	requireAuthScope('content:write');
	const { db } = locals;
	if (!db) throw new DelightError({ message: 'Database not found', status: 500 });
	const data = await request.json<any>().catch(() => undefined);
	const post = await db.create('post', data);
	return json(post);
}
