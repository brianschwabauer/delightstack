import { AuthState } from '$lib/state/auth.state.svelte';

export async function load({ data }) {
	return {
		authState: AuthState.from(data.authState),
		application: data.application,
		scopes: data.scopes,
		redirect_uri: data.redirect_uri,
	};
}
