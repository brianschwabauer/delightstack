import { DelightError } from '@packages/lib';
import { json } from '@sveltejs/kit';

export async function POST({ locals, url }) {
	const grant_type = url.searchParams.get('grant_type');
	const client_id = url.searchParams.get('client_id');
	const client_secret = url.searchParams.get('client_secret');
	const redirect_uri = url.searchParams.get('redirect_uri');

	if (!client_id) {
		throw new DelightError({ message: 'Missing client_id parameter.', status: 400 });
	}
	if (!redirect_uri) {
		throw new DelightError({ message: 'Missing redirect_uri parameter.', status: 400 });
	}
	if (!client_secret) {
		throw new DelightError({ message: 'Missing client_secret parameter.', status: 400 });
	}
	if (grant_type !== 'code' && grant_type !== 'refresh_token') {
		throw new DelightError({
			message: 'Invalid grant_type. Only "code" and "refresh_token" are supported.',
			status: 400,
		});
	}
	await locals.auth.verifyOauthApplicationSecret(client_id, client_secret);

	// Create a token using the authorization code
	if (grant_type === 'code') {
		const code = url.searchParams.get('code');
		if (!code) {
			throw new DelightError({ message: 'Missing authorization code.', status: 400 });
		}
		const token = await locals.auth.createOauthApplicationToken({
			auth_code: code,
		});
		if (!token) {
			throw new DelightError({ message: 'Invalid authorization code.', status: 400 });
		}
		return json({
			access_token: token.access_token,
			token_type: 'bearer',
			expires_in: 3600,
			expires_at: token.access_token_expires_at,
			refresh_token: token.refresh_token,
			refresh_token_expires_at: token.refresh_token_expires_at,
			scope: token.permission,
			user_id: token.user_id,
			org_id: token.org_id,
			state: 'state' in token ? token.state : undefined,
			redirect_uri: 'redirect_uri' in token ? token.redirect_uri : undefined,
		});
	}

	// Handle refresh token grant type
	if (grant_type === 'refresh_token') {
		const refresh_token = url.searchParams.get('refresh_token');
		if (!refresh_token) {
			throw new DelightError({ message: 'Missing refresh token.', status: 400 });
		}
		const token = await locals.auth.createOauthApplicationToken({ refresh_token });
		if (!token) {
			throw new DelightError({ message: 'Invalid refresh token.', status: 400 });
		}
		return json({
			access_token: token.access_token,
			token_type: 'bearer',
			expires_in: 3600,
			expires_at: token.access_token_expires_at,
			refresh_token: token.refresh_token,
			refresh_token_expires_at: token.refresh_token_expires_at,
			scope: token.permission,
			user_id: token.user_id,
			org_id: token.org_id,
		});
	}

	throw new DelightError({ message: 'Unsupported grant type.', status: 400 });
}
