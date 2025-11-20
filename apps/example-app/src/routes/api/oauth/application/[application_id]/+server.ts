import { requireAuthScope } from '$lib/server/security.server';
import { apiError } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function GET({ locals, params }) {
	requireAuthScope('profile:write');
	const applications = await locals.auth.listOauthApplications(locals.authState.id!);
	if (!applications.list.some((app) => app.id === params.application_id)) {
		throw apiError({ status: 404, message: 'Application not found' });
	}
	const application = await locals.auth.getOauthApplication(params.application_id);
	return json(application);
}

export async function PATCH({ locals, request, params }) {
	requireAuthScope('profile:write');
	const body = await request.json<any>();
	if (!body) throw apiError({ status: 400, message: 'No updates provided' });
	const applications = await locals.auth.listOauthApplications(locals.authState.id!);
	if (!applications.list.some((app) => app.id === params.application_id)) {
		throw apiError({ status: 404, message: 'Application not found' });
	}
	const application = await locals.auth.updateOauthApplication(params.application_id, {
		...body,
	});
	return json(application);
}

export async function DELETE({ locals, params }) {
	requireAuthScope('profile:write');
	const applications = await locals.auth.listOauthApplications(locals.authState.id!);
	if (!applications.list.some((app) => app.id === params.application_id)) {
		throw apiError({ status: 404, message: 'Application not found' });
	}
	await locals.auth.deleteOauthApplication(params.application_id);
	return json({ success: true });
}
