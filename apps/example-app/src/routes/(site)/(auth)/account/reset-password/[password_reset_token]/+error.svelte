<script lang="ts">
	import { page } from '$app/state';
	const message = $derived(page.error?.message || `Unknown error`);
</script>

<section>
	<h1>Oops, an error occurred 😥</h1>
	<p>
		The following error occurred when attempting to reset your password. Please try
		signing in, resetting your password, or contacting support.
	</p>
	<p class="message">{message}</p>
</section>

<style>
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
