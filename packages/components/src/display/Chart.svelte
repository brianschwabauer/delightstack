<script lang="ts" module>
	export interface ChartData {
		/** Labels for each data point along the x-axis (or each slice for pie/donut) */
		labels: string[];
		/** One or more series of values to plot */
		datasets: Dataset[];
	}

	export interface Dataset {
		/** Name of this series (shown in the legend) */
		label: string;
		/** The values for this series, one per label */
		data: number[];
		/** Custom color for this series (auto-assigned if omitted) */
		color?: string;
	}
</script>

<script lang="ts">
	import { resizeObserver } from '@delightstack/utilities';

	const propId = $props.id();

	let {
		/** Chart type */
		type = 'line' as 'line' | 'area' | 'bar' | 'horizontal-bar' | 'pie' | 'donut',

		/** Data to display */
		data,

		/** Chart height in pixels */
		height = 300,

		/** Custom color palette */
		colors = undefined as string[] | undefined,

		/** Show grid lines */
		show_grid = true,

		/** Show legend */
		show_legend = true,

		/** Enable tooltips */
		show_tooltip = true,

		/** Animate on load */
		animate = true,

		/** Stack datasets */
		stacked = false,

		/** Smooth curves for line/area */
		curved = true,

		/** Show data points */
		show_points = false,

		/** Inner radius for donut (0-1 ratio of outer radius) */
		inner_radius = 0,

		/** Loading skeleton */
		skeleton = false,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: class_name = '',
	}: {
		type?: 'line' | 'area' | 'bar' | 'horizontal-bar' | 'pie' | 'donut';
		data: ChartData;
		height?: number;
		colors?: string[];
		show_grid?: boolean;
		show_legend?: boolean;
		show_tooltip?: boolean;
		animate?: boolean;
		stacked?: boolean;
		curved?: boolean;
		show_points?: boolean;
		inner_radius?: number;
		skeleton?: boolean;
		id?: string;
		class?: string;
	} = $props();

	// Defaults pull from the theme's categorical chart palette (tokens.css), so a
	// chart dropped into a delightstack dashboard matches the active theme out of
	// the box. The hex fallbacks only apply when the styles package isn't loaded.
	// Override per chart with the `colors` prop, per series with `Dataset.color`,
	// or globally by setting --chart-N in CSS.
	const DEFAULT_COLORS = [
		'var(--chart-1, #3b82f6)',
		'var(--chart-2, #ef4444)',
		'var(--chart-3, #10b981)',
		'var(--chart-4, #f59e0b)',
		'var(--chart-5, #8b5cf6)',
		'var(--chart-6, #ec4899)',
		'var(--chart-7, #06b6d4)',
		'var(--chart-8, #84cc16)',
	];

	let container_width = $state(0);
	let tooltip_visible = $state(false);
	let tooltip_x = $state(0);
	let tooltip_y = $state(0);
	let tooltip_label = $state('');
	let tooltip_dataset = $state('');
	let tooltip_value = $state('');
	let hidden_datasets = $state(new Set<number>());
	let has_animated = $state(false);

	$effect(() => {
		if (animate) {
			has_animated = false;
			const timer = setTimeout(() => {
				has_animated = true;
			}, 50);
			return () => clearTimeout(timer);
		} else {
			has_animated = true;
		}
	});

	const palette = $derived(colors ?? DEFAULT_COLORS);

	function getColor(index: number): string {
		return palette[index % palette.length];
	}

	/* ── Data helpers ─────────────────────────────────────────── */

	const is_empty = $derived(
		!data ||
			!data.datasets ||
			data.datasets.length === 0 ||
			data.datasets.every((d) => d.data.length === 0),
	);

	const visible_datasets = $derived(
		data.datasets.filter((_, i) => !hidden_datasets.has(i)),
	);

	const visible_indices = $derived(
		data.datasets.map((_, i) => i).filter((i) => !hidden_datasets.has(i)),
	);

	const is_cartesian = $derived(
		type === 'line' || type === 'area' || type === 'bar' || type === 'horizontal-bar',
	);

	/* ── Axis calculations for cartesian charts ───────────────── */

	const PADDING_LEFT = 50;
	const PADDING_RIGHT = 20;
	const PADDING_TOP = 20;
	const PADDING_BOTTOM = 30;

	const chart_width = $derived(
		Math.max(0, container_width - PADDING_LEFT - PADDING_RIGHT),
	);
	const chart_height = $derived(Math.max(0, height - PADDING_TOP - PADDING_BOTTOM));

	function computeYRange(
		datasets: Dataset[],
		indices: number[],
		is_stacked: boolean,
	): { min: number; max: number } {
		if (indices.length === 0) return { min: 0, max: 1 };

		let min_val = 0;
		let max_val = 0;

		if (is_stacked) {
			const label_count = datasets[0]?.data.length ?? 0;
			for (let li = 0; li < label_count; li++) {
				let sum = 0;
				for (const di of indices) {
					sum += datasets[di].data[li] ?? 0;
				}
				if (sum > max_val) max_val = sum;
				if (sum < min_val) min_val = sum;
			}
		} else {
			for (const di of indices) {
				for (const v of datasets[di].data) {
					if (v > max_val) max_val = v;
					if (v < min_val) min_val = v;
				}
			}
		}

		if (min_val === max_val) {
			return min_val === 0
				? { min: 0, max: 1 }
				: { min: min_val * 0.9, max: max_val * 1.1 };
		}
		return { min: min_val, max: max_val };
	}

	function computeNiceTicks(
		min_val: number,
		max_val: number,
		target_count: number = 5,
	): number[] {
		if (min_val === max_val) return [min_val];
		const range = max_val - min_val;
		const rough_step = range / target_count;
		const magnitude = Math.pow(10, Math.floor(Math.log10(rough_step)));
		const residual = rough_step / magnitude;

		let nice_step: number;
		if (residual <= 1.5) nice_step = 1 * magnitude;
		else if (residual <= 3) nice_step = 2 * magnitude;
		else if (residual <= 7) nice_step = 5 * magnitude;
		else nice_step = 10 * magnitude;

		const nice_min = Math.floor(min_val / nice_step) * nice_step;
		const nice_max = Math.ceil(max_val / nice_step) * nice_step;
		const ticks: number[] = [];
		for (let v = nice_min; v <= nice_max + nice_step * 0.5; v += nice_step) {
			ticks.push(Math.round(v * 1e10) / 1e10);
		}
		return ticks;
	}

	const y_range = $derived(
		is_cartesian
			? computeYRange(
					data.datasets,
					visible_indices,
					stacked && type !== 'horizontal-bar',
				)
			: { min: 0, max: 1 },
	);

	const y_ticks = $derived(
		is_cartesian ? computeNiceTicks(y_range.min, y_range.max) : [],
	);

	const axis_min = $derived(y_ticks.length > 0 ? y_ticks[0] : 0);
	const axis_max = $derived(y_ticks.length > 0 ? y_ticks[y_ticks.length - 1] : 1);
	const axis_range = $derived(Math.max(axis_max - axis_min, 1e-10));

	/* For horizontal-bar charts we swap axes logic */
	const h_range = $derived(
		type === 'horizontal-bar'
			? computeYRange(data.datasets, visible_indices, stacked)
			: { min: 0, max: 1 },
	);

	const h_ticks = $derived(
		type === 'horizontal-bar' ? computeNiceTicks(h_range.min, h_range.max) : [],
	);

	const h_axis_min = $derived(h_ticks.length > 0 ? h_ticks[0] : 0);
	const h_axis_max = $derived(h_ticks.length > 0 ? h_ticks[h_ticks.length - 1] : 1);
	const h_axis_range = $derived(Math.max(h_axis_max - h_axis_min, 1e-10));

	/* ── Coordinate mapping ───────────────────────────────────── */

	function mapX(index: number, count: number): number {
		if (count <= 1) return PADDING_LEFT + chart_width / 2;
		return PADDING_LEFT + (index / (count - 1)) * chart_width;
	}

	function mapY(value: number): number {
		return PADDING_TOP + chart_height - ((value - axis_min) / axis_range) * chart_height;
	}

	/* ── Line / Area path generation ──────────────────────────── */

	interface PointCoord {
		x: number;
		y: number;
	}

	function buildPoints(values: number[], count: number): PointCoord[] {
		const pts: PointCoord[] = [];
		for (let i = 0; i < count; i++) {
			pts.push({ x: mapX(i, count), y: mapY(values[i] ?? 0) });
		}
		return pts;
	}

	function buildStackedValues(dataset_index: number): number[] {
		const label_count = data.labels.length;
		const vis_pos = visible_indices.indexOf(dataset_index);
		const result: number[] = [];
		for (let li = 0; li < label_count; li++) {
			let sum = 0;
			for (let vi = 0; vi <= vis_pos; vi++) {
				sum += data.datasets[visible_indices[vi]].data[li] ?? 0;
			}
			result.push(sum);
		}
		return result;
	}

	function buildStackedBaseValues(dataset_index: number): number[] {
		const label_count = data.labels.length;
		const result: number[] = [];
		const vis_pos = visible_indices.indexOf(dataset_index);
		for (let li = 0; li < label_count; li++) {
			let sum = 0;
			for (let vi = 0; vi < vis_pos; vi++) {
				sum += data.datasets[visible_indices[vi]].data[li] ?? 0;
			}
			result.push(sum);
		}
		return result;
	}

	function buildLinePath(points: PointCoord[], use_curve: boolean): string {
		if (points.length === 0) return '';
		if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

		let d = `M ${points[0].x} ${points[0].y}`;

		if (use_curve && points.length > 1) {
			for (let i = 0; i < points.length - 1; i++) {
				const p0 = points[Math.max(0, i - 1)];
				const p1 = points[i];
				const p2 = points[i + 1];
				const p3 = points[Math.min(points.length - 1, i + 2)];

				const tension = 0.3;
				const cp1x = p1.x + (p2.x - p0.x) * tension;
				const cp1y = p1.y + (p2.y - p0.y) * tension;
				const cp2x = p2.x - (p3.x - p1.x) * tension;
				const cp2y = p2.y - (p3.y - p1.y) * tension;

				d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
			}
		} else {
			for (let i = 1; i < points.length; i++) {
				d += ` L ${points[i].x} ${points[i].y}`;
			}
		}

		return d;
	}

	function buildAreaPath(
		points: PointCoord[],
		base_y: number | number[],
		use_curve: boolean,
	): string {
		if (points.length === 0) return '';

		const line = buildLinePath(points, use_curve);
		const base_points = Array.isArray(base_y)
			? points.map((p, i) => ({ x: p.x, y: base_y[i] }))
			: points.map((p) => ({ x: p.x, y: base_y }));

		const reversed = [...base_points].reverse();
		let close = '';
		if (Array.isArray(base_y)) {
			close = buildLinePath(reversed, use_curve);
			close = close.replace(/^M/, 'L');
		} else {
			close = ` L ${points[points.length - 1].x} ${base_y}`;
			close += ` L ${points[0].x} ${base_y}`;
		}

		return line + close + ' Z';
	}

	/* ── Line/Area chart data ─────────────────────────────────── */

	interface LineDataset {
		original_index: number;
		color: string;
		label: string;
		line_path: string;
		area_path: string;
		points: PointCoord[];
		values: number[];
		path_length: number;
	}

	const line_datasets = $derived.by((): LineDataset[] => {
		if (type !== 'line' && type !== 'area') return [];
		if (is_empty) return [];

		const count = data.labels.length;
		const result: LineDataset[] = [];

		for (const di of visible_indices) {
			const ds = data.datasets[di];
			const ds_color = ds.color ?? getColor(di);

			let values: number[];
			let base_values: number[] | number;

			if (stacked) {
				values = buildStackedValues(di);
				const base_arr = buildStackedBaseValues(di);
				base_values = base_arr.map((v) => mapY(v));
			} else {
				values = ds.data.slice(0, count);
				base_values = mapY(Math.max(axis_min, 0));
			}

			const points = buildPoints(values, count);
			const line_path = buildLinePath(points, curved);
			const area_path = type === 'area' ? buildAreaPath(points, base_values, curved) : '';

			// Estimate path length for animation
			let path_length = 0;
			for (let i = 1; i < points.length; i++) {
				const dx = points[i].x - points[i - 1].x;
				const dy = points[i].y - points[i - 1].y;
				path_length += Math.sqrt(dx * dx + dy * dy);
			}

			result.push({
				original_index: di,
				color: ds_color,
				label: ds.label,
				line_path,
				area_path,
				points,
				values,
				path_length: Math.ceil(path_length),
			});
		}

		return result;
	});

	/* ── Bar chart data ───────────────────────────────────────── */

	interface BarRect {
		x: number;
		y: number;
		width: number;
		height: number;
		color: string;
		label: string;
		dataset_label: string;
		value: number;
		original_index: number;
	}

	const bar_rects = $derived.by((): BarRect[] => {
		if (type !== 'bar') return [];
		if (is_empty) return [];

		const count = data.labels.length;
		const visible_count = visible_indices.length;
		if (count === 0 || visible_count === 0) return [];

		const group_width = chart_width / count;
		const bar_padding = group_width * 0.1;
		const available = group_width - bar_padding * 2;

		const rects: BarRect[] = [];

		if (stacked) {
			const bar_width = available * 0.7;
			for (let li = 0; li < count; li++) {
				let cumulative = 0;
				for (const di of visible_indices) {
					const ds = data.datasets[di];
					const val = ds.data[li] ?? 0;
					const y_top = mapY(cumulative + val);
					const y_bottom = mapY(cumulative);
					const bar_x =
						PADDING_LEFT + li * group_width + bar_padding + (available - bar_width) / 2;
					rects.push({
						x: bar_x,
						y: Math.min(y_top, y_bottom),
						width: bar_width,
						height: Math.abs(y_bottom - y_top),
						color: ds.color ?? getColor(di),
						label: data.labels[li],
						dataset_label: ds.label,
						value: val,
						original_index: di,
					});
					cumulative += val;
				}
			}
		} else {
			const bar_width = available / visible_count;
			for (let li = 0; li < count; li++) {
				for (let vi = 0; vi < visible_count; vi++) {
					const di = visible_indices[vi];
					const ds = data.datasets[di];
					const val = ds.data[li] ?? 0;
					const baseline = mapY(Math.max(axis_min, 0));
					const y_top = mapY(val);
					const bar_x = PADDING_LEFT + li * group_width + bar_padding + vi * bar_width;

					rects.push({
						x: bar_x,
						y: Math.min(y_top, baseline),
						width: bar_width * 0.85,
						height: Math.abs(baseline - y_top),
						color: ds.color ?? getColor(di),
						label: data.labels[li],
						dataset_label: ds.label,
						value: val,
						original_index: di,
					});
				}
			}
		}

		return rects;
	});

	/* ── Horizontal bar chart data ────────────────────────────── */

	const H_PADDING_LEFT = 80;
	const H_PADDING_RIGHT = 20;
	const H_PADDING_TOP = 20;
	const H_PADDING_BOTTOM = 30;

	const h_chart_width = $derived(
		Math.max(0, container_width - H_PADDING_LEFT - H_PADDING_RIGHT),
	);
	const h_chart_height = $derived(Math.max(0, height - H_PADDING_TOP - H_PADDING_BOTTOM));

	function mapHX(value: number): number {
		return H_PADDING_LEFT + ((value - h_axis_min) / h_axis_range) * h_chart_width;
	}

	interface HBarRect {
		x: number;
		y: number;
		width: number;
		height: number;
		color: string;
		label: string;
		dataset_label: string;
		value: number;
		original_index: number;
	}

	const hbar_rects = $derived.by((): HBarRect[] => {
		if (type !== 'horizontal-bar') return [];
		if (is_empty) return [];

		const count = data.labels.length;
		const visible_count = visible_indices.length;
		if (count === 0 || visible_count === 0) return [];

		const group_height = h_chart_height / count;
		const bar_padding = group_height * 0.1;
		const available = group_height - bar_padding * 2;

		const rects: HBarRect[] = [];
		const baseline_x = mapHX(Math.max(h_axis_min, 0));

		if (stacked) {
			const bar_height = available * 0.7;
			for (let li = 0; li < count; li++) {
				let cumulative = 0;
				for (const di of visible_indices) {
					const ds = data.datasets[di];
					const val = ds.data[li] ?? 0;
					const x_left = mapHX(cumulative);
					const x_right = mapHX(cumulative + val);
					const bar_y =
						H_PADDING_TOP +
						li * group_height +
						bar_padding +
						(available - bar_height) / 2;

					rects.push({
						x: Math.min(x_left, x_right),
						y: bar_y,
						width: Math.abs(x_right - x_left),
						height: bar_height,
						color: ds.color ?? getColor(di),
						label: data.labels[li],
						dataset_label: ds.label,
						value: val,
						original_index: di,
					});
					cumulative += val;
				}
			}
		} else {
			const bar_height = available / visible_count;
			for (let li = 0; li < count; li++) {
				for (let vi = 0; vi < visible_count; vi++) {
					const di = visible_indices[vi];
					const ds = data.datasets[di];
					const val = ds.data[li] ?? 0;
					const x_val = mapHX(val);
					const bar_y = H_PADDING_TOP + li * group_height + bar_padding + vi * bar_height;

					rects.push({
						x: Math.min(baseline_x, x_val),
						y: bar_y,
						width: Math.abs(x_val - baseline_x),
						height: bar_height * 0.85,
						color: ds.color ?? getColor(di),
						label: data.labels[li],
						dataset_label: ds.label,
						value: val,
						original_index: di,
					});
				}
			}
		}

		return rects;
	});

	/* ── Pie / Donut chart data ───────────────────────────────── */

	interface PieSegment {
		path: string;
		color: string;
		label: string;
		value: number;
		percentage: number;
		mid_angle: number;
		original_index: number;
	}

	const pie_segments = $derived.by((): PieSegment[] => {
		if (type !== 'pie' && type !== 'donut') return [];
		if (is_empty) return [];

		// For pie, we use the first dataset's data with labels
		const ds = visible_datasets[0];
		if (!ds) return [];

		const values = ds.data.slice(0, data.labels.length);
		const total = values.reduce((s, v) => s + Math.max(0, v), 0);
		if (total === 0) return [];

		const cx = container_width / 2;
		const cy = height / 2;
		const outer_r = Math.min(cx, cy) - 30;
		const inner_r =
			type === 'donut' ? outer_r * Math.max(0, Math.min(1, inner_radius || 0.6)) : 0;

		const segments: PieSegment[] = [];
		let start_angle = -Math.PI / 2;

		for (let i = 0; i < values.length; i++) {
			const val = Math.max(0, values[i]);
			if (val === 0) continue;

			const sweep = (val / total) * Math.PI * 2;
			const end_angle = start_angle + sweep;
			const mid_angle = start_angle + sweep / 2;

			const large_arc = sweep > Math.PI ? 1 : 0;

			const x1_outer = cx + outer_r * Math.cos(start_angle);
			const y1_outer = cy + outer_r * Math.sin(start_angle);
			const x2_outer = cx + outer_r * Math.cos(end_angle);
			const y2_outer = cy + outer_r * Math.sin(end_angle);

			let path: string;

			if (inner_r > 0) {
				const x1_inner = cx + inner_r * Math.cos(start_angle);
				const y1_inner = cy + inner_r * Math.sin(start_angle);
				const x2_inner = cx + inner_r * Math.cos(end_angle);
				const y2_inner = cy + inner_r * Math.sin(end_angle);

				path = [
					`M ${x1_outer} ${y1_outer}`,
					`A ${outer_r} ${outer_r} 0 ${large_arc} 1 ${x2_outer} ${y2_outer}`,
					`L ${x2_inner} ${y2_inner}`,
					`A ${inner_r} ${inner_r} 0 ${large_arc} 0 ${x1_inner} ${y1_inner}`,
					'Z',
				].join(' ');
			} else {
				path = [
					`M ${cx} ${cy}`,
					`L ${x1_outer} ${y1_outer}`,
					`A ${outer_r} ${outer_r} 0 ${large_arc} 1 ${x2_outer} ${y2_outer}`,
					'Z',
				].join(' ');
			}

			segments.push({
				path,
				color: getColor(i),
				label: data.labels[i],
				value: val,
				percentage: (val / total) * 100,
				mid_angle,
				original_index: i,
			});

			start_angle = end_angle;
		}

		return segments;
	});

	/* ── Tooltip helpers ──────────────────────────────────────── */

	function showTooltipAt(
		event: MouseEvent,
		label: string,
		dataset: string,
		value: string,
	) {
		if (!show_tooltip) return;
		const rect = (event.currentTarget as Element)
			.closest('.chart')
			?.getBoundingClientRect();
		if (!rect) return;
		tooltip_x = event.clientX - rect.left;
		tooltip_y = event.clientY - rect.top - 40;
		tooltip_label = label;
		tooltip_dataset = dataset;
		tooltip_value = value;
		tooltip_visible = true;
	}

	function hideTooltip() {
		tooltip_visible = false;
	}

	/* ── Legend toggle ─────────────────────────────────────────── */

	function toggleDataset(index: number) {
		const next = new Set(hidden_datasets);
		if (next.has(index)) {
			next.delete(index);
		} else {
			// Don't hide if it's the last visible dataset
			const total_visible = data.datasets.length - next.size;
			if (total_visible > 1) {
				next.add(index);
			}
		}
		hidden_datasets = next;
	}

	/* ── Tick formatting ──────────────────────────────────────── */

	function formatTick(value: number): string {
		if (Math.abs(value) >= 1_000_000)
			return (value / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
		if (Math.abs(value) >= 1_000)
			return (value / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
		if (Number.isInteger(value)) return value.toString();
		return value.toFixed(1);
	}
</script>

<div
	{id}
	class={['chart', `chart-${type}`, class_name].filter(Boolean).join(' ')}
	class:skeleton
	class:animate={animate && !has_animated}
	class:animated={animate && has_animated}
	style:height="{height}px"
	{@attach resizeObserver({
		onresize: (el) => {
			container_width = (el as HTMLElement).clientWidth;
		},
	})}>
	{#if skeleton}
		<!-- Skeleton -->
		<div class="skeleton-frame" style:height="{height}px">
			{#if type === 'pie' || type === 'donut'}
				<!-- Same disc the real pie renders: centered, radius = min(w,h)/2 - 30.
				     The donut keeps its hole via a radial mask at the real inner radius. -->
				<div
					class="skeleton-circle"
					class:donut={type === 'donut'}
					style:--donut-inner="{Math.max(0, Math.min(1, inner_radius || 0.6)) * 100}%">
				</div>
			{:else}
				<div class="skeleton-bars">
					{#each Array(7) as _, i}
						<div
							class="skeleton-bar"
							style:height="{30 + Math.sin(i * 0.8) * 40 + 30}%"
							style:--shimmer-delay="{i * 120}ms">
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{:else if is_empty}
		<!-- Empty state -->
		<div class="empty">
			<span>No data available</span>
		</div>
	{:else if container_width > 0}
		{#if type === 'line' || type === 'area'}
			<!-- Line / Area Chart -->
			<svg
				width={container_width}
				{height}
				viewBox="0 0 {container_width} {height}"
				role="img"
				aria-label="{type} chart">
				{#if show_grid}
					{#each y_ticks as tick}
						<line
							x1={PADDING_LEFT}
							y1={mapY(tick)}
							x2={PADDING_LEFT + chart_width}
							y2={mapY(tick)}
							class="grid-line" />
					{/each}
				{/if}

				<!-- Y-axis labels -->
				{#each y_ticks as tick}
					<text
						x={PADDING_LEFT - 8}
						y={mapY(tick)}
						text-anchor="end"
						dominant-baseline="middle">
						{formatTick(tick)}
					</text>
				{/each}

				<!-- X-axis labels -->
				{#each data.labels as label, i}
					<text
						x={mapX(i, data.labels.length)}
						y={PADDING_TOP + chart_height + 20}
						text-anchor="middle"
						dominant-baseline="auto">
						{label}
					</text>
				{/each}

				<!-- Area fills -->
				{#if type === 'area'}
					{#each line_datasets as ds}
						<path
							d={ds.area_path}
							style:fill={ds.color}
							fill-opacity="0.15"
							class="area" />
					{/each}
				{/if}

				<!-- Lines -->
				{#each line_datasets as ds}
					<path
						d={ds.line_path}
						fill="none"
						style:stroke={ds.color}
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="line"
						style:stroke-dasharray={animate ? ds.path_length : 'none'}
						style:stroke-dashoffset={animate && !has_animated ? ds.path_length : 0} />
				{/each}

				<!-- Data points -->
				{#each line_datasets as ds}
					{#each ds.points as pt, pi}
						{#if show_points || show_tooltip}
							<circle
								cx={pt.x}
								cy={pt.y}
								r={show_points ? 4 : 8}
								style:fill={show_points ? ds.color : 'transparent'}
								style:stroke={show_points ? 'var(--color-bg, white)' : 'none'}
								stroke-width={show_points ? 2 : 0}
								class="point"
								onmouseenter={(e) =>
									showTooltipAt(
										e,
										data.labels[pi],
										ds.label,
										(ds.values[pi] ?? 0).toLocaleString(),
									)}
								onmouseleave={hideTooltip}
								role="presentation" />
						{/if}
					{/each}
				{/each}
			</svg>
		{:else if type === 'bar'}
			<!-- Bar Chart -->
			<svg
				width={container_width}
				{height}
				viewBox="0 0 {container_width} {height}"
				role="img"
				aria-label="bar chart">
				{#if show_grid}
					{#each y_ticks as tick}
						<line
							x1={PADDING_LEFT}
							y1={mapY(tick)}
							x2={PADDING_LEFT + chart_width}
							y2={mapY(tick)}
							class="grid-line" />
					{/each}
				{/if}

				<!-- Y-axis labels -->
				{#each y_ticks as tick}
					<text
						x={PADDING_LEFT - 8}
						y={mapY(tick)}
						text-anchor="end"
						dominant-baseline="middle">
						{formatTick(tick)}
					</text>
				{/each}

				<!-- X-axis labels -->
				{#each data.labels as label, i}
					{@const group_width = chart_width / data.labels.length}
					<text
						x={PADDING_LEFT + i * group_width + group_width / 2}
						y={PADDING_TOP + chart_height + 20}
						text-anchor="middle"
						dominant-baseline="auto">
						{label}
					</text>
				{/each}

				<!-- Bars -->
				{#each bar_rects as bar}
					<rect
						x={bar.x}
						y={bar.y}
						width={Math.max(0, bar.width)}
						height={Math.max(0, bar.height)}
						style:fill={bar.color}
						rx="2"
						class="bar"
						style:transform-origin="{bar.x + bar.width / 2}px {PADDING_TOP +
							chart_height}px"
						onmouseenter={(e) =>
							showTooltipAt(e, bar.label, bar.dataset_label, bar.value.toLocaleString())}
						onmouseleave={hideTooltip}
						role="presentation" />
				{/each}
			</svg>
		{:else if type === 'horizontal-bar'}
			<!-- Horizontal Bar Chart -->
			<svg
				width={container_width}
				{height}
				viewBox="0 0 {container_width} {height}"
				role="img"
				aria-label="horizontal bar chart">
				{#if show_grid}
					{#each h_ticks as tick}
						<line
							x1={mapHX(tick)}
							y1={H_PADDING_TOP}
							x2={mapHX(tick)}
							y2={H_PADDING_TOP + h_chart_height}
							class="grid-line" />
					{/each}
				{/if}

				<!-- X-axis (value) labels at bottom -->
				{#each h_ticks as tick}
					<text
						x={mapHX(tick)}
						y={H_PADDING_TOP + h_chart_height + 20}
						text-anchor="middle"
						dominant-baseline="auto">
						{formatTick(tick)}
					</text>
				{/each}

				<!-- Y-axis (category) labels -->
				{#each data.labels as label, i}
					{@const group_height = h_chart_height / data.labels.length}
					<text
						x={H_PADDING_LEFT - 8}
						y={H_PADDING_TOP + i * group_height + group_height / 2}
						text-anchor="end"
						dominant-baseline="middle">
						{label}
					</text>
				{/each}

				<!-- Bars -->
				{#each hbar_rects as bar}
					<rect
						x={bar.x}
						y={bar.y}
						width={Math.max(0, bar.width)}
						height={Math.max(0, bar.height)}
						style:fill={bar.color}
						rx="2"
						class="hbar"
						style:transform-origin="{H_PADDING_LEFT}px {bar.y + bar.height / 2}px"
						onmouseenter={(e) =>
							showTooltipAt(e, bar.label, bar.dataset_label, bar.value.toLocaleString())}
						onmouseleave={hideTooltip}
						role="presentation" />
				{/each}
			</svg>
		{:else if type === 'pie' || type === 'donut'}
			<!-- Pie / Donut Chart -->
			<svg
				width={container_width}
				{height}
				viewBox="0 0 {container_width} {height}"
				role="img"
				aria-label="{type} chart">
				<g class="pie" style:transform-origin="{container_width / 2}px {height / 2}px">
					{#each pie_segments as seg}
						<path
							d={seg.path}
							style:fill={seg.color}
							class="segment"
							style:transform-origin="{container_width / 2}px {height / 2}px"
							onmouseenter={(e) =>
								showTooltipAt(
									e,
									seg.label,
									'',
									`${seg.value.toLocaleString()} (${seg.percentage.toFixed(1)}%)`,
								)}
							onmouseleave={hideTooltip}
							role="presentation" />
					{/each}
				</g>
			</svg>
		{/if}

		<!-- Tooltip -->
		{#if show_tooltip && tooltip_visible}
			<div class="tooltip" style:left="{tooltip_x}px" style:top="{tooltip_y}px">
				{#if tooltip_dataset}
					<span class="dataset">{tooltip_dataset}</span>
				{/if}
				<span class="label">{tooltip_label}</span>
				<span class="value">{tooltip_value}</span>
			</div>
		{/if}

		<!-- Legend -->
		{#if show_legend}
			<div class="legend">
				{#if type === 'pie' || type === 'donut'}
					{#each data.labels as label, i}
						<button
							class:hidden={hidden_datasets.has(i)}
							type="button"
							onclick={() => toggleDataset(i)}>
							<span class="dot" style:background-color={getColor(i)}></span>
							<span class="label">{label}</span>
						</button>
					{/each}
				{:else}
					{#each data.datasets as ds, i}
						<button
							class:hidden={hidden_datasets.has(i)}
							type="button"
							onclick={() => toggleDataset(i)}>
							<span class="dot" style:background-color={ds.color ?? getColor(i)}></span>
							<span class="label">{ds.label}</span>
						</button>
					{/each}
				{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	.chart {
		position: relative;
		width: 100%;
		overflow: hidden;
	}

	svg {
		display: block;
	}

	/* ── Grid ─────────────────────────────────────────────────── */

	.grid-line {
		stroke: var(--color-border, light-dark(#e5e7eb, #374151));
		stroke-width: 1;
		stroke-dasharray: 4 4;
		opacity: 0.6;
	}

	/* ── Axis labels ──────────────────────────────────────────── */

	text {
		font-size: 11px;
		fill: var(--color-text-muted, light-dark(#6b7280, #9ca3af));
		user-select: none;
	}

	/* ── Line / Area ──────────────────────────────────────────── */

	.line {
		transition: stroke-dashoffset 1s ease-out;

		/* Skip animation: show immediately */
		.chart:not(.animate):not(.animated) & {
			stroke-dasharray: none !important;
			stroke-dashoffset: 0 !important;
		}
	}

	.area {
		opacity: 0;
		transition: opacity 0.6s ease-out;

		.chart.animated & {
			opacity: 1;
		}
	}

	.point {
		transition: r 0.15s ease;
		cursor: pointer;

		&:hover {
			r: 6;
			fill-opacity: 1;
			transition: none;
		}
	}

	/* ── Bar ──────────────────────────────────────────────────── */

	.bar {
		transition: opacity 0.15s ease;

		.chart.animate & {
			animation: chart-bar-grow 0.6s ease-out both;
		}

		&:hover {
			opacity: 0.8;
			cursor: pointer;
			transition: none;
		}
	}

	@keyframes chart-bar-grow {
		from {
			transform: scaleY(0);
		}
		to {
			transform: scaleY(1);
		}
	}

	/* ── Horizontal Bar ───────────────────────────────────────── */

	.hbar {
		transition: opacity 0.15s ease;

		.chart.animate & {
			animation: chart-hbar-grow 0.6s ease-out both;
		}

		&:hover {
			opacity: 0.8;
			cursor: pointer;
			transition: none;
		}
	}

	@keyframes chart-hbar-grow {
		from {
			transform: scaleX(0);
		}
		to {
			transform: scaleX(1);
		}
	}

	/* ── Pie / Donut ──────────────────────────────────────────── */

	.segment {
		transition: transform 0.15s ease;
		cursor: pointer;

		&:hover {
			transform: scale(1.03);
		}
	}

	.chart.animate .pie {
		animation: chart-pie-spin 0.8s ease-out;
	}

	@keyframes chart-pie-spin {
		from {
			transform: rotate(-90deg);
			opacity: 0;
		}
		to {
			transform: rotate(0deg);
			opacity: 1;
		}
	}

	/* ── Tooltip ──────────────────────────────────────────────── */

	.tooltip {
		position: absolute;
		z-index: 10;
		background: var(--color-bg, light-dark(#ffffff, #1f2937));
		border: 1px solid var(--color-border, light-dark(#e5e7eb, #374151));
		border-radius: var(--radius-lg, 0.5rem);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-lg, 0.5rem) * var(--squircle-ratio, 2));
		}
		padding: 6px 10px;
		pointer-events: none;
		white-space: nowrap;
		display: flex;
		flex-direction: column;
		gap: 2px;
		box-shadow: 0 4px 12px rgb(0 0 0 / 0.1);
		transform: translateX(-50%);
		font-size: 12px;

		.dataset {
			font-weight: 600;
			color: var(--color-text, light-dark(#111827, #f9fafb));
		}

		.label {
			color: var(--color-text-muted, light-dark(#6b7280, #9ca3af));
		}

		.value {
			font-weight: 600;
			color: var(--color-text, light-dark(#111827, #f9fafb));
			font-variant-numeric: tabular-nums;
		}
	}

	/* ── Legend ────────────────────────────────────────────────── */

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		padding: 8px 0 0;
		justify-content: center;

		button {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			background: none;
			border: none;
			padding: 2px 6px;
			cursor: pointer;
			border-radius: var(--radius-lg, 0.5rem);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius-lg, 0.5rem) * var(--squircle-ratio, 2));
			}
			font-size: 12px;
			color: var(--color-text, light-dark(#111827, #f9fafb));
			transition: opacity 0.15s ease;

			&:hover {
				background: light-dark(rgb(0 0 0 / 0.05), rgb(255 255 255 / 0.05));
				transition: none;
			}

			&.hidden {
				opacity: 0.4;
			}
		}

		.dot {
			width: 10px;
			height: 10px;
			border-radius: 50%;
			flex-shrink: 0;
		}

		.label {
			white-space: nowrap;
		}
	}

	/* ── Empty state ──────────────────────────────────────────── */

	.empty {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		color: var(--color-text-muted, light-dark(#6b7280, #9ca3af));
		font-size: 14px;
	}

	/* ── Skeleton ─────────────────────────────────────────────── */

	.chart.skeleton {
		pointer-events: none;
	}

	.skeleton-frame {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* Mirrors the real svg plot area (PADDING_LEFT/RIGHT/TOP/BOTTOM) so the
	   placeholder bars rise from the same baseline, inside the same box, the
	   real bars/lines will occupy — no shift when data arrives. */
	.skeleton-bars {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		height: 100%;
		width: 100%;
		padding: 20px 20px 30px 50px;
	}

	.skeleton-bar,
	.skeleton-circle {
		position: relative;
		overflow: hidden;
		background: var(--skeleton-bg, rgb(from var(--color-text, #888) r g b / 0.1));

		&::after {
			content: '';
			position: absolute;
			inset: 0;
			transform: translateX(-100%);
			background-image: linear-gradient(
				105deg,
				transparent 25%,
				var(--skeleton-sheen, rgb(from var(--color-text, #888) r g b / 0.12)) 50%,
				transparent 75%
			);
			animation: delight-skeleton-shimmer var(--skeleton-duration, 2.4s) ease-in-out
				infinite;
			animation-delay: var(--shimmer-delay, 0s);
		}
	}

	.skeleton-bar {
		flex: 1;
		border-radius: var(--radius-lg, 0.5rem) var(--radius-lg, 0.5rem) 0 0;
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-lg, 0.5rem) * var(--squircle-ratio, 2))
				calc(var(--radius-lg, 0.5rem) * var(--squircle-ratio, 2)) 0 0;
		}
	}

	/* Same disc the real pie/donut draws: centered, diameter = min(w,h) - 60. */
	.skeleton-circle {
		height: calc(100% - 60px);
		max-width: calc(100% - 60px);
		aspect-ratio: 1;
		border-radius: var(--radius-full, 1e5px);

		/* Donut: punch out the real inner radius so the ring (and its shimmer)
		   matches the loaded shape. */
		&.donut {
			-webkit-mask: radial-gradient(
				closest-side,
				transparent calc(var(--donut-inner, 60%) - 1px),
				#000 var(--donut-inner, 60%)
			);
			mask: radial-gradient(
				closest-side,
				transparent calc(var(--donut-inner, 60%) - 1px),
				#000 var(--donut-inner, 60%)
			);
		}
	}

	@keyframes -global-delight-skeleton-shimmer {
		0% {
			transform: translateX(-100%);
		}
		55%,
		100% {
			transform: translateX(100%);
		}
	}

	/* ── Reduced motion ───────────────────────────────────────── */

	@media (prefers-reduced-motion: reduce) {
		.line {
			transition: none;
			stroke-dasharray: none !important;
			stroke-dashoffset: 0 !important;
		}

		.area {
			transition: none;
			opacity: 1;
		}

		.chart.animate .bar,
		.chart.animate .hbar {
			animation: none;
		}

		.chart.animate .pie {
			animation: none;
		}

		.skeleton-bar::after,
		.skeleton-circle::after {
			animation: none;
		}
	}
</style>
