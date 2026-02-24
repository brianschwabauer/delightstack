import { DelightError } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function GET({ locals, url }) {
	const { authState, db } = locals;
	if (!authState.signed_in) {
		throw new DelightError({
			message: `You must be signed in to sync the database`,
			status: 401,
		});
	}
	if (!authState.isAllowed('content:read')) {
		throw new DelightError({
			message: `Not enough permissions to sync the database`,
			status: 401,
		});
	}
	if (!db) throw new DelightError({ message: 'Database not found', status: 500 });
	let entity: any;
	try {
		entity = JSON.parse(url.searchParams.get('entity') || 'null');
	} catch (error) {}
	const start_updated_at =
		url.searchParams.get('start') ||
		url.searchParams.get('start_updated_at') ||
		undefined;
	const end_updated_at =
		url.searchParams.get('end') || url.searchParams.get('end_updated_at') || undefined;
	const list = await db.listChanges({
		start_updated_at: start_updated_at ? +start_updated_at : undefined,
		end_updated_at: end_updated_at ? +end_updated_at : undefined,
		limit: Math.min(500, +(url.searchParams.get('limit') || '') || 5000),
		entity: entity || undefined,
	});
	return json(list);
}
