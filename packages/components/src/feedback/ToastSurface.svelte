<!--
	Internal to Toast: draws the toast's card (fill + 1px outline) as an SVG
	path so one corner can open into a "liquid" notch that cradles the close
	button. CSS can clip a notch (mask/clip-path), but it can't stroke one, and
	the outline is what separates the card from the page in dark mode, where
	there's no shadow. The light-mode shadow comes from a drop-shadow filter on
	the toast itself, so it follows this shape too.

	The notch is a circle around the close button, with small convex fillets
	where it meets the top and side edges so it reads as one fluid shape rather
	than a bite. `open` tweens it in and out of the plain rounded corner: every
	state is the same chain of cubics, so the points interpolate cleanly.
-->
<script lang="ts">
	import { Tween } from 'svelte/motion';
	import { cubicOut } from 'svelte/easing';

	let {
		/** Which top corner holds the close button */
		side = 'left' as 'left' | 'right',
		/** Whether the notch is open (the close button is showing) */
		open = false,
	}: { side?: 'left' | 'right'; open?: boolean } = $props();

	// Keep in sync with `.close` in Toast.svelte: the button's visual circle is
	// centered CENTER_INSET px in from the corner, with radius BUBBLE_R.
	const CENTER_INSET = 4;
	const BUBBLE_R = 11;
	const GAP = 3;
	const NOTCH_R = BUBBLE_R + GAP;
	const FILLET_R = 5;
	// Half the stroke: the path runs along the middle of the 1px outline, so
	// pulling it in by 0.5px keeps the whole stroke inside the box.
	const E = 0.5;

	let width = $state(0);
	let height = $state(0);
	let host = $state<HTMLElement>();
	let radius = $state(0);
	let squircle = $state(false);

	const progress = new Tween(0, { duration: 260, easing: cubicOut });
	$effect(() => {
		const reduced =
			typeof matchMedia !== 'undefined' &&
			matchMedia('(prefers-reduced-motion: reduce)').matches;
		progress.set(open ? 1 : 0, { duration: reduced ? 0 : 260 });
	});

	// The corner radius comes from the toast's own CSS (theme tokens, squircle
	// doubling), so the drawn card always matches the box it stands in for.
	$effect(() => {
		if (!host || !width) return;
		const card = host.parentElement;
		if (!card) return;
		const style = getComputedStyle(card);
		radius = parseFloat(style.borderBottomLeftRadius) || 0;
		squircle = style.getPropertyValue('corner-shape').trim().startsWith('squircle');
	});

	type Point = [number, number];
	type Cubic = [Point, Point, Point]; // control 1, control 2, end

	const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
	const lerpPoint = (a: Point, b: Point, t: number): Point => [
		lerp(a[0], b[0], t),
		lerp(a[1], b[1], t),
	];

	/** One cubic approximating a circular arc (fine for sweeps under ~90°). */
	function arc(cx: number, cy: number, r: number, a0: number, a1: number): Cubic {
		const k = (4 / 3) * Math.tan((a1 - a0) / 4);
		const x0 = cx + r * Math.cos(a0);
		const y0 = cy + r * Math.sin(a0);
		const x3 = cx + r * Math.cos(a1);
		const y3 = cy + r * Math.sin(a1);
		return [
			[x0 - k * r * Math.sin(a0), y0 + k * r * Math.cos(a0)],
			[x3 + k * r * Math.sin(a1), y3 - k * r * Math.cos(a1)],
			[x3, y3],
		];
	}

	/** Split a cubic (start p0) into three equal-parameter pieces. */
	function splitThree(p0: Point, c: Cubic): Cubic[] {
		const at = (t: number): [Cubic, Cubic, Point] => {
			const [p1, p2, p3] = c;
			const a = lerpPoint(p0, p1, t);
			const b = lerpPoint(p1, p2, t);
			const d = lerpPoint(p2, p3, t);
			const ab = lerpPoint(a, b, t);
			const bd = lerpPoint(b, d, t);
			const m = lerpPoint(ab, bd, t);
			return [[a, ab, m], [bd, d, p3], m];
		};
		const [first, rest, m] = at(1 / 3);
		// Re-split the remaining two-thirds at its midpoint.
		const p1 = rest[0];
		const p2 = rest[1];
		const p3 = rest[2];
		const a = lerpPoint(m, p1, 0.5);
		const b = lerpPoint(p1, p2, 0.5);
		const d = lerpPoint(p2, p3, 0.5);
		const ab = lerpPoint(a, b, 0.5);
		const bd = lerpPoint(b, d, 0.5);
		const mid = lerpPoint(ab, bd, 0.5);
		return [first, [a, ab, mid], [bd, d, p3]];
	}

	/** Control-point distance from the corner for a rounded corner of radius r. */
	const handle = (r: number) => (squircle ? 0.0907 : 0.4477) * r;

	const d = $derived.by(() => {
		const w = width;
		const h = height;
		if (!w || !h) return '';
		const r = Math.max(0, Math.min(radius, w / 2 - E, h / 2 - E));
		const t = handle(r);
		const p = progress.current;
		const L = E;
		const R = w - E;
		const T = E;
		const B = h - E;

		// Closed: the ordinary top-right corner, split so it has as many
		// segments as the open notch.
		const closedStart: Point = [R - r, T];
		const closed = splitThree(closedStart, [
			[R - t, T],
			[R, T + t],
			[R, T + r],
		]);

		// Open: fillet → notch arc → fillet, around the close button.
		const cx = w - CENTER_INSET;
		const cy = CENTER_INSET;
		const reach = NOTCH_R + FILLET_R;
		const f1: Point = [
			cx - Math.sqrt(reach ** 2 - (T + FILLET_R - cy) ** 2),
			T + FILLET_R,
		];
		const f2: Point = [
			R - FILLET_R,
			cy + Math.sqrt(reach ** 2 - (R - FILLET_R - cx) ** 2),
		];
		const toCenter1 = Math.atan2(cy - f1[1], cx - f1[0]);
		const toCenter2 = Math.atan2(cy - f2[1], cx - f2[0]);
		const openStart: Point = [f1[0], T];
		const opened: Cubic[] = [
			arc(f1[0], f1[1], FILLET_R, -Math.PI / 2, toCenter1),
			arc(cx, cy, NOTCH_R, toCenter1 + Math.PI, toCenter2 + Math.PI),
			arc(f2[0], f2[1], FILLET_R, toCenter2, 0),
		];

		const start = lerpPoint(closedStart, openStart, p);
		const corner = closed.map((seg, i) =>
			seg.map((pt, j) => lerpPoint(pt, opened[i][j], p)),
		);
		const n = (v: number) => Math.round(v * 100) / 100;
		const pt = (q: Point) => `${n(q[0])} ${n(q[1])}`;
		const c = (seg: Point[]) => `C${pt(seg[0])} ${pt(seg[1])} ${pt(seg[2])}`;

		return [
			`M${pt([L + r, T])}`,
			`L${pt(start)}`,
			...corner.map(c),
			`L${pt([R, B - r])}`,
			c([
				[R, B - t],
				[R - t, B],
				[R - r, B],
			]),
			`L${pt([L + r, B])}`,
			c([
				[L + t, B],
				[L, B - t],
				[L, B - r],
			]),
			`L${pt([L, T + r])}`,
			c([
				[L, T + t],
				[L + t, T],
				[L + r, T],
			]),
			'Z',
		].join('');
	});
</script>

<div class="surface" bind:this={host} bind:clientWidth={width} bind:clientHeight={height}>
	{#if d}
		<svg {width} {height} aria-hidden="true">
			<path {d} transform={side === 'left' ? `matrix(-1 0 0 1 ${width} 0)` : undefined} />
		</svg>
	{/if}
</div>

<style>
	/* Covers the toast's border box (the toast keeps a transparent 1px border
	   for layout) and sits behind its content. */
	.surface {
		position: absolute;
		inset: -1px;
		z-index: -1;
		pointer-events: none;
	}
	svg {
		display: block;
		overflow: visible;
	}
	path {
		fill: var(--_fill);
		stroke: var(--_stroke);
		stroke-width: 1px;
	}
</style>
