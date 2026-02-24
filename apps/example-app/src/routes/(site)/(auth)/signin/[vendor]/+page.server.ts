import { env } from '$env/dynamic/private';
import { DelightError, generateJwt } from '@packages/lib';
import { type OauthVendor } from '@packages/lib';
import type { OauthCapability, SessionToken } from '@packages/types';
import { error, redirect } from '@sveltejs/kit';

export async function load({ locals, params, url }) {
	const { authState, getVendorApi } = locals;

	// The user id that is being connected to the oauth account
	// This is used to determine if the user is signing in or connecting an vendor sign in to an existing sign in
	const connect_user_id = url.searchParams.get('connect_user_id');
	const invitation_id = url.searchParams.get('invitation_id') || undefined;
	const name = url.searchParams.get('name') || undefined;
	const org_name = url.searchParams.get('org_name') || undefined;
	const org_subscription_plan_id =
		url.searchParams.get('org_subscription_plan_id') ||
		url.searchParams.get('subscription_plan_id') ||
		undefined;
	let redirect_url: URL;

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

	try {
		const vendor_api = await getVendorApi(params.vendor as OauthVendor);
		const capabilities: OauthCapability[] = ['profile'];
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

		const now = Date.now();
		const sub =
			connect_user_id && connect_user_id === authState.id
				? authState.user_auth_id
				: undefined;
		const uid =
			connect_user_id && connect_user_id === authState.id ? authState.id : undefined;
		const signup: SessionToken<'oauth_authorize'>['signup'] = {
			name,
			org_name,
			invitation_id,
			org_subscription_plan_id,
		};
		const { jwt } = await generateJwt(env.JWT_KEY_SECRET, {
			sub, // The ID of the user's auth method used to sign in
			uid, // The user's ID
			iat: Math.floor(now / 1000),
			exp: Math.floor(now / 1000) + 60 * 10,
			typ: 'oauth_authorize',
			scopes,
			redirect: redirect_after_signin,
			signup: Object.values(signup).some((val) => val !== undefined) ? signup : undefined,
		});
		redirect_url.searchParams.set('state', jwt);
	} catch (err) {
		const parsed = DelightError.from(err);
		throw error(parsed.status, parsed.message);
	}
	throw redirect(307, redirect_url);
}
