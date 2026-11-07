<script module lang="ts">
	export interface ButtonGroupContext {
		/** The font size applied to all buttons in the group */
		size: undefined | '0000' | '000' | '00' | '0' | '1' | '2' | '3' | '4' | '5' | '6';
		/** Whether all buttons in the group use the outline style */
		outline: boolean;
		/** Whether all buttons in the group have a transparent background */
		transparent: boolean;
		/** Whether all buttons in the group have a semi-transparent background */
		translucent: boolean;
		/** Whether all buttons in the group use the accent/primary color */
		accent: boolean;
		/** Whether all buttons in the group are styled as an error (danger) */
		error: boolean;
		/** Whether all buttons in the group are styled as success */
		success: boolean;
		/** Whether all buttons in the group are disabled */
		disabled: boolean;
		/** The layout direction of the group */
		orientation: 'horizontal' | 'vertical';
		/** Whether the buttons are visually attached (merged borders, no gap) */
		attached: boolean;
		/** True when the group owns a selection (`bind:value`): child Buttons
		 *  with a `value` become pressed/unpressed toggles. */
		selectable: boolean;
		/** The selected child's value (selection mode only) */
		value: string | number | undefined;
		/** Select a child's value (selection mode only) */
		select: (value: string | number) => void;
	}
</script>

<script lang="ts">
	import { setContext, type Snippet } from 'svelte';

	const propId = $props.id();
	let {
		/** The size applied to all child buttons */
		size = undefined as ButtonGroupContext['size'],

		/** Whether all child buttons should have an outline style */
		outline = false,

		/** Whether all child buttons should have a transparent background */
		transparent = false,

		/** Whether all child buttons should have a translucent background. In a
		 *  segmented group (`bind:value`), the selected option becomes a neutral
		 *  translucent chip instead of the solid brand fill. */
		translucent = false,

		/** Whether all child buttons should use the accent color */
		accent = false,

		/** Whether all child buttons should use the error color */
		error = false,

		/** Whether all child buttons should use the success color */
		success = false,

		/** The orientation of the button group */
		orientation = 'horizontal' as 'horizontal' | 'vertical',

		/** Whether all child buttons should be disabled */
		disabled = false,

		/** Whether child buttons should have merged borders (no gap between them) */
		attached = true,
		/**
		 * The selected value. Binding it turns the group into a segmented control
		 * for 2–5 mutually exclusive options: each child Button with a matching
		 * `value` is a toggle (`aria-pressed`), the selected one is filled and the
		 * rest stay quiet inside one shared frame.
		 */
		value = $bindable(undefined) as string | number | undefined,
		/** Called with the new value when the user picks an option */
		onchange = undefined as undefined | ((value: string | number) => void),

		/** The ID of the element. @defaults to a random ID */
		id = propId,

		/** Specifies a custom class name for the container element */
		class: class_name = '',

		/** The child elements to display inside the group */
		children = undefined as undefined | Snippet,
	} = $props();

	// Getters keep the context live — children re-read the current prop values
	// whenever the parent updates them (no snapshot + sync effect needed).
	const context: ButtonGroupContext = {
		get size() {
			return size;
		},
		get outline() {
			return outline;
		},
		get transparent() {
			return transparent;
		},
		get translucent() {
			return translucent;
		},
		get accent() {
			return accent;
		},
		get error() {
			return error;
		},
		get success() {
			return success;
		},
		get disabled() {
			return disabled;
		},
		get orientation() {
			return orientation;
		},
		get attached() {
			return attached && value === undefined;
		},
		get selectable() {
			return value !== undefined;
		},
		get value() {
			return value;
		},
		select(next) {
			if (next === value) return;
			value = next;
			onchange?.(next);
		},
	};
	setContext<ButtonGroupContext>('button-group', context);
</script>

<div
	{id}
	class={['button-group', class_name].filter(Boolean).join(' ')}
	class:vertical={orientation === 'vertical'}
	class:horizontal={orientation === 'horizontal'}
	class:attached={attached && value === undefined}
	class:selectable={value !== undefined}
	role="group"
	style:display="inline-flex"
	style:align-items="stretch"
	style:flex-direction={orientation === 'vertical' ? 'column' : 'row'}
	style:gap={attached && value === undefined ? null : '0.25em'}>
	{#if children}{@render children()}{/if}
</div>

<style>
	/* Segmented mode: one framed track, options inset inside it. The track
	   radius is concentric with the buttons' (button radius + inset). */
	.selectable {
		/* Hug the options even when a flex/grid parent would stretch it. */
		width: fit-content;
		align-self: flex-start;
		--_inset: 3px;
		padding: var(--_inset);
		gap: 2px !important;
		border: 1px solid var(--color-border-control, var(--color-border));
		border-radius: calc(var(--action-radius, var(--radius-lg, 10px)) + var(--_inset));
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(
				(var(--action-radius, var(--radius-lg, 10px)) + var(--_inset)) *
					var(--squircle-ratio, 2)
			);
		}
	}
</style>
