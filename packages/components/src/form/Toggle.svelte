<script lang="ts">
	import { tooltip } from '@delightstack/utilities';
	import { type Snippet } from 'svelte';

	const propId = $props.id();
	let {
		/** Whether the toggle is checked */
		checked = $bindable(false),

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
		onchange = undefined as ((detail: { checked: boolean }) => void) | undefined,
	} = $props();

	let pressed = $state(false);

	const state_label = $derived(checked ? on_label : off_label);

	function toggle() {
		if (disabled) return;
		checked = !checked;
		onchange?.({ checked });
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.key === ' ' || e.key === 'Enter') {
			e.preventDefault();
			toggle();
		}
	}
</script>

<label
	class={['toggle', `size-${size}`, class_name].filter(Boolean).join(' ')}
	class:checked
	class:disabled
	class:dense
	class:comfortable
	class:pressed
	class:label-start={label_position === 'start'}
	for={id}
	{@attach tooltip_message ? tooltip(tooltip_message) : () => {}}>
	{#if label && label_position === 'start'}
		<span class="label">{label}</span>
	{/if}

	<input
		type="checkbox"
		bind:checked
		{name}
		{value}
		{id}
		{disabled}
		class="sr-only"
		onchange={() => onchange?.({ checked })} />

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<span
		class="track"
		role="switch"
		aria-checked={checked}
		tabindex={disabled ? -1 : 0}
		onkeydown={onKeyDown}
		onpointerdown={() => (pressed = true)}
		onpointerup={() => (pressed = false)}
		onpointerleave={() => (pressed = false)}>
		<span class="thumb">
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
		--thumb-travel: calc(
			var(--track-width) - var(--thumb-size) - var(--thumb-offset) * 2
		);
		--thumb-press-grow: 4px;

		display: inline-flex;
		align-items: center;
		gap: 0.625em;
		cursor: pointer;
		user-select: none;
		-webkit-tap-highlight-color: transparent;
		position: relative;
		perspective: 100px;
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
		font-size: var(--text-sm, 0.75rem);
	}
	.toggle.size-1 {
		--track-width: 44px;
		--track-height: 24px;
		--thumb-size: 18px;
		--thumb-offset: 3px;
		--thumb-press-grow: 4px;
		font-size: var(--text-base, 0.875rem);
	}
	.toggle.size-2 {
		--track-width: 52px;
		--track-height: 28px;
		--thumb-size: 22px;
		--thumb-offset: 3px;
		--thumb-press-grow: 4px;
		font-size: var(--text-lg, 1rem);
	}
	.toggle.size-3 {
		--track-width: 68px;
		--track-height: 36px;
		--thumb-size: 28px;
		--thumb-offset: 4px;
		--thumb-press-grow: 6px;
		font-size: var(--text-xl, 1.125rem);
	}

	.toggle.dense {
		gap: 0.375em;
	}
	.toggle.comfortable {
		gap: 1em;
	}

	/* Track */
	.track {
		position: relative;
		display: inline-flex;
		align-items: center;
		width: var(--track-width);
		height: var(--track-height);
		border-radius: var(--track-height);
		background-color: var(--color-bg-muted, hsl(0 0% 70%));
		transition:
			background-color 0.2s ease,
			translate 200ms ease;
		flex-shrink: 0;
		outline: none;

		&:active {
			translate: 0px 1px clamp(-10px, calc(0.2em - 12px), -2px);
		}
	}

	.disabled .track:active {
		translate: none;
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
		background-color: var(--color-action-text, white);
		display: flex;
		align-items: center;
		justify-content: center;
		transform: translateX(0);
		transition:
			transform 0.25s cubic-bezier(0.34, 1.4, 0.64, 1),
			width 0.15s ease,
			left 0.15s ease;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
	}

	.checked .thumb {
		transform: translateX(var(--thumb-travel));
	}

	/* Press state: widen thumb */
	.pressed:not(.disabled) .thumb {
		width: calc(var(--thumb-size) + var(--thumb-press-grow));
	}
	.pressed.checked:not(.disabled) .thumb {
		width: calc(var(--thumb-size) + var(--thumb-press-grow));
		transform: translateX(calc(var(--thumb-travel) - var(--thumb-press-grow)));
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
	.disabled .track {
		pointer-events: auto;
		cursor: not-allowed;
	}

	/* Labels */
	.label {
		color: var(--color-text, inherit);
		line-height: 1.4;
		transition: translate 200ms ease;
		&:active {
			translate: 0px 1px clamp(-10px, calc(0.2em - 12px), -2px);
		}
	}
	.state-label {
		color: var(--color-text-muted, inherit);
		font-size: 0.875em;
		line-height: 1.4;
		transition: translate 200ms ease;
		&:active {
			translate: 0px 1px clamp(-10px, calc(0.2em - 12px), -2px);
		}
	}
</style>
