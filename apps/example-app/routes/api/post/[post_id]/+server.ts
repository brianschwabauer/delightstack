import { requireAuthScope } from '$lib/server';
import { apiError } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function GET({ locals, params }) {
	requireAuthScope('content:read');
	const { post_id } = params;
	const { db } = locals;
	if (!db) throw apiError({ status: 500, message: 'Database not found' });
	const post = await db.get('post', post_id);
	return json(post);
}

export async function PATCH({ locals, params, request }) {
	requireAuthScope(['content:edit', 'content:write']);
	const { post_id } = params;
	const { authState, db } = locals;
	if (!db) throw apiError({ status: 500, message: 'Database not found' });
	if (!authState.isAllowed('content:edit')) {
		const post = await db.get('post', post_id);
		if (post.creator_id !== authState.id) {
			throw apiError({
				status: 401,
				message: `You don't have permission to update people created by other users`,
			});
		}
	}
	const data = await request.json<any>().catch(() => undefined);
	const post = await db.update('post', post_id, data);
	return json(post);
}

export async function DELETE({ locals, params }) {
	requireAuthScope(['content:edit', 'content:write']);
	const { post_id } = params;
	const { authState, db } = locals;
	if (!db) throw apiError({ status: 500, message: 'Database not found' });
	if (!authState.isAllowed('content:edit')) {
		const post = await db.get('post', post_id);
		if (post.creator_id !== authState.id) {
			throw apiError({
				status: 401,
				message: `You don't have permission to delete people created by other users`,
			});
		}
	}
	await db.delete('post', post_id);
	return new Response(null, { status: 204 });
}
