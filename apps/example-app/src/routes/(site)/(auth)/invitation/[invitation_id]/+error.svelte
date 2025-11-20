<script lang="ts">
	import { page } from '$app/state';
	import Button from '$lib/form/Button.svelte';
	const { data } = $props();
	const { authState } = $derived(data);
</script>

<div class="page">
	<article>
		<section data-sveltekit-noscroll>
			<h1>Invalid Invitation 😥</h1>
			<p class="message">
				{#if page.error?.message}
					{page.error.message}
				{:else}
					The invitation you are trying to view doesn't exist, has expired, or is invalid.
				{/if}
			</p>
			{#if authState.signed_in}
				<Button fullWidth href="/dashboard">Go to Dashboard</Button>
			{:else}
				<Button fullWidth href="/">Go to Home Page</Button>
			{/if}
		</section>
	</article>
</div>

<style>
	.page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: 0 0 4rem;
	}
	article {
		display: flex;
		flex-direction: column;
		max-width: 450px;
		width: 100%;
		padding: 0 1rem;
	}
	section {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}
	.message {
		background-color: var(--c-bg-active);
		border-radius: var(--radius-3);
		padding: 1rem 1.5rem;
	}
	p {
		text-wrap: pretty;
	}
</style>
