<script lang="ts">
	import { ripple, tooltip } from '@delightstack/utilities';
	import { type Snippet } from 'svelte';
	import { type TransitionConfig } from 'svelte/transition';
	import { backOut, quartOut } from 'svelte/easing';
	import Popover from './Popover.svelte';
	import ChevronDown from '~icons/mdi/chevron-down';
	import type { Placement, Strategy } from '@floating-ui/dom';

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
			| ((e: MouseEvent) => Promise<any>),

		...rest
	} = $props();

	let dropdownActive = $state(false);
	let dropdownTrigger = $state(undefined as undefined | HTMLElement);
	let menuActive = $state(false);
	let menuTrigger = $state(undefined as undefined | HTMLElement);
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
	class:round
	class:dense
	class:full-width={fullWidth}
	class:full-height={fullHeight}
	class:overlay
	class:transparent
	class:translucent
	class:success
	class:accent
	class:active
	class:error
	class:is-loading={isLoading}
	class:loading={icon && isLoading}
	{style}
	style:font-size={size === undefined ? null : `var(--font-size-${size})`}
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
		tabindex={disabled || isLoading || (!mounted && !href) ? -1 : 0}
		{...rest}
		{target}
		{href}
		data-sveltekit-noscroll={href?.startsWith('?') ? true : null}
		data-sveltekit-keepfocus={href?.startsWith('?') ? true : null}
		{@attach ripple({ enabled: !disableRipple && !disabled && !isLoading, zIndex: 1 })}
		disabled={disabled || onclickLoading || (!mounted && !href)}
		aria-haspopup={!!menu}
		aria-expanded={menu ? menuActive : null}
		bind:this={menuTrigger}
		onclick={handleClick}>
		{#if !icon}
			{#if isLoading || isLoadingSuccess}
				<div
					class="loading-icon"
					in:loadingTransition={{ direction: 'in' }}
					out:loadingTransition={{ direction: 'out' }}>
					Loading...
					<!-- <Logo
						loading={isLoading}
						success={isLoadingSuccess}
						brandmark
						color="currentColor" /> -->
				</div>
			{/if}
		{/if}
		{#if children}{@render children({ isLoading, isLoadingSuccess })}{/if}
		{#if showChevron && menu}
			<ChevronDown
				style="pointer-events:none;"
				class="chevron {menuActive ? 'active' : ''}" />
		{/if}
	</svelte:element>
	{#if dropdown && !disableDropdown}
		<button
			class="dropdown-trigger"
			type="button"
			aria-haspopup="true"
			aria-expanded={dropdownActive}
			title="Open for more actions"
			{@attach ripple({
				enabled: ripple && !disabled && !isLoading,
				zIndex: 1,
			})}
			bind:this={dropdownTrigger}>
			<ChevronDown
				style="pointer-events:none"
				class="chevron {menuActive ? 'active' : ''}" />
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

<style lang="scss">
	.button {
		--radius: var(--action-radius, var(--radius-3));
		--easing: var(--ease-out-back);
		display: inline-flex;
		justify-content: center;
		position: relative;
		width: fit-content;
		border-radius: var(--radius);

		&.round {
			--radius: var(--radius-round);
		}

		&:not(.transparent):not(.translucent) {
			--c-bg: var(--c-action);
			--c-bg-disabled: var(--c-action-disabled);
			--c-bg-active: var(--c-action-active);
			--c-text: var(--c-action-text);
			--c-text-disabled: var(--c-action-text-disabled);
			--c-text-active: var(--c-action-text-active);
			--c-outline: var(--c-action-outline);
			--c-outline-disabled: var(--c-action-outline-disabled);
			--c-outline-active: var(--c-action-outline-active);
		}
		&.accent:not(.transparent):not(.translucent) {
			--c-bg: var(--c-accent);
			--c-bg-disabled: var(--c-accent-disabled);
			--c-bg-active: var(--c-accent-active);
			--c-text: var(--c-accent-text);
			--c-text-active: var(--c-accent-text-active);
			--c-text-disabled: var(--c-accent-text-disabled);
		}
		&.error:not(.transparent):not(.translucent) {
			--c-bg: var(--c-error);
			--c-bg-disabled: var(--c-error-disabled);
			--c-bg-active: var(--c-error-active);
			--c-text: var(--c-error-text);
			--c-text-active: var(--c-error-text-active);
			--c-text-disabled: var(--c-error-text-disabled);
		}
		&.success:not(.transparent):not(.translucent) {
			--c-bg: var(--c-success);
			--c-bg-disabled: var(--c-success-disabled);
			--c-bg-active: var(--c-success-active);
			--c-text: var(--c-success-text);
			--c-text-active: var(--c-success-text-active);
			--c-text-disabled: var(--c-success-text-disabled);
		}

		&.transparent {
			--c-bg: transparent;
			--c-bg-disabled: transparent;
			--c-bg-active: rgb(from var(--c-text) r g b / 0.06);
		}
		&.translucent {
			backdrop-filter: blur(10px);
			--c-bg: rgb(from var(--c-text) r g b / 0.06);
			--c-bg-disabled: transparent;
			--c-bg-active: rgb(from var(--c-text) r g b / 0.12);
			--c-action-outline: none;
			--c-action-outline-disabled: none;
			--c-action-outline-active: none;
		}
		&.transparent,
		&.translucent {
			&.accent {
				--c-text: var(--c-accent);
				--c-text-disabled: var(--c-accent-disabled);
				--c-text-active: var(--c-accent-active);
			}
			&.error {
				--c-text: var(--c-error);
				--c-text-disabled: var(--c-error-disabled);
				--c-text-active: var(--c-error-active);
			}
			&.success {
				--c-text: var(--c-success);
				--c-text-disabled: var(--c-success-disabled);
				--c-text-active: var(--c-success-active);
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
			--c-bg: var(--c-bg-active) !important;
			--c-text: var(--c-text-active) !important;
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
			background-color: var(--c-accent, var(--c-text));
			color: var(--c-accent-text, var(--c-bg));
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
				background-color: var(--c-accent);
				color: var(--c-accent-text);
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

		button,
		a {
			display: flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;
			position: relative;
			overflow: hidden;
			outline: none;
			border: var(--c-action-outline);
			text-align: center;
			width: fit-content;
			border-radius: var(--radius);
			background-color: var(--c-bg);
			color: var(--c-text);
			cursor: pointer;
			padding: 0.75em 1.5em;
			transition:
				background-color 100ms,
				color 100ms,
				box-shadow 200ms ease;
			box-shadow: inset 0px 0px 0px 0px var(--c-text);
			gap: 0.5em;

			&:focus-visible:not(:disabled):not([aria-disabled='true']) {
				box-shadow: inset 0px 0px 0px 2px var(--c-text);
				outline: solid 2px var(--c-bg);
			}
			&:disabled,
			&[aria-disabled='true'] {
				background-color: var(--c-bg-disabled);
				color: var(--c-text-disabled);
				cursor: not-allowed;
				border: var(--c-action-outline-disabled);
			}
			&:hover:not(:disabled):not([aria-disabled='true']) {
				background-color: var(--c-bg-active);
				color: var(--c-text-active);
				border: var(--c-action-outline-active);
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
				background-color: var(--c-text);
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
		&.overlay {
			--c-action-outline: none;
			--c-action-outline-disabled: none;
			--c-action-outline-active: none;
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
