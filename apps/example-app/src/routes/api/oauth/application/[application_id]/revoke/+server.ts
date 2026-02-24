import { requireAuthScope } from '$lib/server';
import { DelightError } from '@packages/lib';

export async function POST({ locals, params }) {
	requireAuthScope('profile:write');

	const org_id = locals.authState.orgID;
	if (
		!org_id ||
		!locals.authState.orgs.some(
			(org) => org.id === org_id && org.permissions.includes('org:write'),
		)
	) {
		throw new DelightError({
			message: 'You do not have permission to revoke applications for this organization.',
			status: 403,
		});
	}

	await locals.auth.revokeAuthorizedOauthApplication(params.application_id, org_id);

	return new Response(null, { status: 204 });
}
