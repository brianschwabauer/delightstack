import { redirect } from '@sveltejs/kit';
import { untrack } from 'svelte';

function getRedirectQuery(url: URL) {
	return untrack(() => {
		const params = new URLSearchParams(url.search);
		const redirectPath = url.pathname.match(/^\/dashboard$/) ? '' : url.pathname;
		params.delete('redirect');
		if (redirectPath && redirectPath !== '/') params.set('redirect', redirectPath);
		const query = params.toString();
		return query ? `?${query}` : '';
	});
}

export async function load({ url, parent }) {
	const { auth } = await parent();

	// Redirect the user to the sign in page if they are not signed in
	if (auth.signed_out) throw redirect(307, `/signin${getRedirectQuery(url)}`);

	// Redirect the user to the email verification page if they have not verified their email
	if (!auth.verified) {
		throw redirect(307, `/account/verify-email${getRedirectQuery(url)}`);
	}

	// Redirect the user to the organization selection page if they have not selected an organization
	if (!auth.org_id) throw redirect(307, `/account${getRedirectQuery(url)}`);
}
