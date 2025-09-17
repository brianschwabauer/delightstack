import { env } from '$env/dynamic/private';
import { apiError, ApiError, decodeJwt } from '@packages/lib';
import { getOauthToken } from '@packages/lib';
import { type OauthVendor } from '@packages/lib';
import type { OauthToken } from '@packages/types';
import { error, redirect } from '@sveltejs/kit';

export async function load({ locals, params, url }) {
	const { getVendorApi } = locals;
	let redirect_after_signin = '/dashboard';

	try {
		const vendor_api = await getVendorApi(params.vendor as OauthVendor);
		const state = url.searchParams.get('state');
		if (!state) {
			throw apiError({
				status: 400,
				message: `Oauth callback state not provided`,
			});
		}
		let connect_user_id: string | undefined;
		let scopes: string[] = [];
		try {
			const decoded_jwt = await decodeJwt<'oauth_authorize'>(env.JWT_KEY_SECRET, state);
			if (decoded_jwt.typ !== 'oauth_authorize') {
				throw apiError({ status: 400, message: 'Invalid oauth state' });
			}
			connect_user_id = decoded_jwt.uid;
			scopes = decoded_jwt.scopes || [];
			if (decoded_jwt.redirect) redirect_after_signin = decoded_jwt.redirect;
		} catch (error) {
			throw apiError({
				status: 400,
				message: `Invalid or expired state token`,
			});
		}
		if (!connect_user_id) {
			throw apiError({
				status: 400,
				message: `State token is missing user ID`,
			});
		}

		const auth_code = url.searchParams.get('code');
		if (!auth_code) {
			throw apiError({
				status: 400,
				message: `Authorization code not provided`,
			});
		}
		const token = await getOauthToken(vendor_api.config, {
			vendor: params.vendor,
			auth_code,
			redirect_url: `${url.protocol}//${url.host}${url.pathname}`,
		});
		if (!token?.access_token) {
			throw apiError({ status: 500, message: `Couldn't get oauth access token` });
		}
		vendor_api.token = token as OauthToken;
		const account = await vendor_api.oauth.account();
		if (!account?.id) {
			await vendor_api.oauth.revoke().catch(() => undefined);
			throw apiError({
				status: 500,
				message: `Couldn't get user ID from oauth account`,
			});
		}
		if (!account.verified) {
			throw apiError({
				status: 403,
				message: `Your ${params.vendor} account's email has been not verified.`,
			});
		}
		token.vendor_id = account.id;
		token.account_email = account.email;
		token.account_name = account.name;
		token.account_image = account.image;
		token.capabilities = vendor_api.oauth.capabilities(scopes);
		await locals.auth.connectOauthAccount(token, connect_user_id);
	} catch (err) {
		const parsed = ApiError.from(err);
		throw error(parsed.status, parsed.message);
	}
	throw redirect(307, redirect_after_signin);
}
