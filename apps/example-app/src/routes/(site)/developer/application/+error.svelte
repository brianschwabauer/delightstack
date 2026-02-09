<script lang="ts">
	import { page } from '$app/state';
	import Button from '$lib/form/Button.svelte';
</script>

<div class="page">
	<article>
		<section data-sveltekit-noscroll>
			<h1>Unknown Error</h1>
			<p class="message">
				{#if page.error?.message}
					{page.error.message}
				{:else}
					The OAuth applications couldn't be loaded
				{/if}
			</p>
			<Button fullWidth href="/developer">Go to Developer Portal</Button>
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
		background-color: var(--color-bg-active);
		border-radius: var(--radius-3);
		padding: 1rem 1.5rem;
	}
	p {
		text-wrap: pretty;
	}
</style>
