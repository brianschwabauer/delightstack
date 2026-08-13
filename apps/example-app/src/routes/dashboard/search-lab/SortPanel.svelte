<script lang="ts">
	import { Button, ButtonGroup, Callout, Input, Select } from '@delightstack/components';
	import Panel from './Panel.svelte';
	import QueryPreview from './QueryPreview.svelte';
	import ResultList from './ResultList.svelte';
	import { LabRunner, pruneQuery } from './lab.svelte';

	/** Only fields declared `.sortable()` (plus the always-present timestamps). */
	const SORT_FIELDS = [
		{ value: 'name', label: 'name' },
		{ value: 'rating', label: 'rating (nullable)' },
		{ value: 'price', label: 'price (nullable)' },
		{ value: 'address.city', label: 'address.city (child path)' },
		{ value: 'created_at', label: 'created_at' },
		{ value: 'updated_at', label: 'updated_at' },
	];

	interface OrderKey {
		field: string;
		direction: 'ASC' | 'DESC';
	}

	let order = $state<OrderKey[]>([
		{ field: 'rating', direction: 'DESC' },
		{ field: 'name', direction: 'ASC' },
	]);
	let limit = $state(10);
	let offset = $state(0);
	let next_field = $state<string | undefined>('price');

	/** Cursors already consumed, so "Start over" can rewind without a refetch. */
	let cursor_trail = $state<string[]>([]);
	let paging_by_cursor = $state(false);

	const runner = new LabRunner('place');

	const base_query = $derived(
		pruneQuery({
			order: order.length > 0 ? order : undefined,
			limit,
			offset: offset || undefined,
			sparse: true,
		}),
	);

	$effect(() => {
		// Any change to the ordering or window restarts paging — a cursor is only
		// meaningful against the query that produced it.
		void base_query;
		paging_by_cursor = false;
		cursor_trail = [];
		runner.schedule(base_query);
	});

	function addKey() {
		if (!next_field) return;
		if (order.some((key) => key.field === next_field)) return;
		order = [...order, { field: next_field, direction: 'ASC' }];
	}

	function removeKey(index: number) {
		order = order.filter((_, position) => position !== index);
	}

	function moveKey(index: number, delta: number) {
		const target = index + delta;
		if (target < 0 || target >= order.length) return;
		const next = [...order];
		[next[index], next[target]] = [next[target], next[index]];
		order = next;
	}

	function toggleDirection(index: number) {
		order = order.map((key, position) =>
			position === index
				? { ...key, direction: key.direction === 'ASC' ? 'DESC' : 'ASC' }
				: key,
		);
	}

	async function nextPage() {
		const cursor = runner.result?.cursor;
		if (!cursor) return;
		cursor_trail = [...cursor_trail, cursor];
		paging_by_cursor = true;
		// `cursor` is authoritative — the engine ignores every other key when one
		// is present, which is exactly what makes deep paging cheap.
		await runner.run({ cursor });
	}

	async function restart() {
		cursor_trail = [];
		paging_by_cursor = false;
		await runner.run(base_query);
	}

	const window_start = $derived(paging_by_cursor ? cursor_trail.length * limit : offset);
</script>

<Panel
	title="Sort &amp; paging"
	blurb="order[].field · order[].direction · limit · offset · cursor">
	{#snippet controls()}
		<div class="group">
			<h5>Sort keys, in precedence order</h5>
			{#if order.length === 0}
				<p class="muted">No keys — the engine falls back to relevance, then id.</p>
			{/if}
			<ol>
				{#each order as key, index (key.field)}
					<li>
						<span class="index">{index + 1}</span>
						<span class="field">{key.field}</span>
						<ButtonGroup>
							<Button
								dense
								outline
								onclick={() => toggleDirection(index)}
								tooltip="Toggle direction">
								{key.direction}
							</Button>
							<Button
								dense
								outline
								disabled={index === 0}
								onclick={() => moveKey(index, -1)}
								tooltip="Move up">
								↑
							</Button>
							<Button
								dense
								outline
								disabled={index === order.length - 1}
								onclick={() => moveKey(index, 1)}
								tooltip="Move down">
								↓
							</Button>
							<Button dense outline onclick={() => removeKey(index)} tooltip="Remove">
								✕
							</Button>
						</ButtonGroup>
					</li>
				{/each}
			</ol>
		</div>

		<div class="add">
			<Select
				options={SORT_FIELDS.filter(
					(field) => !order.some((key) => key.field === field.value),
				)}
				placeholder="Add a sort key"
				bind:value={
					() => next_field,
					(next) => (next_field = (next as string | undefined) ?? undefined)
				} />
			<Button outline onclick={addKey} disabled={!next_field}>Add</Button>
		</div>

		<div class="pair">
			<Input
				type="number"
				label="limit"
				min={1}
				max={100}
				bind:value={
					() => limit, (next) => (limit = Math.max(1, Math.min(100, Number(next) || 1)))
				} />
			<Input
				type="number"
				label="offset"
				min={0}
				step={10}
				bind:value={() => offset, (next) => (offset = Math.max(0, Number(next) || 0))} />
		</div>

		<div class="group">
			<h5>Cursor paging</h5>
			<ButtonGroup>
				<Button
					outline
					onclick={nextPage}
					disabled={!runner.result?.cursor}
					tooltip={runner.result?.cursor
						? 'Fetch the next window with the returned cursor'
						: 'The last result carried no cursor — you are on the final page'}>
					Next page
				</Button>
				<Button outline onclick={restart} disabled={!paging_by_cursor}>Start over</Button>
			</ButtonGroup>
			<p class="muted">
				Page {cursor_trail.length + 1}. A cursor overrides every other key, so the preview
				below collapses to just the token once you start paging.
			</p>
		</div>
	{/snippet}

	<Callout tip title="Nulls sort last">
		Around one place in eight has no rating and one in eleven no price. Sort by
		<code>rating DESC</code>
		and then
		<code>ASC</code>
		: the null rows stay at the bottom either way rather than flipping to the top.
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
		offset={window_start}
		empty_hint="Past the end of the result set — start over." />
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

	ol {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--font-size-00);
	}

	.index {
		width: 1.25rem;
		color: var(--color-text-disabled);
		font-variant-numeric: tabular-nums;
	}

	.field {
		flex: 1;
		font-family: var(--font-mono);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.add {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: var(--space-2);
		align-items: center;
	}

	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-3);
	}

	code {
		font-family: var(--font-mono);
		font-size: 0.9em;
	}
</style>
