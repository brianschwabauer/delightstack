<script module lang="ts">
	export interface ButtonGroupContext {
		size: undefined | '0000' | '000' | '00' | '0' | '1' | '2' | '3' | '4' | '5' | '6';
		outline: boolean;
		transparent: boolean;
		translucent: boolean;
		accent: boolean;
		error: boolean;
		success: boolean;
		disabled: boolean;
		orientation: 'horizontal' | 'vertical';
		attached: boolean;
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
		class: class_name = '',

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
		orientation,
		attached,
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
		context.orientation = orientation;
		context.attached = attached;
	});
</script>

<div
	{id}
	class={['button-group', class_name].filter(Boolean).join(' ')}
	class:vertical={orientation === 'vertical'}
	class:horizontal={orientation === 'horizontal'}
	class:attached
	role="group"
	style:display="inline-flex"
	style:align-items="stretch"
	style:flex-direction={orientation === 'vertical' ? 'column' : 'row'}
	style:gap={attached ? null : '0.25em'}>
	{#if children}{@render children()}{/if}
</div>
