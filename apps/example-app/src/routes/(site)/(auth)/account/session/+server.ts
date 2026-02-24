import { DelightError } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function GET({ locals }) {
	if (!locals.authState.id) {
		throw new DelightError({
			message: `Must be signed in to view sessions`,
			status: 401,
		});
	}
	const sessions = await locals.auth.listSessions(locals.authState.id);
	return json(sessions);
}
