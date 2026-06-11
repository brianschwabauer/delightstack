<script module lang="ts">
	export interface ListContext {
		type: 'button' | 'text' | 'radio' | 'checkbox' | 'toggle';
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

		/** Whether the list sits on a subtle filled surface (the iOS "inset
		 * grouped" look). Off by default — the list is transparent so it
		 * composes onto any surface. Combine with `outline` for a defined card. */
		filled = false,

		/** Whether the list has a 1px outline + rounded corners (transparent
		 * fill). Gives visible rounded corners without imposing a surface fill. */
		outline = false,

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
		 * `toggle` - A list of toggle switches (multiple can be selected)
		 */
		type = 'button' as 'button' | 'text' | 'radio' | 'checkbox' | 'toggle',

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
		class:filled
		class:outline
		style:--list-pad-x={padding_x}
		style:--list-pad-y={padding_y}
		{style}
		aria-hidden="true">
		{#each { length: skeleton_count } as _, i}
			<li class="skeleton-item" style:--shimmer-delay="{i * 120}ms">
				<span class="skeleton-bar" style:width={`${55 + ((i * 37) % 35)}%`}></span>
			</li>
		{/each}
	</ul>
{:else if !parentContext?.level}
	<ul
		class={['list', class_name].filter(Boolean).join(' ')}
		class:dense
		class:comfortable
		class:filled
		class:outline
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
		--_radius: calc(var(--radius-lg) * 1.5);
		--border-inset: 6px;
		border-radius: var(--_radius);
		@supports (corner-shape: superellipse(var(--squircle-ratio, 2))) {
			corner-shape: superellipse(var(--squircle-ratio, 2));
			border-radius: calc(var(--_radius) * var(--squircle-ratio, 2));
		}
		padding: 0;
		margin: 0;
		/* Transparent by default so the list composes onto any surface; the
		   rounded corners only become visible with `filled` or `outline`. The
		   item hover/active highlights stay rounded regardless. */
		background-color: transparent;
		perspective: 100px;
		&.filled {
			background-color: var(--color-bg-active);
		}
		&.outline {
			border: 1px solid var(--color-border);
		}
		&.disabled {
			color: var(--color-text-disabled);
			cursor: not-allowed;
		}
		&.dense {
			--border-inset: 4px;
			--_radius: var(--radius-lg);
		}
		&.comfortable {
			--border-inset: 8px;
			--_radius: var(--radius-xl);
		}
		&.skeleton {
			/* Lists fill their container. In a definite-width parent this spans the
		 * full width (so skeleton %-width bars and rows lay out correctly); in a
		 * shrink-to-fit parent (e.g. a popover) it collapses to content width. */
			width: 100%;
		}

		:global(> li:first-child) {
			border-top-left-radius: var(--_radius);
			border-top-right-radius: var(--_radius);
			@supports (corner-shape: superellipse(var(--squircle-ratio, 2))) {
				corner-shape: superellipse(var(--squircle-ratio, 2));
				border-top-left-radius: calc(var(--_radius) * var(--squircle-ratio, 2));
				border-top-right-radius: calc(var(--_radius) * var(--squircle-ratio, 2));
			}
		}
		:global(> li:last-child) {
			border-bottom-left-radius: var(--_radius);
			border-bottom-right-radius: var(--_radius);
			@supports (corner-shape: superellipse(var(--squircle-ratio, 2))) {
				corner-shape: superellipse(var(--squircle-ratio, 2));
				border-bottom-left-radius: calc(var(--_radius) * var(--squircle-ratio, 2));
				border-bottom-right-radius: calc(var(--_radius) * var(--squircle-ratio, 2));
			}
		}
	}

	/* Mirrors the real ListItem row metrics (min-height + inline padding,
	   incl. dense/comfortable) so the swap to loaded items doesn't shift. */
	.skeleton-item {
		list-style: none;
		display: flex;
		align-items: center;
		min-height: 3rem;
		padding: 0 calc(1.5rem + var(--list-pad-x, 0px));
	}
	ul.dense .skeleton-item {
		min-height: 2.5rem;
		padding: 0 1rem;
	}
	ul.comfortable .skeleton-item {
		min-height: 3.5rem;
		padding: 0 calc(2rem + var(--list-pad-x, 0px));
	}
	.skeleton-bar {
		height: 0.7em;
		border-radius: var(--radius-full, 1e5px);
		position: relative;
		overflow: hidden;
		background: var(--skeleton-bg, rgb(from var(--color-text, #888) r g b / 0.1));

		&::after {
			content: '';
			position: absolute;
			inset: 0;
			transform: translateX(-100%);
			background-image: linear-gradient(
				105deg,
				transparent 25%,
				var(--skeleton-sheen, rgb(from var(--color-text, #888) r g b / 0.12)) 50%,
				transparent 75%
			);
			animation: delight-skeleton-shimmer var(--skeleton-duration, 2.4s) ease-in-out
				infinite;
			animation-delay: var(--shimmer-delay, 0s);
		}
	}
	@keyframes -global-delight-skeleton-shimmer {
		0% {
			transform: translateX(-100%);
		}
		55%,
		100% {
			transform: translateX(100%);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.skeleton-bar::after {
			animation: none;
		}
	}
</style>
