import { requireAuthScope } from '$lib/server/security.server';
import { apiError } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function POST({ locals, params }) {
	requireAuthScope('profile:write');
	const applications = await locals.auth.listOauthApplications(locals.authState.id!);
	if (!applications.list.some((app) => app.id === params.application_id)) {
		throw apiError({ status: 404, message: 'Application not found' });
	}
	const secret = await locals.auth.createOauthApplicationSecret(params.application_id);
	return json(secret);
}
