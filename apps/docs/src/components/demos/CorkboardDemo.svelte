<script lang="ts">
	import Corkboard from '@delightstack/components/display/Corkboard.svelte';
	import type { ReorderPlan as CorkboardReorderPlan } from '@delightstack/components/display/corkboard-model';

	interface Scene {
		id: string;
		title: string;
		synopsis: string;
		words: number;
	}

	let scenes = $state<Scene[]>([
		{
			id: 'arrival',
			title: 'Arrival',
			synopsis: 'Elias reaches the lighthouse at dusk; the lamp still turns.',
			words: 1840,
		},
		{
			id: 'cottage',
			title: 'The cottage',
			synopsis: 'Every window boarded. A key that fits nothing.',
			words: 920,
		},
		{
			id: 'ledger',
			title: 'The ledger',
			synopsis: 'Eleven years of entries, and the last one unfinished.',
			words: 1430,
		},
		{
			id: 'storm',
			title: 'First storm',
			synopsis: 'The generator fails. Someone answers the radio anyway.',
			words: 2210,
		},
		{
			id: 'landing',
			title: 'The landing',
			synopsis: 'A boat that should not have made the crossing.',
			words: 760,
		},
		{
			id: 'letters',
			title: 'Letters',
			synopsis: 'What the keeper wrote and never sent.',
			words: 1120,
		},
	]);

	let selected = $state<string[]>([]);
	let opened = $state('');

	function onreorder(plan: CorkboardReorderPlan) {
		const moving = scenes.filter((s) => plan.ids.includes(s.id));
		const kept = scenes.filter((s) => !plan.ids.includes(s.id));
		scenes = [...kept.slice(0, plan.index), ...moving, ...kept.slice(plan.index)];
	}
</script>

<div class="demo">
	<Corkboard
		cards={scenes}
		bind:selected
		reorderable
		aria_label="Scenes"
		label_of={(s) => s.title}
		{onreorder}
		onopen={(s) => (opened = s.title)}>
		{#snippet card(scene)}
			<article>
				<h4>{scene.title}</h4>
				<p>{scene.synopsis}</p>
				<footer>{scene.words.toLocaleString()} words</footer>
			</article>
		{/snippet}
	</Corkboard>
	<p class="report" aria-live="polite">
		{#if opened}Opened “{opened}”.{:else}Double-click or press Enter to open a card.{/if}
	</p>
</div>

<style>
	.demo {
		inline-size: 100%;
	}

	article {
		display: grid;
		gap: 0.375rem;
		block-size: 100%;
		padding: 0.75rem 0.875rem;
		border: 1px solid light-dark(rgb(0 0 0 / 0.12), rgb(255 255 255 / 0.14));
		border-radius: 8px;
		background: light-dark(#fff, rgb(255 255 255 / 0.04));
		cursor: grab;
	}

	@supports (corner-shape: squircle) {
		article {
			corner-shape: squircle;
			border-radius: 16px;
		}
	}

	h4 {
		margin: 0;
		font-size: 0.9375rem;
	}

	p {
		margin: 0;
		font-size: 0.8125rem;
		opacity: 0.75;
	}

	footer {
		font-size: 0.75rem;
		opacity: 0.55;
	}

	.report {
		margin-block-start: 1rem;
		font-size: 0.8125rem;
		opacity: 0.7;
	}
</style>
