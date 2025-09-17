import { requireAuthScope } from '$lib/server';
import { apiError, decodeSearchQuery } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function GET({ locals, url }) {
	requireAuthScope('content:read');
	const { db } = locals;
	if (!db) throw apiError({ status: 500, message: 'Database not found' });
	const query = decodeSearchQuery(url.searchParams);
	// const posts = await db.list('post', query);
	return json([]);
}

export async function POST({ locals, request }) {
	requireAuthScope('content:write');
	const { db } = locals;
	if (!db) throw apiError({ status: 500, message: 'Database not found' });
	const data = await request.json<any>().catch(() => undefined);
	// const post = await db.create('post', data);
	return json(undefined);
}
