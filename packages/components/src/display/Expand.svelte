<script lang="ts">
	import { type Snippet } from 'svelte';

	let {
		show = $bindable(false),
		style = '',
		children = undefined as undefined | Snippet,
	} = $props();
</script>

{#if children}
	<div class="expand" class:show inert={!show} {style}>
		<div>{@render children()}</div>
	</div>
{/if}

<style>
	.expand {
		display: grid;
		grid-template-rows: min-content 0fr;
		transition:
			grid-template-rows 300ms cubic-bezier(0.23, 1, 0.32, 1),
			opacity 200ms;
		opacity: 0;
		&::before {
			content: '';
		}
		:global(> *) {
			visibility: hidden;
			overflow: hidden;
			transition-behavior: allow-discrete;
			transition: visibility 0ms 200ms;
		}
		&.show {
			opacity: 1;
			grid-template-rows: min-content 1fr;
			:global(> *) {
				visibility: visible;
				transition: visibility 0ms;
			}
		}
	}
</style>
