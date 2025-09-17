import { error, redirect } from '@sveltejs/kit';

export async function load({ locals, params, cookies, url }) {
	try {
		const { jwt } = await locals.auth.verifyEmail(
			params.email_verification_token,
			locals.authState.meta,
		);
		cookies.set('foreverfamily-session', jwt, { path: '/' });
	} catch (err) {
		throw error(400, `Invalid or expired email verification link`);
	}
	const path = url.searchParams.get('redirect')?.startsWith('/')
		? url.searchParams.get('redirect')
		: locals.authState.orgID
			? `/${locals.authState.orgID}/dashboard`
			: '/dashboard';
	throw redirect(
		307,
		`${url.origin}${path}?toast=${encodeURIComponent(`Successfully verified your email address!`)}`,
	);
}
