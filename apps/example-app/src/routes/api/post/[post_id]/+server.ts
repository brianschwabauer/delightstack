import { requireAuthScope } from '$lib/server';
import { DelightError } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function GET({ locals, params }) {
	requireAuthScope('content:read');
	const { post_id } = params;
	const { db } = locals;
	if (!db) throw new DelightError({ message: 'Database not found', status: 500 });
	const post = await db.get('post', post_id);
	return json(post);
}

export async function PATCH({ locals, params, request }) {
	requireAuthScope(['content:edit', 'content:write']);
	const { post_id } = params;
	const { authState, db } = locals;
	if (!db) throw new DelightError({ message: 'Database not found', status: 500 });
	if (!authState.isAllowed('content:edit')) {
		const post = await db.get('post', post_id);
		if (post.creator_id !== authState.id) {
			throw new DelightError({
				message: `You don't have permission to update people created by other users`,
				status: 401,
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
	if (!db) throw new DelightError({ message: 'Database not found', status: 500 });
	if (!authState.isAllowed('content:edit')) {
		const post = await db.get('post', post_id);
		if (post.creator_id !== authState.id) {
			throw new DelightError({
				message: `You don't have permission to delete people created by other users`,
				status: 401,
			});
		}
	}
	await db.delete('post', post_id);
	return new Response(null, { status: 204 });
}
