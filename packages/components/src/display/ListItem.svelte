<script lang="ts">
	import { ripple } from '@delightstack/utilities';
	import { getContext, type Snippet } from 'svelte';
	import { type ListContext } from './List.svelte';
	import { fade, type TransitionConfig } from 'svelte/transition';
	import { backOut, quartOut } from 'svelte/easing';
	import type { PopoverPlacement } from './../actions/Popover.svelte';
	import Button from './../actions/Button.svelte';
	import Progress from '../feedback/Progress.svelte';
	import Checkbox from '../form/Checkbox.svelte';
	import Radio from '../form/Radio.svelte';
	import Toggle from '../form/Toggle.svelte';
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

		/**
		 * Whether a loading spinner should appear on the action row (`button`
		 * type). Leave undefined to let a promise-returning `onclick` drive it
		 * automatically (see `onclick`).
		 */
		loading = undefined as boolean | undefined,

		/**
		 * For the manual `loading` path only: when `loading` goes true -> false and
		 * this is true, a success checkmark briefly animates in to confirm the
		 * action, then animates away. (The promise-aware `onclick` path shows this
		 * checkmark automatically on resolve, so this prop isn't needed there.)
		 */
		loading_success = false,

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
		 * If it returns a promise, the row manages its own loading feedback:
		 * - A spinner appears only if the promise is still pending after ~100ms
		 *   (faster resolves are treated as instant — no spinner flash).
		 * - Once shown, the spinner stays for at least ~1s so it can't blink away.
		 * - On resolve, a brief success checkmark confirms the action; on reject,
		 *   no checkmark is shown.
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

	/* Promise-aware loading timing (mirrors Button).
	   - SHOW_DELAY: a promise that settles faster than this never gets a spinner;
	     the action reads as "instant".
	   - MIN_VISIBLE: once shown, the spinner stays at least this long so it can't
	     flash on then immediately off.
	   - SPINNER_OUT: spinner collapse duration (kept in sync with the "out"
	     transition) so the success check can slot in right after it clears.
	   - CHECK_HOLD: how long the success checkmark lingers before easing out. */
	const SHOW_DELAY = 100;
	const MIN_VISIBLE = 1000;
	const SPINNER_OUT = 150;
	const CHECK_HOLD = 1000;

	let inFlight = $state(false); // a returned promise is running (covers the pre-spinner window)
	let spinnerVisible = $state(false); // the spinner is actually rendered
	let checkVisible = $state(false); // the success checkmark is rendered

	let showTimer: ReturnType<typeof setTimeout> | undefined;
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	let checkTimer: ReturnType<typeof setTimeout> | undefined;
	let spinnerShownAt = 0;

	function clearTimers() {
		clearTimeout(showTimer);
		clearTimeout(hideTimer);
		clearTimeout(checkTimer);
		showTimer = hideTimer = checkTimer = undefined;
	}
	$effect(() => clearTimers); // tear down pending timers on destroy

	// The external `loading` prop drives the spinner directly; a returned promise
	// drives `inFlight`/`spinnerVisible`. "Busy" (a11y/pointer-gating) is either of
	// those; `showSpinner` excludes the brief pre-spinner window so a sub-SHOW_DELAY
	// promise never flashes one. The checkmark renders straight off `checkVisible`.
	const externalLoading = $derived(loading);
	const isLoading = $derived(!!externalLoading || inFlight);
	const showSpinner = $derived(!!externalLoading || spinnerVisible);

	// Manual loading path: when the caller drives `loading` true -> false and has
	// opted in with `loading_success`, play the same confirming checkmark. Runs in
	// `$effect.pre` so `checkVisible` is set in the same flush `loading` clears in,
	// otherwise the icon slot would render one empty frame and flash closed/open.
	let wasExternalLoading = false;
	$effect.pre(() => {
		const now = !!externalLoading;
		if (wasExternalLoading && !now && loading_success && !inFlight) flashCheck();
		wasExternalLoading = now;
	});

	// The icon slot (the common parent of the spinner and the success check)
	// grows/collapses with this width+opacity transition. Wrapping both means the
	// slot only opens when one first appears and only collapses once both are gone
	// — the spinner -> check handoff happens inside a stable, already-open slot.
	//
	// The margins (and any parent flex gap) ride `t` along with the width so the
	// slot's total layout contribution hits exactly 0 at t=0 — animating width
	// alone leaves them at full strength, which over/under-shoots the label's
	// resting position and snaps it when the node is finally removed (see the
	// matching note in Button.svelte).
	function loadingTransition(
		node: HTMLElement,
		params?: { direction?: 'in' | 'out' },
	): () => TransitionConfig {
		return () => {
			const style = getComputedStyle(node);
			const width = parseFloat(style.width);
			const marginLeft = parseFloat(style.marginLeft) || 0;
			const marginRight = parseFloat(style.marginRight) || 0;
			const gap = node.parentElement
				? parseFloat(getComputedStyle(node.parentElement).columnGap) || 0
				: 0;
			const out = params?.direction === 'out';
			return {
				duration: out ? SPINNER_OUT : 320,
				easing: out ? quartOut : backOut,
				css: (t: number) =>
					`width: ${t * width}px; ` +
					`margin-left: ${t * marginLeft}px; ` +
					`margin-right: ${t * marginRight - (1 - t) * gap}px; ` +
					`opacity: ${t};`,
			};
		};
	}

	// The checkmark's own entrance: a spring-scaled pop that simultaneously draws
	// its stroke on (the dash offset rides `t`). Driving the draw from the
	// transition — rather than a CSS @keyframes — keeps it reliable regardless of
	// scoping. prefers-reduced-motion collapses it to a plain appear.
	function checkIn(_node: Element): TransitionConfig {
		const reduce =
			typeof matchMedia !== 'undefined' &&
			matchMedia('(prefers-reduced-motion: reduce)').matches;
		return {
			duration: reduce ? 0 : 440,
			easing: backOut,
			css: (t: number) =>
				`transform: scale(${0.3 + 0.7 * t}); opacity: ${Math.min(1, t * 2)}; --check-draw: ${24 * (1 - t)};`,
		};
	}

	// Pop the confirming checkmark, then retire it after CHECK_HOLD. spinnerVisible
	// is cleared in the same tick by the caller, so the slot stays open and the
	// spinner crossfades into the check rather than the slot reopening.
	function flashCheck() {
		clearTimeout(checkTimer);
		checkVisible = true;
		checkTimer = setTimeout(() => (checkVisible = false), CHECK_HOLD);
	}

	function handleClick(e: MouseEvent) {
		if (inFlight || externalLoading) return;
		if (!onclick) return;
		const maybePromise = onclick(e);
		if (!(maybePromise instanceof Promise)) return;

		// A fresh action supersedes any checkmark still lingering from the last one.
		clearTimers();
		checkVisible = false;

		inFlight = true;
		// Hold off on the spinner — if the promise settles within SHOW_DELAY the
		// action was effectively instant and never needs one.
		showTimer = setTimeout(() => {
			showTimer = undefined;
			spinnerVisible = true;
			spinnerShownAt = performance.now();
		}, SHOW_DELAY);

		maybePromise.then(
			() => settle(true),
			() => settle(false),
		);
	}

	function settle(success: boolean) {
		// Settled before the spinner ever appeared -> treat as instant: no spinner,
		// no checkmark, just release.
		if (showTimer) {
			clearTimeout(showTimer);
			showTimer = undefined;
			inFlight = false;
			return;
		}
		// The spinner is up; keep it for the rest of its minimum-visible window so
		// it doesn't blink away the instant the promise resolves.
		const remaining = Math.max(0, MIN_VISIBLE - (performance.now() - spinnerShownAt));
		clearTimeout(hideTimer);
		hideTimer = setTimeout(() => {
			spinnerVisible = false;
			inFlight = false;
			// On success, let the spinner collapse, then pop a brief checkmark.
			if (success) flashCheck();
		}, remaining);
	}
</script>

{#if context}
	<li
		class={['list-item', context.type, class_name].filter(Boolean).join(' ')}
		class:disabled={context.disabled || disabled}
		class:is-loading={isLoading}
		class:dense={context.dense}
		class:comfortable={context.comfortable}
		{style}
		{id}
		bind:this={element}
		class:active={checked || active}
		style:--level={context.level}
		{@attach ripple({
			zIndex: 1,
			enabled: !context.disabled && !disabled && context.type !== 'text' && !isLoading,
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
		{:else if context.type === 'toggle'}
			<label for="toggle-{id}">
				{#if children}{@render children()}{/if}
				<div class="spacer"></div>
				<input
					type="checkbox"
					id="toggle-{id}"
					name={id}
					disabled={context.disabled || disabled}
					{checked}
					onchange={() => onchange?.(checked)} />
				<!-- Presentational only: the hidden native input above owns
				     interaction, focus and a11y (List's change delegation treats it
				     like a checkbox). `inert` keeps the Toggle from becoming a
				     second focusable/clickable control. -->
				<span class="list-control" inert>
					<Toggle
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
					aria-busy={isLoading ? 'true' : null}
					onclick={handleClick}>
					{#if showSpinner || checkVisible}
						<div
							class="loading-icon"
							in:loadingTransition={{ direction: 'in' }}
							out:loadingTransition={{ direction: 'out' }}>
							{#if showSpinner}
								<div class="icon-layer" out:fade={{ duration: 120 }}>
									<Progress size="00" color="currentColor" />
								</div>
							{:else}
								<div class="icon-layer check-layer" in:checkIn>
									<svg
										class="check"
										viewBox="2 2 20 20"
										fill="none"
										stroke="currentColor"
										stroke-width="3"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true">
										<path d="M5 12.5l4.5 4.5L19 7" />
									</svg>
								</div>
							{/if}
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
		--_radius: calc(var(--radius-lg) * 1.5);
		:global(> .ripple) {
			inset: 1px var(--border-inset) 1px
				calc(var(--border-inset) + ((var(--level) - 1) * 1rem)) !important;
			border-radius: calc(var(--_radius) - var(--border-inset)) !important;
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(
					(var(--_radius) - var(--border-inset)) * var(--squircle-ratio, 2)
				) !important;
			}
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
			--_radius: var(--radius-lg);
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
			--_radius: var(--radius-xl);
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
	/* Same ring for toggle mode, following the Toggle's pill-shaped track */
	label:has(input:focus-visible) .list-control :global(.toggle .track) {
		box-shadow: 0 0 0 2px var(--color-border-active);
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
		border-radius: calc(var(--_radius) - var(--border-inset));
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(
				(var(--_radius) - var(--border-inset)) * var(--squircle-ratio, 2)
			);
		}
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
			border-radius: calc(var(--_radius) - var(--border-inset));
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(
					(var(--_radius) - var(--border-inset)) * var(--squircle-ratio, 2)
				);
			}
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
				border-radius: calc(var(--_radius) - var(--border-inset));
				@supports (corner-shape: squircle) {
					corner-shape: squircle;
					border-radius: calc(
						(var(--_radius) - var(--border-inset)) * var(--squircle-ratio, 2)
					);
				}
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
		/* Spinner and success check occupy the same spot so they can crossfade
		   during the handoff without nudging the label. */
		.icon-layer {
			position: absolute;
			inset: 0;
			display: flex;
			align-items: center;
			justify-content: center;
		}
		.check {
			display: block;
			/* The tick only spans the middle of its viewBox, so fill the slot
			   (paired with the tightened viewBox) to size it like the spinner. The
			   slot width is fixed and the layer is absolutely positioned, so this
			   never shifts layout. */
			width: 1.25em;
			height: 1.25em;
		}
		.check path {
			/* Dash length >= the tick's path length; checkIn() rides --check-draw
			   from 24 (hidden) down to 0 (drawn). The 0 fallback keeps it drawn
			   once the transition's inline style is gone. */
			stroke-dasharray: 24;
			stroke-dashoffset: var(--check-draw, 0);
		}
	}
</style>
