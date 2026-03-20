<script lang="ts">
	import { type Snippet } from 'svelte';

	const propId = $props.id();
	let {
		/** Whether the split is vertical (top/bottom) instead of horizontal (left/right) */
		vertical = false,

		/** First pane size as a percentage (0-100), bindable */
		size = $bindable(50),

		/** Minimum first pane size as a percentage */
		minSize = 10,

		/** Maximum first pane size as a percentage */
		maxSize = 90,

		/** Snap points as percentages */
		snap = [] as number[],

		/** Distance in percentage to trigger snap */
		snapThreshold = 3,

		/** Whether panes can be collapsed */
		collapsible = false,

		/** Which pane is currently collapsed, bindable */
		collapsed = $bindable(null) as 'first' | 'second' | null,

		/** The ID of the element */
		id = propId,

		/** Specifies a custom class name for the container element */
		class: className = '',

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
		minSize?: number;
		maxSize?: number;
		snap?: number[];
		snapThreshold?: number;
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

	/** The size value before a collapse, so we can restore it on expand */
	let size_before_collapse = $state(50);

	const clamped_size = $derived(Math.min(maxSize, Math.max(minSize, size)));

	/** The flex-basis for the first pane */
	const first_basis = $derived.by(() => {
		if (collapsed === 'first') return '0%';
		if (collapsed === 'second') return '100%';
		return `${clamped_size}%`;
	});

	/** The flex-basis for the second pane */
	const second_basis = $derived.by(() => {
		if (collapsed === 'first') return '100%';
		if (collapsed === 'second') return '0%';
		return `${100 - clamped_size}%`;
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
		let result = Math.min(maxSize, Math.max(minSize, percent));

		// Apply snap points
		if (snap.length > 0) {
			for (const point of snap) {
				if (Math.abs(result - point) <= snapThreshold) {
					result = point;
					break;
				}
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
		setTimeout(() => {
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

	// ---- Pointer drag handling ----

	function handlePointerDown(e: MouseEvent) {
		if (collapsed !== null) return;
		e.preventDefault();
		dragging = true;
		document.addEventListener('mousemove', handlePointerMove);
		document.addEventListener('mouseup', handlePointerUp);
	}

	function handlePointerMove(e: MouseEvent) {
		if (!dragging) return;
		e.preventDefault();
		const percent = pointerToPercent(e.clientX, e.clientY);
		updateSize(percent);
	}

	function handlePointerUp(e: MouseEvent) {
		if (!dragging) return;
		dragging = false;
		document.removeEventListener('mousemove', handlePointerMove);
		document.removeEventListener('mouseup', handlePointerUp);
	}

	// Touch handling
	function handleTouchStart(e: TouchEvent) {
		if (collapsed !== null) return;
		e.preventDefault();
		dragging = true;
		document.addEventListener('touchmove', handleTouchMove, { passive: false });
		document.addEventListener('touchend', handleTouchEnd);
	}

	function handleTouchMove(e: TouchEvent) {
		if (!dragging) return;
		e.preventDefault();
		const touch = e.touches[0];
		const percent = pointerToPercent(touch.clientX, touch.clientY);
		updateSize(percent);
	}

	function handleTouchEnd() {
		if (!dragging) return;
		dragging = false;
		document.removeEventListener('touchmove', handleTouchMove);
		document.removeEventListener('touchend', handleTouchEnd);
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
				new_size = minSize;
				break;
			case 'End':
				e.preventDefault();
				if (collapsed !== null) {
					setCollapsed(null);
				}
				new_size = maxSize;
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
	class={['split-pane', className].filter(Boolean).join(' ')}
	class:vertical
	class:horizontal={!vertical}
	class:dragging
	class:animating
	class:collapsed-first={collapsed === 'first'}
	class:collapsed-second={collapsed === 'second'}
	{id}
	bind:this={container}>
	<!-- First pane -->
	<div
		class="pane pane-first"
		style:flex-basis={first_basis}
		aria-hidden={collapsed === 'first' || undefined}>
		{#if first}
			{@render first()}
		{/if}
		{#if collapsible && collapsed === 'first'}
			<button
				class="expand-button"
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
		aria-valuemin={minSize}
		aria-valuemax={maxSize}
		aria-label="Resize panes"
		onmousedown={handlePointerDown}
		ontouchstart={handleTouchStart}
		ondblclick={handleDblClick}
		onkeydown={handleKeyDown}>
		<div class="divider-handle"></div>
	</div>

	<!-- Second pane -->
	<div
		class="pane pane-second"
		style:flex-basis={second_basis}
		aria-hidden={collapsed === 'second' || undefined}>
		{#if collapsible && collapsed === 'second'}
			<button
				class="expand-button"
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

		.animating & {
			transition: flex-basis 200ms ease;
		}
	}

	.pane-first {
		flex-shrink: 0;
		flex-grow: 0;

		.collapsed-first & {
			overflow: hidden;
		}
	}

	.pane-second {
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

		.horizontal & {
			width: 4px;
			cursor: col-resize;
		}

		.vertical & {
			height: 4px;
			cursor: row-resize;
		}

		&:hover,
		&:active {
			background: light-dark(var(--color-action, #1976d2), var(--color-action, #5c9ce6));
			transition: none;
		}

		&:focus-visible {
			outline: 2px solid var(--color-action, #1976d2);
			outline-offset: -2px;
		}

		.dragging & {
			background: light-dark(var(--color-action, #1976d2), var(--color-action, #5c9ce6));
		}
	}

	.divider-handle {
		position: absolute;

		.horizontal & {
			width: 12px;
			height: 100%;
			left: -4px;
		}

		.vertical & {
			height: 12px;
			width: 100%;
			top: -4px;
		}
	}

	.expand-button {
		position: absolute;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid
			light-dark(var(--color-border, #e0e0e0), var(--color-border, #3a3a3a));
		background: light-dark(var(--color-bg, #ffffff), var(--color-bg, #1e1e1e));
		color: light-dark(
			var(--color-text-secondary, #666),
			var(--color-text-secondary, #aaa)
		);
		cursor: pointer;
		padding: 0;
		width: 20px;
		height: 20px;
		border-radius: var(--radius-2, 4px);
		transition:
			color 150ms ease,
			background 150ms ease;

		&:hover {
			color: light-dark(var(--color-action, #1976d2), var(--color-action, #5c9ce6));
			background: light-dark(
				var(--color-bg-hover, #f5f5f5),
				var(--color-bg-hover, #2a2a2a)
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
	.collapsed-first.horizontal .pane-first .expand-button {
		top: 50%;
		right: 0;
		transform: translateY(-50%);
	}

	/* Expand button positioning for collapsed first pane (vertical) */
	.collapsed-first.vertical .pane-first .expand-button {
		left: 50%;
		bottom: 0;
		transform: translateX(-50%);
	}

	/* Expand button positioning for collapsed second pane (horizontal) */
	.collapsed-second.horizontal .pane-second .expand-button {
		top: 50%;
		left: 0;
		transform: translateY(-50%);
	}

	/* Expand button positioning for collapsed second pane (vertical) */
	.collapsed-second.vertical .pane-second .expand-button {
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
