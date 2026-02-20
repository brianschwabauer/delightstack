<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { AuthClient } from '../auth.client.svelte';

	interface Props {
		/** The AuthClient instance */
		auth: AuthClient;
		/** Content to render when authenticated */
		children: Snippet;
		/** Content to render when not authenticated */
		fallback?: Snippet;
	}

	let { auth, children, fallback }: Props = $props();
</script>

{#if auth.signed_in}
	{@render children()}
{:else if fallback}
	{@render fallback()}
{/if}
