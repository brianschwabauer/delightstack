import { apiError } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function GET({ locals }) {
	if (!locals.authState.id) {
		throw apiError({ status: 401, message: `Must be signed in to view sessions` });
	}
	const sessions = await locals.auth.listSessions(locals.authState.id);
	return json(sessions);
}
