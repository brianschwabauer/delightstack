import { redirect } from '@sveltejs/kit';

export async function load({ locals, cookies, url, request }) {
	const { auth, authState } = locals;

	// Check the origin of the request to prevent CSRF attacks
	const origin = request.headers.get('origin') || request.headers.get('referer');
	if (!origin || !origin.startsWith(url.origin)) {
		throw redirect(307, '/');
	}

	if (authState.token) {
		await auth.revokeSession(authState.token.jti).catch(() => undefined);
	}
	cookies.delete('foreverfamily-session', { path: '/' });
	cookies.delete('foreverfamily-org', { path: '/' });

	let redirect_url = url.searchParams.get('redirect') || '/';
	if (!redirect_url.startsWith('/')) {
		const invalid_url =
			!redirect_url.match(/^https?:\/\//) || new URL(redirect_url).host !== url.host;
		if (invalid_url) redirect_url = '/';
	}
	throw redirect(307, redirect_url);
}
