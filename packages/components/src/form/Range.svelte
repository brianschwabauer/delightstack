<script lang="ts" generics="Multiple extends boolean = false">
	import { untrack } from 'svelte';
	import { formatToString } from '@packages/lib';
	import { browser } from '$app/environment';

	interface RangeProps {
		/** The name of the field (key) of the parent input element */
		name?: string;
		/** Whether multiple values should be selected (min/max). The first value in the array is min */
		multiple?: Multiple;
		/** Whether the range slider is disabled */
		disabled?: boolean;
		/** The minimum value of the slider. @default 0 */
		min?: number;
		/** The maximum value of the slider. @default 100 */
		max?: number;
		/** The step value of the slider. Increments the value by this amount */
		step?: number;
		/** The current value. If multiple is true, this is an array representing [min, max] @default 0 */
		value: Multiple extends true ? [number, number] : number;
		/** Whether the field has been touched (and blurred) */
		touched?: boolean;
		/** Whether the field has a value (field is filled in) */
		dirty?: boolean;
		/** Whether the slider displays tick marks along the slider track. */
		showTickMarks?: boolean;
		/** Whether the 'max' value represents any number greater than or equal to the max. Shows a greater than sign */
		showGreaterThanMax?: boolean;
		/** Whether the 'min' value represents any number less than or equal to the min. Shows a less than sign */
		showLessThanMin?: boolean;
		/** Whether the slider displays a numeric value label upon pressing the thumb. */
		discrete?: boolean;
		/**
		 * Whether the background color should be the accent/primary/brand color.
		 * If 'transparent' is also true, this will change the color of the text instead
		 */
		accent?: boolean;
		/** The css style string added to the component from the parent */
		style?: string;
		/** Specifies a custom class name for the container element */
		class?: string;
		/** The ID of the range element. @defaults to a random ID */
		id?: string;
		/** Emits when the field has been touched (and blurred) */
		ontouch?: () => void;
		/** Emits when the field has a value (field is filled in) */
		ondirty?: () => void;
		/** Emits the current value of the input when it changes */
		onchange?: (output: this['value']) => void;
	}

	const propId = $props.id();
	let {
		multiple = false as Multiple,
		disabled = false,
		min = 0,
		max = 100,
		step = 1,
		value = $bindable(multiple ? [min, max] : 0) as RangeProps['value'],
		showTickMarks = false,
		showGreaterThanMax = false,
		showLessThanMin = false,
		discrete = false,
		accent = false,
		touched = $bindable(false),
		dirty = $bindable(false),
		style = '',
		class: className = '',
		id = propId,
		ontouch = undefined,
		ondirty = undefined,
		onchange = undefined,
	}: RangeProps = $props();

	let lowerBound = $state(((Array.isArray(value) ? value[0] : value) as number) ?? min);
	let upperBound = $state(((Array.isArray(value) ? value[1] : value) as number) ?? max);

	// Update the local value when the value is changed by the parent
	$effect(() => {
		const lower = multiple ? Math.min(...(value as number[])) : <number>value;
		const upper = multiple ? Math.max(...(value as number[])) : <number>value;
		untrack(() => {
			if (lowerBound !== lower) lowerBound = lower;
			if (upperBound !== upper) upperBound = upper;
		});
	});

	// Update the parent value when the value is changed by the local component
	$effect(() => {
		const lower = lowerBound;
		const upper = upperBound;
		untrack(() => {
			if (!touched) touched = true;
			if (!dirty) dirty = true;
			if (multiple && Array.isArray(value)) {
				if (value[0] !== lower || value[1] !== upper) {
					value = [lower, upper] as RangeProps['value'];
				}
			}
			if (!multiple && value !== lower) value = lower as RangeProps['value'];
		});
	});

	// Emit the necessary events when the field is touched or dirty or value changes
	$effect(() => {
		if (touched) ontouch?.();
	});
	$effect(() => {
		if (dirty) ondirty?.();
	});
	$effect(() => {
		onchange?.(value);
	});
</script>

{#if multiple}
	<div
		class={['range', className].filter(Boolean).join(' ')}
		class:accent
		style:--step={`${step}`}
		style:--min={`${min}`}
		style:--max={`${max}`}
		style:--value-a={`${lowerBound}`}
		style:--value-b={`${upperBound}`}
		style:--text-value-a={`'${showLessThanMin && lowerBound === min ? '<' : ''}${formatToString(lowerBound, { type: 'number', maximumFractionDigits: 0 })}'`}
		style:--text-value-b={`'${formatToString(upperBound, { type: 'number', maximumFractionDigits: 0 })}${showGreaterThanMax && upperBound === max ? '+' : ''}'`}
		style:--ticks-height={showTickMarks ? '' : '0px'}
		style:--ticks-color={showTickMarks ? '' : 'transparent'}
		style:--show-min-max={discrete ? '' : 'none'}
		{style}>
		<input
			type="range"
			{step}
			{min}
			{max}
			{id}
			disabled={disabled || !browser}
			bind:value={lowerBound}
			onblur={() => touched || (touched = true)}
			oninput={() =>
				(upperBound = Math.min(max, Math.max(upperBound, lowerBound + step)))} />
		{#if discrete}<output></output>{/if}
		<input
			type="range"
			{step}
			{min}
			{max}
			disabled={disabled || !browser}
			bind:value={upperBound}
			onblur={() => touched || (touched = true)}
			oninput={() =>
				(lowerBound = Math.max(min, Math.min(lowerBound, upperBound - step)))} />
		{#if discrete}<output></output>{/if}
		<div class="progress"></div>
	</div>
{:else}
	<div
		class="range {className}"
		class:accent
		{id}
		style:--step={`${step}`}
		style:--min={`${min}`}
		style:--max={`${max}`}
		style:--value={`${lowerBound}`}
		style:--text-value={`'${showLessThanMin && lowerBound === min ? '<' : ''}${formatToString(lowerBound, { type: 'number', maximumFractionDigits: 0 })}${showGreaterThanMax && lowerBound === max ? '+' : ''}'`}
		style:--ticks-height={showTickMarks ? '' : '0px'}
		style:--ticks-color={showTickMarks ? '' : 'transparent'}
		style:--show-min-max={discrete ? '' : 'none'}
		{style}>
		<input
			type="range"
			{min}
			{max}
			disabled={disabled || !browser}
			{step}
			bind:value={lowerBound}
			onblur={() => touched || (touched = true)} />
		{#if discrete}<output></output>{/if}
		<div class="progress"></div>
	</div>
{/if}

<style lang="scss">
	.range {
		&.accent {
			--c-action: var(--c-accent);
			--c-action-disabled: var(--c-accent-disabled);
			--c-action-active: var(--c-accent-active);
			--c-action-text: var(--c-accent-text);
			--c-action-text-active: var(--c-accent-text-active);
			--c-action-text-disabled: var(--c-accent-text-disabled);
		}
		--value-offset-y: var(--ticks-gap);
		--value-active-color: var(--c-action-text-active);
		--value-color: transparent;
		--value-background: transparent;
		--value-background-hover: var(--c-action-active);

		--fill-color: var(--c-action);
		--fill-color-disabled: var(--c-action-disabled);
		--progress-background: var(--c-bg-6);
		--progress-background-disabled: var(--c-bg-4);
		--progress-radius: var(--radius-round);
		--track-height: calc(var(--thumb-size) / 3);

		--min-max-opacity: 0.5;
		--min-max-x-offset: 10%; // 50% to center

		--thumb-size: 16px; // the size of the thumb, not including the overlay
		--thumb-min-outer-size: 44px; // The minimum size of the thumb, including the overlay
		--thumb-overlay-size: max(
			calc(var(--thumb-size)),
			calc(var(--thumb-min-outer-size) - var(--thumb-size))
		);
		--thumb-radius: var(--radius-round);
		--thumb-color: var(--c-action-active);
		--thumb-color-disabled: var(--c-action-disabled);
		--thumb-shadow: 0 0 0 calc(var(--thumb-overlay-size) / 2) transparent inset;
		--thumb-shadow-active:
			0 0 0 calc(var(--thumb-overlay-size) / 2) rgb(from var(--c-text) r g b / 0.12) inset,
			0 0 0 4px rgb(from var(--c-text) r g b / 0.12);
		--thumb-shadow-hover: 0 0 0 calc(var(--thumb-overlay-size) / 2)
			rgb(from var(--c-text) r g b / 0.12) inset;

		--ticks-thickness: 1px;
		--ticks-height: 5px;
		// vertical space between the ticks and the progress bar
		--ticks-gap: var(--ticks-height, 0);
		--ticks-color: var(--fill-color);

		// ⚠️ BELOW VARIABLES SHOULD NOT BE CHANGED
		--step: 1;
		--ticks-count: (var(--max) - var(--min)) / var(--step);
		--maxTicksAllowed: 30;
		--too-many-ticks: Min(1, Max(var(--ticks-count) - var(--maxTicksAllowed), 0));
		--x-step: Max(
			var(--step),
			var(--too-many-ticks) * (var(--max) - var(--min))
		); // manipulate the number of steps if too many ticks exist, so there would only be 2
		// --tickInterval: 100/((var(--max) - var(--min)) / var(--step)) * var(--tickEvery, 1);
		--tickIntervalPerc_1: Calc((var(--max) - var(--min)) / var(--x-step));
		--tickIntervalPerc: calc(
			(100% - var(--thumb-size) - var(--thumb-overlay-size)) / var(--tickIntervalPerc_1) *
				var(--tickEvery, 1)
		);

		--value-a: Clamp(
			var(--min),
			var(--value, 0),
			var(--max)
		); // default value ("--value" is used in single-range markup)
		--value-b: var(--value, 0); // default value
		--text-value-a: var(--text-value, '');

		--completed-a: calc((var(--value-a) - var(--min)) / (var(--max) - var(--min)) * 100);
		--completed-b: calc((var(--value-b) - var(--min)) / (var(--max) - var(--min)) * 100);
		--ca: Min(var(--completed-a), var(--completed-b));
		--cb: Max(var(--completed-a), var(--completed-b));

		// breakdown of the below super-complex brain-breaking CSS math:
		// "clamp" is used to ensure either "-1" or "1"
		// "calc" is used to inflat the outcome into a huge number, to get rid of any value between -1 & 1
		// if absolute diff of both completed % is above "5" (%)
		// ".001" bumps the value just a bit, to avoid a scenario where calc resulted in "0" (then clamp will also be "0")
		--thumbs-too-close: Clamp(
			-1,
			1000 * (Min(1, Max(var(--cb) - var(--ca) - 5, -1)) + 0.001),
			1
		);
		--thumb-close-to-min: Min(1, Max(var(--ca) - 5, 0)); // 2% threshold
		--thumb-close-to-max: Min(1, Max(95 - var(--cb), 0)); // 2% threshold

		@mixin thumb {
			appearance: none;
			border: none;
			height: calc(var(--thumb-size) + var(--thumb-overlay-size, '0px'));
			width: calc(var(--thumb-size) + var(--thumb-overlay-size, '0px'));
			transform: var(--thumb-transform);
			border-radius: var(--thumb-radius, 50%);
			background-color: transparent;
			background-image: radial-gradient(
				circle at center,
				var(--thumb-color) 0%,
				var(--thumb-color) calc((var(--thumb-size) / 2) - 1px),
				transparent calc(var(--thumb-size) / 2)
			);
			box-shadow: var(--thumb-shadow);
			pointer-events: auto;
			transition: 0.1s;
		}

		min-width: 10em;
		box-sizing: content-box;
		display: inline-block;
		height: max(var(--track-height), var(--thumb-size));
		// margin: calc((var(--thumb-size) - var(--track-height)) * -.25) var(--thumb-size) 0;
		margin: 0 calc(var(--thumb-size) * -0.5);
		background: linear-gradient(
				to right,
				var(--ticks-color) var(--ticks-thickness),
				transparent 1px
			)
			repeat-x;
		background-size: var(--tickIntervalPerc) var(--ticks-height);
		background-position-x: calc(
			var(--thumb-size) / 2 + var(--thumb-overlay-size) / 2 - var(--ticks-thickness) / 2
		);
		background-position-y: var(--flip-y, bottom);

		padding-bottom: var(--flip-y, var(--ticks-gap));
		padding-top: calc(var(--flip-y) * var(--ticks-gap));

		position: relative;
		z-index: 1;

		// mix/max texts
		&::before,
		&::after {
			--offset: calc(var(--thumb-size) / 2 + var(--thumb-overlay-size) / 2);
			content: counter(x);
			display: var(--show-min-max, block);
			font-size: var(--font-size-0);
			position: absolute;
			bottom: var(--flip-y, -2.5ch);
			top: calc(-2.5ch * var(--flip-y));
			opacity: Clamp(0, var(--at-edge), var(--min-max-opacity));
			transform: translateX(calc(var(--min-max-x-offset) * var(--before, -1) * -1))
				scale(var(--at-edge));
			pointer-events: none;
		}

		&::before {
			--before: 1;
			--at-edge: var(--thumb-close-to-min);
			counter-reset: x var(--min);
			left: var(--offset);
		}

		&::after {
			--at-edge: var(--thumb-close-to-max);
			counter-reset: x var(--max);
			right: var(--offset);
		}

		.progress {
			--start-end: calc(var(--thumb-size) / 2 + var(--thumb-overlay-size) / 2);
			--clip-end: calc(100% - (var(--cb)) * 1%);
			--clip-start: calc(var(--ca) * 1%);
			--clip: inset(-20px var(--clip-end) -20px var(--clip-start));
			position: absolute;
			left: var(--start-end);
			right: var(--start-end);
			top: calc(
				var(--ticks-gap) * var(--flip-y, 0) + var(--thumb-size) /
					2 - var(--track-height) / 2
			);
			//  transform: var(--flip-y, translateY(-50%) translateZ(0));
			height: calc(var(--track-height));
			background: var(--progress-background, #eee);
			pointer-events: none;
			z-index: -1;
			border-radius: var(--progress-radius);

			// fill area
			&::before {
				content: '';
				position: absolute;
				// left: Clamp(0%, calc(var(--ca) * 1%), 100%); // confine to 0 or above
				// width: Min(100%, calc((var(--cb) - var(--ca)) * 1%)); // confine to maximum 100%
				left: 0;
				right: 0;
				clip-path: var(--clip);
				top: 0;
				bottom: 0;
				background: var(--fill-color, black);
				box-shadow: var(--progress-flll-shadow);
				z-index: 1;
				border-radius: inherit;
			}

			// shadow-effect
			&::after {
				content: '';
				position: absolute;
				top: 0;
				right: 0;
				bottom: 0;
				left: 0;
				box-shadow: var(--progress-shadow);
				pointer-events: none;
				border-radius: inherit;
			}
		}

		& > input {
			appearance: none;
			-webkit-appearance: none;
			width: 100%;
			height: var(--thumb-size);
			margin: 0;
			position: absolute;
			left: 0;
			box-shadow: none;
			top: calc(
				50% - Max(var(--track-height), var(--thumb-size)) / 2 +
					calc(var(--ticks-gap) / 2 * var(--flip-y, -1))
			);
			cursor: -webkit-grab;
			cursor: grab;
			outline: none;
			background: none;

			&:disabled {
				cursor: -webkit-not-allowed;
				cursor: not-allowed;
				--thumb-color: var(--thumb-color-disabled);
				~ .progress {
					--fill-color: var(--fill-color-disabled);
					--progress-background: var(--progress-background-disabled);
				}
			}

			&:not(:only-of-type) {
				pointer-events: none;
			}

			&::-webkit-slider-thumb {
				@include thumb;
			}
			&::-moz-range-thumb {
				@include thumb;
			}
			&::-ms-thumb {
				@include thumb;
			}

			&:hover:not(:disabled),
			&:focus-visible:not(:disabled) {
				--thumb-shadow: var(--thumb-shadow-hover);
				--thumb-transform: var(--thumb-transform-hover);
				& + output {
					--value-background: var(--value-background-hover);
					--y-offset: -5px;
					color: var(--value-active-color);
					box-shadow: 0 0 0 3px var(--value-background);
				}
			}

			&:active:not(:disabled) {
				--thumb-shadow: var(--thumb-shadow-active);
				--thumb-transform: var(--thumb-transform-active);
				cursor: grabbing;
				z-index: 2; // when sliding left thumb over the right or vice-versa, make sure the moved thumb is on top
				+ output {
					transition: 0s;
				}
			}

			&:nth-of-type(1) {
				--is-left-most: Clamp(0, (var(--value-a) - var(--value-b)) * 99999, 1);
				& + output {
					&:not(:only-of-type) {
						--flip: calc(var(--thumbs-too-close) * -1);
					}

					--value: var(--value-a);
					--x-offset: calc(var(--completed-a) * -1%);
					&::after {
						content: var(--text-value-a);
					}
				}
			}

			&:nth-of-type(2) {
				--is-left-most: Clamp(0, (var(--value-b) - var(--value-a)) * 99999, 1);
				& + output {
					--value: var(--value-b);
				}
			}

			// non-multiple range should not clip start of progress bar
			&:only-of-type {
				~ .progress {
					--clip-start: 0;
				}
			}

			& + output {
				--flip: -1;
				--x-offset: calc(var(--completed-b) * -1%);
				--pos: calc(((var(--value) - var(--min)) / (var(--max) - var(--min))) * 100%);

				pointer-events: none;
				position: absolute;
				z-index: 2;
				background: var(--value-background);
				color: var(--value-color);
				border-radius: 10px;
				padding: 2px 6px;
				left: var(--pos);
				margin-left: calc(
					(1 - ((var(--value) - var(--min)) / (var(--max) - var(--min)))) *
						var(--thumb-overlay-size) - var(--thumb-overlay-size) / 2
				);
				transform: translate(
					var(--x-offset),
					calc(
						150% * var(--flip) - (var(--y-offset, 0px) + var(--value-offset-y)) *
							var(--flip)
					)
				);
				transition:
					all 0.12s ease-out,
					left 0s;

				&::after {
					content: var(--text-value-b);
					font-size: var(--font-size-1);
					line-height: 1;
					font-weight: bold;
				}
			}
		}
	}
</style>
