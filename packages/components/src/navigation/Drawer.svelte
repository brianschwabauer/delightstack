<!-- svelte-ignore state_referenced_locally -->
<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { focusTrap } from '@delightstack/utilities';

	const propId = $props.id();
	let {
		/** Whether the drawer is open */
		open = $bindable(false) as boolean,

		/** Position the drawer on the right edge */
		right = false,

		/** Position the drawer on the top edge */
		top = false,

		/** Position the drawer on the bottom edge */
		bottom = false,

		/** Use push mode: content shifts, no backdrop */
		push = false,

		/** Use persistent mode: always visible, part of layout flow */
		persistent = false,

		/** Width of the drawer (used for left/right positions) */
		width = '280px',

		/** Height of the drawer (used for top/bottom positions) */
		height = '280px',

		/** Whether clicking outside the drawer closes it */
		closeOnOutsideClick = true,

		/** Whether pressing Escape closes the drawer */
		closeOnEscape = true,

		/** Media query breakpoint for switching between persistent (desktop) and overlay (mobile) */
		breakpoint = undefined as string | undefined,

		/** The id of the drawer element */
		id = propId,

		/** Specifies a custom class name for the drawer */
		class: className = '',

		/** The snippet used to render the drawer body */
		children = undefined as undefined | Snippet,

		/** The snippet used to render the drawer header */
		header = undefined as undefined | Snippet,

		/** The snippet used to render the drawer footer */
		footer = undefined as undefined | Snippet,

		/** Called when the drawer opens */
		onopen = undefined as undefined | (() => void),

		/** Called when the drawer closes */
		onclose = undefined as undefined | (() => void),
	} = $props();

	/** The element that had focus before the drawer opened, so we can restore it on close */
	let previous_focus = $state<HTMLElement | undefined>(undefined);

	/** The drawer panel element */
	let drawer_el = $state<HTMLElement | undefined>(undefined);

	/** Whether the breakpoint media query currently matches (true = desktop/persistent) */
	let breakpoint_matches = $state(false);

	/** Touch tracking state for swipe-to-close */
	let touch_start_x = 0;
	let touch_start_y = 0;
	let touch_current_x = 0;
	let touch_current_y = 0;
	let is_swiping = $state(false);
	let swipe_offset = $state(0);

	/** Determine the position side */
	const side = $derived(
		bottom ? 'bottom' : top ? 'top' : right ? 'right' : 'left',
	);

	/** Whether the drawer is horizontal (left/right) */
	const is_horizontal = $derived(side === 'left' || side === 'right');

	/** Determine the effective mode considering breakpoint */
	const is_persistent = $derived(
		persistent || (breakpoint ? breakpoint_matches : false),
	);
	const is_push = $derived(!is_persistent && push);
	const is_overlay = $derived(!is_persistent && !is_push);

	/** The size dimension to apply */
	const size_value = $derived(is_horizontal ? width : height);

	// Breakpoint media query listener
	$effect(() => {
		if (!breakpoint) return;
		const mql = window.matchMedia(breakpoint);
		breakpoint_matches = mql.matches;
		function onChange(e: MediaQueryListEvent) {
			breakpoint_matches = e.matches;
		}
		mql.addEventListener('change', onChange);
		return () => mql.removeEventListener('change', onChange);
	});

	// When persistent mode activates, force open
	$effect(() => {
		if (is_persistent && !open) {
			open = true;
		}
	});

	// Fire onopen/onclose callbacks and manage focus + scroll lock
	$effect(() => {
		if (open) {
			untrack(() => {
				previous_focus = document.activeElement as HTMLElement | undefined;
				onopen?.();
			});
		} else {
			untrack(() => {
				onclose?.();
				if (previous_focus && typeof previous_focus.focus === 'function') {
					previous_focus.focus();
					previous_focus = undefined;
				}
			});
		}
	});

	// Body scroll lock for overlay mode
	$effect(() => {
		if (is_overlay && open) {
			const original_overflow = document.body.style.overflow;
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = original_overflow;
			};
		}
	});

	// Escape key handler
	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && closeOnEscape && open && !is_persistent) {
			e.preventDefault();
			e.stopPropagation();
			open = false;
		}
	}

	// Backdrop click handler
	function handleBackdropClick() {
		if (closeOnOutsideClick && open && !is_persistent) {
			open = false;
		}
	}

	// Touch/swipe handlers for swipe-to-close
	function handleTouchStart(e: TouchEvent) {
		if (is_persistent || !open) return;
		const touch = e.touches[0];
		touch_start_x = touch.clientX;
		touch_start_y = touch.clientY;
		touch_current_x = touch.clientX;
		touch_current_y = touch.clientY;
		is_swiping = false;
		swipe_offset = 0;
	}

	function handleTouchMove(e: TouchEvent) {
		if (is_persistent || !open) return;
		const touch = e.touches[0];
		touch_current_x = touch.clientX;
		touch_current_y = touch.clientY;

		const dx = touch_current_x - touch_start_x;
		const dy = touch_current_y - touch_start_y;

		// Determine if this is a valid swipe in the dismissal direction
		if (!is_swiping) {
			const abs_dx = Math.abs(dx);
			const abs_dy = Math.abs(dy);
			// Need a minimum movement to determine swipe direction
			if (abs_dx < 10 && abs_dy < 10) return;

			if (is_horizontal) {
				// For left/right drawers, horizontal swipe must dominate
				if (abs_dx < abs_dy) return;
				// Must swipe toward the edge the drawer came from
				if (side === 'left' && dx > 0) return;
				if (side === 'right' && dx < 0) return;
				is_swiping = true;
			} else {
				// For top/bottom drawers, vertical swipe must dominate
				if (abs_dy < abs_dx) return;
				if (side === 'top' && dy > 0) return;
				if (side === 'bottom' && dy < 0) return;
				is_swiping = true;
			}
		}

		if (is_swiping) {
			if (is_horizontal) {
				// Compute offset clamped to positive values (distance toward the edge)
				const raw = side === 'left' ? -dx : dx;
				swipe_offset = Math.max(0, raw);
			} else {
				const raw = side === 'top' ? -dy : dy;
				swipe_offset = Math.max(0, raw);
			}
		}
	}

	function handleTouchEnd() {
		if (!is_swiping) return;
		// If swiped more than 30% of the drawer size, close it
		const threshold = 0.3;
		if (drawer_el) {
			const dimension = is_horizontal ? drawer_el.offsetWidth : drawer_el.offsetHeight;
			if (swipe_offset > dimension * threshold) {
				open = false;
			}
		}
		is_swiping = false;
		swipe_offset = 0;
	}

	/** Compute the inline transform for swipe feedback */
	const swipe_transform = $derived.by(() => {
		if (!is_swiping || swipe_offset === 0) return '';
		if (is_horizontal) {
			const sign = side === 'left' ? -1 : 1;
			return `translateX(${sign * swipe_offset}px)`;
		} else {
			const sign = side === 'top' ? -1 : 1;
			return `translateY(${sign * swipe_offset}px)`;
		}
	});
</script>

<svelte:window onkeydown={handleKeydown} />

{#if is_persistent}
	<!-- Persistent mode: render inline, no portal, no backdrop -->
	<aside
		bind:this={drawer_el}
		class={['drawer', side, 'persistent', 'open', className].filter(Boolean).join(' ')}
		style:width={is_horizontal ? size_value : undefined}
		style:height={!is_horizontal ? size_value : undefined}
		aria-label="Side panel"
		{id}>
		{#if header}
			<div class="drawer-header">
				{@render header()}
			</div>
		{/if}
		<div class="drawer-content">
			{#if children}{@render children()}{/if}
		</div>
		{#if footer}
			<div class="drawer-footer">
				{@render footer()}
			</div>
		{/if}
	</aside>
{:else if open}
	<!-- Overlay / Push mode -->
	{#if is_overlay}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="drawer-backdrop"
			class:open
			role="button"
			tabindex="-1"
			onclick={handleBackdropClick}>
		</div>
	{/if}
	<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
	<aside
		bind:this={drawer_el}
		class={['drawer', side, open ? 'open' : '', is_push ? 'push' : '', className].filter(Boolean).join(' ')}
		style:width={is_horizontal ? size_value : undefined}
		style:height={!is_horizontal ? size_value : undefined}
		style:transform={swipe_transform || undefined}
		style:transition={is_swiping ? 'none' : undefined}
		role="dialog"
		aria-modal={is_overlay ? 'true' : undefined}
		{id}
		{@attach focusTrap({
			enabled: is_overlay && open,
			escapeDeactivates: false,
			allowOutsideClick: true,
			returnFocusOnDeactivate: true,
			initialFocus: false,
		})}
		ontouchstart={handleTouchStart}
		ontouchmove={handleTouchMove}
		ontouchend={handleTouchEnd}>
		{#if header}
			<div class="drawer-header">
				{@render header()}
			</div>
		{/if}
		<div class="drawer-content">
			{#if children}{@render children()}{/if}
		</div>
		{#if footer}
			<div class="drawer-footer">
				{@render footer()}
			</div>
		{/if}
	</aside>
{/if}

<style>
	.drawer {
		position: fixed;
		background: light-dark(var(--color-surface-1), var(--color-surface-1));
		box-shadow: var(--shadow-lg);
		display: flex;
		flex-direction: column;
		z-index: var(--layer-drawer, 300);
		transition: transform 250ms ease;
	}

	@media (prefers-reduced-motion: reduce) {
		.drawer {
			transition: none;
		}
	}

	.drawer.left {
		top: 0;
		left: 0;
		bottom: 0;
		transform: translateX(-100%);
	}
	.drawer.left.open {
		transform: translateX(0);
	}

	.drawer.right {
		top: 0;
		right: 0;
		bottom: 0;
		transform: translateX(100%);
	}
	.drawer.right.open {
		transform: translateX(0);
	}

	.drawer.top {
		top: 0;
		left: 0;
		right: 0;
		transform: translateY(-100%);
	}
	.drawer.top.open {
		transform: translateY(0);
	}

	.drawer.bottom {
		bottom: 0;
		left: 0;
		right: 0;
		transform: translateY(100%);
	}
	.drawer.bottom.open {
		transform: translateY(0);
	}

	.drawer.persistent {
		position: relative;
		box-shadow: none;
		transform: none;
		border-right: 1px solid var(--color-border);
	}
	.drawer.persistent.top,
	.drawer.persistent.bottom {
		border-right: none;
		border-bottom: 1px solid var(--color-border);
	}
	.drawer.persistent.bottom {
		border-bottom: none;
		border-top: 1px solid var(--color-border);
	}
	.drawer.persistent.right {
		border-right: none;
		border-left: 1px solid var(--color-border);
	}

	.drawer-backdrop {
		position: fixed;
		inset: 0;
		background: var(--color-backdrop, rgba(0, 0, 0, 0.5));
		z-index: var(--layer-drawer, 300);
		transition: opacity 250ms ease;
	}

	@media (prefers-reduced-motion: reduce) {
		.drawer-backdrop {
			transition: none;
		}
	}

	.drawer-header {
		flex-shrink: 0;
	}

	.drawer-content {
		flex: 1;
		overflow-y: auto;
	}

	.drawer-footer {
		flex-shrink: 0;
	}
</style>
