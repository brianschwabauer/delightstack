import { requireAuthScope } from '$lib/server';
import { apiError } from '@packages/lib';

export async function POST({ locals, params }) {
	requireAuthScope('profile:write');

	const org_id = locals.authState.orgID;
	if (
		!org_id ||
		!locals.authState.orgs.some(
			(org) => org.id === org_id && org.permissions.includes('org:write'),
		)
	) {
		throw apiError({
			status: 403,
			message: 'You do not have permission to revoke applications for this organization.',
		});
	}

	await locals.auth.revokeAuthorizedOauthApplication(params.application_id, org_id);

	return new Response(null, { status: 204 });
}
