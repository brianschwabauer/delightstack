import { ApiError } from '@packages/lib';
import { SCOPES } from '@packages/types';
import { error, redirect } from '@sveltejs/kit';

export async function load({ locals, url }) {
	const client_id = url.searchParams.get('client_id');
	const redirect_uri = url.searchParams.get('redirect_uri');
	const requested_scopes = (url.searchParams.get('scope') || '')
		.split(',')
		.map((val) => val.trim().toLowerCase())
		.filter(Boolean);
	const state = url.searchParams.get('state');
	if (url.searchParams.get('response_type') !== 'code') {
		throw error(400, 'Invalid response type. Only "code" is supported.');
	}
	if (!client_id) {
		throw error(400, 'Missing client_id parameter.');
	}
	if (!redirect_uri) {
		throw error(400, 'Missing redirect_uri parameter.');
	}
	if (!locals.authState.id) {
		throw redirect(
			307,
			`/signin?redirect=${encodeURIComponent(url.pathname + url.search)}`,
		);
	}

	let scopes = SCOPES.filter((scope) => requested_scopes.includes(scope));
	if (!scopes.length) scopes = SCOPES; // Default to all scopes if none requested

	try {
		const application = await locals.auth.getOauthApplication(client_id);
		if (!application.redirect_urls.includes(redirect_uri)) {
			throw { status: 400, message: 'Invalid redirect URI.' };
		}
		return {
			authState: locals.authState.toJSON(),
			application: { ...application, client_secrets: undefined },
			scopes,
			redirect_uri,
		};
	} catch (err) {
		const parsed = ApiError.from(err);
		throw error(parsed.status, parsed.messageText);
	}
}
