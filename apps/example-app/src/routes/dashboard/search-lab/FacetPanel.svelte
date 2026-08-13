<script lang="ts">
	import { Button, Callout, Input } from '@delightstack/components';
	import Panel from './Panel.svelte';
	import QueryPreview from './QueryPreview.svelte';
	import ResultList from './ResultList.svelte';
	import { LabRunner, pruneQuery } from './lab.svelte';

	/** Price buckets, reused for both the facet definition and the click filter. */
	const PRICE_RANGES = [
		{ from: 0, to: 24 },
		{ from: 25, to: 49 },
		{ from: 50, to: 99 },
		{ from: 100, to: 1000 },
	];

	const FACETS = {
		category: { limit: 12, sort: 'desc' },
		'address.city': { limit: 8, sort: 'desc' },
		status: { limit: 6, sort: 'desc' },
		amenities: { limit: 8, sort: 'desc' },
		price: { ranges: PRICE_RANGES },
		open_late: { true: true, false: true },
	} as const;

	/** How each facet's clicked value becomes a `where` clause. */
	const FACET_KIND: Record<string, 'enum' | 'array' | 'number_range' | 'boolean'> = {
		category: 'enum',
		'address.city': 'enum',
		status: 'enum',
		amenities: 'array',
		price: 'number_range',
		open_late: 'boolean',
	};

	const FACET_LABEL: Record<string, string> = {
		category: 'Category (enum)',
		'address.city': 'City (child path)',
		status: 'Status (enum)',
		amenities: 'Amenities (enum[])',
		price: 'Typical spend (number ranges)',
		open_late: 'Open late (boolean)',
	};

	let term = $state('');
	/** field → the selected facet value, or absent. One selection per facet. */
	let selected = $state<Record<string, string>>({});

	const runner = new LabRunner('place');

	const where = $derived.by(() => {
		const clauses: Record<string, unknown>[] = [];
		for (const [field, value] of Object.entries(selected)) {
			const kind = FACET_KIND[field];
			if (kind === 'array') clauses.push({ [field]: { contains_any: [value] } });
			else if (kind === 'boolean') clauses.push({ [field]: value === 'true' });
			else if (kind === 'number_range') {
				const [from, to] = value.split('-').map(Number);
				clauses.push({ [field]: { between: [from, to] } });
			} else clauses.push({ [field]: { eq: value } });
		}
		if (clauses.length === 0) return undefined;
		if (clauses.length === 1) return clauses[0];
		return { and: clauses };
	});

	const query = $derived(pruneQuery({ term, where, facets: FACETS, limit: 10 }));

	$effect(() => {
		runner.schedule(query);
	});

	function toggle(field: string, value: string) {
		const next = { ...selected };
		if (next[field] === value) delete next[field];
		else next[field] = value;
		selected = next;
	}

	/** Largest count in a facet, so the inline bars share a scale per facet. */
	function peak(values: Record<string, number>): number {
		return Math.max(1, ...Object.values(values));
	}

	/**
	 * The engine returns facets keyed alphabetically; render them in the order
	 * they were asked for instead, so the cheap enum facets read first and the
	 * price buckets sit where the eye expects them.
	 */
	const facet_entries = $derived.by(() => {
		const facets = runner.result?.facets ?? {};
		return Object.keys(FACET_LABEL)
			.filter((field) => facets[field] !== undefined)
			.map((field) => [field, facets[field]] as const);
	});
	const selection_count = $derived(Object.keys(selected).length);
</script>

<Panel
	title="Facets"
	blurb="facets · string/enum · enum[] · number ranges · boolean · click to filter">
	{#snippet controls()}
		<Input
			type="search"
			label="Narrow with a term first"
			placeholder="Optional"
			clearable
			bind:value={() => term, (next) => (term = String(next ?? ''))} />

		<Callout tip title="Counts follow the filter">
			Facet counts are computed over the documents that survived
			<code>where</code>
			, not over the whole table — pick a city and watch every other facet's numbers drop with
			it.
		</Callout>

		<Button transparent onclick={() => (selected = {})} disabled={selection_count === 0}>
			Clear {selection_count} facet selection{selection_count === 1 ? '' : 's'}
		</Button>
	{/snippet}

	<QueryPreview
		query={runner.echo}
		elapsed={runner.elapsed}
		round_trip_ms={runner.round_trip_ms}
		count={runner.result?.count} />

	{#if facet_entries.length > 0}
		<div class="facets">
			{#each facet_entries as [field, facet] (field)}
				{@const max = peak(facet.values)}
				<section>
					<h4>
						{FACET_LABEL[field] ?? field}
						<span>{facet.count} bucket{facet.count === 1 ? '' : 's'}</span>
					</h4>
					<ul>
						{#each Object.entries(facet.values) as [value, count] (value)}
							<li>
								<button
									type="button"
									class:on={selected[field] === value}
									onclick={() => toggle(field, value)}
									aria-pressed={selected[field] === value}>
									<span class="bar" style:--fill="{Math.round((count / max) * 100)}%">
									</span>
									<span class="value">{value}</span>
									<span class="count">{count.toLocaleString()}</span>
								</button>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{/if}

	<ResultList
		hits={runner.result?.hits ?? []}
		loading={runner.loading}
		error={runner.error}
		empty_hint="Every facet bucket is empty for this combination." />
</Panel>

<style>
	.facets {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
		gap: var(--space-5) var(--space-6);
	}

	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	h4 {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
		font-size: var(--font-size-00);
		font-weight: 600;

		span {
			font-weight: 400;
			color: var(--color-text-disabled);
		}
	}

	ul {
		display: flex;
		flex-direction: column;
		list-style: none;
	}

	button {
		position: relative;
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		font-size: var(--font-size-00);
		cursor: pointer;
		overflow: hidden;
		transition: color 250ms;

		/* The bar is the background, so the label always sits on top of it and
		   nothing shifts when a row is selected. */
		&:hover .bar {
			background: oklch(from var(--color-action) l c h / 0.28);
			transition: none;
		}
		&.on {
			color: var(--color-action-text);
			font-weight: 600;
		}
		&.on .bar {
			background: oklch(from var(--color-action) l c h / 0.42);
		}
		&:active {
			translate: 0 1px;
		}
	}

	.bar {
		position: absolute;
		inset: 0 auto 0 0;
		width: var(--fill);
		background: oklch(from var(--color-action) l c h / 0.16);
		border-radius: var(--radius-sm);
		transition:
			width 320ms var(--ease-default),
			background-color 280ms;
	}

	.value {
		position: relative;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-align: left;
	}

	.count {
		position: relative;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted);
	}

	code {
		font-family: var(--font-mono);
		font-size: 0.9em;
	}
</style>
