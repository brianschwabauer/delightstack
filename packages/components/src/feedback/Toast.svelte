<script lang="ts">
	import { flip } from 'svelte/animate';
	import { scale } from 'svelte/transition';
	import { backOut, backIn } from 'svelte/easing';
	import { toast } from './toast-state.svelte';

	const {
		/** Whether the background color should be the accent/primary/brand color. */
		accent = false,
		/** The css style string added to the component from the parent */
		style = '',
		/** Specifies a custom class name for the container element */
		class: className = '',
	} = $props();

	const list = $derived(toast.getList());
</script>

{#if list.length}
	<section class="toast-group {className}" style:--max-chars="{120}ch" {style}>
		{#each list as bread (bread.id)}
			<output
				class="toast"
				class:success={bread.level === 'success'}
				class:error={bread.level === 'error'}
				class:accent
				aria-live="polite"
				id="toast-{bread.id}"
				animate:flip={{ easing: backOut, duration: 300 }}
				in:scale|global={{ easing: backOut, duration: 300, start: 0.5 }}
				out:scale|global={{ easing: backIn, duration: 150, start: 0 }}>
				{bread.message}
			</output>
		{/each}
	</section>
{/if}

<style lang="scss">
	.toast-group {
		--layer: 10;
		--c-bg: var(--c-action);
		--c-text: var(--c-action-text);
		--shadow: var(--shadow-2);
		position: fixed;
		z-index: var(--layer);

		inset-block-end: 0;
		inset-inline: 0;
		padding-block-end: max(
			5vh,
			calc(max(var(--navbar-height, 0px), var(--sheet-height, 0px)) + 1vh)
		);

		display: grid;
		justify-items: center;
		justify-content: center;
		gap: 1vh;

		/* optimizations */
		pointer-events: none;
	}

	.toast {
		background-color: var(--c-bg);
		color: var(--c-text);
		box-shadow: var(--shadow);
		border-radius: var(--radius-round);
		font-size: 1rem;
		max-width: min(calc(var(--max-chars) / 2.35), calc(90vw - 6ch));
		padding: 0.75rem 3ch;
		line-height: 1.25;
		box-sizing: content-box;
		word-break: break-all;

		@supports (text-wrap: balance) {
			word-break: break-word;
			text-wrap: balance;
			text-align: center;
		}

		&.error {
			background-color: var(--c-error);
			color: var(--c-error-text);
		}
		&.success {
			background-color: var(--c-success);
			color: var(--c-success-text);
		}
		&.accent {
			background-color: var(--c-accent);
			color: var(--c-accent-text);
		}
	}
</style>
