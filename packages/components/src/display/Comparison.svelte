<script lang="ts">
	const propId = $props.id();
	let {
		/** The URL of the "before" image */
		before,

		/** The URL of the "after" image */
		after,

		/** Alt text for the before image @default 'Before' */
		before_alt = 'Before',

		/** Alt text for the after image @default 'After' */
		after_alt = 'After',

		/** The divider position from 0 to 100 (percentage) */
		position = $bindable(50),

		/** Whether the comparison should be vertical instead of horizontal */
		vertical = false,

		/** Whether to show "Before" and "After" labels */
		show_labels = true,

		/** The text for the before label @default 'Before' */
		label_before = 'Before',

		/** The text for the after label @default 'After' */
		label_after = 'After',

		/** Whether to show a skeleton loading state */
		skeleton = false,

		/** Snap points the divider magnetically locks to (percentage values 0-100) */
		snaps = [] as number[],

		/** The ID of the component @defaults to a random ID */
		id = propId,

		/** Specifies a custom class name for the container element */
		class: class_name = '',

		/** Called when the position changes */
		onchange = undefined as ((detail: { position: number }) => void) | undefined,
	}: {
		before: string;
		after: string;
		before_alt?: string;
		after_alt?: string;
		position?: number;
		vertical?: boolean;
		show_labels?: boolean;
		label_before?: string;
		label_after?: string;
		skeleton?: boolean;
		snaps?: number[];
		id?: string;
		class?: string;
		onchange?: (detail: { position: number }) => void;
	} = $props();

	let container: HTMLElement | undefined = $state(undefined);
	let dragging = $state(false);
	/** Whether the pointer moved during the current press, to distinguish a drag
	 *  (already positioned live) from a click that should position on release. */
	let pointer_moved = false;
	let overshoot_px = $state(0);
	let last_pointer_coord = 0;
	let force_overflow = $state(false);
	let overflow_timer: ReturnType<typeof setTimeout> | undefined;
	let snapped_to: number | null = null;

	/** Capture radius (%) — how close the divider must come before a snap grabs
	 *  it. Small so you can rest near a snap point without being pulled in. */
	const SNAP_RADIUS = 4;
	/** Hold/well radius (%) — once snapped, how far the divider may travel before
	 *  it breaks free. Kept large relative to SNAP_RADIUS so the magnet feels
	 *  strong and sticky with a satisfying release spring (hysteresis). Capped
	 *  per-direction by {@link snapReach} so neighbouring wells never overlap. */
	const SNAP_ESCAPE = 10;

	/** How far the handle may stray from `snap` toward `dir` (+1 / -1) before it
	 *  hands off, and the radius of that snap's gravity well in that direction.
	 *  Capped at the midpoint to the nearest neighbour so adjacent wells meet
	 *  cleanly at the midpoint instead of overlapping — an overlap lets the next
	 *  snap grab the handle partway into its well, teleporting the divider. */
	function snapReach(snap: number, dir: number): number {
		let reach = SNAP_ESCAPE;
		for (const other of snaps) {
			if (Math.sign(other - snap) === dir) {
				reach = Math.min(reach, Math.abs(other - snap) / 2);
			}
		}
		return reach;
	}

	const clampedPosition = $derived(Math.min(100, Math.max(0, position)));

	/** Clip-path for the "after" image based on orientation and position (includes overshoot) */
	const afterClipPath = $derived(
		vertical
			? `inset(calc(${clampedPosition}% + ${overshoot_px}px) 0 0 0)`
			: `inset(0 0 0 calc(${clampedPosition}% + ${overshoot_px}px))`,
	);

	/** CSS for the divider position */
	const dividerStyle = $derived(
		vertical
			? `top: ${clampedPosition}%; left: 0; right: 0;`
			: `left: ${clampedPosition}%; top: 0; bottom: 0;`,
	);

	const needs_visible_overflow = $derived(dragging || force_overflow);

	function snapPosition(raw: number): number {
		if (snaps.length === 0) return raw;

		// Hysteresis: once locked to a snap, stay locked to *that* snap until the
		// pointer moves past its (direction-aware) reach. Using snapReach instead
		// of a flat SNAP_ESCAPE keeps the hold zone from overlapping the next
		// snap's capture zone, so escaping one snap hands off to a free zone (or a
		// clean snap-in) rather than teleporting straight into the neighbour.
		if (snapped_to !== null) {
			if (
				Math.abs(raw - snapped_to) <= snapReach(snapped_to, Math.sign(raw - snapped_to))
			) {
				return snapped_to;
			}
			snapped_to = null;
		}

		// Not locked to anything: capture the nearest snap within SNAP_RADIUS
		// (never reaching past the handoff midpoint for tightly-spaced snaps).
		let nearest_snap = -1;
		let min_dist = Infinity;

		for (const snap of snaps) {
			const dist = Math.abs(raw - snap);
			const capture = Math.min(SNAP_RADIUS, snapReach(snap, Math.sign(raw - snap)));
			if (dist < min_dist && dist <= capture) {
				min_dist = dist;
				nearest_snap = snap;
			}
		}

		if (nearest_snap >= 0) {
			snapped_to = nearest_snap;
			return nearest_snap;
		}
		return raw;
	}

	function updatePosition(clientX: number, clientY: number) {
		if (!container) return;
		const rect = container.getBoundingClientRect();
		let raw: number;
		if (vertical) {
			raw = ((clientY - rect.top) / rect.height) * 100;
		} else {
			raw = ((clientX - rect.left) / rect.width) * 100;
		}

		let newPosition: number;
		if (raw < 0) {
			newPosition = 0;
		} else if (raw > 100) {
			newPosition = 100;
		} else {
			newPosition = Math.round(raw * 100) / 100;
			newPosition = snapPosition(newPosition);
		}

		if (newPosition !== position) {
			position = newPosition;
			onchange?.({ position });
		}
	}

	function updateOvershoot() {
		if (!container) return;
		const rect = container.getBoundingClientRect();
		const dimension = vertical ? rect.height : rect.width;
		const raw_pct = vertical
			? (last_pointer_coord - rect.top) / rect.height
			: (last_pointer_coord - rect.left) / rect.width;

		if (raw_pct < 0 || raw_pct > 1) {
			// Edge rubber band (tanh bounded)
			const overflow_px = (raw_pct < 0 ? raw_pct : raw_pct - 1) * dimension;
			const max_shift = 24;
			overshoot_px = max_shift * Math.tanh(overflow_px / 100);
		} else if (snapped_to !== null) {
			// Magnetic snap gravity — the handle clings to the snap and only
			// reluctantly follows the pointer until the escape boundary, giving
			// an obvious "gravity well" feel before it pops free. The well radius
			// must equal the escape reach (snapReach): at t === 1 the eased curve
			// returns the full radius, so the divider sits exactly under the
			// pointer at the boundary — making the handoff seamless instead of a
			// jump when the snap releases the handle.
			const snapped_pct = snapped_to / 100;
			const pull_px = (raw_pct - snapped_pct) * dimension;
			const well_radius_px =
				(snapReach(snapped_to, Math.sign(raw_pct - snapped_pct)) / 100) * dimension;

			if (well_radius_px < 1) {
				overshoot_px = 0;
			} else {
				const t = Math.min(1, Math.abs(pull_px) / well_radius_px);
				const gravity = 0.16;
				const eased = gravity * t + (1 - gravity) * t * t;
				overshoot_px = Math.sign(pull_px) * eased * well_radius_px;
			}
		} else {
			overshoot_px = 0;
		}
	}

	function handlePointerDown(e: PointerEvent) {
		if (skeleton) return;
		e.preventDefault();
		dragging = true;
		pointer_moved = false;
		last_pointer_coord = vertical ? e.clientY : e.clientX;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		updatePosition(e.clientX, e.clientY);
		updateOvershoot();
	}

	function handlePointerMove(e: PointerEvent) {
		if (!dragging) return;
		e.preventDefault();
		pointer_moved = true;
		updatePosition(e.clientX, e.clientY);
	}

	function handlePointerUp(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		snapped_to = null;
		if (Math.abs(overshoot_px) > 0.5) {
			force_overflow = true;
			clearTimeout(overflow_timer);
			overflow_timer = setTimeout(() => {
				force_overflow = false;
			}, 400);
		}
		overshoot_px = 0;
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
	}

	function handleContainerClick(e: MouseEvent) {
		if (skeleton) return;
		// The browser fires a click after every press+release. When that release
		// concluded a drag, the divider is already positioned (and may have just
		// snapped) — re-running updatePosition here would reset position to the
		// drop point with snap state cleared, leaving the release spring to settle
		// somewhere other than the snap it animated toward. Only handle genuine
		// clicks (no drag movement); presses are already positioned in pointerdown.
		if (pointer_moved) {
			pointer_moved = false;
			return;
		}
		updatePosition(e.clientX, e.clientY);
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (skeleton) return;
		const step = e.shiftKey ? 10 : 1;
		let newPosition = position;

		switch (e.key) {
			case 'ArrowLeft':
			case 'ArrowUp':
				e.preventDefault();
				newPosition = position - step;
				break;
			case 'ArrowRight':
			case 'ArrowDown':
				e.preventDefault();
				newPosition = position + step;
				break;
			case 'Home':
				e.preventDefault();
				newPosition = 0;
				break;
			case 'End':
				e.preventDefault();
				newPosition = 100;
				break;
			default:
				return;
		}

		newPosition = Math.min(100, Math.max(0, newPosition));
		if (newPosition !== position) {
			position = newPosition;
			onchange?.({ position });
		}
	}

	// Window-level pointermove for overshoot (works even when pointer is outside container)
	$effect(() => {
		if (!dragging) return;

		function onMove(e: PointerEvent) {
			last_pointer_coord = vertical ? e.clientY : e.clientX;
			updateOvershoot();
		}

		window.addEventListener('pointermove', onMove);
		return () => window.removeEventListener('pointermove', onMove);
	});
</script>

{#if skeleton}
	<div class={['comparison', 'skeleton', class_name].filter(Boolean).join(' ')} {id}>
		<div class="skeleton-inner"></div>
	</div>
{:else}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class={['comparison', class_name].filter(Boolean).join(' ')}
		class:vertical
		class:dragging
		class:overflowing={needs_visible_overflow}
		{id}
		bind:this={container}
		onclick={handleContainerClick}
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		onpointercancel={handlePointerUp}>
		<img
			class="comparison-image before"
			src={before}
			alt={before_alt}
			draggable="false" />

		<img
			class="comparison-image after"
			src={after}
			alt={after_alt}
			draggable="false"
			style:clip-path={afterClipPath} />

		{#if show_labels}
			<span class="label label-before">{label_before}</span>
			<span class="label label-after">{label_after}</span>
		{/if}

		<div
			class="divider"
			class:vertical
			style={dividerStyle}
			style:--divider-overshoot="{overshoot_px}px">
			<div
				class="handle"
				role="slider"
				tabindex="0"
				aria-valuenow={Math.round(clampedPosition)}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-label="Comparison slider"
				onkeydown={handleKeyDown}>
				{#if vertical}
					<svg class="handle-arrows" viewBox="0 0 24 24" aria-hidden="true">
						<path d="M12 4l-4 4h8zM12 20l-4-4h8z" fill="currentColor" />
					</svg>
				{:else}
					<svg class="handle-arrows" viewBox="0 0 24 24" aria-hidden="true">
						<path d="M4 12l4-4v8zM20 12l-4-4v8z" fill="currentColor" />
					</svg>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.comparison {
		--handle-size: 40px;
		--handle-color: var(--cmp-handle, #fff);
		--handle-shadow: 0 0 6px rgba(0, 0, 0, 0.3), 0 2px 8px rgba(0, 0, 0, 0.15);
		--divider-color: var(--cmp-divider, #fff);
		--divider-width: var(--width-divider, 2px);
		--label-bg: var(--cmp-label-bg, rgba(0, 0, 0, 0.55));
		--label-color: var(--cmp-label-text, #fff);
		--label-padding: var(--padding-label, 4px 10px);
		--label-radius: var(--radius-md, 4px);
		--label-font-size: var(--text-sm, 0.8125rem);

		position: relative;
		overflow: hidden;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		cursor: ew-resize;

		&.vertical {
			cursor: ns-resize;
		}

		&.dragging {
			cursor: grabbing;
		}

		&.overflowing {
			overflow: visible;
		}

		&.skeleton {
			cursor: default;
			touch-action: auto;
			user-select: auto;
		}
	}

	.skeleton-inner {
		width: 100%;
		min-height: 200px;
		border-radius: var(--radius-xl, 8px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-xl, 8px) * var(--squircle-ratio, 2));
		}
		background-color: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.06));
		position: relative;
		overflow: hidden;
	}

	.skeleton-inner::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			90deg,
			transparent 25%,
			light-dark(rgba(0, 0, 0, 0.04), rgba(255, 255, 255, 0.04)) 50%,
			transparent 75%
		);
		background-size: 200% 100%;
		animation: skeleton-pulse 1.5s ease-in-out infinite;
	}

	@keyframes skeleton-pulse {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-inner::after {
			animation: none;
		}
	}

	.comparison-image {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;

		&.before {
			position: relative;
		}

		&.after {
			position: absolute;
			inset: 0;
			transition: clip-path 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
		}
	}

	.label {
		position: absolute;
		padding: var(--label-padding);
		background: var(--label-bg);
		color: var(--label-color);
		font-size: var(--label-font-size);
		font-weight: 500;
		border-radius: var(--label-radius);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--label-radius) * var(--squircle-ratio, 2));
		}
		pointer-events: none;
		z-index: 2;
		line-height: 1;
	}

	.label-before {
		top: 12px;
		left: 12px;
	}

	.label-after {
		bottom: 12px;
		right: 12px;
	}

	.vertical .label-before {
		top: 12px;
		left: 12px;
	}

	.vertical .label-after {
		bottom: 12px;
		right: 12px;
	}

	.divider {
		position: absolute;
		z-index: 3;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);

		&::before {
			content: '';
			position: absolute;
			background: var(--divider-color);
		}

		&:not(.vertical) {
			width: 0;
			transform: translateX(var(--divider-overshoot, 0px));
			&::before {
				width: var(--divider-width);
				top: 0;
				bottom: 0;
				left: calc(var(--divider-width) / -2);
			}
		}

		&.vertical {
			height: 0;
			transform: translateY(var(--divider-overshoot, 0px));
			&::before {
				height: var(--divider-width);
				left: 0;
				right: 0;
				top: calc(var(--divider-width) / -2);
			}
		}
	}

	.dragging .divider {
		transition: none;
	}

	.dragging .comparison-image.after {
		transition: none;
	}

	.handle {
		position: relative;
		width: var(--handle-size);
		height: var(--handle-size);
		border-radius: 50%;
		background: color-mix(in oklch, var(--handle-color) 55%, transparent);
		box-shadow: var(--handle-shadow);
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: auto;
		cursor: grab;
		flex-shrink: 0;
		z-index: 1;
		outline: none;
		backdrop-filter: blur(10px) saturate(140%);
		-webkit-backdrop-filter: blur(10px) saturate(140%);
		border: 1px solid rgba(255, 255, 255, 0.5);
		transition:
			box-shadow 150ms ease,
			background 150ms ease;

		&:hover {
			background: color-mix(in oklch, var(--handle-color) 70%, transparent);
			/* Snap the tint in on hover; the base rule eases it back out on leave. */
			transition: box-shadow 150ms ease;
		}

		&:focus-visible {
			box-shadow:
				var(--handle-shadow),
				0 0 0 3px rgba(59, 130, 246, 0.5);
		}

		.dragging & {
			cursor: grabbing;
			background: color-mix(in oklch, var(--handle-color) 80%, transparent);
		}
	}

	.handle-arrows {
		width: 20px;
		height: 20px;
		color: rgba(0, 0, 0, 0.75);
		pointer-events: none;
	}
</style>
