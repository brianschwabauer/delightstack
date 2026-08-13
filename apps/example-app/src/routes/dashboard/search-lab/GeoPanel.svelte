<script lang="ts">
	import { Button, ButtonGroup, Range, Select, Toggle } from '@delightstack/components';
	import { CITIES } from '$lib/search-lab/seed';
	import Panel from './Panel.svelte';
	import QueryPreview from './QueryPreview.svelte';
	import ResultList from './ResultList.svelte';
	import GeoMap from './GeoMap.svelte';
	import {
		DISTANCE_UNITS,
		formatDistance,
		haversine,
		LabRunner,
		point,
		pruneQuery,
		text,
		type DistanceUnit,
	} from './lab.svelte';

	const CITY_OPTIONS = CITIES.map((city, index) => ({
		value: String(index),
		label: city.city,
	}));
	const UNIT_OPTIONS = (Object.keys(DISTANCE_UNITS) as DistanceUnit[]).map((unit) => ({
		value: unit,
		label: unit,
	}));

	type Shape = 'radius' | 'polygon';
	const SHAPES: Shape[] = ['radius', 'polygon'];

	type PolygonPreset = 'box' | 'wedge' | 'ribbon';
	const POLYGON_PRESETS: { value: PolygonPreset; label: string }[] = [
		{ value: 'box', label: 'Box' },
		{ value: 'wedge', label: 'NE wedge' },
		{ value: 'ribbon', label: 'Ribbon' },
	];

	/** Big enough that every match lands on the map, not just the first page. */
	const MATCH_LIMIT = 400;

	/** How many matches the list under the map shows. */
	const LIST_LIMIT = 25;

	let city_index = $state(0);
	let shape = $state<Shape>('radius');
	let radius = $state(3);
	let unit = $state<DistanceUnit>('km');
	let inside = $state(true);
	let preset = $state<PolygonPreset>('box');
	let hovered_id = $state<string | null>(null);

	const runner = new LabRunner('place');
	const backdrop = new LabRunner('place');

	const city = $derived(CITIES[city_index] ?? CITIES[0]);
	const centre = $derived({ lat: city.lat, lon: city.lon });

	/** Preset polygons, sized off the cluster's own spread so they always bite. */
	const polygon = $derived.by(() => {
		const s = city.spread;
		if (preset === 'box') {
			return [
				{ lat: city.lat - s * 0.6, lon: city.lon - s * 0.9 },
				{ lat: city.lat - s * 0.6, lon: city.lon + s * 0.9 },
				{ lat: city.lat + s * 0.6, lon: city.lon + s * 0.9 },
				{ lat: city.lat + s * 0.6, lon: city.lon - s * 0.9 },
			];
		}
		if (preset === 'wedge') {
			return [
				{ lat: city.lat, lon: city.lon },
				{ lat: city.lat + s * 1.3, lon: city.lon },
				{ lat: city.lat + s * 1.3, lon: city.lon + s * 1.8 },
			];
		}
		return [
			{ lat: city.lat - s * 0.18, lon: city.lon - s * 1.6 },
			{ lat: city.lat - s * 0.18, lon: city.lon + s * 1.6 },
			{ lat: city.lat + s * 0.18, lon: city.lon + s * 1.6 },
			{ lat: city.lat + s * 0.18, lon: city.lon - s * 1.6 },
		];
	});

	const where = $derived(
		shape === 'radius'
			? {
					location: {
						radius: { coordinates: centre, value: radius, unit, inside },
					},
				}
			: { location: { polygon: { coordinates: polygon, inside } } },
	);

	const query = $derived(pruneQuery({ where, limit: MATCH_LIMIT, sparse: true }));

	$effect(() => {
		runner.schedule(query);
	});

	// The unfiltered backdrop only needs fetching once — the whole point is that
	// the grey dots stay put while the boundary moves over them.
	$effect(() => {
		void backdrop.run({ limit: 500, sparse: true, order: [{ field: 'name' }] });
	});

	const map_points = $derived(
		(backdrop.result?.hits ?? [])
			.map((hit) => {
				const location = point(hit.document);
				if (!location) return null;
				return {
					id: hit.id,
					name: text(hit.document, 'name') || hit.id,
					lat: location.lat,
					lon: location.lon,
				};
			})
			.filter((value): value is NonNullable<typeof value> => value !== null),
	);

	const matched = $derived(new Set((runner.result?.hits ?? []).map((hit) => hit.id)));

	const listed = $derived((runner.result?.hits ?? []).slice(0, LIST_LIMIT));

	const radius_metres = $derived(radius * DISTANCE_UNITS[unit]);
</script>

<Panel
	title="Geo"
	blurb="where.location.radius · polygon · unit · inside — distances computed client-side for display">
	{#snippet controls()}
		<Select
			label="City centre"
			options={CITY_OPTIONS}
			bind:value={
				() => String(city_index), (next) => (city_index = Number(next ?? 0) || 0)
			} />

		<div class="group">
			<h5>Shape</h5>
			<ButtonGroup>
				{#each SHAPES as option (option)}
					<Button outline active={shape === option} onclick={() => (shape = option)}>
						{option}
					</Button>
				{/each}
			</ButtonGroup>
		</div>

		{#if shape === 'radius'}
			<Range
				min={0.1}
				max={30}
				step={0.1}
				show_value
				label="Radius"
				format_value={(value) => `${value} ${unit}`}
				bind:value={() => radius, (next) => (radius = next as number)} />
			<Select
				label="Unit"
				options={UNIT_OPTIONS}
				bind:value={
					() => unit, (next) => (unit = (next as DistanceUnit | undefined) ?? 'km')
				} />
		{:else}
			<div class="group">
				<h5>Polygon preset</h5>
				<ButtonGroup>
					{#each POLYGON_PRESETS as option (option.value)}
						<Button
							outline
							active={preset === option.value}
							onclick={() => (preset = option.value)}>
							{option.label}
						</Button>
					{/each}
				</ButtonGroup>
			</div>
		{/if}

		<Toggle
			bind:checked={inside}
			label="inside"
			on_label="Inside"
			off_label="Outside"
			tooltip="Flip to select everything the boundary excludes" />
	{/snippet}

	<GeoMap
		points={map_points}
		{matched}
		circle={shape === 'radius' ? { ...centre, metres: radius_metres } : null}
		polygon={shape === 'polygon' ? polygon : null}
		{inside}
		highlighted_id={hovered_id}
		onhover={(id) => (hovered_id = id)} />

	<QueryPreview
		query={runner.echo}
		elapsed={runner.elapsed}
		round_trip_ms={runner.round_trip_ms}
		count={runner.result?.count} />

	<ResultList
		hits={listed}
		loading={runner.loading}
		error={runner.error}
		highlighted_id={hovered_id}
		onhover={(id) => (hovered_id = id)}
		empty_hint="Nothing inside that boundary. Widen the radius or flip `inside`.">
		{#snippet detail(hit)}
			{@const location = point(hit.document)}
			{#if location}
				<span>{formatDistance(haversine(centre, location), unit)}</span>
			{/if}
		{/snippet}
	</ResultList>
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
