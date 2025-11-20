import { redirect } from '@sveltejs/kit';

export async function load({ locals, url }) {
	const params = new URLSearchParams(url.search);
	if (!locals.authState.token || !locals.authState.signed_in) {
		if (!params.has('redirect') && !url.pathname.endsWith('/dashboard')) {
			params.set('redirect', url.pathname);
		}
		throw redirect(307, `/signin${params.size ? '?' : ''}${params}`);
	}
	params.delete('org');
	params.delete('redirect');
	if (!locals.authState.verified) {
		throw redirect(307, `/account/verify-email${params.size ? '?' : ''}${params}`);
	}
	if (!locals.authState.orgID) {
		if (locals.authState.org_ids.length === 1) {
			throw redirect(
				307,
				`/${locals.authState.org_ids[0]}${url.pathname}${params.size ? '?' : ''}${params}`,
			);
		} else {
			throw redirect(307, `/account${params.size ? '?' : ''}${params}`);
		}
	}
	throw redirect(
		307,
		`/${locals.authState.orgID}${url.pathname}${params.size ? '?' : ''}${params}`,
	);
}
