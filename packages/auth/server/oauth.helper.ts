import { CreateOauthToken, OauthConfig, OauthToken } from '../types';
import { DelightError } from '@delightstack/utilities';

/**
 * Returns an oauth token for the given oauth credential
 * If an auth_code is provided, this means it's the initial setup (using the callback URL)
 * If no auth_code is provided, this uses the refresh token in the credential to get the access code
 * If a valid access token is already provided, it will simply return that token
 * If an expired token is provided, it will refresh the token and return the new one
 */
export const getOauthToken = async (
	config: OauthConfig,
	token: OauthToken | CreateOauthToken,
): Promise<Omit<OauthToken, 'id' | 'created_at' | 'updated_at'>> => {
	if (!config.access_token_url) {
		throw DelightError.badRequest('Access token URL not provided');
	}

	// Check if the provided token is not expired. If not expired, return it
	if (
		!('auth_code' in token) &&
		(token.access_token_expires_at || 0) - 5 * 60 * 1000 > Date.now()
	) {
		if (token.access_token) return token as OauthToken;
	}

	// Generate a new access token with the given config & refresh token
	const response = await fetch(config.access_token_url, {
		method: 'POST',
		headers: {
			Accept: 'application/json, application/x-www-form-urlencoded',
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams({
			...('auth_code' in token
				? { code: token.auth_code, redirect_uri: token.redirect_url }
				: {}),
			...('auth_code' in token ? {} : { refresh_token: token.refresh_token }),
			client_id: config.client_id,
			client_secret: config.client_secret,
			grant_type: 'auth_code' in token ? 'authorization_code' : 'refresh_token',
		}).toString(),
	});

	// Parse the body as JSON if possible
	const raw = await response.text();
	let body: Record<string, string | number | undefined> = {};
	try {
		body = JSON.parse(raw);
	} catch {
		new URLSearchParams(raw).forEach((val, key) => (body[key] = val));
	}

	// Check if an error happened when getting the access token
	if (!response.ok) {
		const message =
			body.error_description || body.error || `Unknown error. Couldn't connect to vendor`;
		const code = `oauth/${body.error || 'unknown'}`;
		console.error(`Error getting access token: ${message}`, body);
		throw new DelightError({
			message: String(message),
			status: response.status || 500,
			code,
		});
	}

	// Get the access token expiry information
	let expiresIn = Number(body.expires_in) || Number(body.x_expires_in) || 0;
	expiresIn = expiresIn * (expiresIn > 100000000000 ? 1 : 1000);
	let expiresAt = Number(body.expires_at) || Number(body.x_expires_at) || 0;
	expiresAt = `${expiresAt}`.match(/^\d+$/)
		? expiresAt * (expiresAt > 100000000000 ? 1 : 1000)
		: Date.parse(`${body.expires_at || body.x_expires_at}`) || 0;
	const expires = expiresIn ? expiresIn + Date.now() : expiresAt;

	// Get the refresh token expiry information
	let refreshExpiresIn =
		Number(body.refresh_token_expires_in) || Number(body.x_refresh_token_expires_in) || 0;
	refreshExpiresIn = refreshExpiresIn * (refreshExpiresIn > 100000000000 ? 1 : 1000);
	let refreshExpiresAt =
		Number(body.refresh_token_expires_at) || Number(body.x_refresh_token_expires_at) || 0;
	refreshExpiresAt = `${refreshExpiresAt}`.match(/^\d+$/)
		? refreshExpiresAt * (refreshExpiresAt > 100000000000 ? 1 : 1000)
		: Date.parse(`${body.refresh_token_expires_at || body.x_refresh_token_expires_at}`) ||
			0;
	const refreshExpires = refreshExpiresIn
		? refreshExpiresIn + Date.now()
		: refreshExpiresAt;

	return {
		access_token: String(body.access_token || ''),
		refresh_token: body.refresh_token as string | undefined,
		access_token_expires_at: expires,
		refresh_token_expires_at: refreshExpires,
		capabilities: 'capabilities' in token ? token.capabilities : [],
		vendor: token.vendor,
		vendor_id: 'vendor_id' in token ? token.vendor_id : '',
		payload: body,
		account_email: 'account_email' in token ? token.account_email : undefined,
		account_image: 'account_image' in token ? token.account_image : undefined,
		account_name: 'account_name' in token ? token.account_name : undefined,
	};
};
