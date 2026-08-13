<script lang="ts">
	import { Button, ButtonGroup, Callout, Input, Range } from '@delightstack/components';
	import Panel from './Panel.svelte';
	import QueryPreview from './QueryPreview.svelte';
	import ResultList from './ResultList.svelte';
	import { LabRunner, pruneQuery } from './lab.svelte';

	/**
	 * Sentences chosen so none of them shares a stem with the category it should
	 * find — if these work, the concept lexicon is doing the work, not BM25.
	 */
	const PROMPTS = [
		'somewhere to work all afternoon with fast wifi',
		'great espresso and a warm pastry',
		'quiet corner to read a novel',
		'live music and cocktails after midnight',
		'a place to stay near the river',
		'fresh produce and cheese under one roof',
	];

	type Mode = 'vector' | 'hybrid';
	const MODES: Mode[] = ['vector', 'hybrid'];

	let prompt = $state(PROMPTS[0]);
	let mode = $state<Mode>('vector');
	let term = $state('');
	let similarity = $state(0.8);

	const runner = new LabRunner('place');

	const query = $derived(
		pruneQuery({
			term: mode === 'hybrid' ? term : undefined,
			limit: 20,
			sparse: true,
		}),
	);

	$effect(() => {
		runner.schedule(query, {
			embed_text: prompt,
			embed_field: 'embedding',
			similarity,
		});
	});
</script>

<Panel
	title="Vector &amp; hybrid"
	blurb="vector.value · vector.field · vector.similarity · term + vector = hybrid">
	{#snippet controls()}
		<Input
			type="textarea"
			rows={3}
			label="Describe what you want"
			placeholder="somewhere to work all afternoon"
			bind:value={() => prompt, (next) => (prompt = String(next ?? ''))} />

		<div class="group">
			<h5>Mode</h5>
			<ButtonGroup>
				{#each MODES as option (option)}
					<Button outline active={mode === option} onclick={() => (mode = option)}>
						{option}
					</Button>
				{/each}
			</ButtonGroup>
			{#if mode === 'hybrid'}
				<Input
					type="search"
					label="Keyword term (fused with the vector)"
					placeholder="sourdough"
					clearable
					bind:value={() => term, (next) => (term = String(next ?? ''))} />
			{/if}
		</div>

		<Range
			min={0.3}
			max={1}
			step={0.01}
			show_value
			label="Minimum similarity"
			format_value={(value) => value.toFixed(2)}
			bind:value={() => similarity, (next) => (similarity = next as number)} />

		<div class="group">
			<h5>Prompts worth trying</h5>
			<div class="prompts">
				{#each PROMPTS as option (option)}
					<Button dense outline onclick={() => (prompt = option)}>
						{option.split(' ').slice(0, 3).join(' ')}…
					</Button>
				{/each}
			</div>
		</div>
	{/snippet}

	<Callout title="These always run on the server">
		Embeddings never reach the browser, so any query carrying <code>vector</code>
		is routed server-side before coverage is even considered. The lab sends the sentence, not
		the vector — the endpoint runs the same 64-dimension embedding function that produced the
		stored values at write time.
	</Callout>

	<QueryPreview
		query={runner.echo}
		elapsed={runner.elapsed}
		round_trip_ms={runner.round_trip_ms}
		count={runner.result?.count} />

	<ResultList
		hits={runner.result?.hits ?? []}
		loading={runner.loading}
		error={runner.error}
		empty_hint={`Nothing reached ${similarity.toFixed(2)} similarity. Drag the slider down.`} />
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

	.prompts {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	code {
		font-family: var(--font-mono);
		font-size: 0.9em;
	}
</style>
