<script lang="ts">
	import Corkboard from '@delightstack/components/display/Corkboard.svelte';
	import type { ReorderPlan as CorkboardReorderPlan } from '@delightstack/components/display/corkboard-model';

	interface Card {
		id: string;
		title: string;
		kind: 'folder' | 'scene';
		count?: number;
		droppable?: boolean;
	}

	let cards = $state<Card[]>([
		{ id: 'act-2', title: 'Act II', kind: 'folder', count: 9, droppable: true },
		{ id: 'ferry', title: 'The ferry', kind: 'scene' },
		{ id: 'argument', title: 'The argument', kind: 'scene' },
		{ id: 'act-3', title: 'Act III', kind: 'folder', count: 4, droppable: true },
		{ id: 'aftermath', title: 'Aftermath', kind: 'scene' },
	]);

	let dropped = $state('');

	function onreorder(plan: CorkboardReorderPlan) {
		const moving = cards.filter((c) => plan.ids.includes(c.id));
		const kept = cards.filter((c) => !plan.ids.includes(c.id));
		cards = [...kept.slice(0, plan.index), ...moving, ...kept.slice(plan.index)];
	}

	function ondropinto(detail: { ids: string[]; target: Card }) {
		const moving = cards.filter((c) => detail.ids.includes(c.id));
		cards = cards
			.filter((c) => !detail.ids.includes(c.id))
			.map((c) =>
				c.id === detail.target.id ? { ...c, count: (c.count ?? 0) + moving.length } : c,
			);
		dropped = `${moving.map((c) => `“${c.title}”`).join(', ')} → ${detail.target.title}`;
	}
</script>

<div class="demo">
	<Corkboard
		{cards}
		reorderable
		min_card_width={160}
		aria_label="Act structure"
		label_of={(c) => c.title}
		{onreorder}
		{ondropinto}>
		{#snippet card(item)}
			<article class:folder={item.kind === 'folder'}>
				<h4>{item.title}</h4>
				{#if item.kind === 'folder'}
					<p>{item.count} scenes</p>
				{/if}
			</article>
		{/snippet}
	</Corkboard>
	<p class="report" aria-live="polite">
		{#if dropped}Moved {dropped}.{:else}Drag a scene onto a folder card.{/if}
	</p>
</div>

<style>
	.demo {
		inline-size: 100%;
	}

	article {
		display: grid;
		gap: 0.25rem;
		block-size: 100%;
		min-block-size: 4.5rem;
		padding: 0.75rem 0.875rem;
		border: 1px solid light-dark(rgb(0 0 0 / 0.12), rgb(255 255 255 / 0.14));
		border-radius: 8px;
		background: light-dark(#fff, rgb(255 255 255 / 0.04));
		cursor: grab;
	}

	/* A folder reads as a small stack of cards. */
	article.folder {
		box-shadow:
			2px -2px 0 -1px light-dark(#fff, #2a2a2a),
			2px -2px 0 0 light-dark(rgb(0 0 0 / 0.12), rgb(255 255 255 / 0.14)),
			4px -4px 0 -1px light-dark(#fff, #2a2a2a),
			4px -4px 0 0 light-dark(rgb(0 0 0 / 0.1), rgb(255 255 255 / 0.1));
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

	.report {
		margin-block-start: 1rem;
		font-size: 0.8125rem;
		opacity: 0.7;
	}
</style>
