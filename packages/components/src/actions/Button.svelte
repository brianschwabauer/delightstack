<script lang="ts">
	import { ripple, tooltip } from '@delightstack/utilities';
	import { getContext, type Snippet } from 'svelte';
	import { type TransitionConfig } from 'svelte/transition';
	import { backOut, quartOut } from 'svelte/easing';
	import Popover from './Popover.svelte';
	import type { Placement, Strategy } from '@floating-ui/dom';
	import Progress from '../feedback/Progress.svelte';
	import type { ButtonGroupContext } from './ButtonGroup.svelte';

	const groupContext = getContext<ButtonGroupContext | undefined>('button-group');

	const propId = $props.id();
	let {
		/** The size of the button - referencing the font size options in css vars*/
		size = undefined as
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
			| '6',

		/** Whether the button is an icon button only */
		icon = false,

		/** Whether the button is a pill shape (rounded corners) */
		pill = false,

		/** Whether the button has a transparent background */
		transparent = false,

		/** Whether the button has a semi-transparent background (takes on some of the color of the text color) */
		translucent = false,

		/** Whether the button has an outline style (transparent background with border) */
		outline = false,

		/**
		 * Whether the button is part of a group of buttons.
		 * If so, the border radius will be removed on the sides that touch other buttons
		 * and the borders/margins will be merged
		 */
		grouped = false,

		/**
		 * Whether the will be styled to indicator an error (or danger).
		 * If 'transparent', this makes the text red instead of the background
		 * If not 'transparent', this makes the background red
		 */
		error = false,

		/**
		 * Whether the will be styled to indicator sucess
		 * If 'transparent', this makes the text green instead of the background
		 * If not 'transparent', this makes the background green
		 */
		success = false,

		/** Whether the button is an 'overlay' - blurs & darkens the background */
		overlay = false,

		/**
		 * Whether the background color should be the accent/primary/brand color.
		 * If 'transparent' is also true, this will change the color of the text instead
		 */
		accent = false,

		/** Whether the button should be smaller (with less padding) */
		dense = false,

		/** Whether the button should take up the full width of its container */
		fullWidth = false,

		/** Whether the button should take up the full height of its container */
		fullHeight = false,

		/** Whether there should not be a ripple animation on click */
		disableRipple = false,

		/** The url to link to (turns the button into an anchor tag) */
		href = undefined as string | undefined,

		/** The target of the link (only used if href is provided) */
		target = undefined as '_self' | '_blank' | '_parent' | '_top' | undefined,

		/** The tooltip message to show on hover */
		tooltip: tooltipMessage = '',

		/** Whether the button is disabled */
		disabled = false,

		/** Whether the button is in in the 'active' state (similar to how a toggle button would be 'selected') */
		active = false,

		/** Whether a loading icon should appear before the button text */
		loading = undefined as boolean | undefined,

		/** Whether a checkmark icon should appear before the button text */
		loadingSuccess = false,

		/**
		 * The text to show in a badge hovering over the top right corner of the button
		 * If "true", then a small dot will appear instead of a box with text
		 */
		badge = undefined as string | undefined | boolean,

		/** The content to show in a dropdown menu when the button is clicked */
		menu = undefined as undefined | Snippet<[{ close: () => void }]>,

		/** Whether the button should have a chevron icon next to it (useful when used with the 'menu' optionk) */
		showChevron = false,

		/** The content shown in a dropdown menu when the secondary dropdown button is clicked */
		dropdown = undefined as undefined | Snippet<[{ close: () => void }]>,

		/** The content shown when the button is in the loading state */
		loadingContent = undefined as undefined | Snippet<[{ close: () => void }]>,

		/** Whether the dropdown menu should be disabled (and the secondary downdown button hidden) */
		disableDropdown = false,

		/** Whether the dropdown menu should close when the user clicks a button like element inside of it */
		popoverCloseOnInsideClick = false,

		/** The placement of the popover (used when either "menu" or "dropdown" is provided) */
		popoverPlacement = 'bottom-end' as Placement,

		/** The placement of the popover (used when either "menu" or "dropdown" is provided) */
		popoverStrategy = 'fixed' as Strategy,

		/** Whether the intial focus should not be set automatically when opening the popover */
		popoverDisableInitialFocus = false,

		/** The content shown in the button element */
		children = undefined as
			| undefined
			| Snippet<[{ isLoading: boolean; isLoadingSuccess: boolean }]>,

		/** The ID of the element. @defaults to a random ID */
		id = propId,

		/** A reference to the button element */
		buttonElement = $bindable() as HTMLElement | undefined,

		/** Specifies a custom class name for the container element */
		class: className = '',

		/** The css style string added to the component from the parent */
		style = '',

		/**
		 * The function to call when the button is clicked.
		 * If a promise is returned, it will show a loading icon while the promise resolves
		 * If the promise is not rejected, the loading icon will change to a checkmark icon
		 */
		onclick = undefined as
			| undefined
			| ((e: MouseEvent) => void)
			| ((e: MouseEvent) => Promise<void>),

		...rest
	} = $props();

	// Merge ButtonGroup context with local props (local props take precedence when explicitly set)
	const resolvedSize = $derived(size ?? groupContext?.size);
	const resolvedOutline = $derived(outline || groupContext?.outline || false);
	const resolvedTransparent = $derived(transparent || groupContext?.transparent || false);
	const resolvedTranslucent = $derived(translucent || groupContext?.translucent || false);
	const resolvedAccent = $derived(accent || groupContext?.accent || false);
	const resolvedError = $derived(error || groupContext?.error || false);
	const resolvedSuccess = $derived(success || groupContext?.success || false);
	const resolvedDisabled = $derived(disabled || groupContext?.disabled || false);
	const resolvedGrouped = $derived(grouped || !!groupContext);

	let dropdownActive = $state(false);
	let dropdownTrigger = $state(undefined as undefined | HTMLElement);
	let menuActive = $state(false);
	let onclickLoading = $state(false);
	let onclickLoadingSuccess = $state(false);
	let mounted = $state(false);
	$effect(() => {
		mounted = true;
	});

	const isLoading = $derived(loading || onclickLoading);
	const isLoadingSuccess = $derived(loadingSuccess || onclickLoadingSuccess);

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

	function closeMenu() {
		if (menuActive) menuActive = false;
		if (dropdownActive) dropdownActive = false;
	}
</script>

<div
	{id}
	class={['button', className].filter(Boolean).join(' ')}
	class:has-dropdown-trigger={dropdown && !disableDropdown}
	class:icon
	class:pill
	class:dense
	class:grouped={resolvedGrouped}
	class:group-h={resolvedGrouped &&
		groupContext?.attached &&
		groupContext?.orientation === 'horizontal'}
	class:group-v={resolvedGrouped &&
		groupContext?.attached &&
		groupContext?.orientation === 'vertical'}
	class:full-width={fullWidth}
	class:full-height={fullHeight}
	class:overlay
	class:transparent={resolvedTransparent}
	class:translucent={resolvedTranslucent}
	class:outline={resolvedOutline}
	class:success={resolvedSuccess}
	class:accent={resolvedAccent}
	class:active
	class:error={resolvedError}
	class:is-loading={isLoading}
	class:loading={icon && isLoading}
	{style}
	style:font-size={resolvedSize === undefined ? null : `var(--font-size-${resolvedSize})`}
	{@attach tooltip(tooltipMessage)}>
	{#if badge}
		<div class="badge" class:dot={badge === true}>
			{#if badge !== true}{badge}{/if}
		</div>
	{/if}
	<svelte:element
		this={href ? 'a' : 'button'}
		type={href ? null : 'button'}
		role="button"
		tabindex={resolvedDisabled || isLoading || (!mounted && !href) ? -1 : 0}
		{...rest}
		{target}
		{href}
		data-sveltekit-noscroll={href?.startsWith('?') ? true : null}
		data-sveltekit-keepfocus={href?.startsWith('?') ? true : null}
		{@attach ripple({
			enabled: !disableRipple && !resolvedDisabled && !isLoading,
			zIndex: 1,
		})}
		disabled={resolvedDisabled || onclickLoading || (!mounted && !href)}
		aria-haspopup={!!menu}
		aria-expanded={menu ? menuActive : null}
		bind:this={buttonElement}
		onclick={handleClick}>
		{#if !icon}
			{#if isLoading || isLoadingSuccess}
				<div
					class="loading-icon"
					in:loadingTransition={{ direction: 'in' }}
					out:loadingTransition={{ direction: 'out' }}>
					<Progress size="00" color="currentColor" />
				</div>
			{/if}
		{/if}
		{#if children}{@render children({ isLoading, isLoadingSuccess })}{/if}
		{#if showChevron && menu}
			<svg
				viewBox="0 0 24 24"
				fill="currentColor"
				style="pointer-events:none;"
				class="chevron {menuActive ? 'active' : ''}"
				aria-hidden="true">
				<path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
			</svg>
		{/if}
	</svelte:element>
	{#if dropdown && !disableDropdown}
		<button
			class="dropdown-trigger"
			type="button"
			aria-haspopup="true"
			aria-expanded={dropdownActive}
			aria-label="Toggle dropdown"
			title="Open for more actions"
			{@attach ripple({
				enabled: !disableRipple && !resolvedDisabled && !isLoading,
				zIndex: 1,
			})}
			bind:this={dropdownTrigger}>
			<svg
				viewBox="0 0 24 24"
				fill="currentColor"
				style="pointer-events:none"
				class="chevron {dropdownActive ? 'active' : ''}"
				aria-hidden="true">
				<path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
			</svg>
		</button>
	{/if}
</div>
{#if menu}
	<Popover
		refElement={menuTrigger}
		bind:opened={menuActive}
		openOnClick
		arrow={false}
		strategy={popoverStrategy}
		closeOnInsideClick={popoverCloseOnInsideClick}
		disableInitialFocus={popoverDisableInitialFocus}
		placement={popoverPlacement}>
		{@render menu({ close: closeMenu })}
	</Popover>
{/if}
{#if dropdown && !disableDropdown}
	<Popover
		refElement={dropdownTrigger}
		bind:opened={dropdownActive}
		openOnClick
		arrow={false}
		strategy={popoverStrategy}
		closeOnInsideClick={popoverCloseOnInsideClick}
		disableInitialFocus={popoverDisableInitialFocus}
		placement={popoverPlacement}>
		{@render dropdown({ close: closeMenu })}
	</Popover>
{/if}

<style>
	.button {
		--radius: var(--action-radius, var(--radius-3));
		--easing: var(--ease-out-back);
		display: inline-flex;
		justify-content: center;
		position: relative;
		width: fit-content;
		border-radius: var(--radius);

		&.pill {
			--radius: var(--radius-round);
		}

		&:not(.transparent):not(.translucent) {
			--color-bg: var(--color-action);
			--color-bg-disabled: var(--color-action-disabled);
			--color-bg-active: var(--color-action-active);
			--color-text: var(--color-action-text);
			--color-text-disabled: var(--color-action-text-disabled);
			--color-text-active: var(--color-action-text-active);
			--color-outline: var(--color-action-outline);
			--color-outline-disabled: var(--color-action-outline-disabled);
			--color-outline-active: var(--color-action-outline-active);
		}
		&.accent:not(.transparent):not(.translucent) {
			--color-bg: var(--color-accent);
			--color-bg-disabled: var(--color-accent-disabled);
			--color-bg-active: var(--color-accent-active);
			--color-text: var(--color-accent-text);
			--color-text-active: var(--color-accent-text-active);
			--color-text-disabled: var(--color-accent-text-disabled);
		}
		&.error:not(.transparent):not(.translucent) {
			--color-bg: var(--color-error);
			--color-bg-disabled: var(--color-error-disabled);
			--color-bg-active: var(--color-error-active);
			--color-text: var(--color-error-text);
			--color-text-active: var(--color-error-text-active);
			--color-text-disabled: var(--color-error-text-disabled);
		}
		&.success:not(.transparent):not(.translucent) {
			--color-bg: var(--color-success);
			--color-bg-disabled: var(--color-success-disabled);
			--color-bg-active: var(--color-success-active);
			--color-text: var(--color-success-text);
			--color-text-active: var(--color-success-text-active);
			--color-text-disabled: var(--color-success-text-disabled);
		}

		&.outline:not(.transparent):not(.translucent) {
			--color-bg: transparent;
			--color-bg-disabled: transparent;
			--color-bg-active: rgb(from var(--color-action) r g b / 0.08);
			--color-text: var(--color-action);
			--color-text-disabled: var(--color-action-disabled);
			--color-text-active: var(--color-action-active);
			--color-action-outline: 1px solid currentColor;
			--color-action-outline-disabled: 1px solid currentColor;
			--color-action-outline-active: 1px solid currentColor;

			&.accent {
				--color-bg-active: rgb(from var(--color-accent) r g b / 0.08);
				--color-text: var(--color-accent);
				--color-text-disabled: var(--color-accent-disabled);
				--color-text-active: var(--color-accent-active);
			}
			&.error {
				--color-bg-active: rgb(from var(--color-error) r g b / 0.08);
				--color-text: var(--color-error);
				--color-text-disabled: var(--color-error-disabled);
				--color-text-active: var(--color-error-active);
			}
			&.success {
				--color-bg-active: rgb(from var(--color-success) r g b / 0.08);
				--color-text: var(--color-success);
				--color-text-disabled: var(--color-success-disabled);
				--color-text-active: var(--color-success-active);
			}
		}

		&.transparent {
			--color-bg: transparent;
			--color-bg-disabled: transparent;
			--color-bg-active: rgb(from var(--color-text) r g b / 0.06);
		}
		&.translucent {
			backdrop-filter: blur(10px);
			--color-bg: rgb(from var(--color-text) r g b / 0.06);
			--color-bg-disabled: transparent;
			--color-bg-active: rgb(from var(--color-text) r g b / 0.12);
			--color-action-outline: none;
			--color-action-outline-disabled: none;
			--color-action-outline-active: none;
		}
		&.transparent,
		&.translucent {
			&.accent {
				--color-text: var(--color-accent);
				--color-text-disabled: var(--color-accent-disabled);
				--color-text-active: var(--color-accent-active);
			}
			&.error {
				--color-text: var(--color-error);
				--color-text-disabled: var(--color-error-disabled);
				--color-text-active: var(--color-error-active);
			}
			&.success {
				--color-text: var(--color-success);
				--color-text-disabled: var(--color-success-disabled);
				--color-text-active: var(--color-success-active);
			}
		}
		&.is-loading {
			cursor: not-allowed;
			a,
			button {
				pointer-events: none;
			}
		}
		&.loading {
			--loading-size: 3em;
			&.dense {
				--loading-size: 3.5em;
			}
		}
		&.active {
			--color-bg: var(--color-bg-active) !important;
			--color-text: var(--color-text-active) !important;
		}
		&.full-width {
			width: 100%;
			a,
			button:not(.dropdown-trigger) {
				width: 100%;
			}
		}
		&.full-height {
			height: 100%;
			a,
			button {
				height: 100%;
			}
		}

		.badge {
			position: absolute;
			top: 0;
			right: 0;
			display: flex;
			align-items: center;
			justify-content: center;
			background-color: var(--color-accent, var(--color-text));
			color: var(--color-accent-text, var(--color-bg));
			border-radius: var(--radius-round);
			font-size: 0.85em;
			line-height: 0.85em;
			padding: 0.1em 0.5em;
			min-width: 1.5em;
			min-height: 1.5em;
			pointer-events: none;
			z-index: 1;
			&.dot {
				width: 0.75rem;
				height: 0.75rem;
				min-width: 0.75rem;
				min-height: 0.75rem;
				padding: 0;
			}
		}
		&.transparent,
		&.translucent {
			.badge {
				background-color: var(--color-accent);
				color: var(--color-accent-text);
			}
		}
		&.icon {
			.badge {
				top: -0.5em;
				right: -0.5em;
				&.dot {
					top: 0;
					right: 0;
				}
			}
			&.transparent,
			&.translucent {
				.badge {
					top: 0.5em;
					right: 0.5em;

					&.dot {
						top: 0.75em;
						right: 0.75em;
					}
				}
			}
		}

		/* Badge cutout: mask the inner button so the badge sits in a clean gap */
		&:not(.icon):has(> .badge:not(.dot)) {
			button,
			a {
				mask-image: radial-gradient(
					circle at calc(100% - 0.65em) 0.65em,
					transparent calc(0.65em + 3px),
					black calc(0.65em + 5px)
				);
			}
		}
		&:not(.icon):has(> .badge.dot) {
			button,
			a {
				mask-image: radial-gradient(
					circle at calc(100% - 0.375rem) 0.375rem,
					transparent calc(0.375rem + 3px),
					black calc(0.375rem + 5px)
				);
			}
		}
		/* Icon button badge cutouts */
		&.icon:has(> .badge:not(.dot)) {
			button,
			a {
				mask-image: radial-gradient(
					circle at calc(100% - 0.15em) 0.15em,
					transparent calc(0.85em + 3px),
					black calc(0.85em + 5px)
				);
			}
		}
		&.icon:has(> .badge.dot) {
			button,
			a {
				mask-image: radial-gradient(
					circle at calc(100% - 0.375rem) 0.375rem,
					transparent calc(0.375rem + 3px),
					black calc(0.375rem + 5px)
				);
			}
		}
		&.icon.transparent:has(> .badge:not(.dot)),
		&.icon.translucent:has(> .badge:not(.dot)) {
			button,
			a {
				mask-image: radial-gradient(
					circle at calc(100% - 1.15em) 1.15em,
					transparent calc(0.65em + 3px),
					black calc(0.65em + 5px)
				);
			}
		}
		&.icon.transparent:has(> .badge.dot),
		&.icon.translucent:has(> .badge.dot) {
			button,
			a {
				mask-image: radial-gradient(
					circle at calc(100% - 0.75em - 0.375rem) calc(0.75em + 0.375rem),
					transparent calc(0.375rem + 3px),
					black calc(0.375rem + 5px)
				);
			}
		}

		button,
		a {
			display: flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;
			position: relative;
			overflow: hidden;
			outline: none;
			border: var(--color-action-outline);
			text-align: center;
			width: fit-content;
			border-radius: var(--radius);
			background-color: var(--color-bg);
			color: var(--color-text);
			cursor: pointer;
			padding: 0.75em 1.5em;
			transition:
				background-color 100ms,
				color 100ms,
				box-shadow 200ms ease;
			box-shadow: inset 0px 0px 0px 0px var(--color-text);
			gap: 0.5em;

			&:focus-visible:not(:disabled):not([aria-disabled='true']) {
				box-shadow: inset 0px 0px 0px 2px var(--color-text);
				outline: solid 2px var(--color-bg);
			}
			&:disabled,
			&[aria-disabled='true'] {
				background-color: var(--color-bg-disabled);
				color: var(--color-text-disabled);
				cursor: not-allowed;
				border: var(--color-action-outline-disabled);
			}
			&:hover:not(:disabled):not([aria-disabled='true']) {
				background-color: var(--color-bg-active);
				color: var(--color-text-active);
				border: var(--color-action-outline-active);
			}
		}

		.loading-icon {
			position: relative;
			display: flex;
			justify-content: center;
			align-items: center;
			width: 1.5em;
			margin-left: -0.5em;
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
			:global(circle.track) {
				stroke: rgb(from currentColor r g b / 0.2);
			}
		}

		:global(.chevron) {
			display: flex;
			align-items: center;
			justify-content: center;
			pointer-events: none;
			transform: rotate(0);
			transition: transform 300ms var(--easing);
		}
		:global(.chevron.active) {
			transform: rotate(-180deg);
		}

		&.has-dropdown-trigger {
			> button:not(.dropdown-trigger),
			> a {
				border-top-right-radius: 0;
				border-bottom-right-radius: 0;
				padding-right: 0.75em;
			}
			> button,
			> a {
				&:first-child {
					border-right: none !important;
				}
				&:last-child {
					border-left: none !important;
				}
			}
		}
		.dropdown-trigger {
			border-top-left-radius: 0;
			border-bottom-left-radius: 0;
			border-top-right-radius: var(--radius);
			border-bottom-right-radius: var(--radius);
			display: flex;
			align-items: center;
			padding: 0 0.5em 0 0.5em;
			&::before {
				content: '';
				height: 1em;
				margin: 0 -0.25em 0 -0.5em;
				padding: 0;
				background-color: var(--color-text);
				width: 1px;
				opacity: 0.2;
			}
			:global(svg) {
				width: 1.5em;
				height: 1.5em;
			}
		}

		&.dense {
			button:not(.dropdown-trigger),
			a {
				line-height: 0.85em;
				padding: 0.35em 0.75em;
				gap: 0.25em;
			}
			&.has-dropdown-trigger {
				> button:not(.dropdown-trigger),
				> a {
					padding: 0.35em 0.75em 0.35em 1em;
				}
			}
			.download-trigger {
				padding: 0 0.25em 0 0.25em;
			}
			:global(.chevron) {
				margin: 0 -0.2em;
			}
		}

		&.icon {
			height: 4em;
			width: 4em;
			aspect-ratio: 1 / 1;
			&.dense {
				button,
				a {
					padding: 0;
					:global(> svg),
					:global(> img) {
						width: 60%;
						height: 60%;
					}
				}
			}
			button,
			a {
				align-items: center;
				justify-content: center;
				border-radius: var(--radius-round);
				aspect-ratio: 1 / 1;
				padding: 0;
				width: 100%;
				height: 100%;
				:global(svg) {
					width: 50%;
					height: 50%;
				}
			}
		}
		/* Grouped attached: border-radius adjustments and border merging */
		&.group-h,
		&.group-v {
			&:hover,
			&:focus-within {
				z-index: 1;
			}
		}
		&.group-h {
			&:not(:first-child):not(:last-child) {
				border-radius: 0;
				button,
				a {
					border-radius: 0;
				}
			}
			&:first-child:not(:last-child) {
				border-top-right-radius: 0;
				border-bottom-right-radius: 0;
				button,
				a {
					border-top-right-radius: 0;
					border-bottom-right-radius: 0;
				}
			}
			&:last-child:not(:first-child) {
				border-top-left-radius: 0;
				border-bottom-left-radius: 0;
				button,
				a {
					border-top-left-radius: 0;
					border-bottom-left-radius: 0;
				}
			}
			/* Remove right border on non-last so outline buttons share a single border */
			&:not(:last-child) {
				button,
				a {
					border-right: none;
				}
			}
			& + :global(.button) {
				margin-left: -1px;
			}
		}
		&.group-v {
			width: auto;
			button,
			a {
				width: 100%;
			}
			&:not(:first-child):not(:last-child) {
				border-radius: 0;
				button,
				a {
					border-radius: 0;
				}
			}
			&:first-child:not(:last-child) {
				border-bottom-left-radius: 0;
				border-bottom-right-radius: 0;
				button,
				a {
					border-bottom-left-radius: 0;
					border-bottom-right-radius: 0;
				}
			}
			&:last-child:not(:first-child) {
				border-top-left-radius: 0;
				border-top-right-radius: 0;
				button,
				a {
					border-top-left-radius: 0;
					border-top-right-radius: 0;
				}
			}
			/* Remove bottom border on non-last so outline buttons share a single border */
			&:not(:last-child) {
				button,
				a {
					border-bottom: none;
				}
			}
			& + :global(.button) {
				margin-top: -1px;
			}
		}

		&.overlay {
			--color-action-outline: none;
			--color-action-outline-disabled: none;
			--color-action-outline-active: none;
			&.active {
				button,
				a {
					color: rgba(255, 255, 255, 1);
					background-color: rgba(0, 0, 0, 0.9);
					@supports (backdrop-filter: blur(10px)) {
						background-color: rgba(0, 0, 0, 0.8);
					}
				}
			}
			button,
			a {
				color: rgba(255, 255, 255, 0.85);
				backdrop-filter: blur(10px);
				background-color: rgba(0, 0, 0, 0.85);
				@supports (backdrop-filter: blur(10px)) {
					background-color: rgba(0, 0, 0, 0.65);
				}
				&:disabled,
				&[aria-disabled='true'] {
					color: rgba(255, 255, 255, 0.65);
				}
				&:focus-visible:not(:disabled):not([aria-disabled='true']) {
					box-shadow: none;
					outline: solid 2px white;
					outline-offset: 1px;
				}
				&:hover:not(:disabled):not([aria-disabled='true']),
				&:focus-visible:not(:disabled):not([aria-disabled='true']) {
					color: rgba(255, 255, 255, 1);
					background-color: rgba(0, 0, 0, 0.9);
					@supports (backdrop-filter: blur(10px)) {
						background-color: rgba(0, 0, 0, 0.75);
					}
				}
				&::before {
					background-color: rgba(0, 0, 0, 1);
				}
			}
		}
	}
</style>
