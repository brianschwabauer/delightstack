import { apiError } from '@packages/lib';
import { encodePermissions, SCOPES } from '@packages/types';
import { json } from '@sveltejs/kit';

export async function POST({ locals, request }) {
	const body = await request.json<any>();

	const user_id = locals.authState.id;
	const org_id = body.org_id || locals.authState.orgID;
	const client_id = body?.client_id;
	const redirect_uri = body?.redirect_uri;
	const requested_scopes = body?.scopes || [];
	const state = body?.state || '';
	if (!client_id) {
		throw apiError({ status: 400, message: 'Missing client_id parameter.' });
	}
	if (!redirect_uri) {
		throw apiError({ status: 400, message: 'Missing redirect_uri parameter.' });
	}
	if (!user_id || !org_id) {
		throw apiError({
			status: 401,
			message: 'You must be signed in to authorize applications.',
		});
	}
	if (
		!locals.authState.orgs.some(
			(org) => org.id === org_id && org.permissions.includes('org:write'),
		)
	) {
		throw apiError({
			status: 403,
			message:
				'You do not have permission to authorize applications for this organization.',
		});
	}

	let scopes = SCOPES.filter((scope) => requested_scopes.includes(scope));
	if (!scopes.length) scopes = SCOPES; // Default to all scopes if none requested

	const auth_code = await locals.auth.createOauthApplicationAuthorizationCode(client_id, {
		user_id,
		org_id,
		permission: encodePermissions(scopes),
		redirect_uri,
	});

	const redirect = new URL(redirect_uri);
	redirect.searchParams.set('code', auth_code.auth_code);
	if (state) redirect.searchParams.set('state', state);
	return json({ url: redirect });
}
