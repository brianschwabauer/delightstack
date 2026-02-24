import { requireAuthScope } from '$lib/server/security.server';
import { DelightError } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function GET({ locals, params }) {
	requireAuthScope('profile:write');
	const applications = await locals.auth.listOauthApplications(locals.authState.id!);
	if (!applications.list.some((app) => app.id === params.application_id)) {
		throw new DelightError({ message: 'Application not found', status: 404 });
	}
	const application = await locals.auth.getOauthApplication(params.application_id);
	return json(application);
}

export async function PATCH({ locals, request, params }) {
	requireAuthScope('profile:write');
	const body = await request.json<any>();
	if (!body) throw new DelightError({ message: 'No updates provided', status: 400 });
	const applications = await locals.auth.listOauthApplications(locals.authState.id!);
	if (!applications.list.some((app) => app.id === params.application_id)) {
		throw new DelightError({ message: 'Application not found', status: 404 });
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
		throw new DelightError({ message: 'Application not found', status: 404 });
	}
	await locals.auth.deleteOauthApplication(params.application_id);
	return json({ success: true });
}
