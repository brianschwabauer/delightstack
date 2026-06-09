<script lang="ts">
	import { ripple, tooltip } from '@delightstack/utilities';
	import { getContext, type Snippet } from 'svelte';
	import { type TransitionConfig } from 'svelte/transition';
	import { backOut, quartOut } from 'svelte/easing';
	import Popover, { type PopoverPlacement, type PopoverStrategy } from './Popover.svelte';
	import Progress from '../feedback/Progress.svelte';
	import type { ButtonGroupContext } from './ButtonGroup.svelte';

	const groupContext = getContext<ButtonGroupContext | undefined>('button-group');

	// When a Button with `type="submit"` lives inside a <Form>, auto-wire its
	// loading and disabled state to the form's submission lifecycle. Callers
	// can still override by passing explicit `loading` or `disabled`.
	type _FormSubmitContext = { is_submitting: boolean; disabled: boolean };
	const formContext = getContext<_FormSubmitContext | undefined>('form');

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
		full_width = false,

		/** Whether the button should take up the full height of its container */
		full_height = false,

		/** Whether there should not be a ripple animation on click */
		disable_ripple = false,

		/** The url to link to (turns the button into an anchor tag) */
		href = undefined as string | undefined,

		/** The target of the link (only used if href is provided) */
		target = undefined as '_self' | '_blank' | '_parent' | '_top' | undefined,

		/** The button type (ignored when `href` is set). @default 'button' */
		type = 'button' as 'button' | 'submit' | 'reset',

		/** The tooltip message to show on hover */
		tooltip: tooltip_message = '',

		/** Whether the button is disabled */
		disabled = false,

		/** Whether the button is in in the 'active' state (similar to how a toggle button would be 'selected') */
		active = false,

		/** Whether a loading icon should appear before the button text */
		loading = undefined as boolean | undefined,

		/** Whether a checkmark icon should appear before the button text */
		loading_success = false,

		/**
		 * The text to show in a badge hovering over the top right corner of the button
		 * If "true", then a small dot will appear instead of a box with text
		 */
		badge = undefined as string | undefined | boolean,

		/** The content to show in a dropdown menu when the button is clicked */
		menu = undefined as undefined | Snippet<[{ close: () => void }]>,

		/** Whether the button should have a chevron icon next to it (useful when used with the 'menu' optionk) */
		show_chevron = false,

		/** The content shown in a dropdown menu when the secondary dropdown button is clicked */
		dropdown = undefined as undefined | Snippet<[{ close: () => void }]>,

		/** The content shown when the button is in the loading state */
		loading_content = undefined as undefined | Snippet<[{ close: () => void }]>,

		/** Whether the dropdown menu should be disabled (and the secondary downdown button hidden) */
		disable_dropdown = false,

		/** Whether the dropdown menu should close when the user clicks a button like element inside of it */
		popover_close_on_inside_click = false,

		/** The placement of the popover (used when either "menu" or "dropdown" is provided) */
		popover_placement = 'bottom-end' as PopoverPlacement,

		/** The placement of the popover (used when either "menu" or "dropdown" is provided) */
		popover_strategy = 'fixed' as PopoverStrategy,

		/** Whether the intial focus should not be set automatically when opening the popover */
		popover_disable_initial_focus = false,

		/** The content shown in the button element */
		children = undefined as
			| undefined
			| Snippet<[{ isLoading: boolean; isLoadingSuccess: boolean }]>,

		/** The ID of the element. @defaults to a random ID */
		id = propId,

		/** A reference to the button element */
		button_element = $bindable() as HTMLElement | undefined,

		/** Specifies a custom class name for the container element */
		class: class_name = '',

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
	// A submit button inside a <Form> inherits the form's submitting/disabled
	// state unless the caller explicitly set `loading` / `disabled`.
	const isFormSubmit = $derived(type === 'submit' && !!formContext);
	const resolvedDisabled = $derived(
		disabled ||
			groupContext?.disabled ||
			(isFormSubmit && formContext!.disabled) ||
			false,
	);
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

	// `loading` prop wins if provided; otherwise a submit button tracks the
	// surrounding form's is_submitting flag. Merge with the internal
	// onclick-promise loading state.
	const externalLoading = $derived(
		loading ?? (isFormSubmit ? formContext!.is_submitting : undefined),
	);
	const isLoading = $derived(externalLoading || onclickLoading);
	const isLoadingSuccess = $derived(loading_success || onclickLoadingSuccess);

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
	class={['button', class_name].filter(Boolean).join(' ')}
	class:has-dropdown-trigger={dropdown && !disable_dropdown}
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
	class:full-width={full_width}
	class:full-height={full_height}
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
	{@attach tooltip(tooltip_message)}>
	{#if badge}
		<div class="badge" class:dot={badge === true}>
			{#if badge !== true}{badge}{/if}
		</div>
	{/if}
	<svelte:element
		this={href ? 'a' : 'button'}
		type={href ? null : type}
		role="button"
		tabindex={resolvedDisabled || isLoading || (!mounted && !href) ? -1 : 0}
		{...rest}
		{target}
		{href}
		data-sveltekit-noscroll={href?.startsWith('?') ? true : null}
		data-sveltekit-keepfocus={href?.startsWith('?') ? true : null}
		{@attach ripple({
			enabled: !disable_ripple && !resolvedDisabled && !isLoading,
			zIndex: 1,
		})}
		disabled={resolvedDisabled || onclickLoading || (!mounted && !href)}
		aria-busy={isLoading ? 'true' : null}
		aria-haspopup={!!menu}
		aria-expanded={menu ? menuActive : null}
		bind:this={button_element}
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
		{#if show_chevron && menu}
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
	{#if dropdown && !disable_dropdown}
		<button
			class="dropdown-trigger"
			type="button"
			aria-haspopup="true"
			aria-expanded={dropdownActive}
			aria-label="Toggle dropdown"
			title="Open for more actions"
			{@attach ripple({
				enabled: !disable_ripple && !resolvedDisabled && !isLoading,
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
		ref_element={button_element}
		bind:opened={menuActive}
		open_on_click
		arrow={false}
		strategy={popover_strategy}
		close_on_inside_click={popover_close_on_inside_click}
		disable_initial_focus={popover_disable_initial_focus}
		placement={popover_placement}>
		{@render menu({ close: closeMenu })}
	</Popover>
{/if}
{#if dropdown && !disable_dropdown}
	<Popover
		ref_element={dropdownTrigger}
		bind:opened={dropdownActive}
		open_on_click
		arrow={false}
		strategy={popover_strategy}
		close_on_inside_click={popover_close_on_inside_click}
		disable_initial_focus={popover_disable_initial_focus}
		placement={popover_placement}>
		{@render dropdown({ close: closeMenu })}
	</Popover>
{/if}

<style>
	.button {
		--_radius: var(--action-radius, var(--radius-lg));
		--easing: var(--ease-spring);
		/* Default font for an unsized button. Combined with the shared control
		   height below, a bare <Button> matches a default Input/Select height in
		   a row. An explicit `size` (inline font-size) or an in-field font
		   override (e.g. .input-icon-btn) wins over this. */
		font-size: var(--control-font-1, 1rem);
		display: inline-flex;
		justify-content: center;
		position: relative;
		width: fit-content;
		border-radius: var(--_radius);
		perspective: 100px;

		&.pill {
			--_radius: var(--radius-full);
		}

		&:not(.transparent):not(.translucent) {
			--color-bg: var(--color-action);
			--color-bg-disabled: var(--color-action-disabled);
			--color-bg-active: var(--color-action-active);
			--color-text: var(--color-action-text);
			--color-text-disabled: var(--color-action-text-disabled);
			--color-text-active: var(--color-action-text-active);
			--color-border: var(--button-border);
			--color-border-disabled: var(--button-border-disabled);
			--color-border-active: var(--button-border-active);
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
			--button-border: 1px solid currentColor;
			--button-border-disabled: 1px solid currentColor;
			--button-border-active: 1px solid currentColor;

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
			--button-border: none;
			--button-border-disabled: none;
			--button-border-active: none;
		}
		&.transparent,
		&.translucent {
			/* Plain (non-accent/error/success) transparent + translucent buttons
			   don't set their own --color-text, so the global --color-text-disabled
			   — a currentColor-relative dim — resolves against the *inherited* color.
			   Nested in a muted container (e.g. Breadcrumbs' trail) that compounds and
			   washes the disabled label into the background. Derive it from the
			   button's own full-contrast --color-text instead; the accent/error/success
			   variants below override with their own disabled tokens. */
			--color-text-disabled: light-dark(
				oklch(from var(--color-text) calc(l + 0.2) c h),
				oklch(from var(--color-text) calc(l - 0.2) c h)
			);
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
				/* A loading button is "busy", not "disabled". It still carries the
				   disabled attribute (to block clicks/keyboard activation), but it
				   must stay fully legible — so restore the resting colors instead
				   of the muted disabled treatment. --color-text-disabled is a
				   currentColor-relative dim; when a transparent button inherits an
				   already-muted color (e.g. Breadcrumbs' muted trail) that dim
				   compounds and washes the label almost into the background. */
				&:disabled,
				&[aria-disabled='true'] {
					background-color: var(--color-bg);
					color: var(--color-text);
					border: var(--button-border);
				}
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
			top: -0.2em;
			right: -0.2em;
			display: flex;
			align-items: center;
			justify-content: center;
			background-color: var(--color-accent, var(--color-text));
			color: var(--color-accent-text, var(--color-bg));
			border-radius: var(--radius-full);
			font-size: 0.8em;
			line-height: 0.8em;
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
				top: -0.1em;
				right: -0.1em;
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
				/* Scale the number badge down relative to the (small) icon
				   button and pull it in to hug the circle's top-right edge,
				   instead of floating off the bounding-box corner. */
				font-size: 0.8em;
				top: -0.25em;
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
					circle at calc(100% - 0.55em) 0.4em,
					transparent calc(0.65em + 3px),
					black calc(0.65em + 3.5px)
				);
			}
		}
		&:not(.icon):has(> .badge.dot) {
			button,
			a {
				mask-image: radial-gradient(
					circle at calc(100% - 0.3rem) 0.3rem,
					transparent calc(0.375rem + 3px),
					black calc(0.375rem + 3.55px)
				);
			}
		}
		/* Icon button badge cutouts */
		&.icon:has(> .badge:not(.dot)) {
			button,
			a {
				mask-image: radial-gradient(
					circle at calc(100% - 0.3em) 0.4em,
					transparent 0.75em,
					black calc(0.75em + 0.5px)
				);
			}
		}
		&.icon:has(> .badge.dot) {
			button,
			a {
				mask-image: radial-gradient(
					circle at calc(100% - 0.375rem) 0.375rem,
					transparent calc(0.375rem + 3px),
					black calc(0.375rem + 3.5px)
				);
			}
		}
		&.icon.transparent:has(> .badge:not(.dot)),
		&.icon.translucent:has(> .badge:not(.dot)) {
			button,
			a {
				mask-image: radial-gradient(
					circle at calc(100% - 0.75em) 0.75em,
					transparent 0.5em,
					black calc(0.5em + 0.5px)
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
					black calc(0.375rem + 3.5px)
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
			border: var(--button-border);
			text-align: center;
			text-decoration: none;
			width: fit-content;
			border-radius: var(--_radius);
			background-color: var(--color-bg);
			color: var(--color-text);
			cursor: pointer;
			padding: 0.75em 1.5em;
			/* Set an explicit line-height so the label centers symmetrically
			 * regardless of the host page's inherited line-height. Inheriting a
			 * loose prose line-height (e.g. 1.75) leaves fractional half-leading
			 * that rounds unevenly at small font sizes, pushing the text upward. */
			line-height: normal;
			transition:
				background-color 300ms,
				color 300ms,
				box-shadow 300ms ease,
				translate 200ms ease;
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
				border: var(--button-border-disabled);
			}
			/* While loading the button is "busy" and shouldn't react to pointer
			   interaction — gate :hover/:active on :not([aria-busy='true']) so it
			   behaves like a disabled control (aria-busy is set whenever isLoading,
			   covering anchors and prop/form-driven loading that aren't :disabled). */
			&:hover:not(:disabled):not([aria-disabled='true']):not([aria-busy='true']) {
				background-color: var(--color-bg-active);
				color: var(--color-text-active);
				border: var(--button-border-active);
				text-decoration: none;
				transition: translate 200ms ease;
			}
			&:active:not(:disabled):not([aria-disabled='true']):not([aria-busy='true']) {
				translate: 0px 1px clamp(-10px, calc(0.2em - 12px), -2px);
			}
		}

		/* Shared control height: a standalone (non-icon) button snaps to the
		   same height as Input/Select for a given size (see --control-height-*
		   in tokens.css), so a Button lines up in a form row. The floor is
		   em-based, so an explicitly sized button scales up too. The
		   dropdown-trigger is excluded — it stretches to match its sibling.
		   Icon buttons keep their 4em square (and so do the font-scaled
		   buttons embedded inside Input/Select). */
		&:not(.icon) {
			button:not(.dropdown-trigger),
			a {
				box-sizing: border-box;
				min-height: calc(1em * var(--control-height-ratio, 3));
			}
			&.dense {
				button:not(.dropdown-trigger),
				a {
					min-height: calc(1em * var(--control-height-ratio-dense, 2.5));
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
			transform: rotate(180deg);
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
			border-top-right-radius: var(--_radius);
			border-bottom-right-radius: var(--_radius);
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
				line-height: 1em;
				padding: 0.5em 1em;
				gap: 0.3em;
			}
			&.has-dropdown-trigger {
				> button:not(.dropdown-trigger),
				> a {
					padding: 0.5em 1em 0.5em 1.1em;
				}
			}
			.download-trigger {
				padding: 0 0.35em 0 0.35em;
			}
			:global(.chevron) {
				margin: 0 -0.2em;
			}
		}

		&.icon {
			/* A standalone icon button is a control-height square so it lines up
			   in a row with text controls (Input/Select/Button). It scales with
			   the button's font, so a sized icon button grows too. Icon buttons
			   embedded in a field (.input-icon-btn / .input-pill-btn) pin their
			   own size and are unaffected. */
			--_icon-size: calc(1em * var(--control-height-ratio, 3));
			height: var(--_icon-size);
			width: var(--_icon-size);
			aspect-ratio: 1 / 1;
			/* Make the icon button a real circle by setting --_radius on the
			   inner button/a (which owns the background, border, ripple AND the
			   :active translate). Don't clip the circle from this wrapper with
			   overflow:hidden — that fakes the shape (so the square inner radius
			   shows through on :active and the outline border gets clipped) and
			   crops the badge that hangs off the corner. The inner element's own
			   overflow:hidden still clips the ripple to the circle. */
			--_radius: var(--radius-full);
			&.dense {
				--_icon-size: calc(1em * var(--control-height-ratio-dense, 2.5));
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
			/* Icon-only ends: the pill curve crowds a centered icon at the
			   rounded outer end. Widen the end button and pad its rounded side
			   so the icon keeps its size and its spacing from the flat (inner)
			   edge while gaining a little breathing room from the curve. */
			&.icon {
				--_group-end-pad: 0.5em;
				&:first-child:not(:last-child) {
					width: calc(var(--_icon-size) + var(--_group-end-pad));
					button,
					a {
						box-sizing: border-box;
						padding-left: var(--_group-end-pad);
					}
				}
				&:last-child:not(:first-child) {
					width: calc(var(--_icon-size) + var(--_group-end-pad));
					button,
					a {
						box-sizing: border-box;
						padding-right: var(--_group-end-pad);
					}
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
			/* Icon-only ends: same breathing room as horizontal, but the rounded
			   ends are top/bottom here, so pad the block axis. */
			&.icon {
				--_group-end-pad: 0.5em;
				&:first-child:not(:last-child) {
					height: calc(var(--_icon-size) + var(--_group-end-pad));
					button,
					a {
						box-sizing: border-box;
						padding-top: var(--_group-end-pad);
					}
				}
				&:last-child:not(:first-child) {
					height: calc(var(--_icon-size) + var(--_group-end-pad));
					button,
					a {
						box-sizing: border-box;
						padding-bottom: var(--_group-end-pad);
					}
				}
			}
			& + :global(.button) {
				margin-top: -1px;
			}
		}

		&.overlay {
			--button-border: none;
			--button-border-disabled: none;
			--button-border-active: none;
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
				&:hover:not(:disabled):not([aria-disabled='true']):not([aria-busy='true']) {
					transition: none;
				}
				&:hover:not(:disabled):not([aria-disabled='true']):not([aria-busy='true']),
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
