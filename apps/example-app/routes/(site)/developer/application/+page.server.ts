import { redirect } from '@sveltejs/kit';

export async function load({ locals }) {
	if (!locals.authState.id) throw redirect(307, '/developer');
	const applications = await locals.auth.listOauthApplications(locals.authState.id);
	return { applications };
}
