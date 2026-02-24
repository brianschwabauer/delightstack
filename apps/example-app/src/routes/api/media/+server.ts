import { requireAuthScope } from '$lib/server';
import { DelightError, decodeSearchQuery } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function GET({ locals, url }) {
	requireAuthScope('content:read');
	const { db } = locals;
	if (!db) throw new DelightError({ message: 'Database not found', status: 500 });
	const query = decodeSearchQuery(url.searchParams);
	const medias = await db.list('media', query);
	return json(medias);
}

export async function POST({ locals, request, platform }) {
	requireAuthScope('content:write');
	const { db, authState } = locals;
	if (!db) throw new DelightError({ message: 'Database not found', status: 500 });
	if (!authState.orgID) {
		throw new DelightError({ message: 'Auth state not found', status: 500 });
	}
	const data = await request.json<any>().catch(() => undefined);
	const media = await db.create('media', data);
	// TODO: Start the media workflow to start processing the file
	const workflow = await platform?.env?.MEDIA_WORKFLOW.create({
		id: `/org/${authState.orgID}/media/${media.id}`,
		params: {
			org_id: authState.orgID,
			media_id: media.id,
		},
	});
	return json(media);
}
