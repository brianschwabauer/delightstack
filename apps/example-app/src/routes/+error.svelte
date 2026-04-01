<script lang="ts">
	import { Button } from '@delightstack/components';
	import { page } from '$app/state';
</script>

<div class="error-page">
	<h1>{page.error?.status ?? 500}</h1>
	<p>{page.error?.message ?? 'Something went wrong'}</p>
	<Button href="/">Go home</Button>
</div>

<style>
	.error-page {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		gap: var(--size-3);
		text-align: center;
		padding: var(--size-5);
	}
	h1 {
		font-size: var(--font-size-fluid-3);
		font-family: var(--font-serif);
	}
	p {
		color: var(--color-text-disabled);
		font-size: var(--font-size-2);
		max-width: var(--size-content-2);
	}
</style>
