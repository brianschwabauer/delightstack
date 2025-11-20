import { requireAuthScope } from '$lib/server';
import { apiError } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function GET({ locals, params }) {
	requireAuthScope('content:read');
	const { media_id } = params;
	const { db } = locals;
	if (!db) throw apiError({ status: 500, message: 'Database not found' });
	const media = await db.get('media', media_id);
	return json(media);
}

export async function PATCH({ locals, params, request }) {
	requireAuthScope(['content:edit', 'content:write']);
	const { media_id } = params;
	const { authState, db } = locals;
	if (!db) throw apiError({ status: 500, message: 'Database not found' });
	if (!authState.isAllowed('content:edit')) {
		const media = await db.get('media', media_id);
		if (media.creator_id !== authState.id) {
			throw apiError({
				status: 401,
				message: `You don't have permission to update files uploaded by other users`,
			});
		}
	}
	const data = await request.json<any>().catch(() => undefined);
	const media = await db.update('media', media_id, data);
	return json(media);
}

export async function DELETE({ locals, params, platform }) {
	requireAuthScope(['content:edit', 'content:write']);
	const { media_id } = params;
	const { authState, db } = locals;
	if (!db) throw apiError({ status: 500, message: 'Database not found' });
	if (!authState.isAllowed('content:edit')) {
		const media = await db.get('media', media_id);
		if (media.creator_id !== authState.id) {
			throw apiError({
				status: 401,
				message: `You don't have permission to delete files uploaded by other users`,
			});
		}
	}
	// TODO: delete the media record and stop the media processing workflow
	const workflow = await platform?.env?.MEDIA_WORKFLOW.get(
		`/org/${authState.orgID}/media/${media_id}`,
	);
	await workflow.terminate();

	await db.delete('media', media_id);
	return new Response(null, { status: 204 });
}
