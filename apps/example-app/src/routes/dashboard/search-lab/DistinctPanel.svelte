<script lang="ts">
	import {
		Button,
		ButtonGroup,
		Callout,
		Code,
		Input,
		Toggle,
	} from '@delightstack/components';
	import Panel from './Panel.svelte';
	import QueryPreview from './QueryPreview.svelte';
	import ResultList from './ResultList.svelte';
	import { LabRunner, pruneQuery } from './lab.svelte';

	const DISTINCT_FIELDS = [
		{ value: '', label: 'off' },
		{ value: 'address.city', label: 'address.city' },
		{ value: 'category', label: 'category' },
		{ value: 'status', label: 'status' },
		{ value: 'organization_name', label: 'organization_name' },
	];

	let distinct_on = $state('address.city');
	let sparse = $state(true);
	let term = $state('');

	const runner = new LabRunner('place');

	const query = $derived(
		pruneQuery({
			term,
			distinct_on: distinct_on || undefined,
			sparse,
			limit: 20,
		}),
	);

	$effect(() => {
		runner.schedule(query);
	});

	/** The first hit's raw document — the clearest way to show what `sparse` costs. */
	const sample = $derived(
		runner.result?.hits[0]
			? JSON.stringify(
					// The vector would be 64 numbers of noise in a shape demo.
					Object.fromEntries(
						Object.entries(runner.result.hits[0].document).filter(
							([key]) => key !== 'embedding',
						),
					),
					null,
					2,
				)
			: '',
	);

	const field_count = $derived(
		runner.result?.hits[0] ? Object.keys(runner.result.hits[0].document).length : 0,
	);
</script>

<Panel title="Distinct &amp; document shape" blurb="distinct_on · sparse · elapsed">
	{#snippet controls()}
		<div class="group">
			<h5>distinct_on</h5>
			<ButtonGroup orientation="vertical">
				{#each DISTINCT_FIELDS as field (field.value)}
					<Button
						outline
						active={distinct_on === field.value}
						onclick={() => (distinct_on = field.value)}>
						{field.label}
					</Button>
				{/each}
			</ButtonGroup>
			<p class="muted">
				Keeps the highest-scoring hit per distinct value — one place per city, or per
				category.
			</p>
		</div>

		<Toggle
			bind:checked={sparse}
			label="sparse"
			on_label="Search fields only"
			off_label="Full entity from SQLite"
			tooltip="Off, the engine reads the row back out of SQLite" />

		<Input
			type="search"
			label="Term"
			placeholder="Optional"
			clearable
			bind:value={() => term, (next) => (term = String(next ?? ''))} />
	{/snippet}

	<Callout tip title="Watch the timing, not just the rows">
		<code>sparse: false</code>
		makes the engine fetch every matching row out of SQLite and re-hydrate the JSON column.
		The engine time in the query card below is the honest measure of that.
	</Callout>

	<QueryPreview
		query={runner.echo}
		elapsed={runner.elapsed}
		round_trip_ms={runner.round_trip_ms}
		count={runner.result?.count} />

	{#if sample}
		<section>
			<h4>
				First document
				<span>{field_count} field{field_count === 1 ? '' : 's'} · embedding elided</span>
			</h4>
			<Code
				code={sample}
				language="json"
				show_line_numbers={false}
				max_height="16rem"
				wrap />
		</section>
	{/if}

	<ResultList
		hits={runner.result?.hits ?? []}
		loading={runner.loading}
		error={runner.error}
		empty_hint="Nothing matched." />
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

	.muted {
		font-size: var(--font-size-00);
		color: var(--color-text-disabled);
	}

	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	h4 {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		font-size: var(--font-size-0);
		font-weight: 600;

		span {
			font-size: var(--font-size-00);
			font-weight: 400;
			color: var(--color-text-disabled);
		}
	}

	code {
		font-family: var(--font-mono);
		font-size: 0.9em;
	}
</style>
