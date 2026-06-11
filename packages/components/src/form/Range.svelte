<script lang="ts">
	import { tooltip } from '@delightstack/utilities';

	const propId = $props.id();
	let {
		/** Current value: number for single, [number, number] for range mode */
		value = $bindable(0) as number | [number, number],

		/** Minimum value */
		min = 0,

		/** Maximum value */
		max = 100,

		/** Step increment */
		step = 1,

		/** Whether to show two thumbs for range selection */
		range = false,

		/** Whether the slider is disabled */
		disabled = false,

		/** Size preset: 0=small, 1=default, 2=medium, 3=large */
		size = '1' as '0' | '1' | '2' | '3',

		/** Whether to show the current value near the thumb */
		show_value = false,

		/** Whether to display stop indicator dots at each step */
		show_ticks = false,

		/** Custom labels for tick positions */
		tick_labels = undefined as string[] | undefined,

		/** Custom formatter for displayed values */
		format_value = undefined as ((n: number) => string) | undefined,

		/** Label text displayed above the slider */
		label = undefined as string | undefined,

		/** Tooltip message shown on hover */
		tooltip: tooltip_message = undefined as string | undefined,

		/** Whether the slider uses dense spacing */
		dense = false,

		/** Whether the slider uses comfortable spacing */
		comfortable = false,

		/** Whether to display the slider vertically */
		vertical = false,

		/** The id of the slider element */
		id = propId,

		/** Name attribute for hidden input(s) */
		name = undefined as string | undefined,

		/** Accessible label for the slider thumb(s) when no visible `label` is
		 *  shown (e.g. an icon-only slider). Takes precedence over `label`. */
		aria_label = undefined as string | undefined,

		/** Custom class name */
		class: class_name = '',

		/** Called when value changes (on pointerup / change) */
		onchange = undefined as
			| ((detail: { value: number | [number, number] }) => void)
			| undefined,

		/** Called during dragging */
		oninput = undefined as
			| ((detail: { value: number | [number, number] }) => void)
			| undefined,
	} = $props();

	let lower_hovering = $state(false);
	let upper_hovering = $state(false);
	let lower_dragging = $state(false);
	let upper_dragging = $state(false);
	let drag_wrapper: HTMLElement | null = null;
	let active_thumb = $state<'lower' | 'upper' | null>(null);
	let overshoot_px = $state(0);

	const lower_value = $derived(
		range && Array.isArray(value) ? value[0] : (value as number),
	);
	const upper_value = $derived(range && Array.isArray(value) ? value[1] : max);

	const lower_pct = $derived(((lower_value - min) / (max - min)) * 100);
	const upper_pct = $derived(((upper_value - min) / (max - min)) * 100);

	// Native range inputs offset the thumb center from raw percentage by
	// handleWidth * (0.5 - ratio). Compute this so track segments align with the thumb.
	const lower_thumb_offset = $derived(0.5 - lower_pct / 100);
	const upper_thumb_offset = $derived(0.5 - upper_pct / 100);

	const is_dragging = $derived(lower_dragging || upper_dragging);

	// Visual pixel offsets for track segments to follow the handle during magnetic drag
	const lower_visual_offset = $derived(active_thumb === 'lower' ? overshoot_px : 0);
	const upper_visual_offset = $derived(active_thumb === 'upper' ? overshoot_px : 0);

	const tick_count = $derived(Math.floor((max - min) / step));

	function formatDisplay(n: number): string {
		if (format_value) return format_value(n);
		return String(n);
	}

	function emitValue() {
		return range ? ([lower_value, upper_value] as [number, number]) : lower_value;
	}

	function onLowerInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const v = Number(input.value);
		if (range) {
			value = [v, Math.max(v, upper_value)] as [number, number];
		} else {
			value = v;
		}
		oninput?.({ value: emitValue() });
		// Recompute overshoot now that value has snapped, so the DOM update
		// includes an overshoot consistent with the new thumb position
		if (is_dragging) updateOvershoot();
	}

	function onUpperInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const v = Number(input.value);
		value = [Math.min(v, lower_value), v] as [number, number];
		oninput?.({ value: emitValue() });
		if (is_dragging) updateOvershoot();
	}

	function onLowerChange() {
		onchange?.({ value: emitValue() });
	}

	function onUpperChange() {
		onchange?.({ value: emitValue() });
	}

	function rawPctFromPointer(e: PointerEvent): number {
		if (!drag_wrapper) return 0;
		const rect = drag_wrapper.getBoundingClientRect();
		return vertical
			? 1 - (e.clientY - rect.top) / rect.height
			: (e.clientX - rect.left) / rect.width;
	}

	function valueFromPointer(e: PointerEvent): number {
		const pct = Math.max(0, Math.min(1, rawPctFromPointer(e)));
		const raw = min + pct * (max - min);
		const snapped = Math.round(raw / step) * step;
		return Math.max(min, Math.min(max, snapped));
	}

	function setValueForThumb(v: number) {
		if (range && Array.isArray(value)) {
			if (active_thumb === 'lower') {
				value = [v, Math.max(v, upper_value)] as [number, number];
			} else {
				value = [Math.min(v, lower_value), v] as [number, number];
			}
		} else {
			value = v;
		}
	}

	// --- Track click-and-drag (custom pointer capture on wrapper) ---

	function onTrackPointerDown(e: PointerEvent) {
		if (disabled) return;
		if (e.target instanceof HTMLInputElement) return;
		e.preventDefault();

		drag_wrapper = e.currentTarget as HTMLElement;
		const v = valueFromPointer(e);

		let thumb: 'lower' | 'upper' = 'lower';
		if (range && Array.isArray(value)) {
			const lower_dist = Math.abs(v - lower_value);
			const upper_dist = Math.abs(v - upper_value);
			thumb = lower_dist <= upper_dist ? 'lower' : 'upper';
		}

		active_thumb = thumb;
		drag_wrapper.setPointerCapture(e.pointerId);
		if (thumb === 'lower') lower_dragging = true;
		else upper_dragging = true;

		setValueForThumb(v);
		oninput?.({ value: emitValue() });
	}

	function onTrackPointerMove(e: PointerEvent) {
		if (!active_thumb) return;
		// Only update value for track-initiated drags (wrapper has capture, so
		// target is the wrapper). For native thumb drags the event bubbles from
		// the input and the native oninput handler manages the value instead.
		if (!(e.target instanceof HTMLInputElement)) {
			setValueForThumb(valueFromPointer(e));
			oninput?.({ value: emitValue() });
		}
	}

	function onTrackPointerUp() {
		if (!active_thumb) return;
		if (active_thumb === 'lower') lower_dragging = false;
		else upper_dragging = false;
		active_thumb = null;
		overshoot_px = 0;
		drag_wrapper = null;
		onchange?.({ value: emitValue() });
	}

	// --- Native thumb drag detection via pointer capture events ---
	// The browser internally sets pointer capture on the input when dragging
	// the thumb. gotpointercapture/lostpointercapture fire regardless of
	// the CSS pointer-events property.

	function onThumbCaptureStart(thumb: 'lower' | 'upper', e: Event) {
		if (active_thumb) return; // Already in a custom track drag
		active_thumb = thumb;
		drag_wrapper = (e.currentTarget as HTMLElement).parentElement as HTMLElement;
		if (thumb === 'lower') lower_dragging = true;
		else upper_dragging = true;
	}

	function onThumbCaptureEnd(thumb: 'lower' | 'upper') {
		if (active_thumb !== thumb) return; // Wasn't our drag
		if (thumb === 'lower') lower_dragging = false;
		else upper_dragging = false;
		active_thumb = null;
		overshoot_px = 0;
		drag_wrapper = null;
	}

	// --- Overshoot computation (shared by pointermove and oninput) ---

	let last_pointer_coord = 0;

	function updateOvershoot() {
		if (!drag_wrapper) return;
		const rect = drag_wrapper.getBoundingClientRect();
		const raw_pct = vertical
			? 1 - (last_pointer_coord - rect.top) / rect.height
			: (last_pointer_coord - rect.left) / rect.width;

		if (raw_pct < 0 || raw_pct > 1) {
			// Edge rubber band
			const overflow_px = (raw_pct < 0 ? raw_pct : raw_pct - 1) * rect.width;
			const max_shift = 24;
			overshoot_px = max_shift * Math.tanh(overflow_px / 100);
		} else {
			// Magnetic tick gravity — uses the ACTUAL current value (not our
			// own snap) so the overshoot is always consistent with the thumb
			// position. Uses a smooth easing that reaches full-follow at the
			// midpoint between ticks, guaranteeing visual continuity at snaps.
			const current_val = active_thumb === 'lower' ? lower_value : upper_value;
			const snapped_pct = (current_val - min) / (max - min);
			const pull_px = (raw_pct - snapped_pct) * rect.width;
			const step_px = (step / (max - min)) * rect.width;
			const half_step_px = step_px / 2;

			if (half_step_px < 1) {
				overshoot_px = 0;
			} else {
				// Smooth ease: starts at gravity rate near tick, reaches
				// full follow at midpoint (continuity across snaps)
				const t = Math.min(1, Math.abs(pull_px) / half_step_px);
				const gravity = 0.15;
				const eased = gravity * t + (1 - gravity) * t * t;
				overshoot_px = Math.sign(pull_px) * eased * half_step_px;
			}
		}
	}

	// --- Window-level pointermove for overshoot (works for both drag sources) ---

	$effect(() => {
		if (!is_dragging) return;

		function onMove(e: PointerEvent) {
			last_pointer_coord = vertical ? e.clientY : e.clientX;
			updateOvershoot();
		}

		window.addEventListener('pointermove', onMove);
		return () => window.removeEventListener('pointermove', onMove);
	});
</script>

<div
	class={['range-container', `size-${size}`, class_name].filter(Boolean).join(' ')}
	class:disabled
	class:dense
	class:comfortable
	class:vertical
	class:has-tick-labels={show_ticks && !!tick_labels?.length}
	class:dragging={is_dragging}
	{@attach tooltip_message ? tooltip(tooltip_message) : () => {}}>
	{#if label}
		<label for={id}>{label}</label>
	{/if}

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="range-wrapper"
		onpointerdown={onTrackPointerDown}
		onpointermove={onTrackPointerMove}
		onpointerup={onTrackPointerUp}>
		{#if show_value}
			<span
				class="value-tooltip"
				class:visible={lower_hovering || lower_dragging}
				style:left="calc({lower_pct}% + var(--handle-width) * {lower_thumb_offset})">
				{formatDisplay(lower_value)}
			</span>
			{#if range}
				<span
					class="value-tooltip"
					class:visible={upper_hovering || upper_dragging}
					style:left="calc({upper_pct}% + var(--handle-width) * {upper_thumb_offset})">
					{formatDisplay(upper_value)}
				</span>
			{/if}
		{/if}

		<!-- Track segments follow the handle's visual position (including magnetic overshoot) -->
		{#if range}
			<div
				class="track-segment inactive"
				style:left="0"
				style:width="calc({lower_pct}% + var(--handle-width) * {lower_thumb_offset} - var(--gap)
				+ {lower_visual_offset}px)">
			</div>
			<div
				class="track-segment active"
				style:left="calc({lower_pct}% + var(--handle-width) * {lower_thumb_offset} + var(--gap)
				+ {lower_visual_offset}px)"
				style:width="calc({upper_pct - lower_pct}% + var(--handle-width) * {upper_thumb_offset -
					lower_thumb_offset} - var(--gap) * 2 + {upper_visual_offset -
					lower_visual_offset}px)">
			</div>
			<div
				class="track-segment inactive"
				style:left="calc({upper_pct}% + var(--handle-width) * {upper_thumb_offset} + var(--gap)
				+ {upper_visual_offset}px)"
				style:right="0">
			</div>
		{:else}
			<div
				class="track-segment active"
				style:left="0"
				style:width="calc({lower_pct}% + var(--handle-width) * {lower_thumb_offset} - var(--gap)
				+ {lower_visual_offset}px)">
			</div>
			<div
				class="track-segment inactive"
				style:left="calc({lower_pct}% + var(--handle-width) * {lower_thumb_offset} + var(--gap)
				+ {lower_visual_offset}px)"
				style:right="0">
			</div>
		{/if}

		<input
			type="range"
			{id}
			{name}
			{min}
			{max}
			{step}
			{disabled}
			value={lower_value}
			class="lower"
			class:dragging={lower_dragging}
			style:--thumb-overshoot="{active_thumb === 'lower' ? overshoot_px : 0}px"
			aria-valuenow={lower_value}
			aria-valuemin={min}
			aria-valuemax={range ? upper_value : max}
			aria-label={aria_label || label || 'Range value'}
			oninput={onLowerInput}
			onchange={onLowerChange}
			onpointerenter={() => (lower_hovering = true)}
			onpointerleave={() => (lower_hovering = false)}
			ongotpointercapture={(e) => onThumbCaptureStart('lower', e)}
			onlostpointercapture={() => onThumbCaptureEnd('lower')} />

		{#if range}
			<input
				type="range"
				{min}
				{max}
				{step}
				{disabled}
				value={upper_value}
				class="upper"
				class:dragging={upper_dragging}
				style:--thumb-overshoot="{active_thumb === 'upper' ? overshoot_px : 0}px"
				aria-valuenow={upper_value}
				aria-valuemin={lower_value}
				aria-valuemax={max}
				aria-label={aria_label
					? `${aria_label} upper`
					: label
						? `${label} upper`
						: 'Range upper value'}
				oninput={onUpperInput}
				onchange={onUpperChange}
				onpointerenter={() => (upper_hovering = true)}
				onpointerleave={() => (upper_hovering = false)}
				ongotpointercapture={(e) => onThumbCaptureStart('upper', e)}
				onlostpointercapture={() => onThumbCaptureEnd('upper')} />
		{/if}

		{#if show_ticks && tick_count <= 50}
			<div class="ticks" aria-hidden="true">
				{#each { length: tick_count + 1 } as _, i}
					{@const tick_value = min + i * step}
					{@const tick_pct = ((tick_value - min) / (max - min)) * 100}
					{@const tick_offset = 0.5 - tick_pct / 100}
					<span
						class="tick"
						class:active={tick_value >= (range ? lower_value : min) &&
							tick_value <= (range ? upper_value : lower_value)}
						style:left="calc({tick_pct}% + var(--handle-width) * {tick_offset})">
						{#if tick_labels && tick_labels[i] !== undefined}
							<span class="tick-label">{tick_labels[i]}</span>
						{/if}
					</span>
				{/each}
			</div>
		{/if}
	</div>

	{#if show_value && !show_ticks}
		<div class="value-display">
			<span>{formatDisplay(lower_value)}</span>
			{#if range}
				<span>{formatDisplay(upper_value)}</span>
			{/if}
		</div>
	{/if}
</div>

<style>
	.range-container {
		--handle-width: 8px;
		--handle-height: 24px;
		--active-height: 6px;
		--inactive-height: 4px;
		--gap: 7px;
		--fill-color: var(--color-action, hsl(220 70% 55%));
		--track-bg: var(--color-bg-muted, hsl(0 0% 80%));

		display: flex;
		flex-direction: column;
		gap: 0.5em;
		width: 100%;
		font-size: var(--control-font-1, 1rem);

		&.dense {
			gap: 0.25em;
		}
		&.comfortable {
			gap: 0.75em;
		}

		/* Sizes */
		&.size-0 {
			--handle-width: 6px;
			--handle-height: 20px;
			--active-height: 4px;
			--inactive-height: 4px;
			--gap: 6px;
			font-size: var(--control-font-0, 0.875rem);
		}
		&.size-1 {
			--handle-width: 8px;
			--handle-height: 24px;
			--active-height: 6px;
			--inactive-height: 4px;
			--gap: 7px;
			font-size: var(--control-font-1, 1rem);
		}
		&.size-2 {
			--handle-width: 10px;
			--handle-height: 28px;
			--active-height: 7px;
			--inactive-height: 4px;
			--gap: 9px;
			font-size: var(--control-font-2, 1.125rem);
		}
		&.size-3 {
			--handle-width: 12px;
			--handle-height: 32px;
			--active-height: 8px;
			--inactive-height: 5px;
			--gap: 10px;
			font-size: var(--control-font-3, 1.25rem);
		}
	}

	label {
		color: var(--color-text, inherit);
		font-weight: 500;
		line-height: 1.4;
	}

	.range-wrapper {
		position: relative;
		height: var(--handle-height);
		display: flex;
		align-items: center;
		cursor: pointer;
	}

	/* Track segments */
	.track-segment {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		border-radius: 999px;
		pointer-events: none;
	}

	.track-segment.active {
		height: var(--active-height);
		background: var(--fill-color);
		transition:
			left 100ms ease,
			width 100ms ease,
			height 200ms ease,
			box-shadow 200ms ease;
	}

	.track-segment.inactive {
		height: var(--inactive-height);
		background: var(--track-bg);
		transition:
			left 100ms ease,
			width 100ms ease,
			right 100ms ease,
			height 200ms ease;
	}

	/* During drag: no position transition (track follows handle via reactive offset) */
	.dragging .track-segment.active {
		transition:
			height 200ms ease,
			box-shadow 200ms ease;
		box-shadow: 0 0 8px rgb(from var(--fill-color) r g b / 0.35);
	}
	.dragging .track-segment.inactive {
		transition: height 200ms ease;
	}

	/* Track grows on hover */
	.range-container:not(.disabled):hover .track-segment.active {
		height: calc(var(--active-height) + 2px);
	}
	.range-container:not(.disabled):hover .track-segment.inactive {
		height: calc(var(--inactive-height) + 2px);
	}

	/* Native range inputs */
	input {
		position: absolute;
		width: 100%;
		height: var(--handle-height);
		margin: 0;
		padding: 0;
		background: transparent;
		appearance: none;
		-webkit-appearance: none;
		pointer-events: none;
		outline: none;
		z-index: 2;
		/* Overshoot applied to the input element (not pseudo) to avoid native clipping */
		transform: translateX(var(--thumb-overshoot, 0px));
		transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	/* Disable overshoot transition during drag for instant tracking */
	input.dragging {
		transition: none;
	}

	input::-webkit-slider-runnable-track {
		height: var(--active-height);
		background: transparent;
		border: none;
	}
	input::-moz-range-track {
		height: var(--active-height);
		background: transparent;
		border: none;
	}

	/* M3-style vertical bar handle */
	input::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: var(--handle-width);
		height: var(--handle-height);
		border-radius: calc(var(--handle-width) / 2);
		background: var(--fill-color);
		border: none;
		box-shadow: none;
		cursor: pointer;
		pointer-events: auto;
		margin-top: calc((var(--active-height) - var(--handle-height)) / 2);
		transition:
			transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1),
			box-shadow 150ms ease;
	}
	input::-moz-range-thumb {
		width: var(--handle-width);
		height: var(--handle-height);
		border-radius: calc(var(--handle-width) / 2);
		background: var(--fill-color);
		border: none;
		box-shadow: none;
		cursor: pointer;
		pointer-events: auto;
		transition:
			transform 200ms cubic-bezier(0.34, 1.56, 0.64, 1),
			box-shadow 150ms ease;
	}

	/* Handle hover: widen + grow taller + halo */
	input:not(:disabled)::-webkit-slider-thumb:hover {
		transform: scale(1.5, 1.3);
		box-shadow: 0 0 0 8px rgb(from var(--fill-color) r g b / 0.12);
	}
	input:not(:disabled)::-moz-range-thumb:hover {
		transform: scale(1.5, 1.3);
		box-shadow: 0 0 0 8px rgb(from var(--fill-color) r g b / 0.12);
	}

	/* Handle active: widen + grow taller + larger halo + push down */
	input:not(:disabled):active::-webkit-slider-thumb {
		transform: scale(1.5, 1.15) translateY(2px);
		box-shadow: 0 0 0 12px rgb(from var(--fill-color) r g b / 0.18);
	}
	input:not(:disabled):active::-moz-range-thumb {
		transform: scale(1.5, 1.15) translateY(2px);
		box-shadow: 0 0 0 12px rgb(from var(--fill-color) r g b / 0.18);
	}

	/* During custom drag: show active scale, no pseudo transition */
	input.dragging::-webkit-slider-thumb {
		transform: scale(1.5, 1.15);
		transition: box-shadow 150ms ease;
	}
	input.dragging::-moz-range-thumb {
		transform: scale(1.5, 1.15);
		transition: box-shadow 150ms ease;
	}

	/* Focus ring */
	input:focus-visible::-webkit-slider-thumb {
		outline: 2px solid var(--color-border-active, currentColor);
		outline-offset: 2px;
	}
	input:focus-visible::-moz-range-thumb {
		outline: 2px solid var(--color-border-active, currentColor);
		outline-offset: 2px;
	}

	input:disabled {
		cursor: not-allowed;
	}
	input:disabled::-webkit-slider-thumb {
		background: var(--color-action-disabled, hsl(0 0% 70%));
		cursor: not-allowed;
	}
	input:disabled::-moz-range-thumb {
		background: var(--color-action-disabled, hsl(0 0% 70%));
		cursor: not-allowed;
	}

	.disabled {
		opacity: 0.5;
	}

	/* Ticks — M3 stop indicator dots on the track */
	.ticks {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
		bottom: 0;
		pointer-events: none;
		z-index: 3;
	}

	.tick {
		position: absolute;
		top: 50%;
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--fill-color);
		opacity: 0.6;
		transform: translate(-50%, -50%);
	}
	.tick.active {
		background: var(--color-action-text, white);
		opacity: 0.6;
	}

	.tick-label {
		position: absolute;
		top: calc(var(--handle-height) / 2 + 6px);
		left: 50%;
		transform: translateX(-50%);
		font-size: 0.75em;
		color: var(--color-text-muted, inherit);
		white-space: nowrap;
	}

	/* Value tooltip */
	.value-tooltip {
		position: absolute;
		bottom: calc(100% + 8px);
		transform: translateX(-50%) translateY(4px);
		background: var(--color-action-active, hsl(220 70% 50%));
		color: var(--color-action-text, white);
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 0.8em;
		font-weight: 600;
		white-space: nowrap;
		pointer-events: none;
		z-index: 3;
		opacity: 0;
		visibility: hidden;
		transition:
			opacity 150ms ease,
			transform 150ms ease,
			visibility 150ms ease;
	}

	.value-tooltip.visible {
		opacity: 1;
		visibility: visible;
		transform: translateX(-50%) translateY(0);
	}

	/* Tooltip arrow */
	.value-tooltip::after {
		content: '';
		position: absolute;
		top: 100%;
		left: 50%;
		transform: translateX(-50%);
		border: 4px solid transparent;
		border-top-color: var(--color-action-active, hsl(220 70% 50%));
	}

	/* Value display below */
	.value-display {
		display: flex;
		justify-content: space-between;
		color: var(--color-text-muted, inherit);
		font-size: 0.85em;
		font-variant-numeric: tabular-nums;
	}

	.has-tick-labels .range-wrapper {
		margin-bottom: 1.5em;
	}

	/* ========== Vertical mode ========== */
	.range-container.vertical {
		width: fit-content;
		height: var(--range-height, 200px);
		align-items: center;
		overflow: visible;

		.range-wrapper {
			/* Rotate the horizontal slider to render vertically.
			   The wrapper's CSS "width" becomes the visual height. */
			width: var(--range-height, 200px);
			transform-origin: 0 0;
			transform: rotate(-90deg) translateX(-100%);
		}

		/* Vertical tooltip: reposition to the right of the handle, counter-rotate text */
		.value-tooltip {
			/* In rotated space, "bottom: 100%" places the tooltip to the visual-left.
			   Switch to "top: 100%" so it appears to the visual-right instead. */
			bottom: auto;
			top: calc(100% + 8px);
			transform: translateX(-50%) translateY(-4px) rotate(90deg) translateX(18px);

			&.visible {
				transform: translateX(-50%) translateY(0) rotate(90deg) translateX(10px);
			}

			/* Arrow points left instead of down */
			&::after {
				top: 50%;
				left: auto;
				right: 100%;
				transform: translateY(-50%);
				border-top-color: transparent;
				border-right-color: var(--color-action-active, hsl(220 70% 50%));
			}
		}

		.tick-label {
			transform: translateX(-50%) rotate(90deg);
		}
	}
</style>
