import { DelightError } from '@packages/lib';
import { redirect, error } from '@sveltejs/kit';

export async function load({ locals, params }) {
	if (!locals.authState.id) throw redirect(307, '/developer');
	const application_id = params.application_id;
	if (application_id === 'new') return { application: undefined };
	try {
		const application = await locals.auth.getOauthApplication(application_id);
		return { application };
	} catch (err: any) {
		const parsed = DelightError.from(err);
		throw error(parsed.status, parsed.message);
	}
}
