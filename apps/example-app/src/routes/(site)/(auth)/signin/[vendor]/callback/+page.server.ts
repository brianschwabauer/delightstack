import { env } from '$env/dynamic/private';
import { DelightError, decodeJwt } from '@packages/lib';
import { getOauthToken } from '@packages/lib';
import { type OauthVendor } from '@packages/lib';
import type { OauthToken, SessionToken } from '@packages/types';
import { error, redirect } from '@sveltejs/kit';

export async function load({ locals, params, url, cookies }) {
	const { getVendorApi } = locals;
	let redirect_after_signin = '/dashboard';

	try {
		const vendor_api = await getVendorApi(params.vendor as OauthVendor);
		const state = url.searchParams.get('state');
		if (!state) {
			throw {
				status: 400,
				message: `Oauth callback state not provided`,
			};
		}
		let signup_data: SessionToken<'oauth_authorize'>['signup'] | undefined;
		let connect_user_id: string | undefined;
		let scopes: string[] = [];
		try {
			const decoded_jwt = await decodeJwt<'oauth_authorize'>(env.JWT_KEY_SECRET, state);
			if (decoded_jwt.typ !== 'oauth_authorize') {
				throw { status: 400, message: 'Invalid oauth state' };
			}
			connect_user_id = decoded_jwt.uid;
			signup_data = decoded_jwt.signup;
			scopes = decoded_jwt.scopes || [];
			if (decoded_jwt.redirect) redirect_after_signin = decoded_jwt.redirect;
		} catch (error) {
			throw {
				status: 400,
				message: `Invalid or expired state token`,
			};
		}

		const auth_code = url.searchParams.get('code');
		if (!auth_code) {
			throw {
				status: 400,
				message: `Authorization code not provided`,
			};
		}
		const token = await getOauthToken(vendor_api.config, {
			vendor: params.vendor,
			auth_code,
			redirect_url: `${url.protocol}//${url.host}${url.pathname}`,
		});
		if (!token?.access_token) {
			throw { status: 500, message: `Couldn't get oauth access token` };
		}
		vendor_api.token = token as OauthToken;
		const account = await vendor_api.oauth.account();
		if (!account?.id) {
			await vendor_api.oauth.revoke().catch(() => undefined);
			throw {
				status: 500,
				message: `Couldn't get user ID from oauth account`,
			};
		}
		if (!account.verified) {
			throw {
				status: 403,
				message: `Your ${params.vendor} account's email has been not verified.`,
			};
		}
		token.vendor_id = account.id;
		token.account_email = account.email;
		token.account_name = account.name;
		token.account_image = account.image;
		token.capabilities = vendor_api.oauth.capabilities(scopes);
		const { jwt, type, user_id, user_auth_id, decoded_jwt } =
			await locals.auth.signInWithOauth(
				token,
				{ connect_user_id, invitation_id: signup_data?.invitation_id },
				locals.authState.meta,
			);
		cookies.set('foreverfamily-session', jwt, { path: '/' });

		if (type === 'new-signin-method') {
			try {
				const methods = await locals.auth.listSignInMethods(user_id);
				const notify_users = methods.list.filter(
					(method) =>
						method.id !== user_auth_id &&
						!!method.verified_at &&
						method.email &&
						method.email !== decoded_jwt.email,
				);
				if (notify_users.length) {
					await fetch(`https://api.resend.com/emails`, {
						method: 'POST',
						headers: {
							Authorization: `Bearer ${env.RESEND_KEY}`,
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({
							from: `Forever Family <support@email.foreverfamily.app>`,
							to: notify_users.map((user) => user.email),
							subject: `New sign-in method for Forever Family`,
							html: `
							<p>Hello,</p>
							<p>A new sign in method was added to your Forever Family account with the email: ${decoded_jwt.email}.</p>
							<p>If you didn't intend to add that email to your account, you can remove it in your account settings.</p>
							<p>Thanks,</p>
							<p>The Forever Family team</p>
						`,
						}),
					});
				}
			} catch (error) {}
		}
	} catch (err) {
		const parsed = DelightError.from(err);
		throw error(parsed.status, parsed.message);
	}
	throw redirect(307, redirect_after_signin);
}
