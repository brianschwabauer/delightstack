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

	// Fail clearly when the refresh token itself has expired instead of
	// surfacing whatever error the vendor returns for a dead grant
	if (
		!('auth_code' in token) &&
		token.refresh_token_expires_at &&
		token.refresh_token_expires_at < Date.now()
	) {
		throw new DelightError({
			message: 'OAuth refresh token expired. Reconnect the account.',
			status: 401,
			code: 'oauth/refresh_token_expired',
		});
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

	// Resolve who the token belongs to. The vendor only tells us this on the initial
	// exchange (or via the user info endpoint), so fall back to whatever the caller
	// already knew about the account.
	const account = await getOauthAccount(config, {
		access_token: String(body.access_token || ''),
		payload: body,
	});

	return {
		access_token: String(body.access_token || ''),
		refresh_token: body.refresh_token as string | undefined,
		access_token_expires_at: expires,
		refresh_token_expires_at: refreshExpires,
		capabilities: 'capabilities' in token ? token.capabilities : [],
		vendor: token.vendor,
		vendor_id: account.vendor_id || ('vendor_id' in token ? token.vendor_id : ''),
		payload: body,
		account_email:
			account.account_email ??
			('account_email' in token ? token.account_email : undefined),
		account_image:
			account.account_image ??
			('account_image' in token ? token.account_image : undefined),
		account_name:
			account.account_name ?? ('account_name' in token ? token.account_name : undefined),
	};
};

/** The identity of the vendor account an oauth token was issued for */
export interface OauthAccountIdentity {
	/** The vendor's ID for the account (the OpenID `sub` claim, or the user info `id`) */
	vendor_id: string;
	/** The email address on the account. Only set when the vendor says it's verified */
	account_email?: string;
	/** The display name on the account */
	account_name?: string;
	/** The url of the account's profile image */
	account_image?: string;
}

/**
 * Resolves the vendor account an access token was issued for.
 *
 * Prefers the OpenID Connect `id_token` returned alongside the access token (Google,
 * Microsoft, Apple, …) and falls back to the vendor's `user_info_url` when configured.
 * Returns empty values when the vendor provides neither — callers decide whether an
 * unidentified account is an error (signing in) or fine (connecting an API-only token).
 */
export const getOauthAccount = async (
	config: Pick<OauthConfig, 'user_info_url'>,
	token: { access_token: string; payload?: Record<string, unknown> },
): Promise<OauthAccountIdentity> => {
	// The id_token comes straight from the vendor's token endpoint over TLS, so its
	// claims are trustworthy without re-verifying the signature
	const id_token = token.payload?.id_token;
	const claims = typeof id_token === 'string' ? decodeJwtClaims(id_token) : undefined;
	if (claims?.sub) return accountFromClaims(claims);

	if (!config.user_info_url || !token.access_token) return { vendor_id: '' };

	const response = await fetch(config.user_info_url, {
		headers: {
			Authorization: `Bearer ${token.access_token}`,
			Accept: 'application/json',
		},
	});
	if (!response.ok) {
		const body = await response.text();
		console.error(`Error fetching oauth user info: ${response.status}`, body);
		throw new DelightError({
			message: `Couldn't fetch the account information from the vendor`,
			status: response.status || 500,
			code: 'oauth/user_info_failed',
		});
	}
	const info = (await response.json()) as Record<string, unknown>;
	return accountFromClaims(info);
};

/** Maps OpenID Connect style claims (from an id_token or a user info endpoint) to an account */
function accountFromClaims(claims: Record<string, unknown>): OauthAccountIdentity {
	const email = typeof claims.email === 'string' ? claims.email : undefined;
	// Vendors send `email_verified` as a boolean or as the string 'true'. Only an
	// explicit "not verified" is disqualifying — plenty of vendors omit the claim
	const verified = claims.email_verified ?? claims.verified_email;
	const email_verified = `${verified ?? true}` !== 'false';
	const id = claims.sub ?? claims.id;
	const image = claims.picture ?? claims.avatar_url ?? claims.image;
	return {
		vendor_id: id === undefined || id === null ? '' : String(id),
		account_email: email_verified ? email : undefined,
		account_name: typeof claims.name === 'string' ? claims.name : undefined,
		account_image: typeof image === 'string' ? image : undefined,
	};
}

/** Decodes the claims of a JWT without verifying its signature */
function decodeJwtClaims(jwt: string): Record<string, unknown> | undefined {
	const payload = jwt.split('.')[1];
	if (!payload) return undefined;
	try {
		const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
		// The claims are utf-8 — atob gives latin1, so re-decode names with accents
		const bytes = Uint8Array.from(json, (char) => char.charCodeAt(0));
		return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
	} catch (error) {
		console.error('Failed to decode the oauth id_token', error);
		return undefined;
	}
}
