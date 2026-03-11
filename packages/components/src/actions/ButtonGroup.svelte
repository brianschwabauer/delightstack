<script module lang="ts">
	export interface ButtonGroupContext {
		size:
			| undefined
			| '0000'
			| '000'
			| '00'
			| '0'
			| '1'
			| '2'
			| '3'
			| '4'
			| '5'
			| '6';
		outline: boolean;
		transparent: boolean;
		translucent: boolean;
		accent: boolean;
		error: boolean;
		success: boolean;
		disabled: boolean;
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

		/** Whether all child buttons should have a translucent background */
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

		/** The ID of the element. @defaults to a random ID */
		id = propId,

		/** Specifies a custom class name for the container element */
		class: className = '',

		/** The child elements to display inside the group */
		children = undefined as undefined | Snippet,
	} = $props();

	const context = $state<ButtonGroupContext>({
		size,
		outline,
		transparent,
		translucent,
		accent,
		error,
		success,
		disabled,
	});
	setContext<ButtonGroupContext>('button-group', context);

	$effect(() => {
		context.size = size;
		context.outline = outline;
		context.transparent = transparent;
		context.translucent = translucent;
		context.accent = accent;
		context.error = error;
		context.success = success;
		context.disabled = disabled;
	});
</script>

<div
	{id}
	class={['button-group', className].filter(Boolean).join(' ')}
	class:vertical={orientation === 'vertical'}
	class:horizontal={orientation === 'horizontal'}
	class:attached
	role="group">
	{#if children}{@render children()}{/if}
</div>

<style>
	.button-group {
		display: inline-flex;
		align-items: stretch;

		&.horizontal {
			flex-direction: row;
		}
		&.vertical {
			flex-direction: column;
		}

		/* Attached mode: merge borders and adjust border-radius */
		&.attached {
			&.horizontal {
				/* Remove border-radius from middle children */
				:global(> .button:not(:first-child):not(:last-child)) {
					border-radius: 0;
				}
				:global(> .button:not(:first-child):not(:last-child) button),
				:global(> .button:not(:first-child):not(:last-child) a) {
					border-radius: 0;
				}

				/* First child: keep left radius, remove right */
				:global(> .button:first-child) {
					border-top-right-radius: 0;
					border-bottom-right-radius: 0;
				}
				:global(> .button:first-child button),
				:global(> .button:first-child a) {
					border-top-right-radius: 0;
					border-bottom-right-radius: 0;
				}

				/* Last child: keep right radius, remove left */
				:global(> .button:last-child) {
					border-top-left-radius: 0;
					border-bottom-left-radius: 0;
				}
				:global(> .button:last-child button),
				:global(> .button:last-child a) {
					border-top-left-radius: 0;
					border-bottom-left-radius: 0;
				}

				/* Merge borders between adjacent children */
				:global(> .button + .button) {
					margin-left: -1px;
				}
			}

			&.vertical {
				/* Remove border-radius from middle children */
				:global(> .button:not(:first-child):not(:last-child)) {
					border-radius: 0;
				}
				:global(> .button:not(:first-child):not(:last-child) button),
				:global(> .button:not(:first-child):not(:last-child) a) {
					border-radius: 0;
				}

				/* First child: keep top radius, remove bottom */
				:global(> .button:first-child) {
					border-bottom-left-radius: 0;
					border-bottom-right-radius: 0;
				}
				:global(> .button:first-child button),
				:global(> .button:first-child a) {
					border-bottom-left-radius: 0;
					border-bottom-right-radius: 0;
				}

				/* Last child: keep bottom radius, remove top */
				:global(> .button:last-child) {
					border-top-left-radius: 0;
					border-top-right-radius: 0;
				}
				:global(> .button:last-child button),
				:global(> .button:last-child a) {
					border-top-left-radius: 0;
					border-top-right-radius: 0;
				}

				/* Merge borders between adjacent children */
				:global(> .button + .button) {
					margin-top: -1px;
				}
			}

			/* Ensure hovered/focused buttons appear above siblings for border visibility */
			:global(> .button:hover),
			:global(> .button:focus-within) {
				z-index: 1;
			}
		}

		/* Non-attached mode: small gap between buttons */
		&:not(.attached) {
			gap: 0.25em;
		}
	}
</style>
