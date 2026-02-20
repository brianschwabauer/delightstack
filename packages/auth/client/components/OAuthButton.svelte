<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { AuthClient } from '../auth.client.svelte';

	interface OAuthState {
		vendor: string;
		handleClick: () => void;
	}

	interface Props {
		/** The AuthClient instance */
		auth: AuthClient;
		/** The OAuth vendor name (e.g. 'google', 'github') */
		vendor: string;
		/** Redirect URL after sign-in */
		redirect_to?: string;
		/** Headless render snippet */
		children?: Snippet<[OAuthState]>;
	}

	let {
		auth,
		vendor,
		redirect_to = '/dashboard',
		children,
	}: Props = $props();

	function handleClick() {
		auth.api.signIn.oauth(vendor, { redirect_to });
	}
</script>

{#if children}
	{@render children({ vendor, handleClick })}
{:else}
	<button type="button" onclick={handleClick}>
		Continue with {vendor}
	</button>
{/if}
