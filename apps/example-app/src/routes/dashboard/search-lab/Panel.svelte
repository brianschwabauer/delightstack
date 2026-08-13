<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** What this panel is for. Sentence case, no trailing punctuation. */
		title: string;
		/** One line naming the DSL keys the panel exercises. */
		blurb: string;
		/** The controls column. */
		controls: Snippet;
		/** The results column. */
		children: Snippet;
	}

	let { title, blurb, controls, children }: Props = $props();
</script>

<section>
	<header>
		<h3>{title}</h3>
		<p>{blurb}</p>
	</header>

	<div class="split">
		<aside>{@render controls()}</aside>
		<div class="results">{@render children()}</div>
	</div>
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	header {
		display: flex;
		flex-direction: column;
		gap: 2px;

		h3 {
			font-size: var(--font-size-2);
			font-family: var(--font-serif);
		}
		p {
			font-size: var(--font-size-00);
			color: var(--color-text-muted);
			font-family: var(--font-mono);
		}
	}

	.split {
		display: grid;
		grid-template-columns: minmax(0, 19rem) minmax(0, 1fr);
		gap: var(--space-8);
		align-items: start;

		@media (max-width: 900px) {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--space-6);
		}
	}

	aside {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		position: sticky;
		top: var(--space-4);

		@media (max-width: 900px) {
			position: static;
		}
	}

	.results {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
	}
</style>
