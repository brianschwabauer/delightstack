<script lang="ts">
	import {
		Button,
		ButtonGroup,
		Input,
		Range,
		Select,
		Toggle,
	} from '@delightstack/components';
	import Panel from './Panel.svelte';
	import QueryPreview from './QueryPreview.svelte';
	import ResultList from './ResultList.svelte';
	import { LabRunner, pruneQuery } from './lab.svelte';

	/** The text fields worth pointing a term at. */
	const TERM_FIELDS = [
		{ value: 'name', label: 'name' },
		{ value: 'description', label: 'description' },
		{ value: 'tags', label: 'tags' },
		{ value: 'organization_name', label: 'organization_name (derived)' },
		{ value: 'address.city', label: 'address.city' },
		{ value: 'category', label: 'category' },
		{ value: 'status', label: 'status' },
	];

	/** Fields the boost sliders drive. */
	const BOOSTABLE = ['name', 'description', 'tags', 'organization_name'] as const;

	/**
	 * Each one lands on a different tokenizer rule. `hint` says what to watch —
	 * these are the cases where a search engine is either right or obviously
	 * wrong, and nothing else in the panel makes them visible.
	 */
	const PROBES = [
		{
			term: 'dat',
			tolerance: 0,
			hint: 'Prefix — matches DataOps, and nothing else starting "dat".',
		},
		{
			term: 'resturant',
			tolerance: 2,
			hint: 'Typo — needs tolerance 2 to reach "restaurant".',
		},
		{
			term: 'northwind.example',
			tolerance: 0,
			hint: 'Email — the domain survives tokenization.',
		},
		{ term: 'DataOps', tolerance: 0, hint: 'camelCase — splits into "data" and "ops".' },
		{ term: 'Café', tolerance: 0, hint: 'Diacritics — folds to "cafe" on both sides.' },
		{
			term: 'sourdough bread',
			tolerance: 0,
			hint: 'Two tokens — try threshold 0 to require both.',
		},
	];

	let term = $state('');
	let tolerance = $state(0);
	let exact = $state(false);
	let threshold = $state(1);
	let fields = $state<string[]>([]);
	let boost = $state<Record<string, number>>({
		name: 1,
		description: 1,
		tags: 1,
		organization_name: 1,
	});
	let hint = $state<string | null>(null);

	const runner = new LabRunner('place');

	// Only send `boost` when the user actually moved a slider — an all-ones map
	// is noise in the query preview.
	const active_boost = $derived(
		Object.fromEntries(Object.entries(boost).filter(([, value]) => value !== 1)),
	);

	const query = $derived(
		pruneQuery({
			term,
			limit: 20,
			tolerance: tolerance || undefined,
			exact: exact || undefined,
			threshold: threshold === 1 ? undefined : threshold,
			fields: fields.length > 0 ? fields : undefined,
			boost: active_boost,
		}),
	);

	$effect(() => {
		runner.schedule(query);
	});

	function applyProbe(probe: (typeof PROBES)[number]) {
		term = probe.term;
		tolerance = probe.tolerance;
		exact = false;
		hint = probe.hint;
	}
</script>

<Panel
	title="Full-text search"
	blurb="term · tolerance · exact · threshold · fields · boost">
	{#snippet controls()}
		<Input
			type="search"
			label="Term"
			placeholder="espresso"
			clearable
			bind:value={
				() => term,
				(next) => {
					term = String(next ?? '');
					hint = null;
				}
			} />

		<div class="group">
			<h5>Typo tolerance</h5>
			<ButtonGroup>
				{#each [0, 1, 2] as level (level)}
					<Button
						outline
						active={tolerance === level}
						onclick={() => (tolerance = level)}
						tooltip={level === 0
							? 'Exact token match only'
							: `Up to ${level} edits per token`}>
						{level}
					</Button>
				{/each}
			</ButtonGroup>
		</div>

		<div class="group">
			<h5>Multi-token threshold</h5>
			<ButtonGroup>
				<Button outline active={threshold === 0} onclick={() => (threshold = 0)}>
					0 — all tokens
				</Button>
				<Button outline active={threshold === 1} onclick={() => (threshold = 1)}>
					1 — any token
				</Button>
			</ButtonGroup>
		</div>

		<Toggle
			bind:checked={exact}
			label="Exact match"
			tooltip="Off, the last token is treated as a prefix" />

		<Select
			multiple
			searchable
			clearable
			label="Fields searched"
			placeholder="All searchable fields"
			options={TERM_FIELDS}
			bind:value={
				() => fields, (next) => (fields = (next as string[] | undefined) ?? [])
			} />

		<div class="group">
			<h5>Per-field boost</h5>
			{#each BOOSTABLE as field (field)}
				<Range
					min={0}
					max={5}
					step={0.5}
					show_value
					label={field}
					format_value={(value) => `×${value}`}
					bind:value={() => boost[field], (next) => (boost[field] = next as number)} />
			{/each}
		</div>
	{/snippet}

	<div class="probes">
		<span>Try</span>
		{#each PROBES as probe (probe.term)}
			<Button dense outline onclick={() => applyProbe(probe)}>
				{probe.term}
			</Button>
		{/each}
	</div>

	{#if hint}
		<p class="hint">{hint}</p>
	{/if}

	<QueryPreview
		query={runner.echo}
		elapsed={runner.elapsed}
		round_trip_ms={runner.round_trip_ms}
		count={runner.result?.count} />

	<ResultList
		hits={runner.result?.hits ?? []}
		loading={runner.loading}
		error={runner.error}
		empty_hint={term
			? `Nothing matched “${term}”. Raise tolerance, or turn exact match off.`
			: 'Type a term, or press one of the probes above.'} />
</Panel>

<style>
	.group {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);

		h5 {
			font-size: var(--font-size-00);
			font-weight: 600;
			color: var(--color-text-muted);
		}
	}

	.probes {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);

		span {
			font-size: var(--font-size-00);
			color: var(--color-text-disabled);
		}
	}

	.hint {
		font-size: var(--font-size-00);
		color: var(--color-text-muted);
		padding: var(--space-2) var(--space-3);
		border-left: 2px solid var(--color-action);
		background: oklch(from var(--color-action) l c h / 0.06);
	}
</style>
