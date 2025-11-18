import { apiError } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function GET({ locals }) {
	if (!locals.authState.id || !locals.authState.orgID) {
		throw apiError({ status: 401, message: `Must be signed in to view oauth accounts` });
	}
	const accounts = await locals.auth.listOauthAccounts(
		locals.authState.id,
		locals.authState.orgID,
	);
	return json(accounts);
}
