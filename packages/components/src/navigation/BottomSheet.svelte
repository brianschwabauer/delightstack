<script lang="ts">
	import { type Snippet, tick, untrack } from 'svelte';
	import { portal } from '../actions/Portal.svelte';

	/**
	 * A snap point expressed either as a fraction of the viewport height (a value
	 * `<= 1`, e.g. `0.5` for half the screen) or as an absolute pixel height (a
	 * value `> 1`, e.g. `120` for a 120px peek). Mixing the two is allowed, so
	 * `[120, 0.6, 1]` means a 120px peek, 60% of the viewport, then full height.
	 */
	type SnapPoint = number;

	const propId = $props.id();
	let {
		/** Whether the bottom sheet is open */
		open = $bindable(false) as boolean,

		/**
		 * Snap heights the sheet settles to. Each value is a fraction of the
		 * viewport height (`<= 1`) or an absolute pixel height (`> 1`). They're
		 * sorted ascending internally, and clamped to the content height so a
		 * short sheet never opens taller than its content.
		 */
		snapPoints = [0.5, 1] as SnapPoint[],

		/**
		 * Index of the snap point to open to. Defaults to the largest snap point
		 * so the sheet opens up big, the way the legacy sheets did. Set to `0` to
		 * open at the smallest/peek height instead.
		 */
		defaultSnap = undefined as undefined | number,

		/** The current snap point index (`$bindable`) */
		snap = $bindable(0) as number,

		/**
		 * Morph progress (0-1) of the sheet between its collapsed and expanded
		 * states. Drives the optional morphing header. By default it interpolates
		 * across the gap between the two smallest snap points; override the range
		 * with {@link morphRange}. Bind to it (`bind:morphPercent`) or read it from
		 * the {@link onmorph} callback / the `--morph-percent` CSS variable.
		 */
		morphPercent = $bindable(0) as number,

		/**
		 * The height range `[from, to]` over which {@link morphPercent} animates
		 * from 0 to 1. Values follow the same fraction-or-pixel rule as
		 * {@link snapPoints}. Defaults to `[snapPoints[0], snapPoints[1]]`.
		 */
		morphRange = undefined as undefined | [number, number],

		/** Whether the sheet can be dismissed by dragging down, the backdrop, or Escape */
		dismissible = true,

		/**
		 * Whether to render the frosted backdrop (blur + tint). When `false` the
		 * backdrop is fully transparent but still catches clicks to dismiss the
		 * sheet — pass `dismissible={false}` too if you want the page behind to
		 * stay interactive.
		 */
		backdrop = true,

		/** Whether to lock body scroll while the sheet is open */
		blocking = true,

		/** Maximum width of the sheet in pixels (it stays centered when wider) */
		maxWidth = 500,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: className = '',

		/** Scrollable content. Receives the current morph percent (0-1). */
		children = undefined as undefined | Snippet<[number]>,

		/**
		 * Fixed header rendered above the scrollable content and used as a drag
		 * area. Receives the current morph percent (0-1) so you can build a
		 * morphing header.
		 */
		header = undefined as undefined | Snippet<[number]>,

		/** Called when the sheet opens */
		onopen = undefined as undefined | (() => void),

		/** Called when the sheet finishes closing */
		onclose = undefined as undefined | (() => void),

		/** Called when the sheet settles on a snap point */
		onsnap = undefined as undefined | ((detail: { index: number; height: number }) => void),

		/** Called whenever the morph percent (0-1) changes */
		onmorph = undefined as undefined | ((percent: number) => void),
	} = $props();

	// --- Tuning constants ---
	const DRAG_THRESHOLD = 4; // px of movement before a press becomes a drag
	const FLICK_VELOCITY = 0.4; // px/ms that counts as a fast swipe
	const DISMISS_FACTOR = 0.5; // release below this fraction of the lowest snap dismisses
	const RUBBER = 0.15; // resistance when overscrolling past the top

	// --- Element refs ---
	let panel_el = $state<HTMLElement | undefined>();
	let backdrop_el = $state<HTMLElement | undefined>();
	let content_el = $state<HTMLElement | undefined>();

	// --- Position state ---
	/** How many pixels of the sheet are revealed from the bottom (0 = hidden). */
	let offset = $state(0);
	let viewport_h = $state(0);
	let container_h = $state(0);

	// --- Interaction state ---
	let dragging = $state(false);
	let animating = $state(false);
	let current_snap = $state(0);
	let was_open = $state(false);

	// --- Pointer tracking ---
	let active_pointer: number | null = null;
	/** none → idle, pending → press not yet classified, sheet → dragging the sheet, native → let the content scroll. */
	let drag_mode: 'none' | 'pending' | 'sheet' | 'native' = 'none';
	let drag_from_content = false;
	let drag_from_handle = false;
	let start_y = 0;
	let start_offset = 0;
	let last_y = 0;
	let last_t = 0;
	let velocity = 0; // px/ms, positive = moving up

	// --- Easings (mirror svelte/easing without the import) ---
	const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
	const quartOut = (t: number) => 1 - Math.pow(1 - t, 4);
	const expoOut = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
	const quadInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

	function prefersReducedMotion() {
		return (
			typeof window !== 'undefined' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches
		);
	}

	// --- Derived geometry ---
	/** Resolve a snap value: <= 1 is a viewport fraction, > 1 is absolute pixels. */
	const resolve = (v: number) => (v <= 1 ? v * viewport_h : v);
	const sorted_snaps = $derived([...snapPoints].sort((a, b) => a - b));
	const max_offset = $derived(Math.min(viewport_h || Infinity, container_h || Infinity));
	const snap_heights = $derived(
		sorted_snaps.map((v) => Math.min(resolve(v), max_offset || Infinity)),
	);
	const default_index = $derived(
		defaultSnap == null
			? sorted_snaps.length - 1
			: clamp(Math.round(defaultSnap), 0, sorted_snaps.length - 1),
	);
	const at_max = $derived(max_offset > 0 && offset >= max_offset - 1);

	// --- Morph ---
	const morph_range_px = $derived<[number, number]>(
		morphRange
			? [resolve(morphRange[0]), resolve(morphRange[1])]
			: snap_heights.length >= 2
				? [snap_heights[0], snap_heights[1]]
				: [0, snap_heights[0] ?? 0],
	);
	const morph = $derived.by(() => {
		const [from, to] = morph_range_px;
		if (to <= from) return offset > from ? 1 : 0;
		return quadInOut(clamp((offset - from) / (to - from), 0, 1));
	});
	$effect(() => {
		morphPercent = morph;
		onmorph?.(morph);
	});

	// --- Backdrop fade: reaches full tint over the lower ~60% of travel ---
	const fade_distance = $derived(Math.min(max_offset || Infinity, (viewport_h || 0) * 0.6) || 1);
	const backdrop_opacity = $derived(quartOut(clamp(offset / fade_distance, 0, 1)));

	// --- Viewport tracking ---
	$effect(() => {
		const update = () => (viewport_h = window.innerHeight);
		update();
		window.addEventListener('resize', update);
		return () => window.removeEventListener('resize', update);
	});

	// --- Keep the content height fresh ---
	$effect(() => {
		if (!panel_el) return;
		const ro = new ResizeObserver(() => (container_h = panel_el!.clientHeight));
		ro.observe(panel_el);
		container_h = panel_el.clientHeight;
		return () => ro.disconnect();
	});

	// --- Body scroll lock ---
	$effect(() => {
		if (!open || !blocking) return;
		const original = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = original;
		};
	});

	// --- Open / close lifecycle ---
	$effect(() => {
		const is_open = open;
		untrack(() => {
			if (is_open && !was_open) {
				was_open = true;
				openSheet();
			} else if (!is_open && was_open) {
				was_open = false;
				closeSheet();
			}
		});
	});

	async function openSheet() {
		viewport_h = window.innerHeight;
		await tick();
		if (panel_el) container_h = panel_el.clientHeight;
		const idx = default_index;
		current_snap = idx;
		snap = idx;
		await animateSheet(snap_heights[idx] ?? max_offset, 550, expoOut);
		onopen?.();
	}

	async function closeSheet() {
		await animateSheet(0, 350, quartOut);
		offset = 0;
		onclose?.();
	}

	// --- React to external snap changes ---
	$effect(() => {
		const s = snap;
		untrack(() => {
			if (!open || dragging || animating) return;
			if (s !== current_snap && s >= 0 && s < snap_heights.length) snapTo(s);
		});
	});

	// --- Snapping ---
	function nearestSnapIndex(y: number): number {
		let best = 0;
		let dist = Infinity;
		for (let i = 0; i < snap_heights.length; i++) {
			const d = Math.abs(y - snap_heights[i]);
			if (d < dist) {
				dist = d;
				best = i;
			}
		}
		return best;
	}

	function snapTo(index: number) {
		const idx = clamp(index, 0, snap_heights.length - 1);
		current_snap = idx;
		snap = idx;
		const height = snap_heights[idx] ?? 0;
		animateSheet(height, 450, expoOut).then(() => onsnap?.({ index: idx, height }));
	}

	function toggleSnap() {
		if (current_snap >= snap_heights.length - 1) snapTo(0);
		else snapTo(snap_heights.length - 1);
	}

	function dismiss() {
		if (!dismissible) {
			snapTo(0);
			return;
		}
		open = false; // open/close effect animates the sheet down and fires onclose
	}

	// --- Animation ---
	let raf_id = 0;
	let anim_token = 0;

	function cancelAnimation() {
		cancelAnimationFrame(raf_id);
		anim_token++;
		animating = false;
	}

	function animateSheet(
		target: number,
		duration = 450,
		easing: (t: number) => number = quartOut,
	): Promise<void> {
		return new Promise((resolve) => {
			cancelAnimationFrame(raf_id);
			const from = untrack(() => offset);
			if (from === target) return resolve();
			if (prefersReducedMotion()) {
				offset = target;
				animating = false;
				return resolve();
			}
			animating = true;
			const token = ++anim_token;
			const start = performance.now();
			function step(now: number) {
				if (token !== anim_token) return resolve();
				const p = Math.min(1, (now - start) / duration);
				offset = from + (target - from) * easing(p);
				if (p < 1) {
					raf_id = requestAnimationFrame(step);
				} else {
					offset = target;
					animating = false;
					resolve();
				}
			}
			raf_id = requestAnimationFrame(step);
		});
	}

	// --- Gesture handling ---
	function isWithinContent(target: EventTarget | null) {
		return !!content_el && target instanceof Node && content_el.contains(target);
	}
	function isWithinHandle(target: EventTarget | null) {
		return target instanceof Element && !!target.closest('.handle');
	}

	function onPanelPointerDown(e: PointerEvent) {
		if (e.button === 2 || active_pointer !== null) return;
		drag_from_content = isWithinContent(e.target);
		drag_from_handle = isWithinHandle(e.target);

		// Already scrolled down inside the content: let the browser scroll it.
		if (drag_from_content && at_max && content_el && content_el.scrollTop > 0) {
			drag_mode = 'native';
			return;
		}

		cancelAnimation();
		active_pointer = e.pointerId;
		drag_mode = 'pending';
		start_y = last_y = e.clientY;
		start_offset = untrack(() => offset);
		last_t = e.timeStamp;
		velocity = 0;

		window.addEventListener('pointermove', onPointerMove, { passive: false });
		window.addEventListener('pointerup', onPointerUp);
		window.addEventListener('pointercancel', onPointerUp);
	}

	function onPointerMove(e: PointerEvent) {
		if (e.pointerId !== active_pointer) return;

		const total = start_y - e.clientY; // positive = moved up
		const dt = Math.max(1, e.timeStamp - last_t);
		velocity = (last_y - e.clientY) / dt;
		last_y = e.clientY;
		last_t = e.timeStamp;

		if (drag_mode === 'pending') {
			if (Math.abs(total) < DRAG_THRESHOLD) return;
			if (drag_from_content && at_max) {
				const pulling_down = total < 0;
				const at_top = !content_el || content_el.scrollTop <= 0;
				if (pulling_down && at_top) {
					drag_mode = 'sheet';
				} else {
					// Hand the gesture back to the browser for native scrolling.
					drag_mode = 'native';
					teardownPointer();
					return;
				}
			} else {
				drag_mode = 'sheet';
			}
			dragging = true;
			document.body.style.userSelect = 'none';
		}

		if (drag_mode !== 'sheet') return;
		e.preventDefault();

		let next = start_offset + total;
		if (next > max_offset) next = max_offset + (next - max_offset) * RUBBER;
		if (next < 0) next = 0;
		offset = next;
	}

	function onPointerUp(e: PointerEvent) {
		if (e.pointerId !== active_pointer) return;
		const mode = drag_mode;
		const tapped_handle = drag_from_handle && Math.abs(start_y - e.clientY) < DRAG_THRESHOLD;
		teardownPointer();

		if (mode === 'sheet') {
			dragging = false;
			releaseToSnap();
		} else if (mode === 'pending' && tapped_handle) {
			toggleSnap();
		}
	}

	function teardownPointer() {
		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerup', onPointerUp);
		window.removeEventListener('pointercancel', onPointerUp);
		document.body.style.userSelect = '';
		active_pointer = null;
		drag_mode = 'none';
	}

	function releaseToSnap() {
		const speed = Math.abs(velocity);
		const moving_down = velocity < 0;
		const nearest = nearestSnapIndex(offset);

		if (speed > FLICK_VELOCITY) {
			if (moving_down) {
				if (nearest <= 0) dismiss();
				else snapTo(nearest - 1);
			} else {
				snapTo(Math.min(nearest + 1, snap_heights.length - 1));
			}
			return;
		}

		if (dismissible && offset < (snap_heights[0] ?? 0) * DISMISS_FACTOR) dismiss();
		else snapTo(nearest);
	}

	function onBackdropPointerDown() {
		dismiss();
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape' && dismissible) dismiss();
	}

	// Attach the press handlers manually rather than via Svelte's delegated
	// `onpointerdown`. The sheet portals to <body>, which can sit outside a
	// consuming app's delegation root and silently break drags otherwise.
	$effect(() => {
		const panel = panel_el;
		const back = backdrop_el;
		panel?.addEventListener('pointerdown', onPanelPointerDown);
		back?.addEventListener('pointerdown', onBackdropPointerDown);
		return () => {
			panel?.removeEventListener('pointerdown', onPanelPointerDown);
			back?.removeEventListener('pointerdown', onBackdropPointerDown);
		};
	});

	// --- Visibility: keep mounted through the close animation ---
	const visible = $derived(open || offset > 0);
</script>

<svelte:window onkeydown={open ? onKeyDown : undefined} />

{#if visible}
	<div
		use:portal={'body'}
		{id}
		class={['bottom-sheet', className].filter(Boolean).join(' ')}
		class:dragging
		style:--offset="{offset}px"
		style:--max-offset="{max_offset || 0}px"
		style:--morph-percent={morph}
		style:--max-width="{maxWidth}px">
		<!-- Backdrop: always catches taps to dismiss; `.frosted` adds the blur + tint. -->
		<div
			bind:this={backdrop_el}
			class="backdrop"
			class:frosted={backdrop}
			style:opacity={backdrop ? backdrop_opacity : 0}
			style:pointer-events={offset > 0 ? 'auto' : 'none'}>
		</div>

		<div bind:this={panel_el} class="panel" role="dialog" aria-modal="true">
			<div class="handle" aria-hidden="true">
				<div class="handle-bar"></div>
			</div>

			{#if header}
				<div class="header">
					{@render header(morph)}
				</div>
			{/if}

			<div
				bind:this={content_el}
				class="content"
				style:touch-action={at_max ? 'pan-y' : 'pan-x'}>
				{@render children?.(morph)}
			</div>
		</div>
	</div>
{/if}

<style>
	.bottom-sheet {
		position: fixed;
		inset: 0;
		display: flex;
		justify-content: center;
		pointer-events: none;
		z-index: var(--layer-3, 300);
	}

	.backdrop {
		position: absolute;
		inset: 0;
		z-index: 1;
		transition: opacity 150ms ease;
	}
	.bottom-sheet.dragging .backdrop {
		transition: none;
	}
	.backdrop.frosted {
		background-color: var(--bottom-sheet-backdrop, rgb(0 0 0 / 0.18));
	}
	@supports (backdrop-filter: blur(1px)) {
		.backdrop.frosted {
			background-color: var(--bottom-sheet-backdrop, rgb(0 0 0 / 0.12));
			backdrop-filter: blur(var(--bottom-sheet-blur, 12px));
		}
	}

	.panel {
		position: absolute;
		top: 100%;
		left: 50%;
		z-index: 2;
		width: 100%;
		max-width: var(--max-width, 500px);
		/* Reveal `--offset` pixels from the bottom; never higher than the panel top. */
		transform: translate3d(-50%, clamp(-100%, calc(-1 * var(--offset)), 0px), 0);
		height: max-content;
		max-height: 100svh;
		display: flex;
		flex-direction: column;
		background-color: var(--color-bg, light-dark(#fff, #0a0a0a));
		border-top-left-radius: var(--radius-5, 28px);
		border-top-right-radius: var(--radius-5, 28px);
		box-shadow:
			var(--shadow-4, 0 -8px 30px rgb(0 0 0 / 0.18)),
			0 0 0 1px color-mix(in oklch, transparent, var(--color-text, #888) 12%);
		pointer-events: auto;
		cursor: grab;
		touch-action: none;
	}
	.bottom-sheet.dragging .panel {
		cursor: grabbing;
	}

	.handle {
		position: relative;
		display: flex;
		justify-content: center;
		align-items: center;
		height: 1.5rem;
		flex-shrink: 0;
		touch-action: none;
	}
	.handle-bar {
		width: 36px;
		height: 4px;
		border-radius: var(--radius-round, 9999px);
		background-color: color-mix(in oklch, transparent, var(--color-text, #888) 28%);
	}

	.header {
		flex-shrink: 0;
		touch-action: none;
	}

	.content {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overflow-x: hidden;
		overscroll-behavior: contain;
		padding-bottom: env(safe-area-inset-bottom);
	}
	/* Thin, theme-aware scrollbar; hidden on touch devices. */
	@media (pointer: fine) {
		.content {
			scrollbar-width: thin;
			scrollbar-color: color-mix(in oklch, transparent, var(--color-text, #888) 25%) transparent;
		}
	}
	@media (pointer: coarse) {
		.content {
			scrollbar-width: none;
		}
		.content::-webkit-scrollbar {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.backdrop {
			transition: none;
		}
	}
</style>
