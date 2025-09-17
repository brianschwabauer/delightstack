import { env } from '$env/dynamic/private';
import { decodeJwt } from '@packages/lib';
import { error, redirect } from '@sveltejs/kit';

export async function load({ locals, params, url }) {
	try {
		const token = await decodeJwt<'password_reset'>(
			env.JWT_KEY_SECRET,
			params.password_reset_token,
		);
		await locals.auth.getSession(token.jti);
		const signInMethod = await locals.auth.getSignInMethod(token.sub);
		return { email: signInMethod.email };
	} catch (err) {
		if (locals.authState.signed_in) {
			const path = url.searchParams.get('redirect')?.startsWith('/')
				? url.searchParams.get('redirect')
				: locals.authState.orgID
					? `/${locals.authState.orgID}/dashboard`
					: '/dashboard';
			throw redirect(307, `${url.origin}${path}`);
		}
		throw error(400, `Invalid or expired password reset link`);
	}
}
