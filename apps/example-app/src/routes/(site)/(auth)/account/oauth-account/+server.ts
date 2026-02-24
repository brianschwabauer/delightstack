import { DelightError } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function GET({ locals }) {
	if (!locals.authState.id || !locals.authState.orgID) {
		throw new DelightError({
			message: `Must be signed in to view oauth accounts`,
			status: 401,
		});
	}
	const accounts = await locals.auth.listOauthAccounts(
		locals.authState.id,
		locals.authState.orgID,
	);
	return json(accounts);
}
