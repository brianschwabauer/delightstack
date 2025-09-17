import { redirect } from '@sveltejs/kit';

export async function load({ locals, cookies }) {
	if (!locals.authState.token) throw redirect(307, '/');

	const refreshed = await locals.auth
		.refreshSession(locals.authState.token.jti, locals.authState.meta)
		.catch(() => {
			cookies.delete('foreverfamily-session', { path: '/' });
			cookies.delete('foreverfamily-org', { path: '/' });
			return undefined;
		});
	if (refreshed) cookies.set('foreverfamily-session', refreshed.jwt, { path: '/' });
	if (refreshed?.decoded_jwt?.verified) throw redirect(307, '/dashboard');
}
