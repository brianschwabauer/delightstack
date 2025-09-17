import { env } from '$env/dynamic/private';
import { apiError, ApiError, generateJwt } from '@packages/lib';
import { type OauthVendor } from '@packages/lib';
import { OAUTH_CAPABILITIES, type OauthCapability } from '@packages/types';
import { error, redirect } from '@sveltejs/kit';

export async function load({ locals, params, url }) {
	const { authState, getVendorApi } = locals;

	// Get the url to redirect to after signing in
	let redirect_after_signin = url.searchParams.get('redirect') || undefined;
	if (!redirect_after_signin?.startsWith('/')) {
		if (redirect_after_signin?.match(/^https?:\/\//)) {
			const new_url = new URL(redirect_after_signin);
			if (new_url.host !== url.host) redirect_after_signin = undefined;
			else redirect_after_signin = new_url.pathname;
		}
	}
	if (redirect_after_signin === '/') redirect_after_signin = undefined;
	if (redirect_after_signin === '/dashboard') redirect_after_signin = undefined;

	let redirect_url: URL;
	try {
		const capabilities = (
			(url.searchParams.get('capabilities')?.split(',') as OauthCapability[]) || []
		).filter((val) => val in OAUTH_CAPABILITIES);
		if (capabilities.length === 0) capabilities.push('profile');
		if (authState.signed_out) {
			throw apiError({
				status: 401,
				message: `You must be signed in to connect your ${params.vendor} account`,
			});
		}
		const vendor_api = await getVendorApi(params.vendor as OauthVendor);
		const scopes = vendor_api.oauth.scopes(capabilities);
		const callback_url = new URL(url);
		callback_url.pathname = `${url.pathname}/callback`;
		callback_url.search = '';
		callback_url.hash = '';
		redirect_url = new URL(vendor_api.config.authorization_url);
		redirect_url.searchParams.set('client_id', vendor_api.config.client_id);
		redirect_url.searchParams.set('redirect_uri', callback_url.href);
		redirect_url.searchParams.set('response_type', 'code');
		redirect_url.searchParams.set('scope', scopes.join(' '));

		// Add offline abilities to Google oauth
		if (params.vendor === 'google') {
			redirect_url.searchParams.set('access_type', 'offline');
			redirect_url.searchParams.set('include_granted_scopes', 'true');
			// redirect_url.searchParams.set('prompt', 'consent');
		}

		const now = Date.now();
		const { jwt } = await generateJwt(env.JWT_KEY_SECRET, {
			sub: authState.user_auth_id, // The ID of the user's auth method used to sign in
			uid: authState.id, // The user's ID
			iat: Math.floor(now / 1000),
			exp: Math.floor(now / 1000) + 60 * 10,
			typ: 'oauth_authorize',
			scopes,
			redirect: redirect_after_signin,
		});
		redirect_url.searchParams.set('state', jwt);
	} catch (err) {
		const parsed = ApiError.from(err);
		throw error(parsed.status, parsed.message);
	}
	throw redirect(307, redirect_url);
}
