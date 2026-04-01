<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children,
		dense = false,
	}: {
		children: Snippet;
		dense?: boolean;
	} = $props();
</script>

<span class="badge" class:dense>{@render children()}</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		padding: 0.15em 0.6em;
		font-size: var(--font-size-00);
		font-weight: var(--font-weight-6);
		border-radius: var(--radius-round);
		background: var(--color-bg-4);
		color: var(--color-text);
		white-space: nowrap;
	}
	.dense {
		padding: 0.1em 0.45em;
		font-size: 0.6rem;
	}
</style>
