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

		/** Size preset: 0=3px track, 1=5px, 2=7px, 3=8px */
		size = '1' as '0' | '1' | '2' | '3',

		/** Whether to show the current value near the thumb */
		show_value = false,

		/** Whether to display tick marks at each step */
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

		/** The id of the slider element */
		id = propId,

		/** Name attribute for hidden input(s) */
		name = undefined as string | undefined,

		/** Custom class name */
		class: class_name = '',

		/** Called when value changes (on pointerup / change) */
		onchange = undefined as ((detail: { value: number | [number, number] }) => void) | undefined,

		/** Called during dragging */
		oninput = undefined as ((detail: { value: number | [number, number] }) => void) | undefined,
	} = $props();

	let lower_hovering = $state(false);
	let upper_hovering = $state(false);
	let lower_dragging = $state(false);
	let upper_dragging = $state(false);

	const lower_value = $derived(range && Array.isArray(value) ? value[0] : (value as number));
	const upper_value = $derived(range && Array.isArray(value) ? value[1] : max);

	const fill_left = $derived(range ? ((lower_value - min) / (max - min)) * 100 : 0);
	const fill_right = $derived(
		range
			? ((upper_value - min) / (max - min)) * 100
			: ((lower_value - min) / (max - min)) * 100
	);

	const tick_count = $derived(Math.floor((max - min) / step));

	function formatDisplay(n: number): string {
		if (format_value) return format_value(n);
		return String(n);
	}

	function emitValue() {
		const v = range ? ([lower_value, upper_value] as [number, number]) : lower_value;
		return v;
	}

	function onLowerInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		let v = Number(input.value);
		if (range) {
			if (v > upper_value) v = upper_value;
			value = [v, upper_value] as [number, number];
		} else {
			value = v;
		}
		oninput?.({ value: emitValue() });
	}

	function onUpperInput(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		let v = Number(input.value);
		if (v < lower_value) v = lower_value;
		value = [lower_value, v] as [number, number];
		oninput?.({ value: emitValue() });
	}

	function onLowerChange() {
		onchange?.({ value: emitValue() });
	}

	function onUpperChange() {
		onchange?.({ value: emitValue() });
	}
</script>

<div
	class={['range-container', `size-${size}`, class_name].filter(Boolean).join(' ')}
	class:disabled
	class:dense
	class:comfortable
	class:has-ticks={show_ticks}
	{@attach tooltip_message ? tooltip(tooltip_message) : () => {}}>
	{#if label}
		<label class="range-label" for={id}>{label}</label>
	{/if}

	<div class="range-wrapper">
		{#if show_value && (lower_hovering || lower_dragging)}
			<span
				class="value-tooltip"
				style:left="{fill_right}%"
				style:--offset="{range ? fill_left : 0}%">
				{formatDisplay(lower_value)}
			</span>
		{/if}
		{#if range && show_value && (upper_hovering || upper_dragging)}
			<span class="value-tooltip" style:left="{fill_right}%">
				{formatDisplay(upper_value)}
			</span>
		{/if}

		<div class="track">
			<div
				class="fill"
				style:left="{fill_left}%"
				style:width="{fill_right - fill_left}%"></div>
		</div>

		<input
			type="range"
			{id}
			{name}
			{min}
			{max}
			{step}
			{disabled}
			value={lower_value}
			class="thumb-input lower"
			aria-valuenow={lower_value}
			aria-valuemin={min}
			aria-valuemax={range ? upper_value : max}
			aria-label={label || 'Range value'}
			oninput={onLowerInput}
			onchange={onLowerChange}
			onpointerenter={() => (lower_hovering = true)}
			onpointerleave={() => (lower_hovering = false)}
			onpointerdown={() => (lower_dragging = true)}
			onpointerup={() => (lower_dragging = false)} />

		{#if range}
			<input
				type="range"
				{min}
				{max}
				{step}
				{disabled}
				value={upper_value}
				class="thumb-input upper"
				aria-valuenow={upper_value}
				aria-valuemin={lower_value}
				aria-valuemax={max}
				aria-label={label ? `${label} upper` : 'Range upper value'}
				oninput={onUpperInput}
				onchange={onUpperChange}
				onpointerenter={() => (upper_hovering = true)}
				onpointerleave={() => (upper_hovering = false)}
				onpointerdown={() => (upper_dragging = true)}
				onpointerup={() => (upper_dragging = false)} />
		{/if}

		{#if show_ticks && tick_count <= 50}
			<div class="ticks" aria-hidden="true">
				{#each { length: tick_count + 1 } as _, i}
					{@const tick_value = min + i * step}
					<span
						class="tick"
						class:active={tick_value >= (range ? lower_value : min) &&
							tick_value <= (range ? upper_value : lower_value)}
						style:left="{((tick_value - min) / (max - min)) * 100}%">
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
		--track-height: 5px;
		--thumb-size: 18px;
		--fill-color: var(--c-action, hsl(220 70% 55%));
		--track-bg: var(--c-bg-6, hsl(0 0% 80%));
		--thumb-color: var(--c-action-active, hsl(220 70% 50%));

		display: flex;
		flex-direction: column;
		gap: 0.5em;
		width: 100%;
		font-size: var(--font-size-1, 0.875rem);
	}

	.range-container.dense {
		gap: 0.25em;
	}
	.range-container.comfortable {
		gap: 0.75em;
	}

	/* Sizes */
	.range-container.size-0 {
		--track-height: 3px;
		--thumb-size: 14px;
		font-size: var(--font-size-0, 0.75rem);
	}
	.range-container.size-1 {
		--track-height: 5px;
		--thumb-size: 18px;
		font-size: var(--font-size-1, 0.875rem);
	}
	.range-container.size-2 {
		--track-height: 7px;
		--thumb-size: 22px;
		font-size: var(--font-size-2, 1rem);
	}
	.range-container.size-3 {
		--track-height: 8px;
		--thumb-size: 26px;
		font-size: var(--font-size-3, 1.125rem);
	}

	.range-label {
		color: var(--c-text, inherit);
		font-weight: 500;
		line-height: 1.4;
	}

	.range-wrapper {
		position: relative;
		height: var(--thumb-size);
		display: flex;
		align-items: center;
	}

	/* Track */
	.track {
		position: absolute;
		left: 0;
		right: 0;
		height: var(--track-height);
		background: var(--track-bg);
		border-radius: var(--track-height);
		pointer-events: none;
	}

	.fill {
		position: absolute;
		height: 100%;
		background: var(--fill-color);
		border-radius: inherit;
		pointer-events: none;
	}

	/* Native range inputs */
	.thumb-input {
		position: absolute;
		width: 100%;
		height: var(--thumb-size);
		margin: 0;
		padding: 0;
		background: transparent;
		appearance: none;
		-webkit-appearance: none;
		pointer-events: none;
		outline: none;
		z-index: 2;
	}

	.thumb-input::-webkit-slider-runnable-track {
		height: var(--track-height);
		background: transparent;
		border: none;
	}
	.thumb-input::-moz-range-track {
		height: var(--track-height);
		background: transparent;
		border: none;
	}

	.thumb-input::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: var(--thumb-size);
		height: var(--thumb-size);
		border-radius: 50%;
		background: var(--thumb-color);
		border: 2px solid white;
		box-shadow: 0 1px 4px rgb(0 0 0 / 0.2);
		cursor: pointer;
		pointer-events: auto;
		margin-top: calc((var(--track-height) - var(--thumb-size)) / 2);
		transition: box-shadow 0.15s ease, transform 0.15s ease;
	}
	.thumb-input::-moz-range-thumb {
		width: var(--thumb-size);
		height: var(--thumb-size);
		border-radius: 50%;
		background: var(--thumb-color);
		border: 2px solid white;
		box-shadow: 0 1px 4px rgb(0 0 0 / 0.2);
		cursor: pointer;
		pointer-events: auto;
		transition: box-shadow 0.15s ease, transform 0.15s ease;
	}

	.thumb-input:focus-visible::-webkit-slider-thumb {
		outline: 2px solid var(--c-outline-active, currentColor);
		outline-offset: 2px;
	}
	.thumb-input:focus-visible::-moz-range-thumb {
		outline: 2px solid var(--c-outline-active, currentColor);
		outline-offset: 2px;
	}

	.thumb-input:not(:disabled)::-webkit-slider-thumb:hover {
		box-shadow: 0 0 0 6px rgb(from var(--fill-color) r g b / 0.15);
	}
	.thumb-input:not(:disabled)::-moz-range-thumb:hover {
		box-shadow: 0 0 0 6px rgb(from var(--fill-color) r g b / 0.15);
	}
	.thumb-input:not(:disabled):active::-webkit-slider-thumb {
		box-shadow: 0 0 0 8px rgb(from var(--fill-color) r g b / 0.2);
		transform: scale(1.1);
	}
	.thumb-input:not(:disabled):active::-moz-range-thumb {
		box-shadow: 0 0 0 8px rgb(from var(--fill-color) r g b / 0.2);
		transform: scale(1.1);
	}

	.thumb-input:disabled {
		cursor: not-allowed;
	}
	.thumb-input:disabled::-webkit-slider-thumb {
		background: var(--c-action-disabled, hsl(0 0% 70%));
		cursor: not-allowed;
	}
	.thumb-input:disabled::-moz-range-thumb {
		background: var(--c-action-disabled, hsl(0 0% 70%));
		cursor: not-allowed;
	}

	.disabled {
		opacity: 0.5;
	}

	/* Ticks */
	.ticks {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(50% + var(--thumb-size) / 2 + 4px);
		height: 8px;
		pointer-events: none;
	}

	.tick {
		position: absolute;
		width: 1px;
		height: 6px;
		background: var(--c-bg-6, hsl(0 0% 75%));
		transform: translateX(-50%);
	}
	.tick.active {
		background: var(--fill-color);
	}

	.tick-label {
		position: absolute;
		top: 10px;
		left: 50%;
		transform: translateX(-50%);
		font-size: 0.75em;
		color: var(--c-text-2, inherit);
		white-space: nowrap;
	}

	/* Value tooltip */
	.value-tooltip {
		position: absolute;
		top: calc(-1.75em - 8px);
		transform: translateX(-50%);
		background: var(--c-action-active, hsl(220 70% 50%));
		color: var(--c-action-text, white);
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 0.8em;
		font-weight: 600;
		white-space: nowrap;
		pointer-events: none;
		z-index: 3;
	}

	/* Value display below */
	.value-display {
		display: flex;
		justify-content: space-between;
		color: var(--c-text-2, inherit);
		font-size: 0.85em;
		font-variant-numeric: tabular-nums;
	}

	.has-ticks .range-wrapper {
		margin-bottom: 1.5em;
	}
</style>
