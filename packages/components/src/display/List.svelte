<script module lang="ts">
	/**
	 *
	 * TODO:
	 * - Add support for adding icons at the beginning or end of list items
	 * - Add a slot for beginning and end of list items (to add something like an avatar or action button)
	 * - Add support for virtualized lists for performance with large datasets (virtual scroll)
	 * - Add support for sortable lists (drag and drop to reorder)
	 */

	export interface ListContext {
		type: 'button' | 'text' | 'radio' | 'checkbox';
		value: number[];
		dense: boolean;
		comfortable: boolean;
		disabled: boolean;
		level: number;
		id: string;
	}
</script>

<script lang="ts">
	import { onFocusWithin } from '@delightstack/utilities';
	import { getContext, setContext, type Snippet } from 'svelte';
	import { browser } from '$app/environment';

	const propId = $props.id();
	let {
		/** Whether the list should display in a condensed view (less padding) */
		dense = false,

		/** Whether the form should display in an expanded view (more padding) */
		comfortable = false,

		/** Whether the buttons/checkboxes/radios should be disabled */
		disabled = false,

		/** Whether the field has been touched (and blurred) */
		touched = $bindable(false) as boolean,

		/**
		 * The type of items in the list.
		 * @default 'button'
		 * `button` - A list of buttons that can be clicked
		 * `text` - A list of non-interactive text
		 * `radio` - A list of radio buttons (only one can be selected)
		 * `checkbox` - A list of checkboxes (multiple can be selected)
		 */
		type = 'button' as 'button' | 'text' | 'radio' | 'checkbox',

		/** The list of indexes that have been selected (can be multiple for checkbox and only one for radio)*/
		value = $bindable([]) as number[],

		/** The css amount (@example '16px') to pad the list items in the X direction */
		paddingX = undefined as string | undefined,

		/** The css amount (@example '16px') to pad the list items in the Y direction */
		paddingY = undefined as string | undefined,

		/** The css style string added to the component from the parent */
		style = '',

		/** The ID of the select element. @defaults to a random ID */
		id = propId,

		/** Specifies a custom class name for the container element */
		class: className = '',

		/** The child elements to display inside the element */
		children = undefined as undefined | Snippet,

		/** Called when the field is touched */
		ontouch = undefined as (() => void) | undefined,

		/** Called when the value changes */
		onchange = undefined as ((val: number[]) => void) | undefined,
	} = $props();

	let element = $state<HTMLElement | undefined>(undefined);
	const parentContext = getContext<ListContext | undefined>('list');

	// Emit the necessary events when the field is touched or dirty or value changes
	$effect(() => {
		if (touched) ontouch?.();
	});

	const context = $state({
		type,
		value,
		dense,
		comfortable,
		disabled,
		id,
		...parentContext,
		level: (parentContext?.level || 0) + 1,
	});
	setContext<ListContext>('list', context);
	$effect(() => {
		context.type = parentContext?.type ?? type;
		context.value = parentContext?.value ?? value;
		context.dense = parentContext?.dense ?? dense;
		context.comfortable = parentContext?.comfortable ?? comfortable;
		context.disabled = parentContext?.disabled ?? disabled;
		context.id = parentContext?.id ?? id;
		context.level = (parentContext?.level || 0) + 1;
	});

	function handleChangeEvent(e: Event) {
		const target = e.target as HTMLInputElement;
		if (!target || (target.type !== 'checkbox' && target.type !== 'radio')) return;
		let hostChild: HTMLElement | null = target;
		while (hostChild && hostChild.parentElement !== element) {
			hostChild = hostChild.parentElement;
		}
		if (!hostChild || !element) return;
		const index = Array.from(element.children).indexOf(hostChild);
		let tempSelected = type === 'radio' ? [index] : [...value].filter((i) => i !== index);
		if (type !== 'radio' && target.checked) {
			tempSelected = [...tempSelected, index];
		}
		if (JSON.stringify(tempSelected) === JSON.stringify(value)) return;
		value = tempSelected;
		if (onchange) onchange(value);
	}
</script>

{#if !parentContext?.level}
	<ul
		class={['list', className].filter(Boolean).join(' ')}
		class:dense
		class:comfortable
		class:disabled={disabled || !browser}
		style:--list-pad-x={paddingX}
		style:--list-pad-y={paddingY}
		{@attach onFocusWithin({
			onfocuswithin: () => touched || (touched = true),
		})}
		{style}
		bind:this={element}
		onchange={handleChangeEvent}>
		{#if children}{@render children()}{/if}
	</ul>
{:else if children}{@render children()}{/if}

<style>
	ul {
		--radius: var(--radius-5);
		--color-bg: var(--color-bg-active);
		--border-inset: 6px;
		border-radius: var(--radius);
		padding: 0;
		margin: 0;
		background-color: var(--color-bg);
		&.disabled {
			color: var(--color-text-disabled);
			cursor: not-allowed;
		}
		&.dense {
			--radius: var(--radius-4);
			--border-inset: 4px;
		}
		&.comfortable {
			--border-inset: 8px;
		}

		:global(> li:first-child) {
			border-top-left-radius: var(--radius);
			border-top-right-radius: var(--radius);
		}
		:global(> li:last-child) {
			border-bottom-left-radius: var(--radius);
			border-bottom-right-radius: var(--radius);
		}
	}
</style>
