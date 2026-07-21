<script lang="ts">
	import { type Snippet } from 'svelte';
	import { scrollbar } from '../actions/scrollbar';

	const propId = $props.id();
	let {
		/** Whether the split is vertical (top/bottom) instead of horizontal (left/right) */
		vertical = false,

		/** First pane size as a percentage (0-100), bindable */
		size = $bindable(50),

		/** Minimum first pane size as a percentage */
		min_size = 10,

		/** Maximum first pane size as a percentage */
		max_size = 90,

		/** Snap points as percentages */
		snap = [] as number[],

		/** Distance in percentage to trigger snap */
		snap_threshold = 8,

		/** Whether panes can be collapsed */
		collapsible = false,

		/** Which pane is currently collapsed, bindable */
		collapsed = $bindable(null) as 'first' | 'second' | null,

		/** The ID of the element */
		id = propId,

		/** Specifies a custom class name for the container element */
		class: class_name = '',

		/** First pane content */
		first = undefined as undefined | Snippet,

		/** Second pane content */
		second = undefined as undefined | Snippet,

		/** Called when pane size changes */
		onresize = undefined as ((detail: { size: number }) => void) | undefined,

		/** Called when a pane is collapsed or expanded */
		oncollapse = undefined as
			| ((detail: { pane: 'first' | 'second' | null }) => void)
			| undefined,
	}: {
		vertical?: boolean;
		size?: number;
		min_size?: number;
		max_size?: number;
		snap?: number[];
		snap_threshold?: number;
		collapsible?: boolean;
		collapsed?: 'first' | 'second' | null;
		id?: string;
		class?: string;
		first?: Snippet;
		second?: Snippet;
		onresize?: (detail: { size: number }) => void;
		oncollapse?: (detail: { pane: 'first' | 'second' | null }) => void;
	} = $props();

	let container: HTMLElement | undefined = $state(undefined);
	let dragging = $state(false);
	let animating = $state(false);
	let overshoot_px = $state(0);
	let snapping = $state(false);
	let snap_timer: ReturnType<typeof setTimeout> | undefined;
	let animating_timer: ReturnType<typeof setTimeout> | undefined;
	let last_pointer_coord = 0;
	let snapped_to: number | null = null;
	let expanded_during_drag = false;

	const COLLAPSE_THRESHOLD = 5;

	/** The size value before a collapse, so we can restore it on expand */
	let size_before_collapse = $state(50);

	const clamped_size = $derived(Math.min(max_size, Math.max(min_size, size)));

	/** The divider's fixed cross size (see .divider width/height below). The
	 * panes' percentage bases must leave room for it — with grow/shrink locked
	 * to 0, bases summing to a full 100% push the second pane past the
	 * container's overflow:hidden edge and clip its content. */
	const DIVIDER_PX = 4;

	/** The flex-basis for the first pane (includes overshoot for smooth snap/rubber band) */
	const first_basis = $derived.by(() => {
		if (collapsed === 'first') return '0%';
		if (collapsed === 'second') return `calc(100% - ${DIVIDER_PX}px)`;
		return `calc(${clamped_size}% + ${overshoot_px}px - ${DIVIDER_PX / 2}px)`;
	});

	/** The flex-basis for the second pane (includes overshoot for smooth snap/rubber band) */
	const second_basis = $derived.by(() => {
		if (collapsed === 'first') return `calc(100% - ${DIVIDER_PX}px)`;
		if (collapsed === 'second') return '0%';
		return `calc(${100 - clamped_size}% - ${overshoot_px}px - ${DIVIDER_PX / 2}px)`;
	});

	/** Convert a pointer position to a percentage of the container */
	function pointerToPercent(clientX: number, clientY: number): number {
		if (!container) return size;
		const rect = container.getBoundingClientRect();
		let percent: number;
		if (vertical) {
			percent = ((clientY - rect.top) / rect.height) * 100;
		} else {
			percent = ((clientX - rect.left) / rect.width) * 100;
		}
		return percent;
	}

	/** Apply snap points and clamping to a raw percentage */
	function applyConstraints(percent: number): number {
		// Clamp to min/max
		let result = Math.min(max_size, Math.max(min_size, percent));

		// Apply snap points with hysteresis: once snapped, require a much larger
		// movement to escape (2.2x threshold), making snaps feel strongly sticky
		if (snap.length > 0) {
			const threshold = snapped_to !== null ? snap_threshold * 2.2 : snap_threshold;
			let best_snap = -1;
			let min_dist = Infinity;

			for (const point of snap) {
				const dist = Math.abs(result - point);
				if (dist < min_dist && dist <= threshold) {
					min_dist = dist;
					best_snap = point;
				}
			}

			if (best_snap >= 0) {
				result = best_snap;
				snapped_to = best_snap;
			} else {
				snapped_to = null;
			}
		}

		// Round to 2 decimal places for cleanliness
		return Math.round(result * 100) / 100;
	}

	/** Update the size and fire the onresize event */
	function updateSize(new_size: number) {
		const constrained = applyConstraints(new_size);
		if (constrained !== size) {
			size = constrained;
			onresize?.({ size });
		}
	}

	/** Compute visual overshoot for magnetic snap gravity and edge rubber band */
	function updateOvershoot() {
		if (!container) return;
		const rect = container.getBoundingClientRect();
		const dimension = vertical ? rect.height : rect.width;
		const raw_pct = vertical
			? (last_pointer_coord - rect.top) / rect.height
			: (last_pointer_coord - rect.left) / rect.width;
		const raw_percent = raw_pct * 100;

		if (raw_percent < min_size) {
			// Edge rubber band past min (tanh bounded)
			const overflow_px = ((raw_percent - min_size) / 100) * dimension;
			const max_shift = 24;
			overshoot_px = max_shift * Math.tanh(overflow_px / 80);
		} else if (raw_percent > max_size) {
			// Edge rubber band past max (tanh bounded)
			const overflow_px = ((raw_percent - max_size) / 100) * dimension;
			const max_shift = 24;
			overshoot_px = max_shift * Math.tanh(overflow_px / 80);
		} else if (snapped_to !== null) {
			// Magnetic snap gravity — smooth easing that reaches full-follow
			// at the snap zone boundary, guaranteeing visual continuity.
			// Uses the wider escape threshold to match hysteresis zone.
			const snapped_pct = snapped_to / 100;
			const pull_px = (raw_pct - snapped_pct) * dimension;
			const escape_radius_px = ((snap_threshold * 2.2) / 100) * dimension;

			if (escape_radius_px < 1) {
				overshoot_px = 0;
			} else {
				const t = Math.min(1, Math.abs(pull_px) / escape_radius_px);
				const gravity = 0.16;
				const eased = gravity * t + (1 - gravity) * t * t;
				overshoot_px = Math.sign(pull_px) * eased * escape_radius_px;
			}
		} else {
			overshoot_px = 0;
		}
	}

	/** Clean up drag state and listeners */
	function stopDrag(trigger_snap_back = true) {
		dragging = false;
		snapped_to = null;
		if (trigger_snap_back && Math.abs(overshoot_px) > 0.5) {
			snapping = true;
			clearTimeout(snap_timer);
			snap_timer = setTimeout(() => {
				snapping = false;
			}, 400);
		}
		overshoot_px = 0;
		document.removeEventListener('mousemove', handlePointerMove);
		document.removeEventListener('mouseup', handlePointerUp);
		document.removeEventListener('touchmove', handleTouchMove);
		document.removeEventListener('touchend', handleTouchEnd);
	}

	/** Collapse or expand a pane */
	function setCollapsed(pane: 'first' | 'second' | null) {
		if (!collapsible) return;

		if (pane !== null && collapsed === null) {
			// Collapsing: save current size
			size_before_collapse = size;
		}

		animating = true;
		collapsed = pane;
		oncollapse?.({ pane });

		if (pane === null) {
			// Restoring: set size back
			size = size_before_collapse;
			onresize?.({ size });
		}

		// Remove animating flag after transition completes
		clearTimeout(animating_timer);
		animating_timer = setTimeout(() => {
			animating = false;
		}, 200);
	}

	/** Toggle collapse: collapse the smaller pane, or expand if already collapsed */
	function toggleCollapse() {
		if (!collapsible) return;
		if (collapsed !== null) {
			setCollapsed(null);
		} else {
			// Collapse the smaller pane
			setCollapsed(size <= 50 ? 'first' : 'second');
		}
	}

	// Remove document listeners and pending timers if the component unmounts mid-drag
	$effect(() => {
		return () => {
			stopDrag(false);
			clearTimeout(snap_timer);
			clearTimeout(animating_timer);
		};
	});

	// ---- Pointer drag handling ----

	function handlePointerDown(e: MouseEvent) {
		e.preventDefault();
		dragging = true;
		snapping = false;
		expanded_during_drag = false;
		clearTimeout(snap_timer);
		last_pointer_coord = vertical ? e.clientY : e.clientX;
		document.addEventListener('mousemove', handlePointerMove);
		document.addEventListener('mouseup', handlePointerUp);
	}

	function handlePointerMove(e: MouseEvent) {
		if (!dragging) return;
		e.preventDefault();
		const raw = pointerToPercent(e.clientX, e.clientY);

		// Expand collapsed pane by dragging away from edge
		if (collapsed !== null) {
			const should_expand =
				(collapsed === 'first' && raw > COLLAPSE_THRESHOLD) ||
				(collapsed === 'second' && raw < 100 - COLLAPSE_THRESHOLD);
			if (should_expand) {
				collapsed = null;
				expanded_during_drag = true;
				oncollapse?.({ pane: null });
				updateSize(raw);
				last_pointer_coord = vertical ? e.clientY : e.clientX;
				updateOvershoot();
			}
			return;
		}

		// Don't re-collapse in the same drag that expanded a pane
		if (collapsible && !expanded_during_drag) {
			if (raw < COLLAPSE_THRESHOLD) {
				stopDrag(false);
				setCollapsed('first');
				return;
			}
			if (raw > 100 - COLLAPSE_THRESHOLD) {
				stopDrag(false);
				setCollapsed('second');
				return;
			}
		}

		updateSize(raw);
		last_pointer_coord = vertical ? e.clientY : e.clientX;
		updateOvershoot();
	}

	function handlePointerUp() {
		if (!dragging) return;
		stopDrag();
	}

	// Touch handling
	function handleTouchStart(e: TouchEvent) {
		e.preventDefault();
		dragging = true;
		snapping = false;
		expanded_during_drag = false;
		clearTimeout(snap_timer);
		const touch = e.touches[0];
		last_pointer_coord = vertical ? touch.clientY : touch.clientX;
		document.addEventListener('touchmove', handleTouchMove, { passive: false });
		document.addEventListener('touchend', handleTouchEnd);
	}

	function handleTouchMove(e: TouchEvent) {
		if (!dragging) return;
		e.preventDefault();
		const touch = e.touches[0];
		const raw = pointerToPercent(touch.clientX, touch.clientY);

		// Expand collapsed pane by dragging away from edge
		if (collapsed !== null) {
			const should_expand =
				(collapsed === 'first' && raw > COLLAPSE_THRESHOLD) ||
				(collapsed === 'second' && raw < 100 - COLLAPSE_THRESHOLD);
			if (should_expand) {
				collapsed = null;
				expanded_during_drag = true;
				oncollapse?.({ pane: null });
				updateSize(raw);
				last_pointer_coord = vertical ? touch.clientY : touch.clientX;
				updateOvershoot();
			}
			return;
		}

		// Don't re-collapse in the same drag that expanded a pane
		if (collapsible && !expanded_during_drag) {
			if (raw < COLLAPSE_THRESHOLD) {
				stopDrag(false);
				setCollapsed('first');
				return;
			}
			if (raw > 100 - COLLAPSE_THRESHOLD) {
				stopDrag(false);
				setCollapsed('second');
				return;
			}
		}

		updateSize(raw);
		last_pointer_coord = vertical ? touch.clientY : touch.clientX;
		updateOvershoot();
	}

	function handleTouchEnd() {
		if (!dragging) return;
		stopDrag();
	}

	// Double-click to collapse
	function handleDblClick() {
		if (!collapsible) return;
		toggleCollapse();
	}

	// ---- Keyboard handling ----

	function handleKeyDown(e: KeyboardEvent) {
		const step = e.shiftKey ? 5 : 1;
		let new_size = collapsed === null ? size : size_before_collapse;

		switch (e.key) {
			case 'ArrowLeft':
			case 'ArrowUp':
				e.preventDefault();
				if (collapsed !== null) {
					setCollapsed(null);
					return;
				}
				new_size = size - step;
				break;
			case 'ArrowRight':
			case 'ArrowDown':
				e.preventDefault();
				if (collapsed !== null) {
					setCollapsed(null);
					return;
				}
				new_size = size + step;
				break;
			case 'Home':
				e.preventDefault();
				if (collapsed !== null) {
					setCollapsed(null);
				}
				new_size = min_size;
				break;
			case 'End':
				e.preventDefault();
				if (collapsed !== null) {
					setCollapsed(null);
				}
				new_size = max_size;
				break;
			case 'Enter':
				e.preventDefault();
				toggleCollapse();
				return;
			default:
				return;
		}

		updateSize(new_size);
	}

	// ---- Expand button handler ----

	function handleExpand() {
		setCollapsed(null);
	}
</script>

<div
	class={['split-pane', class_name].filter(Boolean).join(' ')}
	class:vertical
	class:horizontal={!vertical}
	class:dragging
	class:snapping
	class:animating
	class:collapsed-first={collapsed === 'first'}
	class:collapsed-second={collapsed === 'second'}
	{id}
	bind:this={container}>
	<!-- First pane -->
	<div
		class="pane first"
		style:flex-basis={first_basis}
		aria-hidden={collapsed === 'first' || undefined}
		{@attach scrollbar()}>
		{#if first}
			{@render first()}
		{/if}
		{#if collapsible && collapsed === 'first'}
			<button
				class:vertical
				type="button"
				aria-label="Expand first pane"
				onclick={handleExpand}>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					{#if vertical}
						<path
							d="M3 6l5 5 5-5"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round" />
					{:else}
						<path
							d="M6 3l5 5-5 5"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round" />
					{/if}
				</svg>
			</button>
		{/if}
	</div>

	<!-- Divider -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="divider"
		role="separator"
		tabindex="0"
		aria-orientation={vertical ? 'vertical' : 'horizontal'}
		aria-valuenow={Math.round(clamped_size)}
		aria-valuemin={min_size}
		aria-valuemax={max_size}
		aria-label="Resize panes"
		onmousedown={handlePointerDown}
		ontouchstart={handleTouchStart}
		ondblclick={handleDblClick}
		onkeydown={handleKeyDown}>
		<div class="handle"></div>
	</div>

	<!-- Second pane -->
	<div
		class="pane second"
		style:flex-basis={second_basis}
		aria-hidden={collapsed === 'second' || undefined}
		{@attach scrollbar()}>
		{#if collapsible && collapsed === 'second'}
			<button
				class:vertical
				type="button"
				aria-label="Expand second pane"
				onclick={handleExpand}>
				<svg viewBox="0 0 16 16" aria-hidden="true">
					{#if vertical}
						<path
							d="M3 10l5-5 5 5"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round" />
					{:else}
						<path
							d="M10 3l-5 5 5 5"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round" />
					{/if}
				</svg>
			</button>
		{/if}
		{#if second}
			{@render second()}
		{/if}
	</div>
</div>

<style>
	.split-pane {
		display: flex;
		width: 100%;
		height: 100%;
		overflow: hidden;

		&.horizontal {
			flex-direction: row;
		}

		&.vertical {
			flex-direction: column;
		}

		&.dragging {
			user-select: none;
			-webkit-user-select: none;
			cursor: col-resize;

			&.vertical {
				cursor: row-resize;
			}
		}
	}

	.pane {
		position: relative;
		overflow: auto;
		min-width: 0;
		min-height: 0;

		/* Explicit cross-axis size so nested components with height/width: 100% resolve correctly */
		.horizontal > & {
			height: 100%;
		}
		.vertical > & {
			width: 100%;
		}

		.snapping & {
			transition: flex-basis 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
		}

		.animating & {
			transition: flex-basis 200ms ease;
		}

		.dragging & {
			transition: none;
		}
	}

	.first {
		flex-shrink: 0;
		flex-grow: 0;

		.collapsed-first & {
			overflow: hidden;
		}
	}

	.second {
		flex-shrink: 0;
		flex-grow: 0;

		.collapsed-second & {
			overflow: hidden;
		}
	}

	.divider {
		flex-shrink: 0;
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		background: light-dark(var(--color-border, #e0e0e0), var(--color-border, #3a3a3a));
		touch-action: none;
		outline: none;
		z-index: 1;

		&:hover,
		&:active {
			background: light-dark(var(--color-action, #1976d2), var(--color-action, #5c9ce6));
			transition: none;
		}

		&:focus-visible {
			outline: 2px solid var(--color-action, #1976d2);
			outline-offset: -2px;
		}

		/* Direct child selectors prevent leaking into nested SplitPane instances */
		.horizontal > & {
			width: 4px;
			cursor: col-resize;
		}
		.vertical > & {
			height: 4px;
			cursor: row-resize;
		}
		.dragging > & {
			background: light-dark(var(--color-action, #1976d2), var(--color-action, #5c9ce6));
		}
	}

	.handle {
		position: absolute;

		.horizontal > .divider > & {
			width: 12px;
			height: 100%;
			left: -4px;
		}
		.vertical > .divider > & {
			height: 12px;
			width: 100%;
			top: -4px;
		}
	}

	/* The expand buttons are the component's only <button>s */
	button {
		position: absolute;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid
			light-dark(var(--color-border, #e0e0e0), var(--color-border, #3a3a3a));
		background: light-dark(var(--color-bg, #ffffff), var(--color-bg, #1e1e1e));
		color: light-dark(var(--color-text-muted, #666), var(--color-text-muted, #aaa));
		cursor: pointer;
		padding: 0;
		width: 20px;
		height: 20px;
		border-radius: var(--radius-md, 4px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md, 4px) * var(--squircle-ratio, 2));
		}
		transition:
			color 150ms ease,
			background 150ms ease;

		&:hover {
			color: light-dark(var(--color-action, #1976d2), var(--color-action, #5c9ce6));
			background: light-dark(
				var(--color-bg-active, #f5f5f5),
				var(--color-bg-active, #2a2a2a)
			);
			transition: none;
		}

		&:focus-visible {
			outline: 2px solid var(--color-action, #1976d2);
			outline-offset: 2px;
		}

		svg {
			width: 12px;
			height: 12px;
		}
	}

	/* Expand button positioning for collapsed first pane (horizontal) */
	.collapsed-first.horizontal .first button {
		top: 50%;
		right: 0;
		transform: translateY(-50%);
	}

	/* Expand button positioning for collapsed first pane (vertical) */
	.collapsed-first.vertical .first button {
		left: 50%;
		bottom: 0;
		transform: translateX(-50%);
	}

	/* Expand button positioning for collapsed second pane (horizontal) */
	.collapsed-second.horizontal .second button {
		top: 50%;
		left: 0;
		transform: translateY(-50%);
	}

	/* Expand button positioning for collapsed second pane (vertical) */
	.collapsed-second.vertical .second button {
		left: 50%;
		top: 0;
		transform: translateX(-50%);
	}

	@media (prefers-reduced-motion: reduce) {
		.pane {
			transition: none;
		}
	}
</style>
