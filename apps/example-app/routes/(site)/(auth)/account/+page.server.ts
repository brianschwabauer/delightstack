import { redirect } from '@sveltejs/kit';

export async function load({ locals, url }) {
	if (locals.authState.signed_out) throw redirect(302, '/signin');
	if (!locals.authState.verified) {
		const params = new URLSearchParams(url.search);
		throw redirect(307, `/account/verify-email${params.size ? '?' : ''}${params}`);
	}
}
