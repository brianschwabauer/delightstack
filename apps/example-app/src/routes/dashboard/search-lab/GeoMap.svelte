<script lang="ts">
	/**
	 * A plain-SVG scatter of the corpus in geographic space.
	 *
	 * Not a map library and not a basemap — just the points, plus whichever
	 * boundary the query is using, drawn in the same projected space so the
	 * engine's answer can be checked by eye. Matches carry three encodings at
	 * once (fill, larger radius, surface ring), so identity never rests on
	 * colour alone.
	 */

	interface MapPoint {
		id: string;
		name: string;
		lat: number;
		lon: number;
	}

	interface Props {
		points: MapPoint[];
		/** Ids the engine returned for the current query. */
		matched: Set<string>;
		/** Circle boundary, when the query is a radius query. */
		circle?: { lat: number; lon: number; metres: number } | null;
		/** Polygon boundary, when the query is a polygon query. */
		polygon?: { lat: number; lon: number }[] | null;
		/** Whether the boundary selects what is inside it or what is outside. */
		inside?: boolean;
		highlighted_id?: string | null;
		onhover?: (id: string | null) => void;
	}

	let {
		points,
		matched,
		circle = null,
		polygon = null,
		inside = true,
		highlighted_id = null,
		onhover = undefined,
	}: Props = $props();

	/** Metres in one degree of latitude. Good to a fraction of a percent. */
	const METRES_PER_DEGREE = 111_320;

	/** Longitude is squeezed by the cosine of the latitude we are looking at. */
	const cos_latitude = $derived.by(() => {
		const reference =
			circle?.lat ?? polygon?.[0]?.lat ?? (points.length > 0 ? points[0].lat : 0);
		return Math.max(0.15, Math.cos((reference * Math.PI) / 180));
	});

	function projectX(lon: number): number {
		return lon * cos_latitude;
	}

	/** Screen y grows downward, so latitude is negated. */
	function projectY(lat: number): number {
		return -lat;
	}

	const geometry = $derived.by(() => {
		const xs: number[] = [];
		const ys: number[] = [];
		for (const point of points) {
			xs.push(projectX(point.lon));
			ys.push(projectY(point.lat));
		}
		if (circle) {
			const radius = circle.metres / METRES_PER_DEGREE;
			xs.push(projectX(circle.lon) - radius, projectX(circle.lon) + radius);
			ys.push(projectY(circle.lat) - radius, projectY(circle.lat) + radius);
		}
		for (const vertex of polygon ?? []) {
			xs.push(projectX(vertex.lon));
			ys.push(projectY(vertex.lat));
		}
		if (xs.length === 0) return null;

		const min_x = Math.min(...xs);
		const max_x = Math.max(...xs);
		const min_y = Math.min(...ys);
		const max_y = Math.max(...ys);
		const pad = Math.max(max_x - min_x, max_y - min_y, 0.01) * 0.08;

		const x = min_x - pad;
		const y = min_y - pad;
		const width = max_x - min_x + pad * 2;
		const height = max_y - min_y + pad * 2;
		return { x, y, width, height, unit: Math.max(width, height) };
	});

	const dot_radius = $derived((geometry?.unit ?? 1) / 190);

	const polygon_path = $derived(
		(polygon ?? [])
			.map(
				(vertex, index) =>
					`${index === 0 ? 'M' : 'L'}${projectX(vertex.lon)},${projectY(vertex.lat)}`,
			)
			.join(' ') + (polygon && polygon.length > 2 ? ' Z' : ''),
	);
</script>

{#if geometry}
	<figure>
		<svg
			viewBox="{geometry.x} {geometry.y} {geometry.width} {geometry.height}"
			preserveAspectRatio="xMidYMid meet"
			role="img"
			aria-label="Scatter of every place by longitude and latitude, with query matches highlighted">
			{#if circle}
				<circle
					class="boundary"
					cx={projectX(circle.lon)}
					cy={projectY(circle.lat)}
					r={circle.metres / METRES_PER_DEGREE}
					vector-effect="non-scaling-stroke" />
				<circle
					class="centre"
					cx={projectX(circle.lon)}
					cy={projectY(circle.lat)}
					r={dot_radius * 0.8}
					vector-effect="non-scaling-stroke" />
			{/if}

			{#if polygon && polygon.length > 2}
				<path class="boundary" d={polygon_path} vector-effect="non-scaling-stroke" />
			{/if}

			{#each points as point (point.id)}
				{@const is_match = matched.has(point.id)}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<circle
					class="dot"
					role="img"
					aria-label={point.name}
					class:match={is_match}
					class:highlighted={highlighted_id === point.id}
					cx={projectX(point.lon)}
					cy={projectY(point.lat)}
					r={is_match ? dot_radius * 1.7 : dot_radius}
					vector-effect="non-scaling-stroke"
					onpointerenter={() => onhover?.(point.id)}
					onpointerleave={() => onhover?.(null)}>
					<title>{point.name} — {point.lat.toFixed(4)}, {point.lon.toFixed(4)}</title>
				</circle>
			{/each}
		</svg>

		<figcaption>
			<span class="key match">{matched.size.toLocaleString()} matched</span>
			<span class="key">
				{(points.length - matched.size).toLocaleString()} not matched
			</span>
			<span class="note">
				Boundary selects what is {inside ? 'inside' : 'outside'} it
			</span>
		</figcaption>
	</figure>
{/if}

<style>
	figure {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	svg {
		width: 100%;
		aspect-ratio: 3 / 2;
		background: var(--color-bg-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: visible;
	}
	@supports (corner-shape: squircle) {
		svg {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md) * 2);
		}
	}

	.dot {
		fill: var(--color-text-disabled);
		fill-opacity: 0.45;
		stroke: none;
		transition:
			fill 260ms,
			fill-opacity 260ms;

		&.match {
			fill: var(--color-action);
			fill-opacity: 1;
			/* The ring is the second encoding: matches stay legible when the two
			   fills are indistinguishable (CVD, print, forced colors). */
			stroke: var(--color-bg-1);
			stroke-width: 1.5px;
			transition: none;
		}
		&.highlighted {
			fill: var(--color-accent);
			stroke: var(--color-bg-1);
			stroke-width: 2px;
			transition: none;
		}
	}

	.boundary {
		fill: oklch(from var(--color-action) l c h / 0.08);
		stroke: var(--color-action);
		stroke-width: 1.5px;
		stroke-dasharray: 5 4;
	}

	.centre {
		fill: var(--color-action);
		stroke: var(--color-bg-1);
		stroke-width: 1.5px;
	}

	figcaption {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2) var(--space-4);
		font-size: var(--font-size-00);
		color: var(--color-text-muted);
	}

	.key {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);

		&::before {
			content: '';
			width: 0.6em;
			height: 0.6em;
			border-radius: var(--radius-full);
			background: oklch(from var(--color-text-disabled) l c h / 0.45);
		}
		&.match::before {
			background: var(--color-action);
		}
	}

	.note {
		margin-left: auto;
		color: var(--color-text-disabled);
	}

	@media (prefers-reduced-motion: reduce) {
		.dot {
			transition: none;
		}
	}
</style>
