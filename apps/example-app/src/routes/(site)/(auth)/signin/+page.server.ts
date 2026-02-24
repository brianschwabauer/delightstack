import { env } from '$env/dynamic/private';
import { DelightError, decodeJwt } from '@packages/lib';
import { error, redirect } from '@sveltejs/kit';

export async function load({ locals, url, cookies }) {
	const { authState } = locals;
	let signed_in = authState.signed_in;

	// Check if the user is signing in with an email token
	const raw_token = url.searchParams.get('token');
	if (raw_token) {
		try {
			const email_signin_token = await decodeJwt<'email_signin'>(
				env.JWT_KEY_SECRET,
				raw_token,
			);
			if (email_signin_token.typ === 'email_signin') {
				const { jwt } = await locals.auth.signInWithEmailToken(
					{ email_signin_token: raw_token },
					locals.authState.meta,
				);
				const orgID = email_signin_token.sub;
				if (jwt) cookies.set('foreverfamily-session', jwt, { path: '/' });
				if (orgID) cookies.set('foreverfamily-org', orgID, { path: '/' });
				signed_in = true;
			}
		} catch (err) {
			const parsed = DelightError.from(err);
			throw error(parsed.status, parsed.toJSON());
		}
	}

	if (signed_in) {
		let redirect_url = url.searchParams.get('redirect') || '/dashboard';
		if (!redirect_url.startsWith('/')) {
			const invalid_url =
				!redirect_url.match(/^https?:\/\//) || new URL(redirect_url).host !== url.host;
			if (invalid_url) redirect_url = '/dashboard';
		}
		throw redirect(307, redirect_url || '/dashboard');
	}
}
