import { requireAuthScope } from '$lib/server/security.server';
import { DelightError } from '@packages/lib';

export async function DELETE({ locals, params }) {
	requireAuthScope('profile:write');
	const applications = await locals.auth.listOauthApplications(locals.authState.id!);
	if (!applications.list.some((app) => app.id === params.application_id)) {
		throw new DelightError({ message: 'Application not found', status: 404 });
	}
	await locals.auth.deleteOauthApplicationSecret(params.application_id, params.secret_id);
	return new Response(null, { status: 204 });
}
