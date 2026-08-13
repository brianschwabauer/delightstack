<script lang="ts">
	import { Button, ButtonGroup, Range, Select, Toggle } from '@delightstack/components';
	import Panel from './Panel.svelte';
	import QueryPreview from './QueryPreview.svelte';
	import ResultList from './ResultList.svelte';
	import { LabRunner, pruneQuery } from './lab.svelte';
	import {
		CITIES,
		PLACE_AMENITIES,
		PLACE_CATEGORIES,
		PLACE_STATUSES,
	} from '$lib/search-lab/seed';

	const CATEGORY_OPTIONS = PLACE_CATEGORIES.map((value) => ({ value, label: value }));
	const STATUS_OPTIONS = PLACE_STATUSES.map((value) => ({ value, label: value }));
	const AMENITY_OPTIONS = PLACE_AMENITIES.map((value) => ({
		value,
		label: value.replace(/_/g, ' '),
	}));
	const CITY_OPTIONS = CITIES.map((city) => ({ value: city.city, label: city.city }));
	const TAG_OPTIONS = [
		'cozy',
		'quiet',
		'family-friendly',
		'late-night',
		'seasonal',
		'local-favourite',
		'award-winning',
		'budget',
		'romantic',
		'group-friendly',
		'historic',
		'newly-opened',
		'vegan-options',
		'live-music',
		'study-spot',
		'walk-in-only',
	].map((value) => ({ value, label: value }));

	type EnumOperator = 'eq' | 'in' | 'not_in';
	type ArrayOperator = 'contains_all' | 'contains_any';
	type RangeOperator = 'between' | 'gt' | 'gte' | 'lt' | 'lte';
	type Combinator = 'and' | 'or' | 'not';

	const ENUM_OPERATORS: EnumOperator[] = ['eq', 'in', 'not_in'];
	const ARRAY_OPERATORS: ArrayOperator[] = ['contains_any', 'contains_all'];
	const RANGE_OPERATORS: RangeOperator[] = ['between', 'gt', 'gte', 'lt', 'lte'];
	const COMBINATORS: Combinator[] = ['and', 'or', 'not'];

	let category_operator = $state<EnumOperator>('in');
	let categories = $state<string[]>([]);
	let statuses = $state<string[]>([]);
	let price_operator = $state<RangeOperator>('between');
	let price_bounds = $state<[number, number]>([0, 200]);
	let price_active = $state(false);
	let rating_active = $state(false);
	let rating_bounds = $state<[number, number]>([4, 5]);
	let open_late = $state<boolean | null>(null);
	let tag_operator = $state<ArrayOperator>('contains_any');
	let tags = $state<string[]>([]);
	let amenity_operator = $state<ArrayOperator>('contains_all');
	let amenities = $state<string[]>([]);
	let city = $state<string | undefined>(undefined);
	let combinator = $state<Combinator>('and');

	const runner = new LabRunner('place');

	/** Turn a range operator plus a two-thumb value into a comparison object. */
	function rangeClause(
		operator: RangeOperator,
		bounds: [number, number],
	): Record<string, unknown> {
		if (operator === 'between') return { between: bounds };
		if (operator === 'gt' || operator === 'gte') return { [operator]: bounds[0] };
		return { [operator]: bounds[1] };
	}

	/** Each control contributes at most one clause; empty controls contribute none. */
	const clauses = $derived.by(() => {
		const list: Record<string, unknown>[] = [];

		if (categories.length > 0) {
			list.push({
				category:
					category_operator === 'eq'
						? { eq: categories[0] }
						: { [category_operator]: categories },
			});
		}
		if (statuses.length > 0) list.push({ status: { in: statuses } });
		if (price_active) list.push({ price: rangeClause(price_operator, price_bounds) });
		if (rating_active) list.push({ rating: { between: rating_bounds } });
		if (open_late !== null) list.push({ open_late });
		if (tags.length > 0) list.push({ tags: { [tag_operator]: tags } });
		if (amenities.length > 0) list.push({ amenities: { [amenity_operator]: amenities } });
		if (city) list.push({ 'address.city': city });

		return list;
	});

	const where = $derived.by(() => {
		if (clauses.length === 0) return undefined;
		if (combinator === 'not') return { not: { and: clauses } };
		if (clauses.length === 1 && combinator === 'and') return clauses[0];
		return { [combinator]: clauses };
	});

	const query = $derived(pruneQuery({ where, limit: 20 }));

	$effect(() => {
		runner.schedule(query);
	});

	function reset() {
		categories = [];
		statuses = [];
		tags = [];
		amenities = [];
		city = undefined;
		open_late = null;
		price_active = false;
		rating_active = false;
		combinator = 'and';
	}
</script>

<Panel
	title="Filter builder"
	blurb="where · eq/in/not_in · ranges · contains_all/contains_any · child paths · and/or/not">
	{#snippet controls()}
		<div class="group">
			<h5>Category</h5>
			<ButtonGroup>
				{#each ENUM_OPERATORS as operator (operator)}
					<Button
						outline
						active={category_operator === operator}
						onclick={() => (category_operator = operator)}>
						{operator}
					</Button>
				{/each}
			</ButtonGroup>
			<Select
				multiple={category_operator !== 'eq'}
				searchable
				clearable
				placeholder="Any category"
				options={CATEGORY_OPTIONS}
				bind:value={
					() => (category_operator === 'eq' ? categories[0] : categories),
					(next) => {
						categories =
							next === undefined || next === null
								? []
								: Array.isArray(next)
									? (next as string[])
									: [next as string];
					}
				} />
		</div>

		<Select
			multiple
			clearable
			label="Status (in)"
			placeholder="Any status"
			options={STATUS_OPTIONS}
			bind:value={
				() => statuses, (next) => (statuses = (next as string[] | undefined) ?? [])
			} />

		<div class="group">
			<h5>Typical spend</h5>
			<Toggle bind:checked={price_active} label="Filter on price" />
			{#if price_active}
				<ButtonGroup>
					{#each RANGE_OPERATORS as operator (operator)}
						<Button
							outline
							active={price_operator === operator}
							onclick={() => (price_operator = operator)}>
							{operator}
						</Button>
					{/each}
				</ButtonGroup>
				<Range
					range={price_operator === 'between'}
					min={0}
					max={200}
					step={5}
					show_value
					bind:value={
						() =>
							price_operator === 'between'
								? price_bounds
								: price_operator === 'gt' || price_operator === 'gte'
									? price_bounds[0]
									: price_bounds[1],
						(next) => {
							if (Array.isArray(next)) price_bounds = [next[0], next[1]];
							else if (price_operator === 'gt' || price_operator === 'gte') {
								price_bounds = [next as number, price_bounds[1]];
							} else price_bounds = [price_bounds[0], next as number];
						}
					} />
			{/if}
		</div>

		<div class="group">
			<h5>Rating</h5>
			<Toggle bind:checked={rating_active} label="Filter on rating (between)" />
			{#if rating_active}
				<Range
					range
					min={0}
					max={5}
					step={0.1}
					show_value
					bind:value={
						() => rating_bounds,
						(next) => {
							if (Array.isArray(next)) rating_bounds = [next[0], next[1]];
						}
					} />
			{/if}
		</div>

		<div class="group">
			<h5>Open late</h5>
			<ButtonGroup>
				<Button outline active={open_late === null} onclick={() => (open_late = null)}>
					Any
				</Button>
				<Button outline active={open_late === true} onclick={() => (open_late = true)}>
					Yes
				</Button>
				<Button outline active={open_late === false} onclick={() => (open_late = false)}>
					No
				</Button>
			</ButtonGroup>
		</div>

		<div class="group">
			<h5>Tags (string[])</h5>
			<ButtonGroup>
				{#each ARRAY_OPERATORS as operator (operator)}
					<Button
						outline
						active={tag_operator === operator}
						onclick={() => (tag_operator = operator)}>
						{operator}
					</Button>
				{/each}
			</ButtonGroup>
			<Select
				multiple
				searchable
				clearable
				placeholder="Any tag"
				options={TAG_OPTIONS}
				bind:value={
					() => tags, (next) => (tags = (next as string[] | undefined) ?? [])
				} />
		</div>

		<div class="group">
			<h5>Amenities (enum[])</h5>
			<ButtonGroup>
				{#each ARRAY_OPERATORS as operator (operator)}
					<Button
						outline
						active={amenity_operator === operator}
						onclick={() => (amenity_operator = operator)}>
						{operator}
					</Button>
				{/each}
			</ButtonGroup>
			<Select
				multiple
				clearable
				placeholder="Any amenity"
				options={AMENITY_OPTIONS}
				bind:value={
					() => amenities, (next) => (amenities = (next as string[] | undefined) ?? [])
				} />
		</div>

		<Select
			clearable
			label="address.city (child path)"
			placeholder="Any city"
			options={CITY_OPTIONS}
			bind:value={
				() => city, (next) => (city = (next as string | undefined) ?? undefined)
			} />

		<div class="group">
			<h5>Combine {clauses.length} clause{clauses.length === 1 ? '' : 's'} with</h5>
			<ButtonGroup>
				{#each COMBINATORS as option (option)}
					<Button
						outline
						active={combinator === option}
						onclick={() => (combinator = option)}
						tooltip={option === 'not' ? 'Negates the whole AND group' : undefined}>
						{option}
					</Button>
				{/each}
			</ButtonGroup>
		</div>

		<Button transparent onclick={reset} disabled={clauses.length === 0}>
			Clear all filters
		</Button>
	{/snippet}

	<QueryPreview
		query={runner.echo}
		elapsed={runner.elapsed}
		round_trip_ms={runner.round_trip_ms}
		count={runner.result?.count} />

	<ResultList
		hits={runner.result?.hits ?? []}
		loading={runner.loading}
		error={runner.error}
		empty_hint="No place satisfies every clause. Try `or` instead of `and`." />
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
</style>
