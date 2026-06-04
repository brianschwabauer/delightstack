<script module lang="ts">
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
		padding_x = undefined as string | undefined,

		/** The css amount (@example '16px') to pad the list items in the Y direction */
		padding_y = undefined as string | undefined,

		/** Whether to show a skeleton loading placeholder instead of the items */
		skeleton = false,

		/** Number of skeleton rows to render when `skeleton` is true */
		skeleton_count = 5,

		/** The css style string added to the component from the parent */
		style = '',

		/** The ID of the select element. @defaults to a random ID */
		id = propId,

		/** Specifies a custom class name for the container element */
		class: class_name = '',

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

{#if skeleton && !parentContext?.level}
	<ul
		class={['list', 'skeleton', class_name].filter(Boolean).join(' ')}
		class:dense
		class:comfortable
		style:--list-pad-x={padding_x}
		style:--list-pad-y={padding_y}
		{style}
		aria-hidden="true">
		{#each { length: skeleton_count } as _, i}
			<li class="skeleton-item">
				<span class="skeleton-bar" style:width={`${55 + ((i * 37) % 35)}%`}></span>
			</li>
		{/each}
	</ul>
{:else if !parentContext?.level}
	<ul
		class={['list', class_name].filter(Boolean).join(' ')}
		class:dense
		class:comfortable
		class:disabled
		style:--list-pad-x={padding_x}
		style:--list-pad-y={padding_y}
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
		perspective: 100px;
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
		&.skeleton {
			/* Lists fill their container. In a definite-width parent this spans the
		 * full width (so skeleton %-width bars and rows lay out correctly); in a
		 * shrink-to-fit parent (e.g. a popover) it collapses to content width. */
			width: 100%;
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

	.skeleton-item {
		list-style: none;
		display: flex;
		align-items: center;
		min-height: 3.5rem;
		padding: 0 1.5rem;
	}
	ul.dense .skeleton-item {
		min-height: 3rem;
		padding: 0 1rem;
	}
	ul.comfortable .skeleton-item {
		min-height: 4rem;
		padding: 0 2rem;
	}
	.skeleton-bar {
		height: 0.85em;
		border-radius: var(--radius-2, 4px);
		background-color: color-mix(in oklch, var(--color-text, #000) 12%, transparent);
		background-image: linear-gradient(
			90deg,
			transparent 0,
			color-mix(in oklch, var(--color-text, #000) 8%, transparent) 50%,
			transparent 100%
		);
		background-size: 200% 100%;
		animation: list-skeleton-shimmer 1.5s linear infinite;
	}
	@keyframes list-skeleton-shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.skeleton-bar {
			animation: none;
		}
	}
</style>
