import { redirect } from '@sveltejs/kit';

export async function load({ locals, url }) {
	const { authState } = locals;
	if (authState.signed_in) {
		let redirect_url = url.searchParams.get('redirect') || '/dashboard';
		if (!redirect_url.startsWith('/')) {
			const invalid_url =
				!redirect_url.match(/^https?:\/\//) || new URL(redirect_url).host !== url.host;
			if (invalid_url) redirect_url = '/dashboard';
		}
		throw redirect(307, redirect_url || '/dashboard');
	}
}
