<script lang="ts">
	import { untrack } from 'svelte';
	import { Button, Tabs } from '@delightstack/components';
	import { DEFAULT_PLACE_COUNT } from '$lib/search-lab/seed';
	import SearchPanel from './SearchPanel.svelte';
	import FilterPanel from './FilterPanel.svelte';
	import SortPanel from './SortPanel.svelte';
	import FacetPanel from './FacetPanel.svelte';
	import VectorPanel from './VectorPanel.svelte';
	import GeoPanel from './GeoPanel.svelte';
	import DistinctPanel from './DistinctPanel.svelte';
	import RoutingPanel from './RoutingPanel.svelte';
	import DataPanel from './DataPanel.svelte';

	const { data } = $props();
	const db = $derived(data.db);

	// Seeded from the load once, then owned by the Data panel.
	let counts = $state(untrack(() => ({ ...data.counts })));
	let tab = $state(0);

	const TABS = [
		{ label: 'Search' },
		{ label: 'Filters' },
		{ label: 'Sort & paging' },
		{ label: 'Facets' },
		{ label: 'Vector' },
		{ label: 'Geo' },
		{ label: 'Distinct' },
		{ label: 'Routing' },
		{ label: 'Data' },
	];

	const seeded = $derived(counts.places > 0);
</script>

<svelte:head>
	<title>Search Lab</title>
</svelte:head>

<article>
	<header>
		<h1>Search Lab</h1>
		<p>
			Every part of the query DSL, pointed at one corpus of places and the organizations
			that run them. Each panel prints the query it ran, so what you see on screen is the
			query language, not a paraphrase of it.
		</p>
		{#if seeded}
			<p class="corpus">
				{counts.places.toLocaleString()} places · {counts.organizations} organizations
			</p>
		{/if}
	</header>

	{#if !seeded}
		<section class="empty">
			<h2>Nothing to search yet</h2>
			<p>
				The lab runs on a generated corpus: about {DEFAULT_PLACE_COUNT} places across six cities,
				clustered so geo queries have real boundaries, with deliberate gaps in the nullable
				fields and enough odd text — emails, acronyms, diacritics, camelCase — to make tokenizer
				behaviour visible.
			</p>
			<p>
				It is deterministic. The same seed always produces the same places, the same
				ratings, and the same 64-dimension vectors.
			</p>
			<Button onclick={() => (tab = 8)}>Go to the Data panel and seed it</Button>
		</section>
	{/if}

	<Tabs {tab} tabs={TABS} pills onchange={(detail) => (tab = detail.tab)}>
		{#if tab === 0}
			<SearchPanel />
		{:else if tab === 1}
			<FilterPanel />
		{:else if tab === 2}
			<SortPanel />
		{:else if tab === 3}
			<FacetPanel />
		{:else if tab === 4}
			<VectorPanel />
		{:else if tab === 5}
			<GeoPanel />
		{:else if tab === 6}
			<DistinctPanel />
		{:else if tab === 7}
			<RoutingPanel {db} />
		{:else if tab === 8}
			<DataPanel {db} bind:counts />
		{/if}
	</Tabs>
</article>

<style>
	article {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
	}

	header {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		max-width: 68ch;

		h1 {
			font-family: var(--font-serif);
			font-size: var(--font-size-5);
			line-height: 1.1;
		}
		p {
			color: var(--color-text-muted);
		}
	}

	.corpus {
		font-size: var(--font-size-00);
		font-family: var(--font-mono);
		color: var(--color-text-disabled);
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: start;
		gap: var(--space-3);
		max-width: 62ch;
		--inset: var(--space-5);
		--radius-inner: var(--radius-md);
		padding: var(--inset);
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: calc(var(--radius-inner) + var(--inset));

		h2 {
			font-family: var(--font-serif);
			font-size: var(--font-size-2);
		}
		p {
			font-size: var(--font-size-0);
			color: var(--color-text-muted);
		}
	}
	@supports (corner-shape: squircle) {
		.empty {
			corner-shape: squircle;
			border-radius: calc((var(--radius-inner) + var(--inset)) * 2);
		}
	}
</style>
