<script lang="ts">
	import { ripple } from '@delightstack/utilities';
	import { getContext, type Snippet } from 'svelte';
	import { type ListContext } from './List.svelte';
	import type { TransitionConfig } from 'svelte/transition';
	import { backOut, quartOut } from 'svelte/easing';
	import type { PopoverPlacement } from './../actions/Popover.svelte';
	import Button from './../actions/Button.svelte';
	import Progress from '../feedback/Progress.svelte';
	import Checkbox from '../form/Checkbox.svelte';
	import Radio from '../form/Radio.svelte';
	import ListContextReset from './ListContextReset.svelte';

	const propId = $props.id();
	let {
		/** Whether this button/checkbox/radio should be disabled */
		disabled = false,

		/** The target of the link (only used if href is provided) */
		target = undefined as '_self' | '_blank' | '_parent' | '_top' | undefined,

		/** The link the user should be navigated to (uses an 'a' tag instead of the button) */
		href = undefined as string | undefined,

		/** Whether the list item is active (like when used as a button selection list) */
		active = false,

		/** The content to show in a dropdown menu when the button is clicked */
		menu = undefined as undefined | Snippet,

		/** Whether the dropdown menu should close when the user clicks a button like element inside of it */
		popover_close_on_inside_click = false,

		/** The placement of the popover (used when either "menu" or "dropdown" is provided) */
		popover_placement = 'bottom-end' as PopoverPlacement,

		/** The css style string added to the component from the parent */
		style = '',

		/** The ID of the select element. @defaults to a random ID */
		id = propId,

		/** Specifies a custom class name for the container element */
		class: class_name = '',

		/** The child elements to display inside the component */
		children = undefined as undefined | Snippet,

		/** Emits when the list item is selected/deselected */
		onchange = undefined as ((value: boolean) => void) | undefined,

		/**
		 * The function to call when the list item is clicked.
		 * If a promise is returned, it will show a loading icon while the promise resolves
		 * If the promise is not rejected, the loading icon will change to a checkmark icon
		 */
		onclick = undefined as
			| undefined
			| ((e: MouseEvent) => void)
			| ((e: MouseEvent) => Promise<void>),
	} = $props();

	let element = $state<HTMLElement | undefined>(undefined);
	let checked = $state(false);
	const context = getContext<ListContext | undefined>('list');

	$effect(() => {
		if (!context?.value) return;
		if (!element?.parentElement?.children) return;
		const index = Array.from(element.parentElement.children).indexOf(element);
		checked = context.value.includes(index);
	});

	let onclickLoading = $state(false);
	let onclickLoadingSuccess = $state(false);

	function loadingTransition(
		node: HTMLElement,
		params?: { direction?: 'in' | 'out' },
	): () => TransitionConfig {
		return () => {
			const style = getComputedStyle(node);
			const width = parseFloat(style.width);
			return {
				duration: params?.direction === 'out' ? 200 : 400,
				easing: params?.direction === 'out' ? quartOut : backOut,
				css: (t: number) => `width: ${t * width}px; opacity: ${t};`,
			};
		};
	}

	function handleClick(e: MouseEvent) {
		if (onclickLoading) return;
		if (onclick) {
			const maybePromise = onclick(e);
			if (maybePromise instanceof Promise) {
				onclickLoading = true;
				maybePromise
					.then(() => {
						onclickLoadingSuccess = true;
						setTimeout(() => {
							if (onclickLoading) return;
							onclickLoadingSuccess = false;
						}, 1000);
					})
					.catch(() => (onclickLoadingSuccess = false))
					.finally(() => (onclickLoading = false));
			}
		}
	}
</script>

{#if context}
	<li
		class={['list-item', context.type, class_name].filter(Boolean).join(' ')}
		class:disabled={context.disabled || disabled}
		class:is-loading={onclickLoading}
		class:dense={context.dense}
		class:comfortable={context.comfortable}
		{style}
		{id}
		bind:this={element}
		class:active={checked || active}
		style:--level={context.level}
		{@attach ripple({
			zIndex: 1,
			enabled:
				!context.disabled && !disabled && context.type !== 'text' && !onclickLoading,
		})}>
		{#if context.type === 'checkbox'}
			<label for="checkbox-{id}">
				{#if children}{@render children()}{/if}
				<div class="spacer"></div>
				<input
					type="checkbox"
					id="checkbox-{id}"
					name={id}
					disabled={context.disabled || disabled}
					{checked}
					onchange={() => onchange?.(checked)} />
				<!-- Presentational only: the hidden native input above owns
				     interaction, focus and a11y. `inert` keeps the Checkbox from
				     becoming a second focusable/clickable control. -->
				<span class="list-control" inert>
					<Checkbox
						{checked}
						disabled={context.disabled || disabled}
						size={context.dense ? '0' : '1'} />
				</span>
			</label>
		{:else if context.type === 'radio'}
			<label for="radio-{id}">
				{#if children}{@render children()}{/if}
				<div class="spacer"></div>
				<input
					type="radio"
					disabled={context.disabled || disabled}
					id="radio-{id}"
					name={context.id}
					onchange={() => onchange?.(checked)}
					{checked} />
				<span class="list-control" inert>
					<Radio
						{checked}
						disabled={context.disabled || disabled}
						size={context.dense ? '0' : '1'} />
				</span>
			</label>
		{:else if context.type === 'button'}
			{#if href}
				<a aria-disabled={context.disabled || disabled} {href} {target}>
					{#if children}{@render children()}{/if}
				</a>
			{:else}
				<button
					type="button"
					disabled={context.disabled || disabled}
					aria-busy={onclickLoading ? 'true' : null}
					onclick={handleClick}>
					{#if onclickLoading || onclickLoadingSuccess}
						<div
							class="loading-icon"
							in:loadingTransition={{ direction: 'in' }}
							out:loadingTransition={{ direction: 'out' }}>
							<Progress size="00" />
						</div>
					{/if}
					{#if children}{@render children()}{/if}
				</button>
			{/if}
		{:else if context.type === 'text'}
			<span class="text-content">
				{#if children}{@render children()}{/if}
			</span>
		{/if}
		{#if menu}
			<Button
				icon
				transparent
				size="0"
				class="action"
				{popover_close_on_inside_click}
				{popover_placement}
				menu={resetMenu}>
				<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path
						d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
				</svg>
			</Button>
		{/if}
	</li>
{/if}

{#snippet resetMenu()}
	<ListContextReset>
		{#if menu}{@render menu()}{/if}
	</ListContextReset>
{/snippet}

<style>
	li {
		min-height: 3rem;
		padding: 0;
		margin: 0;
		position: relative;
		overflow: hidden;
		list-style: none;
		display: flex;
		align-items: center;
		perspective: 100px;
		:global(> .ripple) {
			inset: 1px var(--border-inset) 1px
				calc(var(--border-inset) + ((var(--level) - 1) * 1rem)) !important;
			border-radius: calc(var(--radius-lg) - var(--border-inset)) !important;
		}
		&.active {
			a,
			button,
			label {
				&::before {
					opacity: 0.06;
					/* Snap the active highlight in instantly (so keyboard navigation —
					   e.g. arrowing an autocomplete list — feels immediate). The base
					   ::before rule still eases it out when the item is deselected. */
					transition:
						opacity 0ms ease,
						border-radius 150ms ease;
				}
			}
			.text-content::before {
				opacity: 0.06;
				transition:
					opacity 0ms ease,
					border-radius 150ms ease;
			}
		}
		&.disabled .text-content {
			color: var(--color-text-disabled);
		}
		&::after {
			content: '';
			position: absolute;
			top: 0px;
			right: 1rem;
			left: 1rem;
			border-top: solid 1px color-mix(in oklch, transparent, var(--color-text) 6%);
		}
		&:first-child {
			&::after {
				content: none;
			}
			&::before {
				top: var(--border-inset);
			}
			:global(> .ripple) {
				top: var(--border-inset) !important;
			}
			a,
			button,
			label {
				padding-top: calc(var(--border-inset, 0px) + 0.25rem);
				&::before,
				&::after {
					top: var(--border-inset);
				}
			}
		}
		&:last-child {
			&::before {
				bottom: var(--border-inset);
			}
			:global(> .ripple) {
				bottom: var(--border-inset) !important;
			}
			a,
			button,
			label {
				padding-bottom: calc(var(--border-inset, 0px) + 0.25rem);
				&::before,
				&::after {
					bottom: var(--border-inset);
				}
			}
		}
		&.dense {
			min-height: 2.5rem;
			a,
			button,
			label {
				padding-top: 0;
				padding-bottom: 0;
				padding-right: 1rem;
				padding-left: calc(1rem + ((var(--level) - 1) * 1rem));
			}
			&:first-child {
				a,
				button,
				label {
					padding-top: calc(var(--border-inset, 0px));
				}
			}
			&:last-child {
				a,
				button,
				label {
					padding-bottom: calc(var(--border-inset, 0px));
				}
			}
		}
		&.comfortable {
			min-height: 3.5rem;
			a,
			button,
			label {
				padding-top: 0.5rem;
				padding-bottom: 0.5rem;
				padding-left: calc(2rem + var(--list-pad-x, 0px));
				padding-right: calc(
					2rem + var(--list-pad-x, 0px) + ((var(--level) - 1) * 1.5rem)
				);
			}
			&:first-child {
				a,
				button,
				label {
					padding-top: calc(var(--border-inset, 0px) + 0.5rem);
				}
			}
			&:last-child {
				a,
				button,
				label {
					padding-bottom: calc(var(--border-inset, 0px) + 0.5rem);
				}
			}
		}
		&.disabled {
			cursor: not-allowed;
			a,
			button,
			label {
				cursor: not-allowed;
				color: var(--color-text-disabled);
			}
		}
		&.is-loading {
			/* Busy while the onclick promise resolves — the inner button stops
			   taking pointer events (see &[aria-busy] below), so set the row cursor
			   here so the whole row reads as not-interactive. */
			cursor: not-allowed;
		}
		&:not(.disabled) {
			a,
			button,
			label {
				&:hover:not(:disabled):not([aria-disabled='true']):not([aria-busy='true']) {
					&::before {
						opacity: 0.06;
						transition:
							opacity 0ms ease,
							border-radius 150ms ease;
					}
				}
			}
		}
	}
	/* --- Adjacent highlighted rows merge into one block --- */
	/* When two neighbouring rows are both "highlighted" — active, or hovered
	   while enabled and interactive — square off the corners where they meet so
	   the pair reads as one continuous selection instead of two rounded pills.
	   The border-radius transition on the highlight ::before animates it.

	   The sibling/:has parts are wrapped in :global() because ListItem renders a
	   single <li>; without it Svelte prunes these as "unused" (it can't see a
	   sibling .list-item in this component's own template). The `.text` guard
	   skips non-interactive text rows in the hover case (no highlight to merge). */
	:global(.list-item.active:has(+ .list-item.active))
		:is(a, button, label, .text-content)::before,
	:global(
			.list-item.active:has(+ .list-item:hover:not(.disabled):not(.text):not(.is-loading))
		)
		:is(a, button, label, .text-content)::before,
	:global(
			.list-item:hover:not(.disabled):not(.text):not(.is-loading):has(+ .list-item.active)
		)
		:is(a, button, label, .text-content)::before {
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
	}
	:global(.list-item.active + .list-item.active)
		:is(a, button, label, .text-content)::before,
	:global(.list-item:hover:not(.disabled):not(.text):not(.is-loading) + .list-item.active)
		:is(a, button, label, .text-content)::before,
	:global(.list-item.active + .list-item:hover:not(.disabled):not(.text):not(.is-loading))
		:is(a, button, label, .text-content)::before {
		border-top-left-radius: 0;
		border-top-right-radius: 0;
	}

	.spacer {
		flex: 1;
		min-width: 1.5rem;
	}
	/* The native inputs are visually hidden but remain the real, focusable
	 * controls (the <label> toggles them, List delegates off their change
	 * event). The adjacent <Checkbox>/<Radio> render the visual state. */
	input[type='radio'],
	input[type='checkbox'] {
		opacity: 0;
		position: absolute;
		width: 1px;
		height: 1px;
		margin: 0;
		pointer-events: none;
	}
	.list-control {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		pointer-events: none;
	}
	/* Keyboard focus ring, driven by the hidden native input's focus state */
	label:has(input:focus-visible) .list-control :global(.indicator-wrapper) {
		box-shadow: 0 0 0 2px var(--color-border-active);
		border-radius: 50%;
	}
	.text-content {
		position: relative;
		flex: 1;
		/* Match the row's full height so the active background fills it (see the
		 * align-self note on a/button/label). */
		align-self: stretch;
		padding-top: 0.25rem;
		padding-bottom: 0.25rem;
		padding-right: calc(1.5rem + var(--list-pad-x, 0px));
		padding-left: calc(1.5rem + var(--list-pad-x, 0px) + ((var(--level) - 1) * 1rem));
		display: flex;
		align-items: center;
		color: var(--color-text);
	}
	.text-content::before {
		content: '';
		opacity: 0;
		position: absolute;
		top: 1px;
		right: var(--border-inset);
		bottom: 1px;
		left: calc(var(--border-inset) + ((var(--level) - 1) * 1rem));
		border-radius: calc(var(--radius-lg) - var(--border-inset));
		background-color: var(--color-text);
		transition:
			opacity 300ms ease,
			border-radius 150ms ease;
		z-index: 0;
	}
	li.dense .text-content {
		padding-top: 0;
		padding-bottom: 0;
		padding-right: 1rem;
		padding-left: calc(1rem + ((var(--level) - 1) * 1rem));
	}
	li:first-child .text-content {
		padding-top: calc(var(--border-inset, 0px) + 0.25rem);
	}
	li:last-child .text-content {
		padding-bottom: calc(var(--border-inset, 0px) + 0.25rem);
	}

	a,
	button,
	label {
		flex: 1;
		padding-top: 0.25rem;
		padding-bottom: 0.25rem;
		padding-right: calc(1.5rem + var(--list-pad-x, 0px));
		padding-left: calc(1.5rem + var(--list-pad-x, 0px) + ((var(--level) - 1) * 1rem));
		margin: 0;
		border: none;
		/* Establish a containing block at rest so the ::before background is
		 * always positioned against this element. The :active press applies a
		 * translateZ, and a transformed element becomes the containing block for
		 * its absolutely-positioned descendants — without this, the ::before's
		 * containing block would switch from the <li> to here only while pressed,
		 * snapping its size on mousedown/up. Being relative up front keeps it
		 * stable, so the press just smoothly scales the background with the
		 * content via the list's `perspective`. */
		position: relative;
		display: flex;
		align-items: center;
		/* Fill the full list-item width so the hover/active background spans
		 * the row uniformly with the ripple — previously `max-content` made
		 * the hover-bg only as wide as the text, producing a tight inner
		 * highlight that fought the wider ripple on click. */
		width: 100%;
		/* Fill the row's full height. `height: 100%` can't be used here: the
		 * <li>'s height comes from `min-height` (e.g. dense mode), which is
		 * indefinite for percentage resolution, so the percentage collapses to
		 * the element's intrinsic height — shorter than the row whenever padding
		 * is small (dense). align-self stretches to the flex line's cross size,
		 * which does honour min-height, so the ::before background (and the press
		 * scale that rides on it) always matches the full row. */
		align-self: stretch;
		cursor: pointer;
		color: var(--color-text);
		background-color: transparent;
		text-decoration: none;
		box-shadow: none;
		transition: translate 200ms ease;

		&:active:not(:disabled):not([aria-disabled='true']):not([aria-busy='true']) {
			translate: 0px 1px clamp(-10px, calc(0.2em - 12px), -2px);
		}
		/* Busy while the onclick promise is in flight: block pointer interaction
		   so a re-click can't re-press (:active) — the ripple is gated by its
		   `enabled` flag, and hover by the :not([aria-busy]) guards above. */
		&[aria-busy='true'] {
			pointer-events: none;
		}
		&::before {
			content: '';
			opacity: 0;
			position: absolute;
			top: 1px;
			right: var(--border-inset);
			bottom: 1px;
			left: calc(var(--border-inset) + ((var(--level) - 1) * 1rem));
			border-radius: calc(var(--radius-lg) - var(--border-inset));
			background-color: var(--color-text);
			transition:
				opacity 300ms ease,
				border-radius 150ms ease;
		}
	}
	a[aria-disabled='true'] {
		color: var(--color-text-disabled);
		cursor: auto;
	}
	button,
	label {
		&:disabled {
			color: var(--color-text-disabled);
			cursor: auto;
		}
	}
	button {
		&:focus-visible {
			&::after {
				content: '';
				position: absolute;
				top: 1px;
				right: var(--border-inset);
				bottom: 1px;
				left: calc(var(--border-inset) + ((var(--level) - 1) * 1rem));
				border-radius: calc(var(--radius-lg) - var(--border-inset));
				border: solid 1px var(--color-border-active);
			}
		}
	}

	.loading-icon {
		position: relative;
		display: flex;
		justify-content: center;
		align-items: center;
		width: 1.5em;
		margin-left: -0.25em;
		margin-right: 0.5em;
		height: 100%;
		flex-shrink: 0;
		flex-grow: 0;
		:global(.logo) {
			display: block;
			width: 100%;
			height: auto;
			aspect-ratio: 1;
			flex-shrink: 0;
			flex-grow: 0;
		}
	}
</style>
