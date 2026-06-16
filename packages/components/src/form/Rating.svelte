<script lang="ts">
	import { tooltip } from '@delightstack/utilities';
	import { getContext } from 'svelte';
	import type { FormContext } from './Form.svelte';

	const propId = $props.id();
	let {
		/** The current rating value */
		value = $bindable(0),

		/** The maximum number of stars */
		max = 5,

		/** The rating precision: 1 for whole stars, 0.5 for half-star */
		precision = 1 as 0.5 | 1,

		/** The size of the stars. 0=16px, 1=24px, 2=32px, 3=40px */
		size = '1' as '0' | '1' | '2' | '3',

		/** Whether the rating is read-only (display only) */
		readonly = false,

		/** Whether the rating is disabled */
		disabled = false,

		/** The fill color of active stars */
		color = '',

		/** Whether to show the numeric value next to the stars */
		show_value = false,

		/** Whether clicking the current value clears the rating */
		clearable = false,

		/** The tooltip message shown on hover */
		tooltip: tooltip_message = '',

		/** Whether to display in a condensed view */
		dense = false,

		/** Whether to display in an expanded view */
		comfortable = false,

		/** The ID of the rating element */
		id = propId,

		/** The name attribute for the hidden input */
		name = '',

		/** Error message shown below the stars */
		error = '',

		/** Parses & validates the value (e.g. a database table form field's
		 *  `parse`). Inside a Form it is registered with the form, which runs it
		 *  on the form's validation timing. */
		parse = undefined as ((value: unknown) => unknown) | undefined,

		/** Specifies a custom class name */
		class: class_name = '',

		/** Called when the rating value changes */
		onchange = undefined as ((detail: { value: number }) => void) | undefined,

		/** Called when hovering over a star */
		onhover = undefined as ((detail: { value: number }) => void) | undefined,
	} = $props();

	const sizes: Record<string, number> = { '0': 16, '1': 24, '2': 32, '3': 40 };
	const px = $derived(sizes[size] ?? 24);

	/* ------------------------------------------------------------------ */
	/*  Form context integration                                           */
	/* ------------------------------------------------------------------ */

	const form_ctx = getContext<FormContext | undefined>('form');
	let root_element = $state<HTMLElement | undefined>(undefined);

	/** Disabled merges the parent form's disabled/submitting state */
	const effectively_disabled = $derived(disabled || (form_ctx?.disabled ?? false));

	/** Error from the local prop or the parent form context */
	const resolved_error = $derived.by(() => {
		if (error) return error;
		if (form_ctx && name && form_ctx.errors[name]) return form_ctx.errors[name];
		return '';
	});

	// Register with a parent Form (focus-on-error target + field validator).
	$effect(() => {
		if (!form_ctx || !name) return;
		if (root_element) form_ctx.register(name, root_element, parse);
		return () => form_ctx.unregister(name);
	});

	// Context-driven: drive the rating value from the form data when inside a
	// Form with a name — no bind:value needed.
	$effect(() => {
		if (!form_ctx || !name) return;
		const ctx_value = form_ctx.getValue(name);
		const next = ctx_value == null ? 0 : Number(ctx_value);
		if (!Number.isNaN(next) && next !== value) value = next;
	});

	/** Writes the value into the form data, marks touched, and emits onchange */
	function emitChange() {
		if (form_ctx && name) {
			form_ctx.setValue(name, value);
			form_ctx.setTouched(name);
		}
		onchange?.({ value: value });
	}

	let hoverValue = $state(0);
	let isHovering = $state(false);
	let bounceStar = $state(-1);

	const displayValue = $derived(isHovering ? hoverValue : value);
	const isInteractive = $derived(!readonly && !effectively_disabled);

	// Star path (5-pointed star)
	const starPath =
		'M12 2l2.93 6.26L22 9.27l-5 4.87L18.18 22 12 18.27 5.82 22 7 14.14l-5-4.87 7.07-1.01L12 2z';

	function starValues(index: number): { full: number; half: number } {
		return {
			full: index + 1,
			half: index + 0.5,
		};
	}

	function selectValue(newValue: number) {
		if (!isInteractive) return;
		if (clearable && newValue === value) {
			value = 0;
		} else {
			value = newValue;
		}
		bounceStar = newValue;
		setTimeout(() => (bounceStar = -1), 300);
		emitChange();
	}

	function hoverStar(newValue: number) {
		if (!isInteractive) return;
		hoverValue = newValue;
		isHovering = true;
		onhover?.({ value: newValue });
	}

	function hoverEnd() {
		isHovering = false;
		hoverValue = 0;
	}

	function onKeyDown(e: KeyboardEvent) {
		if (!isInteractive) return;
		const step = precision === 0.5 ? 0.5 : 1;
		if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
			e.preventDefault();
			const next = Math.min(max, value + step);
			value = next;
			emitChange();
		} else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
			e.preventDefault();
			const next = Math.max(0, value - step);
			value = next;
			emitChange();
		} else if (e.key === 'Home') {
			e.preventDefault();
			value = 0;
			emitChange();
		} else if (e.key === 'End') {
			e.preventDefault();
			value = max;
			emitChange();
		}
	}

	function getStarFill(index: number): 'full' | 'half' | 'empty' {
		const starNum = index + 1;
		if (displayValue >= starNum) return 'full';
		if (displayValue >= starNum - 0.5 && precision === 0.5) return 'half';
		return 'empty';
	}
</script>

<div class="rating-field" class:has-error={!!resolved_error}>
	<div
		bind:this={root_element}
		class={['rating', class_name].filter(Boolean).join(' ')}
		class:readonly
		class:disabled={effectively_disabled}
		class:dense
		class:comfortable
		role="slider"
		aria-valuenow={value}
		aria-valuemin={0}
		aria-valuemax={max}
		aria-label="Rating"
		tabindex={isInteractive ? 0 : -1}
		onkeydown={onKeyDown}
		onmouseleave={hoverEnd}
		{@attach tooltip(tooltip_message)}
		style:font-size={`var(--control-font-${size})`}
		{id}>
		<!-- Hidden native input for form submission -->
		<input type="hidden" {name} value={value.toString()} />

		<div class="stars" style:--star-color={color || null}>
			{#each { length: max } as _, i}
				{@const fill = getStarFill(i)}
				{@const vals = starValues(i)}
				{@const isBouncing = bounceStar === vals.full || bounceStar === vals.half}
				<div
					class="star-wrapper"
					class:bouncing={isBouncing}
					style:width="{px}px"
					style:height="{px}px">
					{#if precision === 0.5 && isInteractive}
						<!-- Left half (0.5) -->
						<button
							type="button"
							class="star-half left"
							tabindex={-1}
							disabled={effectively_disabled}
							aria-hidden="true"
							onclick={() => selectValue(vals.half)}
							onmouseenter={() => hoverStar(vals.half)}>
							<svg
								viewBox="0 0 24 24"
								width={px}
								height={px}
								aria-hidden="true"
								style="clip-path: inset(0 50% 0 0)">
								<path
									d={starPath}
									class="star-path"
									class:filled={fill === 'full' || fill === 'half'} />
							</svg>
						</button>
						<!-- Right half (1.0) -->
						<button
							type="button"
							class="star-half right"
							tabindex={-1}
							disabled={effectively_disabled}
							aria-hidden="true"
							onclick={() => selectValue(vals.full)}
							onmouseenter={() => hoverStar(vals.full)}>
							<svg
								viewBox="0 0 24 24"
								width={px}
								height={px}
								aria-hidden="true"
								style="clip-path: inset(0 0 0 50%)">
								<path d={starPath} class="star-path" class:filled={fill === 'full'} />
							</svg>
						</button>
					{:else}
						<!-- Full star button -->
						<button
							type="button"
							class="star-full"
							tabindex={-1}
							disabled={effectively_disabled || readonly}
							aria-hidden="true"
							onclick={() => selectValue(vals.full)}
							onmouseenter={() => hoverStar(vals.full)}>
							<svg viewBox="0 0 24 24" width={px} height={px} aria-hidden="true">
								<path
									d={starPath}
									class="star-path"
									class:filled={fill === 'full' || fill === 'half'} />
							</svg>
						</button>
					{/if}
				</div>
			{/each}
		</div>

		{#if show_value}
			<span class="value-display">{value}</span>
		{/if}
	</div>

	{#if resolved_error}
		<span class="error-text">{resolved_error}</span>
	{/if}
</div>

<style>
	.rating-field {
		display: inline-flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.25em;

		.error-text {
			font-size: 0.8em;
			color: var(--color-error, #d32f2f);
		}
	}

	.rating {
		display: inline-flex;
		align-items: center;
		gap: 0.5em;
		outline: none;

		&.dense {
			gap: 0.25em;
		}
		&.comfortable {
			gap: 0.75em;
		}
		&.disabled {
			opacity: 0.5;
			pointer-events: none;
		}
		&.readonly {
			pointer-events: none;
		}

		&:focus-visible .stars {
			outline: 2px solid var(--color-text, currentColor);
			outline-offset: 4px;
			border-radius: 4px;
		}
	}

	.stars {
		--star-active: var(--star-color, #f59e0b);
		/* Empty stars use the neutral border gray (absolute lightness: light in
		   light mode, dark in dark mode) rather than --color-text-disabled, which
		   is a *relative* nudge of currentColor — against dark page text that
		   resolved to a near-black fill, making empty stars look selected. */
		--star-inactive: light-dark(
			var(--color-border, #d4d4d8),
			var(--color-border, #52525b)
		);
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}

	.star-wrapper {
		position: relative;
		display: inline-flex;
		flex-shrink: 0;
		perspective: 100px;

		&.bouncing {
			animation: bounce 300ms cubic-bezier(0.4, 0, 0.2, 1);
		}
	}

	.star-full,
	.star-half {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		padding: 0;
		margin: 0;
		border: none;
		background: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		box-shadow: none;
		outline: none;
		-webkit-tap-highlight-color: transparent;
		transition: translate 200ms ease;

		&:active:not(:disabled) {
			translate: 0px 1px clamp(-20px, calc(0.2em - 17px), -2px);
		}

		&:disabled {
			cursor: default;
		}

		svg {
			display: block;
			pointer-events: none;
		}
	}

	.star-half.left {
		clip-path: inset(0 50% 0 0);
		z-index: 1;
	}

	.star-half.right {
		clip-path: inset(0 0 0 50%);
	}

	.star-path {
		fill: var(--star-inactive);
		stroke: none;
		transition: fill 150ms ease;

		&.filled {
			fill: var(--star-active);
		}
	}

	.value-display {
		font-size: 0.9em;
		font-weight: 600;
		color: var(--color-text, inherit);
		min-width: 1.5em;
		text-align: center;
	}

	@keyframes bounce {
		0% {
			transform: scale(1);
		}
		40% {
			transform: scale(1.25);
		}
		100% {
			transform: scale(1);
		}
	}
</style>
