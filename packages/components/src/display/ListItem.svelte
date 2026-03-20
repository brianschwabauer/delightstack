<script lang="ts">
	import { ripple } from '@delightstack/utilities';
	import { getContext, type Snippet } from 'svelte';
	import { type ListContext } from './List.svelte';
	import type { TransitionConfig } from 'svelte/transition';
	import { backOut, quartOut } from 'svelte/easing';
	import type { PopoverPlacement } from './../actions/Popover.svelte';
	import Button from './../actions/Button.svelte';
	import Progress from '../feedback/Progress.svelte';

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
		popoverCloseOnInsideClick = false,

		/** The placement of the popover (used when either "menu" or "dropdown" is provided) */
		popoverPlacement = 'bottom-end' as PopoverPlacement,

		/** The css style string added to the component from the parent */
		style = '',

		/** The ID of the select element. @defaults to a random ID */
		id = propId,

		/** Specifies a custom class name for the container element */
		class: className = '',

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
		class={['list-item', context.type, className].filter(Boolean).join(' ')}
		class:disabled={context.disabled || disabled}
		class:dense={context.dense}
		class:comfortable={context.comfortable}
		{style}
		{id}
		bind:this={element}
		class:active={checked || active}
		style:--level={context.level}
		{@attach ripple({
			zIndex: 1,
			enabled: !context.disabled && !disabled && context.type !== 'text',
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
				<div class="checkbox"></div>
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
				<div class="radio"></div>
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
			{#if children}{@render children()}{/if}
		{/if}
		{#if menu}
			<Button
				icon
				transparent
				size="0"
				class="action"
				{popoverCloseOnInsideClick}
				{popoverPlacement}
				{menu}>
				<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path
						d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
				</svg>
			</Button>
		{/if}
	</li>
{/if}

<style>
	li {
		--radio-size: 1.25em;
		--checkbox-size: 1.15em;
		min-height: 3.5rem;
		padding: 0;
		margin: 0;
		position: relative;
		overflow: hidden;
		list-style: none;
		display: flex;
		align-items: center;
		:global(> .ripple) {
			inset: 1px var(--border-inset) 1px
				calc(var(--border-inset) + ((var(--level) - 1) * 1rem)) !important;
			border-radius: calc(var(--radius) - var(--border-inset)) !important;
		}
		&.active {
			a,
			button,
			label {
				&::before {
					opacity: 0.06;
				}
			}
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
				padding-top: calc(var(--border-inset, 0px) + 1rem);
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
				padding-bottom: calc(var(--border-inset, 0px) + 1rem);
				&::before,
				&::after {
					bottom: var(--border-inset);
				}
			}
		}
		&.dense {
			min-height: 3rem;
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
			min-height: 4rem;
			a,
			button,
			label {
				padding-top: 1.5rem;
				padding-bottom: 1.5rem;
				padding-left: calc(2rem + var(--list-pad-x, 0px));
				padding-right: calc(
					2rem + var(--list-pad-x, 0px) + ((var(--level) - 1) * 1.5rem)
				);
			}
			&:first-child {
				a,
				button,
				label {
					padding-top: calc(var(--border-inset, 0px) + 1.5rem);
				}
			}
			&:last-child {
				a,
				button,
				label {
					padding-bottom: calc(var(--border-inset, 0px) + 1.5rem);
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
		&:not(.disabled) {
			a,
			button,
			label {
				&:hover:not(:disabled):not([aria-disabled='true']) {
					&::before {
						opacity: 0.06;
						transition: opacity 0ms ease;
					}
				}
			}
		}
	}
	.spacer {
		flex: 1;
	}
	input[type='radio'],
	input[type='checkbox'] {
		margin: 0 1.5rem;
		transform: scale(1.25);
	}
	li.dense input[type='radio'],
	li.dense input[type='checkbox'] {
		margin: 0 1rem;
	}
	a,
	button,
	label {
		flex: 1;
		padding-top: 1rem;
		padding-bottom: 1rem;
		padding-right: calc(1.5rem + var(--list-pad-x, 0px));
		padding-left: calc(1.5rem + var(--list-pad-x, 0px) + ((var(--level) - 1) * 1rem));
		margin: 0;
		border: none;
		display: flex;
		align-items: center;
		width: max-content;
		height: 100%;
		cursor: pointer;
		color: var(--color-text);
		background-color: transparent;
		text-decoration: none;
		box-shadow: none;
		&::before {
			content: '';
			opacity: 0;
			position: absolute;
			top: 1px;
			right: var(--border-inset);
			bottom: 1px;
			left: calc(var(--border-inset) + ((var(--level) - 1) * 1rem));
			border-radius: calc(var(--radius) - var(--border-inset));
			background-color: var(--color-text);
			transition: opacity 300ms ease;
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
				border-radius: calc(var(--radius) - var(--border-inset));
				border: solid 1px var(--color-outline-active);
			}
		}
	}

	.loading-icon {
		position: relative;
		display: flex;
		justify-content: center;
		align-items: center;
		width: 1.5em;
		margin-left: -0.5em;
		margin-right: 1em;
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

	input[type='radio'] {
		opacity: 0;
		position: absolute;
		& + .radio {
			position: relative;
			width: var(--radio-size);
			height: var(--radio-size);
			border-radius: 100%;
			background-color: var(--color-bg-active);
			border: solid 1px var(--color-outline-active);
		}
		&:focus-visible + .radio {
			outline: solid 2px var(--color-outline-active);
			outline-offset: 6px;
		}
		&:checked + .radio {
			background-color: var(--color-bg-active);
			&::before {
				content: '';
				position: absolute;
				top: calc((var(--radio-size) / 4) - 1px);
				left: calc((var(--radio-size) / 4) - 1px);
				width: calc(var(--radio-size) / 2);
				height: calc(var(--radio-size) / 2);
				border-radius: 100%;
				background-color: var(--color-action-active);
			}
		}
	}

	input[type='checkbox'] {
		opacity: 0;
		position: absolute;
		& + .checkbox {
			position: relative;
			width: var(--checkbox-size);
			height: var(--checkbox-size);
			border-radius: 30%;
			background-color: var(--color-bg-active);
			border: solid 1px var(--color-outline-active);
		}
		&:focus-visible + .checkbox {
			outline: solid 2px var(--color-outline-active);
			outline-offset: 6px;
		}
		&:checked + .checkbox {
			background-color: var(--color-bg-active);
			border: solid 1px var(--color-action-active);
			&::before {
				content: '';
				position: absolute;
				top: 0px;
				left: 0px;
				width: 100%;
				height: 100%;
				border-radius: 30%;
				overflow: hidden;
				background-color: var(--color-action-active);
			}
			&::after {
				content: '';
				display: block;
				position: absolute;
				top: -1px;
				left: 5px;
				width: 8px;
				height: 15px;
				border: solid var(--color-action-text-active);
				border-width: 0 3px 3px 0;
				transform: rotate(45deg);
			}
		}
	}
</style>
