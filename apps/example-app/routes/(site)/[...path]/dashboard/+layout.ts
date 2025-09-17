import { browser } from '$app/environment';
import { Entities } from '$lib/state';
import { redirect } from '@sveltejs/kit';
import { untrack } from 'svelte';

let entities: Entities;

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

export async function load({ url, parent, fetch }) {
	const { authState } = await parent();

	// Redirect the user to the sign in page if they are not signed in
	if (authState.signed_out) throw redirect(307, `/signin${getRedirectQuery(url)}`);

	// Redirect the user to the email verification page if they have not verified their email
	if (!authState.verified) {
		throw redirect(307, `/account/verify-email${getRedirectQuery(url)}`);
	}

	// Redirect the user to the organization selection page if they have not selected an organization
	if (!authState.orgID) throw redirect(307, `/account${getRedirectQuery(url)}`);

	// Redirect the user to the subscription page if they have not subscribed to a plan yet
	const hasValidSubscription =
		!!authState.org?.subscription_id &&
		(authState.org?.subscription_status === 'active' ||
			authState.org?.subscription_status === 'trialing' ||
			authState.org?.subscription_status === 'past_due');
	if (!hasValidSubscription) {
		const new_url = new URL(url);
		new_url.searchParams.delete('org');
		throw redirect(
			307,
			`/account/${authState.orgID}/subscription${getRedirectQuery(new_url)}`,
		);
	}

	if (browser) {
		if (!entities) entities = new Entities(fetch, authState);
	}
	return { entities: entities || new Entities(fetch, authState) };
}
