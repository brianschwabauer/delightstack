import { requireAuthScope } from '$lib/server/security.server';
import { apiError } from '@packages/lib';

export async function DELETE({ locals, params }) {
	requireAuthScope('profile:write');
	const applications = await locals.auth.listOauthApplications(locals.authState.id!);
	if (!applications.list.some((app) => app.id === params.application_id)) {
		throw apiError({ status: 404, message: 'Application not found' });
	}
	await locals.auth.deleteOauthApplicationSecret(params.application_id, params.secret_id);
	return new Response(null, { status: 204 });
}
