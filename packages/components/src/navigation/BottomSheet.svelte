<script lang="ts">
	import { type Snippet, untrack } from 'svelte';
	import { portal } from '../actions/Portal.svelte';

	const propId = $props.id();
	let {
		/** Whether the bottom sheet is open */
		open = $bindable(false) as boolean,

		/** Snap points as fractions of viewport height (0-1) */
		snapPoints = [0.5, 1] as number[],

		/** Default snap point index when opening */
		defaultSnap = 0,

		/** Current snap point index */
		snap = $bindable(0) as number,

		/** Whether the sheet can be dismissed by dragging down */
		dismissible = true,

		/** Whether to show the drag handle */
		showHandle = true,

		/** Whether to show the backdrop overlay */
		showBackdrop = true,

		/** Whether to lock body scroll when open */
		blocking = true,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: className = '',

		/** Main content */
		children = undefined as undefined | Snippet,

		/** Header content rendered below the handle */
		header = undefined as undefined | Snippet,

		/** Called when the sheet opens */
		onopen = undefined as undefined | (() => void),

		/** Called when the sheet closes */
		onclose = undefined as undefined | (() => void),

		/** Called when the sheet snaps to a point */
		onsnap = undefined as undefined | ((detail: { index: number; height: number }) => void),
	} = $props();

	// --- Element refs ---
	let sheet_el = $state<HTMLElement | undefined>();
	let content_el = $state<HTMLElement | undefined>();

	// --- Internal state ---
	let dragging = $state(false);
	let animating = $state(false);
	let sheet_y = $state(0); // current sheet height from bottom (0 = fully hidden)
	let viewport_height = $state(0);
	let was_open = $state(false);
	let scroll_dragging = $state(false);

	// --- Pointer tracking ---
	let pointer_start_y = 0;
	let pointer_start_sheet_y = 0;
	let pointer_last_y = 0;
	let pointer_last_time = 0;
	let velocity = 0;

	// --- Animation ---
	let animation_frame = 0;
	let animation_start_time = 0;
	let animation_start_y = 0;
	let animation_target_y = 0;
	let animation_duration = 350;

	// --- Derived ---
	const sorted_snaps = $derived([...snapPoints].sort((a, b) => a - b));
	const snap_heights = $derived(sorted_snaps.map((s) => s * viewport_height));
	const max_snap_height = $derived(snap_heights[snap_heights.length - 1] ?? 0);
	const at_highest_snap = $derived(
		snap_heights.length > 0 &&
			Math.abs(sheet_y - snap_heights[snap_heights.length - 1]) < 2,
	);

	// --- Viewport tracking ---
	function onResize() {
		viewport_height = window.innerHeight;
	}

	$effect(() => {
		viewport_height = window.innerHeight;
	});

	// --- Body scroll lock ---
	$effect(() => {
		if (open && blocking) {
			const original = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = original;
			};
		}
	});

	// --- Open/close lifecycle ---
	$effect(() => {
		if (open && !was_open) {
			was_open = true;
			const target_index = Math.min(defaultSnap, snap_heights.length - 1);
			const target_height = snap_heights[target_index] ?? snap_heights[0] ?? viewport_height * 0.5;
			snap = target_index;
			animateTo(target_height, 350);
			onopen?.();
		} else if (!open && was_open) {
			was_open = false;
			animateTo(0, 250, () => {
				onclose?.();
			});
		}
	});

	// --- Snap to nearest ---
	function findNearestSnap(y: number): number {
		let closest_index = 0;
		let closest_dist = Infinity;
		for (let i = 0; i < snap_heights.length; i++) {
			const dist = Math.abs(y - snap_heights[i]);
			if (dist < closest_dist) {
				closest_dist = dist;
				closest_index = i;
			}
		}
		return closest_index;
	}

	function findHigherSnap(current_index: number): number {
		return Math.min(current_index + 1, snap_heights.length - 1);
	}

	function findLowerSnap(current_index: number): number {
		return Math.max(current_index - 1, 0);
	}

	// --- Animation ---
	function animateTo(target: number, duration = 350, oncomplete?: () => void) {
		cancelAnimationFrame(animation_frame);
		animating = true;
		animation_start_time = performance.now();
		animation_start_y = untrack(() => sheet_y);
		animation_target_y = target;
		animation_duration = duration;

		function step(time: number) {
			const elapsed = time - animation_start_time;
			const progress = Math.min(elapsed / animation_duration, 1);
			// Spring-like cubic-bezier(0.32, 0.72, 0, 1) approximation
			const eased = 1 - Math.pow(1 - progress, 3);
			sheet_y = animation_start_y + (animation_target_y - animation_start_y) * eased;

			if (progress < 1) {
				animation_frame = requestAnimationFrame(step);
			} else {
				sheet_y = animation_target_y;
				animating = false;
				oncomplete?.();
			}
		}

		animation_frame = requestAnimationFrame(step);
	}

	// --- Rubber banding ---
	function rubberBand(overscroll: number): number {
		return overscroll * 0.3;
	}

	// --- Gesture handling ---
	function onHandlePointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		startDrag(e);
	}

	function onHeaderPointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		startDrag(e);
	}

	function startDrag(e: PointerEvent) {
		cancelAnimationFrame(animation_frame);
		dragging = true;
		scroll_dragging = false;
		pointer_start_y = e.clientY;
		pointer_start_sheet_y = untrack(() => sheet_y);
		pointer_last_y = e.clientY;
		pointer_last_time = e.timeStamp;
		velocity = 0;

		document.body.style.userSelect = 'none';

		(e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
	}

	function onDragMove(e: PointerEvent) {
		if (!dragging) return;

		const current_y = e.clientY;
		const dt = Math.max(1, e.timeStamp - pointer_last_time);
		velocity = (pointer_last_y - current_y) / dt; // positive = dragging up
		pointer_last_y = current_y;
		pointer_last_time = e.timeStamp;

		const delta = pointer_start_y - current_y; // positive = dragging up
		let new_y = pointer_start_sheet_y + delta;

		// Apply rubber banding when dragging past top snap
		if (new_y > max_snap_height) {
			const overscroll = new_y - max_snap_height;
			new_y = max_snap_height + rubberBand(overscroll);
		}

		// Don't allow dragging below 0
		if (new_y < 0) {
			new_y = 0;
		}

		sheet_y = new_y;
	}

	function onDragEnd(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		document.body.style.userSelect = '';

		const speed = Math.abs(velocity); // px/ms
		const current_snap_index = findNearestSnap(sheet_y);

		if (speed > 0.5) {
			// Fast swipe
			if (velocity < 0) {
				// Swiping down
				if (dismissible && current_snap_index === 0) {
					dismiss();
				} else {
					const lower = findLowerSnap(current_snap_index);
					if (lower === current_snap_index && dismissible) {
						dismiss();
					} else {
						snapTo(lower);
					}
				}
			} else {
				// Swiping up
				const higher = findHigherSnap(current_snap_index);
				snapTo(higher);
			}
		} else {
			// Slow release - snap to nearest
			const nearest = findNearestSnap(sheet_y);

			// If below the lowest snap and dismissible, dismiss
			if (dismissible && sheet_y < snap_heights[0] * 0.5) {
				dismiss();
			} else {
				snapTo(nearest);
			}
		}
	}

	function snapTo(index: number) {
		const clamped = Math.max(0, Math.min(index, snap_heights.length - 1));
		const height = snap_heights[clamped];
		snap = clamped;
		animateTo(height, 350, () => {
			onsnap?.({ index: clamped, height });
		});
	}

	function dismiss() {
		open = false;
	}

	// --- Scroll-to-dismiss ---
	function onContentScroll() {
		// handled in pointer events below
	}

	function onContentPointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		if (!at_highest_snap) {
			// Not at highest snap, start normal sheet drag
			startDrag(e);
			return;
		}

		// At highest snap, let scroll handle it unless at scroll top
		if (content_el && content_el.scrollTop <= 0) {
			// At scroll top - could be a pull-to-dismiss gesture
			scroll_dragging = true;
			pointer_start_y = e.clientY;
			pointer_start_sheet_y = untrack(() => sheet_y);
			pointer_last_y = e.clientY;
			pointer_last_time = e.timeStamp;
			velocity = 0;
		}
	}

	function onContentPointerMove(e: PointerEvent) {
		if (!scroll_dragging) return;
		if (!content_el) return;

		const delta_from_start = pointer_start_y - e.clientY; // positive = up

		// If pulling down and at scroll top, transition to sheet drag
		if (delta_from_start < 0 && content_el.scrollTop <= 0) {
			if (!dragging) {
				// Transition from scroll to sheet drag
				dragging = true;
				document.body.style.userSelect = 'none';
				// Prevent the content from scrolling
				if (content_el) {
					content_el.style.overflowY = 'hidden';
				}
			}
			onDragMove(e);
		} else if (dragging) {
			// Was dragging but now pulling up, stop drag
			onDragMove(e);
		}
	}

	function onContentPointerUp(e: PointerEvent) {
		if (scroll_dragging) {
			scroll_dragging = false;
			if (content_el) {
				content_el.style.overflowY = '';
			}
			if (dragging) {
				onDragEnd(e);
				return;
			}
		}
	}

	// --- Backdrop click ---
	function onBackdropClick() {
		if (dismissible) {
			dismiss();
		}
	}

	// --- Keyboard ---
	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape' && dismissible) {
			dismiss();
		}
	}

	// --- Computed styles ---
	const translate_y = $derived(sheet_y <= 0 ? 100 : Math.max(0, 100 - (sheet_y / viewport_height) * 100));
	const backdrop_opacity = $derived(
		max_snap_height > 0 ? Math.min(1, sheet_y / max_snap_height) : 0,
	);

	// --- Aria values for handle slider ---
	const aria_value_now = $derived(snap_heights.length > 0 ? Math.round((sheet_y / viewport_height) * 100) : 0);
	const aria_value_min = $derived(0);
	const aria_value_max = $derived(Math.round((max_snap_height / viewport_height) * 100));
</script>

<svelte:window onresize={onResize} onkeydown={open ? onKeyDown : undefined} />

{#if open || sheet_y > 0}
	<div
		use:portal={'body'}
		class={['wrapper', className].filter(Boolean).join(' ')}
		{id}>
		{#if showBackdrop}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				class="backdrop"
				class:no-transition={dragging || animating}
				style:opacity={backdrop_opacity}
				style:pointer-events={sheet_y > 0 ? 'auto' : 'none'}
				role="button"
				tabindex="-1"
				onclick={onBackdropClick}>
			</div>
		{/if}

		<div
			class="sheet"
			class:no-transition={dragging || animating}
			bind:this={sheet_el}
			role="dialog"
			aria-modal="true"
			style:transform="translateY({translate_y}%)">
			{#if showHandle}
				<div
					class="handle"
					role="slider"
					tabindex="0"
					aria-label="Sheet height"
					aria-valuemin={aria_value_min}
					aria-valuemax={aria_value_max}
					aria-valuenow={aria_value_now}
					onpointerdown={onHandlePointerDown}
					onpointermove={onDragMove}
					onpointerup={onDragEnd}
					onpointercancel={onDragEnd}>
					<div class="handle-bar"></div>
				</div>
			{/if}

			{#if header}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="header"
					onpointerdown={onHeaderPointerDown}
					onpointermove={onDragMove}
					onpointerup={onDragEnd}
					onpointercancel={onDragEnd}>
					{@render header()}
				</div>
			{/if}

			{#if children}
				<div
					class="content"
					bind:this={content_el}
					onscroll={onContentScroll}
					onpointerdown={onContentPointerDown}
					onpointermove={onContentPointerMove}
					onpointerup={onContentPointerUp}
					onpointercancel={onContentPointerUp}>
					{@render children()}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.wrapper {
		display: contents;
	}

	.backdrop {
		position: fixed;
		inset: 0;
		background: var(--color-backdrop, rgba(0, 0, 0, 0.5));
		z-index: var(--layer-modal, 400);
		transition: opacity 150ms ease;

		&.no-transition {
			transition: none;
		}
	}

	.sheet {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		background: light-dark(var(--color-surface-1, white), var(--color-surface-1, #1a1a1a));
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		box-shadow: var(--shadow-lg);
		z-index: var(--layer-modal, 400);
		transform: translateY(100%);
		max-height: calc(100vh - env(safe-area-inset-top) - 1rem);
		display: flex;
		flex-direction: column;
		touch-action: none;

		&.no-transition {
			transition: none;
		}
	}

	.handle {
		display: flex;
		justify-content: center;
		padding: 0.75rem 0 0.5rem;
		cursor: grab;
		touch-action: none;
		flex-shrink: 0;

		&:active {
			cursor: grabbing;
		}

		&:focus-visible {
			outline: 2px solid var(--color-accent, #0066ff);
			outline-offset: -2px;
			border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		}
	}

	.handle-bar {
		width: 36px;
		height: 4px;
		border-radius: 9999px;
		background: var(--color-text-disabled, #a3a3a3);
	}

	.header {
		flex-shrink: 0;
		touch-action: none;
		cursor: grab;

		&:active {
			cursor: grabbing;
		}
	}

	.content {
		flex: 1;
		overflow-y: auto;
		overscroll-behavior: none;
		padding-bottom: env(safe-area-inset-bottom);
		touch-action: pan-y;
	}

	@media (prefers-reduced-motion: reduce) {
		.sheet {
			transition: none;
		}

		.backdrop {
			transition: none;
		}
	}
</style>
