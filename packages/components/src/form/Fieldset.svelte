<script lang="ts">
	import type { Snippet } from 'svelte';
	import HelpIcon from '~icons/material-symbols/help';
	import { tooltip as tooltipAction } from '@packages/lib';

	let {
		/** The label to show at the top of the field */
		label = '',
		/** Additional helpful information shown when hovering over the label. Adds a "question mark" icon to the label */
		tooltip = '',
		/** Whether the field is valid */
		valid = true,
		/** Whether the field should display in a condensed view (less padding) */
		dense = false,
		/** Whether the form should display in an expanded view (more padding) */
		comfortable = false,
		/** Whether the field is disabled */
		disabled = false,
		/** Whether the field should show an outline when hovered */
		outlineOnHover = false,
		/** Whether the field should show an outline when focused */
		outlineOnFocus = false,
		/** Whether there should be a border around the field. Use 'filled' to give the field a darker background */
		outlined = true,
		/** Whether the field should have a darker background */
		filled = false,
		/** The border radius of the field */
		radius = 'var(--radius-3)',
		/** Specifies a custom class name for the container element */
		class: className = '',
		/** The css style string added to the component from the parent */
		style = '',
		/** The child elements to display inside the field */
		children = undefined as undefined | Snippet,
	} = $props();
</script>

<div
	class="fieldset"
	class:error={!valid}
	class:dense
	class:comfortable
	class:disabled
	class:outline-on-hover={outlineOnHover}
	class:outline-on-focus={outlineOnFocus}
	class:outlined
	class:filled
	class:has-label={!!label}
	style:--fieldset-radius={radius}
	{style}>
	<div class="label">
		{label}
		{#if tooltip}
			<div class="tooltip-icon" use:tooltipAction={tooltip}>
				<HelpIcon />
			</div>
		{/if}
	</div>
	<div class="field {className}">
		{#if children}{@render children()}{/if}
	</div>
</div>

<style lang="scss">
	$label-font-size: 0.8em;
	$label-margin: 0.4em;

	.fieldset {
		--c-outline-width: 1px;
		width: 100%;
		color: inherit;
		caret-color: currentColor;
		display: flex;
		align-items: center;
		position: relative;
		min-height: calc(var(--height) + $label-margin);
		border-radius: var(--fieldset-radius);
		padding: 1em;
		margin-bottom: 0.4em;

		.field {
			width: 100%;
		}

		&.dense {
			padding: 0.5em;
		}
		&.comfortable {
			padding: 1.5em;
		}
		&.outline-on-hover:not(.disabled):hover {
			--c-outline: var(--c-outline-high);
			--c-outline-width: 2px;
		}
		&.outline-on-focus:not(.disabled):focus-within {
			--c-outline: var(--c-outline-high);
			--c-outline-width: 2px;
		}
		&.disabled {
			pointer-events: none;
			color: var(--c-text-disabled);

			.label {
				color: var(--c-text-disabled);
			}
		}
		&.error {
			color: var(--c-error);
			--c-outline: var(--c-error);
			--c-text-disabled: var(--c-error);
			.input-inner:hover,
			&:focus-within {
				color: var(--c-error-active);
			}
		}
		&:not(.outlined) {
			--c-outline: transparent;
			--c-outline: transparent;
		}
		&.filled {
			.label {
				background-color: var(--c-bg-active);
				z-index: -1;
			}
		}

		> :global(*) {
			margin-top: $label-margin;
		}

		&::before {
			border-radius: inherit;
			width: inherit;
			bottom: calc(-1 * var(--c-outline-width));
			content: '';
			left: 0;
			position: absolute;
			pointer-events: none;
			border-color: var(--c-outline);
			border-style: solid;
			top: $label-margin;
			border-width: var(--c-outline-width);
			box-sizing: border-box;
			transition: border-color 0.1s;
		}
	}

	.label {
		position: absolute;
		text-overflow: ellipsis;
		transform-origin: top left;
		top: 0;
		left: 0;
		display: flex;
		width: 100%;
		min-height: calc(100% - $label-margin);
		max-height: 100%;
		max-width: 100%;
		line-height: 0;
		height: auto;
		padding: 0;
		transform: none;
		transition: color 0.1s;
		overflow: visible;
		border-radius: var(--fieldset-radius);
		color: var(--c-text-disabled);
		pointer-events: none;
		font-size: $label-font-size;
		.tooltip-icon {
			line-height: 0px;
			margin: -0.5em 0 0 0.5em;
			cursor: default;
			pointer-events: all;
		}
		&::before,
		&::after {
			content: '';
			display: block;
			box-sizing: border-box;
			min-width: max(var(--fieldset-radius), 1em);
			width: 0;
			height: var(--fieldset-radius);
			pointer-events: none;
			border-top: solid var(--c-outline-width) transparent;
			margin-top: 0.1em;
		}
		&::before {
			margin-right: 0;
			border-radius: var(--fieldset-radius) 0;
			transition:
				margin-right 0.2s,
				width 0.3s;
			border-left: solid var(--c-outline-width) transparent;
		}
		&::after {
			flex-grow: 1;
			margin-left: 4px;
			border-radius: 0 var(--fieldset-radius);
			border-right: solid var(--c-outline-width) transparent;
		}
	}

	.has-label {
		&::before {
			border-top-color: transparent;
		}
		.label {
			&::before {
				margin-right: 4px;
			}
			&::before,
			&::after {
				// The top border when there is a value in the input and the input is not focused
				// The placeholder text shows up at the top
				border-top: solid var(--c-outline-width) var(--c-outline);
			}
		}
	}
</style>
