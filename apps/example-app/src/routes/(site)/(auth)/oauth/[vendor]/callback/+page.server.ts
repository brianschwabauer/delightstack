import { env } from '$env/dynamic/private';
import { DelightError, decodeJwt } from '@packages/lib';
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
			throw new DelightError({
				message: `Oauth callback state not provided`,
				status: 400,
			});
		}
		let connect_user_id: string | undefined;
		let scopes: string[] = [];
		try {
			const decoded_jwt = await decodeJwt<'oauth_authorize'>(env.JWT_KEY_SECRET, state);
			if (decoded_jwt.typ !== 'oauth_authorize') {
				throw new DelightError({ message: 'Invalid oauth state', status: 400 });
			}
			connect_user_id = decoded_jwt.uid;
			scopes = decoded_jwt.scopes || [];
			if (decoded_jwt.redirect) redirect_after_signin = decoded_jwt.redirect;
		} catch (error) {
			throw new DelightError({
				message: `Invalid or expired state token`,
				status: 400,
			});
		}
		if (!connect_user_id) {
			throw new DelightError({
				message: `State token is missing user ID`,
				status: 400,
			});
		}

		const auth_code = url.searchParams.get('code');
		if (!auth_code) {
			throw new DelightError({
				message: `Authorization code not provided`,
				status: 400,
			});
		}
		const token = await getOauthToken(vendor_api.config, {
			vendor: params.vendor,
			auth_code,
			redirect_url: `${url.protocol}//${url.host}${url.pathname}`,
		});
		if (!token?.access_token) {
			throw new DelightError({ message: `Couldn't get oauth access token`, status: 500 });
		}
		vendor_api.token = token as OauthToken;
		const account = await vendor_api.oauth.account();
		if (!account?.id) {
			await vendor_api.oauth.revoke().catch(() => undefined);
			throw new DelightError({
				message: `Couldn't get user ID from oauth account`,
				status: 500,
			});
		}
		if (!account.verified) {
			throw new DelightError({
				message: `Your ${params.vendor} account's email has been not verified.`,
				status: 403,
			});
		}
		token.vendor_id = account.id;
		token.account_email = account.email;
		token.account_name = account.name;
		token.account_image = account.image;
		token.capabilities = vendor_api.oauth.capabilities(scopes);
		await locals.auth.connectOauthAccount(token, connect_user_id);
	} catch (err) {
		const parsed = DelightError.from(err);
		throw error(parsed.status, parsed.message);
	}
	throw redirect(307, redirect_after_signin);
}
