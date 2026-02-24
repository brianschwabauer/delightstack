import { requireAuthScope } from '$lib/server/security.server';
import { DelightError } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function GET({ locals }) {
	requireAuthScope('profile:write');
	const applications = await locals.auth.listOauthApplications(locals.authState.id!);
	return json(applications);
}

export async function POST({ locals, request }) {
	requireAuthScope('profile:write');
	const body = await request.json<any>();
	if (!body?.name) throw new DelightError({ message: 'Name is required', status: 400 });
	const application = await locals.auth.createOauthApplication({
		...body,
		user_id: locals.authState.id,
	});
	return json(application);
}
