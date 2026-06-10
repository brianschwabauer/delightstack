<script lang="ts" generics="Indeterminate extends boolean = false">
	import { tooltip } from '@delightstack/utilities';
	import { type Snippet } from 'svelte';

	/** `boolean` normally; widened to `boolean | null` in indeterminate mode */
	type Checked = Indeterminate extends true ? boolean | null : boolean;

	const propId = $props.id();
	let {
		/**
		 * Whether the toggle is checked. In indeterminate mode this can also be
		 * `null` — the in-between state, shown as a third stop in the middle of
		 * the track.
		 */
		checked = $bindable(false as Checked),

		/**
		 * Whether the toggle supports a third, in-between state. When true,
		 * `checked` is `boolean | null` and clicking cycles
		 * false → null → true → false; the track also lengthens so all three
		 * thumb stops keep distinct touch targets.
		 */
		indeterminate = false as Indeterminate,

		/** Whether the toggle is disabled */
		disabled = false,

		/** Size preset: 0=32x18, 1=44x24, 2=52x28, 3=68x36 */
		size = '1' as '0' | '1' | '2' | '3',

		/** Label text displayed alongside the toggle */
		label = undefined as string | undefined,

		/** Position of the label relative to the toggle */
		label_position = 'end' as 'start' | 'end',

		/** Label displayed when toggle is on */
		on_label = undefined as string | undefined,

		/** Label displayed when toggle is off */
		off_label = undefined as string | undefined,

		/** Name attribute for the hidden input */
		name = undefined as string | undefined,

		/** Value attribute for the hidden input */
		value = undefined as string | undefined,

		/** Tooltip message shown on hover */
		tooltip: tooltip_message = undefined as string | undefined,

		/** Whether the toggle uses dense spacing */
		dense = false,

		/** Whether the toggle uses comfortable spacing */
		comfortable = false,

		/** The id of the toggle element */
		id = propId,

		/** Custom class name */
		class: class_name = '',

		/** Snippet for a custom icon inside the thumb */
		thumb_icon = undefined as Snippet | undefined,

		/** Called when the toggle value changes */
		onchange = undefined as ((detail: { checked: Checked }) => void) | undefined,
	} = $props();

	let pressed = $state(false);

	const state_label = $derived(
		checked === true ? on_label : checked === false ? off_label : undefined,
	);

	function setChecked(next: Checked) {
		if (next === checked) return;
		checked = next;
		onchange?.({ checked });
	}

	function toggle() {
		if (disabled) return;
		if (indeterminate) {
			// Cycle off → middle → on → off (matching the legacy three-state toggle)
			setChecked((checked === false ? null : checked === null ? true : false) as Checked);
		} else {
			setChecked(!checked as Checked);
		}
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			toggle();
		} else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			// Arrows step between stops directly (no cycling), so a three-state
			// toggle can go null -> false without passing through true.
			e.preventDefault();
			const order = (indeterminate ? [false, null, true] : [false, true]) as Checked[];
			const next = order[order.indexOf(checked) + (e.key === 'ArrowRight' ? 1 : -1)];
			if (next !== undefined) setChecked(next);
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Thumb dragging                                                     */
	/*                                                                     */
	/*  The thumb can be dragged straight to any stop (so a three-state    */
	/*  toggle can go null -> false in one gesture). While dragging, the   */
	/*  thumb follows the pointer through a magnetic "stop gravity" curve  */
	/*  (same shape as Range's tick gravity): it lags near a stop and only */
	/*  reaches full pointer-follow at the midpoint between stops, so each */
	/*  stop — including the centre — has a felt basin. Past the track     */
	/*  ends a tanh rubber band resists harder the further you pull. On    */
	/*  release the inline transform is dropped and the thumb springs to   */
	/*  its stop via the CSS spring transition.                            */
	/* ------------------------------------------------------------------ */

	let dragging = $state(false);
	let drag_x = $state(0);
	/** Swallows the click the label synthesizes right after a drag ends */
	let recently_dragged = false;
	let drag_origin = 0; // viewport x where translateX(0) puts the thumb's left edge
	let drag_travel = 0; // max translateX while pressed (thumb is press-widened)
	let drag_half_thumb = 0;
	let drag_start_client_x = 0;

	/** The thumb stops — translateX px paired with the value each represents */
	function dragStops(): { x: number; value: Checked }[] {
		if (indeterminate) {
			return [
				{ x: 0, value: false as Checked },
				{ x: drag_travel / 2, value: null as Checked },
				{ x: drag_travel, value: true as Checked },
			];
		}
		return [
			{ x: 0, value: false as Checked },
			{ x: drag_travel, value: true as Checked },
		];
	}

	function onTrackPointerDown(e: PointerEvent) {
		if (disabled) return;
		pressed = true;
		const track = e.currentTarget as HTMLElement;
		const rect = track.getBoundingClientRect();
		const cs = getComputedStyle(track);
		const thumb_size = parseFloat(cs.getPropertyValue('--thumb-size'));
		const offset = parseFloat(cs.getPropertyValue('--thumb-offset'));
		const grow = parseFloat(cs.getPropertyValue('--thumb-press-grow'));
		/* Measure against the press-widened thumb so the drag stops land exactly
		   on the .pressed CSS stop positions. */
		const thumb_w = thumb_size + grow;
		drag_origin = rect.left + offset;
		drag_travel = rect.width - thumb_w - offset * 2;
		drag_half_thumb = thumb_w / 2;
		drag_start_client_x = e.clientX;
		try {
			track.setPointerCapture(e.pointerId);
		} catch {
			/* pointer already gone */
		}
	}

	function onTrackPointerMove(e: PointerEvent) {
		if (!pressed || disabled) return;
		if (!dragging) {
			/* A few px of slop so taps stay clicks (the label's native click
			   handles those) */
			if (Math.abs(e.clientX - drag_start_client_x) < 3) return;
			dragging = true;
		}
		updateDrag(e.clientX);
	}

	function updateDrag(client_x: number) {
		const desired = client_x - drag_origin - drag_half_thumb;
		const stops = dragStops();
		const last = stops[stops.length - 1];

		if (desired < 0 || desired > last.x) {
			/* Rubber band past the ends — tanh saturates, so resistance grows the
			   further you pull and the track feels like it's pulling back. */
			const edge = desired < 0 ? stops[0] : last;
			const overflow = desired - edge.x;
			const max_shift = drag_half_thumb * 0.8;
			drag_x = edge.x + max_shift * Math.tanh(overflow / 40);
			setChecked(edge.value);
			return;
		}

		/* Magnetic stop gravity: ease from a slow near-stop crawl to full
		   pointer-follow exactly at the midpoint between stops — continuous
		   across basins, so the thumb never jumps as the value snaps. */
		let nearest = stops[0];
		for (const s of stops) {
			if (Math.abs(desired - s.x) < Math.abs(desired - nearest.x)) nearest = s;
		}
		const half_step = drag_travel / (stops.length - 1) / 2;
		const pull = desired - nearest.x;
		const t = half_step > 0 ? Math.min(1, Math.abs(pull) / half_step) : 1;
		const gravity = 0.15;
		const eased = gravity * t + (1 - gravity) * t * t;
		drag_x = nearest.x + Math.sign(pull) * eased * half_step;
		setChecked(nearest.value);
	}

	/* Fires after pointerup (capture auto-releases) AND on pointercancel, so
	   one handler ends the gesture for taps, drags and aborted touches alike. */
	function endDrag() {
		pressed = false;
		if (!dragging) return;
		dragging = false;
		recently_dragged = true;
		setTimeout(() => (recently_dragged = false), 300);
	}
</script>

<label
	class={['toggle', `size-${size}`, class_name].filter(Boolean).join(' ')}
	class:checked={checked === true}
	class:mixed={checked === null}
	class:indeterminate
	class:disabled
	class:dense
	class:comfortable
	class:pressed
	class:dragging
	class:label-start={label_position === 'start'}
	for={id}
	{@attach tooltip_message ? tooltip(tooltip_message) : () => {}}>
	{#if label && label_position === 'start'}
		<span class="label">{label}</span>
	{/if}

	<input
		type="checkbox"
		{name}
		{value}
		{id}
		{disabled}
		class="sr-only"
		checked={checked === true}
		indeterminate={checked === null}
		onclick={(e) => {
			/* A drag just set the value directly — swallow the synthesized label
			   click so it can't immediately cycle the value again. */
			if (recently_dragged) {
				e.preventDefault();
				e.stopPropagation();
			}
		}}
		onchange={(e) => {
			toggle();
			/* The native click already flipped the box; pin the DOM back to the
			   component's (possibly three-state) value. The reactive attributes
			   above can't be relied on here — when e.g. false → null, the derived
			   `checked === true` is false both before and after, so Svelte sees
			   no change to flush while the browser has flipped the property. */
			e.currentTarget.checked = checked === true;
			e.currentTarget.indeterminate = checked === null;
		}} />

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- The dynamic role is always interactive (checkbox/switch), Svelte just
	     can't see that statically -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<span
		class="track"
		role={indeterminate ? 'checkbox' : 'switch'}
		aria-checked={checked === null ? 'mixed' : checked === true}
		tabindex={disabled ? -1 : 0}
		onkeydown={onKeyDown}
		onpointerdown={onTrackPointerDown}
		onpointermove={onTrackPointerMove}
		onlostpointercapture={endDrag}>
		<span
			class="thumb"
			style:transform={dragging ? `translateX(${drag_x}px)` : undefined}>
			{#if thumb_icon}
				<span class="thumb-icon">{@render thumb_icon()}</span>
			{/if}
		</span>
	</span>

	{#if state_label}
		<span class="state-label">{state_label}</span>
	{/if}

	{#if label && label_position === 'end'}
		<span class="label">{label}</span>
	{/if}
</label>

<style>
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.toggle {
		--track-width: 44px;
		--track-height: 24px;
		--thumb-size: 18px;
		--thumb-offset: 3px;
		/* The rendered track width — indeterminate mode stretches it (below) */
		--_track-width: var(--track-width);
		--thumb-travel: calc(
			var(--_track-width) - var(--thumb-size) - var(--thumb-offset) * 2
		);
		--thumb-press-grow: 4px;

		/* Off-state palette: a mid-tone neutral track (clearly visible against
		   the page bg in BOTH schemes — bg-muted all but vanished in dark mode)
		   under a near-white neutral thumb. High handle/track contrast, and no
		   brand-tinted thumb fighting a gray track; the on state keeps the
		   saturated action-colored pair. */
		--_track-off: var(--color-border-active, light-dark(hsl(0 0% 72%), hsl(0 0% 52%)));
		--_thumb-off: light-dark(#fff, hsl(0 0% 95%));

		display: inline-flex;
		align-items: center;
		gap: 0.625em;
		cursor: pointer;
		user-select: none;
		-webkit-tap-highlight-color: transparent;
		position: relative;
	}

	.toggle.label-start {
		flex-direction: row-reverse;
	}

	/* Sizes */
	.toggle.size-0 {
		--track-width: 32px;
		--track-height: 18px;
		--thumb-size: 12px;
		--thumb-offset: 3px;
		--thumb-press-grow: 2px;
		font-size: var(--control-font-0, 0.875rem);
	}
	.toggle.size-1 {
		--track-width: 44px;
		--track-height: 24px;
		--thumb-size: 18px;
		--thumb-offset: 3px;
		--thumb-press-grow: 4px;
		font-size: var(--control-font-1, 1rem);
	}
	.toggle.size-2 {
		--track-width: 52px;
		--track-height: 28px;
		--thumb-size: 22px;
		--thumb-offset: 3px;
		--thumb-press-grow: 4px;
		font-size: var(--control-font-2, 1.125rem);
	}
	.toggle.size-3 {
		--track-width: 68px;
		--track-height: 36px;
		--thumb-size: 28px;
		--thumb-offset: 4px;
		--thumb-press-grow: 6px;
		font-size: var(--control-font-3, 1.25rem);
	}

	.toggle.dense {
		gap: 0.375em;
	}
	.toggle.comfortable {
		gap: 1em;
	}

	/* Indeterminate mode adds a third (middle) thumb stop, so the track gets
	   more runway — each stop keeps a distinct, comfortably-sized touch
	   target. --thumb-travel derives from --_track-width, so the stops spread
	   out with it automatically. */
	.toggle.indeterminate {
		--_track-width: calc(var(--track-width) * 1.25);
	}

	/* Track */
	.track {
		position: relative;
		display: inline-flex;
		align-items: center;
		width: var(--_track-width);
		height: var(--track-height);
		border-radius: var(--track-height);
		background-color: var(--_track-off);
		transition:
			background-color 0.2s ease,
			transform 200ms ease;
		flex-shrink: 0;
		outline: none;
		/* Horizontal drags are ours; vertical pans stay with the browser (a
		   vertical scroll mid-gesture fires pointercancel and ends the drag). */
		touch-action: pan-y;

		/* Pressed dip — perspective is baked into the transform so the recede
		   is centred on the track itself, not on the whole labelled control
		   (a parent `perspective` made the track lean toward the label). */
		&:active {
			transform: perspective(100px)
				translate3d(0, 1px, clamp(-10px, calc(0.2em - 12px), -2px));
		}
	}

	.disabled .track:active {
		transform: none;
	}

	.track:focus-visible {
		outline: 2px solid var(--color-border-active, currentColor);
		outline-offset: 2px;
	}

	.checked .track {
		background-color: var(--color-action, hsl(220 70% 55%));
	}

	/* Thumb */
	.thumb {
		position: absolute;
		left: var(--thumb-offset);
		width: var(--thumb-size);
		height: var(--thumb-size);
		border-radius: 50%;
		background-color: var(--_thumb-off);
		display: flex;
		align-items: center;
		justify-content: center;
		transform: translateX(0);
		cursor: grab;
		transition:
			transform 300ms var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)),
			background-color 0.2s ease,
			width 0.15s ease,
			left 0.15s ease;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
	}

	/* Instant pointer tracking while dragging — the inline transform drives
	   the position; the spring above only plays on release/settle. */
	.dragging .thumb {
		cursor: grabbing;
		transition:
			background-color 0.2s ease,
			width 0.15s ease,
			left 0.15s ease;
	}
	.dragging .track {
		cursor: grabbing;
	}

	/* On: thumb returns to the action-text tint so it pairs with the action
	   track (the off thumb is neutral — see --_thumb-off). */
	.checked .thumb {
		transform: translateX(var(--thumb-travel));
		background-color: var(--color-action-text, white);
	}

	/* Middle stop (indeterminate `null`) — halfway along the track */
	.mixed .thumb {
		transform: translateX(calc(var(--thumb-travel) / 2));
	}

	/* Press state: widen thumb */
	.pressed:not(.disabled) .thumb {
		width: calc(var(--thumb-size) + var(--thumb-press-grow));
	}
	.pressed.checked:not(.disabled) .thumb {
		width: calc(var(--thumb-size) + var(--thumb-press-grow));
		transform: translateX(calc(var(--thumb-travel) - var(--thumb-press-grow)));
	}
	/* A pressed middle thumb grows symmetrically so it stays centred */
	.pressed.mixed:not(.disabled) .thumb {
		width: calc(var(--thumb-size) + var(--thumb-press-grow));
		transform: translateX(calc((var(--thumb-travel) - var(--thumb-press-grow)) / 2));
	}

	.thumb-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: calc(var(--thumb-size) * 0.6);
		line-height: 1;
		color: var(--color-action, hsl(220 70% 55%));
	}

	/* Disabled */
	.disabled {
		cursor: not-allowed;
		opacity: 0.5;
		pointer-events: none;
	}
	.disabled .track,
	.disabled .thumb {
		pointer-events: auto;
		cursor: not-allowed;
	}

	/* Labels — the pressed dip bakes its own perspective like the track, so
	   each piece recedes toward its own centre */
	.label {
		color: var(--color-text, inherit);
		line-height: 1.4;
		transition: transform 200ms ease;
		&:active {
			transform: perspective(100px)
				translate3d(0, 1px, clamp(-10px, calc(0.2em - 12px), -2px));
		}
	}
	.state-label {
		color: var(--color-text-muted, inherit);
		font-size: 0.875em;
		line-height: 1.4;
		transition: transform 200ms ease;
		&:active {
			transform: perspective(100px)
				translate3d(0, 1px, clamp(-10px, calc(0.2em - 12px), -2px));
		}
	}
</style>
