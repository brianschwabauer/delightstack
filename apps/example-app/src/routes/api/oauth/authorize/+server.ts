import { DelightError } from '@packages/lib';
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
		throw new DelightError({ message: 'Missing client_id parameter.', status: 400 });
	}
	if (!redirect_uri) {
		throw new DelightError({ message: 'Missing redirect_uri parameter.', status: 400 });
	}
	if (!user_id || !org_id) {
		throw new DelightError({
			message: 'You must be signed in to authorize applications.',
			status: 401,
		});
	}
	if (
		!locals.authState.orgs.some(
			(org) => org.id === org_id && org.permissions.includes('org:write'),
		)
	) {
		throw new DelightError({
			message:
				'You do not have permission to authorize applications for this organization.',
			status: 403,
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
