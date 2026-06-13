<script lang="ts" module>
	export { default as Step } from './Steps.svelte';

	export interface StepsContext {
		/** Index of the currently active step */
		current: number;
		/** The layout direction of the steps */
		orientation: 'horizontal' | 'vertical';
		/** Whether steps can be clicked to navigate */
		clickable: boolean;
		/** Whether steps must be completed in order (only visited/adjacent steps are clickable) */
		linear: boolean;
		/** The size applied to all steps */
		size: string;
		/** Total number of registered steps */
		totalSteps: number;
		/** Registers a new step and returns its index */
		register: () => number;
		/** Navigates to the step at the given index */
		navigate: (index: number) => void;
	}
</script>

<script lang="ts">
	import { ripple } from '@delightstack/utilities';
	import { getContext, setContext, type Snippet } from 'svelte';
	import Button from '../actions/Button.svelte';
	import Expand from '../display/Expand.svelte';

	const propId = $props.id();

	let {
		/* --- Step item props --- */
		/** The title text for this step */
		title = '',

		/** Optional description text below the title */
		description = '',

		/** Whether this step is optional */
		optional = false,

		/** Whether this step is in an error state */
		error = false,

		/* --- Steps container props --- */
		/** The current active step index */
		current = $bindable(0),

		/** Layout orientation */
		orientation = 'horizontal' as 'horizontal' | 'vertical',

		/** Whether completed steps are clickable for navigation */
		clickable = false,

		/** Whether navigation is restricted to sequential order */
		linear = true,

		/** Size variant */
		size = '1' as '0' | '1' | '2' | '3',

		/** Show skeleton shimmer placeholders */
		skeleton = false,

		/** Number of skeleton placeholder steps */
		skeleton_count = 4,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: class_name = '',

		/** Child content snippet */
		children = undefined as undefined | Snippet,

		/** Called when the active step changes */
		onchange = undefined as ((detail: { step: number }) => void) | undefined,

		/** Called when all steps are completed */
		oncomplete = undefined as (() => void) | undefined,
	} = $props();

	/* ------------------------------------------------------------------ */
	/*  Determine whether this instance is a container or an item         */
	/* ------------------------------------------------------------------ */
	const parentContext = getContext<StepsContext | undefined>('steps');
	const isItem = !!parentContext;

	/* ------------------------------------------------------------------ */
	/*  Steps container behaviour                                         */
	/* ------------------------------------------------------------------ */
	let stepCounter = 0;

	if (!isItem) {
		const ctx = $state<StepsContext>({
			current,
			orientation,
			clickable,
			linear,
			size,
			totalSteps: 0,
			register() {
				const index = stepCounter++;
				ctx.totalSteps = stepCounter;
				return index;
			},
			navigate(index: number) {
				if (!ctx.clickable) return;
				if (ctx.linear && index > ctx.current) return;
				if (index === ctx.current) return;
				current = index;
				onchange?.({ step: index });
			},
		});
		setContext<StepsContext>('steps', ctx);

		$effect(() => {
			ctx.current = current;
			ctx.orientation = orientation;
			ctx.clickable = clickable;
			ctx.linear = linear;
			ctx.size = size;
		});

		$effect(() => {
			if (current >= ctx.totalSteps && ctx.totalSteps > 0) {
				oncomplete?.();
			}
		});
	}

	/* ------------------------------------------------------------------ */
	/*  Step item behaviour                                                */
	/* ------------------------------------------------------------------ */
	const stepIndex = isItem ? parentContext.register() : -1;

	const isComplete = $derived(isItem && !error && stepIndex < parentContext.current);
	const isCurrent = $derived(isItem && stepIndex === parentContext.current);
	const isUpcoming = $derived(isItem && stepIndex > parentContext.current);
	const isError = $derived(isItem && error);
	const isLast = $derived(isItem && stepIndex === parentContext.totalSteps - 1);
	const connectorFilled = $derived(isItem && stepIndex < parentContext.current);

	const canClick = $derived(
		isItem &&
			parentContext.clickable &&
			(isComplete || (!parentContext.linear && !isCurrent)),
	);

	const stepState = $derived(
		isError ? 'error' : isComplete ? 'complete' : isCurrent ? 'current' : 'upcoming',
	);

	const ariaLabel = $derived(
		isItem
			? `Step ${stepIndex + 1}: ${title}${isComplete ? ', completed' : isCurrent ? ', current' : isError ? ', error' : ''}${optional ? ', optional' : ''}`
			: undefined,
	);

	function handleClick() {
		if (!canClick || !isItem) return;
		parentContext.navigate(stepIndex);
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			handleClick();
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Size mapping                                                       */
	/* ------------------------------------------------------------------ */
	const CIRCLE_SIZES: Record<string, number> = {
		'0': 24,
		'1': 32,
		'2': 40,
		'3': 48,
	};

	const FONT_SIZES: Record<string, string> = {
		'0': '0.625rem',
		'1': '0.75rem',
		'2': '0.875rem',
		'3': '1rem',
	};

	const resolvedCircleSize = $derived(
		isItem ? (CIRCLE_SIZES[parentContext.size] ?? 32) : (CIRCLE_SIZES[size] ?? 32),
	);

	const resolvedFontSize = $derived(
		isItem
			? (FONT_SIZES[parentContext.size] ?? '0.75rem')
			: (FONT_SIZES[size] ?? '0.75rem'),
	);

	const resolvedOrientation = $derived(isItem ? parentContext.orientation : orientation);

	/* ------------------------------------------------------------------ */
	/*  Horizontal overflow (container only)                               */
	/*                                                                     */
	/*  When the row can't fit, it becomes a snap-scrollable strip with    */
	/*  edge fade masks. Chevron pagers render only while overflowing and  */
	/*  are shown only for fine pointers (CSS); touch users swipe.         */
	/* ------------------------------------------------------------------ */
	let scroll_el = $state<HTMLElement | undefined>(undefined);
	let overflowing = $state(false);
	let canScrollPrev = $state(false);
	let canScrollNext = $state(false);

	function updateScrollState() {
		if (!scroll_el) return;
		overflowing = scroll_el.scrollWidth > scroll_el.clientWidth + 1;
		canScrollPrev = scroll_el.scrollLeft > 4;
		canScrollNext =
			scroll_el.scrollLeft + scroll_el.clientWidth < scroll_el.scrollWidth - 4;
	}

	function scrollNext() {
		scroll_el?.scrollBy({ left: scroll_el.clientWidth * 0.8, behavior: 'smooth' });
	}
	function scrollPrev() {
		scroll_el?.scrollBy({ left: -scroll_el.clientWidth * 0.8, behavior: 'smooth' });
	}

	$effect(() => {
		if (isItem || orientation === 'vertical' || !scroll_el) return;
		const el = scroll_el;
		updateScrollState();
		const onScroll = () => updateScrollState();
		el.addEventListener('scroll', onScroll, { passive: true });
		const ro = new ResizeObserver(updateScrollState);
		ro.observe(el);
		// Content width changes (steps mounting, labels reflowing) don't resize
		// the scroller's own box, so watch the steps too.
		for (const child of Array.from(el.children)) ro.observe(child);
		return () => {
			el.removeEventListener('scroll', onScroll);
			ro.disconnect();
		};
	});

	// Keep the active step in view: when `current` changes while overflowing,
	// center it in the strip (instantly on first sync so the initial paint
	// doesn't animate).
	let scrollSynced = false;
	$effect(() => {
		if (isItem || !scroll_el) return;
		void current;
		if (!overflowing) return;
		const target = scroll_el.querySelector<HTMLElement>('[aria-current="step"]');
		if (!target) return;
		const left = target.offsetLeft + target.offsetWidth / 2 - scroll_el.clientWidth / 2;
		scroll_el.scrollTo({ left, behavior: scrollSynced ? 'smooth' : 'instant' });
		scrollSynced = true;
	});
</script>

{#if isItem}
	<!-- Step item -->
	<div
		class={['step', stepState, class_name].filter(Boolean).join(' ')}
		class:vertical={resolvedOrientation === 'vertical'}
		class:horizontal={resolvedOrientation !== 'vertical'}
		{id}
		style:--circle-size="{resolvedCircleSize}px"
		style:--step-font-size={resolvedFontSize}
		aria-current={isCurrent ? 'step' : undefined}>
		<div class="main">
			{#if canClick}
				<button
					type="button"
					class="circle"
					aria-label={ariaLabel}
					{@attach ripple({ zIndex: 1 })}
					onclick={handleClick}
					onkeydown={handleKeyDown}>
					{#if isError}
						<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
							<path
								d="M6 18L18 6M6 6l12 12"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								fill="none" />
						</svg>
					{:else if isComplete}
						<svg
							class="checkmark"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							aria-hidden="true">
							<path
								d="M5 13l4 4L19 7"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								fill="none" />
						</svg>
					{:else}
						<span class="number">{stepIndex + 1}</span>
					{/if}
				</button>
			{:else}
				<span class="circle" role="img" aria-label={ariaLabel}>
					{#if isError}
						<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
							<path
								d="M6 18L18 6M6 6l12 12"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								fill="none" />
						</svg>
					{:else if isComplete}
						<svg
							class="checkmark"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							aria-hidden="true">
							<path
								d="M5 13l4 4L19 7"
								stroke="currentColor"
								stroke-width="2.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								fill="none" />
						</svg>
					{:else}
						<span class="number">{stepIndex + 1}</span>
					{/if}
				</span>
			{/if}

			<div class="label">
				<span class="title">{title}</span>
				{#if description}
					<span class="description">{description}</span>
				{/if}
				{#if optional}
					<span class="optional">Optional</span>
				{/if}
			</div>
		</div>

		{#if !isLast}
			<div class="connector">
				<div class="fill" class:filled={connectorFilled}></div>
			</div>
		{/if}

		{#if children}
			<!-- Expand animates the content open/closed so the surrounding steps
			     reflow smoothly when the active step changes. Hidden content stays
			     mounted but inert (Expand handles that). -->
			<Expand show={isCurrent} style="width: 100%">
				<div class="content">
					{@render children()}
				</div>
			</Expand>
		{/if}
	</div>
{:else if skeleton}
	<!-- Skeleton -->
	<div
		class={['steps skeleton', class_name].filter(Boolean).join(' ')}
		class:vertical={orientation === 'vertical'}
		class:horizontal={orientation !== 'vertical'}
		{id}
		style:--circle-size="{CIRCLE_SIZES[size] ?? 32}px"
		style:--step-font-size={FONT_SIZES[size] ?? '0.75rem'}
		aria-hidden="true">
		{#each { length: skeleton_count } as _, i}
			<!-- Reuses the real .step/.main/.label/.connector layout
			     classes so every placeholder sits exactly where the real step will. -->
			<div
				class="step"
				class:vertical={orientation === 'vertical'}
				class:horizontal={orientation !== 'vertical'}
				style:--shimmer-delay="{i * 120}ms">
				<div class="main">
					<div class="skeleton-circle"></div>
					<div class="label">
						<div class="skeleton-bar skeleton-title"></div>
						<div class="skeleton-bar skeleton-desc"></div>
					</div>
				</div>
				{#if i < skeleton_count - 1}
					<div class="connector"></div>
				{/if}
			</div>
		{/each}
	</div>
{:else}
	<!-- Steps container -->
	<div
		class="wrap"
		class:vertical={orientation === 'vertical'}
		class:horizontal={orientation !== 'vertical'}
		style:--circle-size="{CIRCLE_SIZES[size] ?? 32}px">
		{#if orientation !== 'vertical' && overflowing}
			<Button
				icon
				size="00"
				class="steps-nav steps-nav-prev"
				aria-label="Scroll to previous steps"
				disabled={!canScrollPrev}
				disable_ripple={!canScrollPrev}
				onclick={scrollPrev}>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true">
					<polyline points="15 18 9 12 15 6" />
				</svg>
			</Button>
		{/if}
		<div
			bind:this={scroll_el}
			class={['steps', class_name].filter(Boolean).join(' ')}
			class:vertical={orientation === 'vertical'}
			class:horizontal={orientation !== 'vertical'}
			{id}
			role="group"
			aria-label="Progress"
			style:--fade-l={canScrollPrev ? '3rem' : '0px'}
			style:--fade-r={canScrollNext ? '3rem' : '0px'}>
			{@render children?.()}
		</div>
		{#if orientation !== 'vertical' && overflowing}
			<Button
				icon
				size="00"
				class="steps-nav steps-nav-next"
				aria-label="Scroll to next steps"
				disabled={!canScrollNext}
				disable_ripple={!canScrollNext}
				onclick={scrollNext}>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true">
					<polyline points="9 18 15 12 9 6" />
				</svg>
			</Button>
		{/if}
	</div>
{/if}

<style>
	/* ========== Steps Container ========== */
	.wrap {
		position: relative;
		width: 100%;

		/* Vertical (and SSR'd) layouts need no overflow chrome — the wrapper
		   disappears from layout entirely. */
		&.vertical {
			display: contents;
		}

		/* Chevron pagers: <Button icon> instances positioned over the strip's
		   faded edges, vertically centered on the circle row. Touch devices
		   swipe instead, so they only display for fine pointers. */
		:global(.steps-nav) {
			display: none;
			position: absolute;
			top: calc(var(--circle-size, 32px) / 2);
			translate: 0 -50%;
			z-index: 2;
			box-shadow:
				0 2px 6px rgba(0, 0, 0, 0.12),
				0 1px 2px rgba(0, 0, 0, 0.08);
		}
		:global(.steps-nav-prev) {
			left: -0.25rem;
		}
		:global(.steps-nav-next) {
			right: -0.25rem;
		}
		@media (hover: hover) and (pointer: fine) {
			:global(.steps-nav) {
				display: inline-flex;
			}
		}
	}

	.steps {
		display: flex;
		align-items: flex-start;
		width: 100%;

		&.vertical {
			flex-direction: column;
		}

		&.horizontal {
			position: relative;
			overflow-x: auto;
			overscroll-behavior-x: contain;
			scroll-snap-type: x proximity;
			-webkit-overflow-scrolling: touch;
			/* Hide the native scrollbar — overflow is paged via the chevrons on
			   desktop and swiped on touch (same pattern as Timeline). */
			scrollbar-width: none;
			/* Breathing room for the current-step halo / focus ring that the
			   scroll clip would otherwise crop; the negative margin cancels it
			   so nothing shifts when the steps fit. */
			padding-block: 0.5rem;
			margin-block: -0.5rem;
			/* Edge fades hint at clipped content; 0px fades are a no-op mask. */
			mask-image: linear-gradient(
				to right,
				transparent 0,
				black var(--fade-l, 0px),
				black calc(100% - var(--fade-r, 0px)),
				transparent 100%
			);
		}
		&.horizontal::-webkit-scrollbar {
			display: none;
		}
	}

	/* ========== Step Item ========== */
	.step {
		display: flex;
		position: relative;

		&.horizontal {
			flex-direction: column;
			align-items: center;
			flex: 1;
			/* The readability floor: steps refuse to crush below this, which is
			   what tips a crowded row into the scrollable overflow strip. */
			min-width: var(--step-min-width, 7rem);
			scroll-snap-align: center;
		}

		&.vertical {
			flex-direction: column;
			align-items: flex-start;
			flex: none;

			/* Inter-step spacing (the connector is absolutely positioned so it
			   can run continuously past expanded step content). */
			&:not(:last-child) {
				padding-bottom: 2rem;
			}
		}
	}

	.main {
		display: flex;
		gap: 0.625rem;
		/* Press feedback for clickable steps: the indicator + label wrapper
		   squeezes toward its OWN center (not the row's), like Button's press. */
		transform-origin: center;
		transition: scale 150ms ease;

		&:has(button.circle:active) {
			scale: 0.95;
		}

		.step.horizontal & {
			flex-direction: column;
			align-items: center;
		}

		.step.vertical & {
			flex-direction: row;
			align-items: flex-start;
		}
	}

	/* ========== Circle ========== */
	.circle {
		width: var(--circle-size);
		height: var(--circle-size);
		min-width: var(--circle-size);
		min-height: var(--circle-size);
		border-radius: 9999px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 500;
		font-size: var(--step-font-size);
		border: 2px solid
			light-dark(var(--color-border, #d1d5db), var(--color-border, #4b5563));
		background: transparent;
		color: light-dark(
			var(--color-text-disabled, #9ca3af),
			var(--color-text-disabled, #6b7280)
		);
		position: relative;
		padding: 0;
		cursor: default;
		outline: none;
		transition:
			background-color 300ms ease,
			border-color 300ms ease,
			color 300ms ease,
			box-shadow 300ms ease;

		svg {
			width: 55%;
			height: 55%;
		}

		.step.complete & {
			background: var(--color-success, #16a34a);
			border-color: var(--color-success, #16a34a);
			color: white;
		}

		/* "You are here" is neutral on purpose: a surface-filled circle with a
		   strong text-colored ring and a soft breathing halo. It reads clearly
		   without adding a hue that clashes with the success/error states. */
		.step.current & {
			background: var(--color-surface, light-dark(#ffffff, #111111));
			border-color: var(--color-text, light-dark(#1a1a1a, #f5f5f5));
			color: var(--color-text, light-dark(#1a1a1a, #f5f5f5));
			font-weight: 600;
			animation: steps-pulse 2.4s ease-in-out infinite;
		}

		.step.error & {
			background: var(--color-error, #dc2626);
			border-color: var(--color-error, #dc2626);
			color: white;
			animation: steps-shake 400ms ease;
		}
	}

	button.circle {
		cursor: pointer;

		/* Hover colors snap IN instantly (the :hover rule owns the in-transition
		   and omits color properties) and ease OUT via the base .circle
		   transition — the library's "instant in, slow out" pattern. */
		&:hover {
			transition: none;
		}
		.step.complete &:hover {
			background: var(--color-success-active, #128b7e);
			border-color: var(--color-success-active, #128b7e);
		}
		.step.error &:hover {
			background: var(--color-error-active, light-dark(#ca3030, #f55d5d));
			border-color: var(--color-error-active, light-dark(#ca3030, #f55d5d));
		}
		.step.upcoming &:hover,
		.step.current &:hover {
			background: rgb(from var(--color-text, #888888) r g b / 0.08);
			border-color: var(--color-text, light-dark(#1a1a1a, #f5f5f5));
			color: var(--color-text, light-dark(#1a1a1a, #f5f5f5));
		}

		&:focus-visible {
			outline: 2px solid var(--color-action, #2563eb);
			outline-offset: 2px;
		}
	}

	/* ========== Checkmark draw-in ========== */
	.step.complete .checkmark path {
		stroke-dasharray: 30;
		stroke-dashoffset: 30;
		animation: steps-check-draw 400ms ease forwards;
	}

	/* ========== Step Number ========== */
	.number {
		line-height: 1;
		user-select: none;
	}

	/* ========== Labels ========== */
	.label {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;

		.step.horizontal & {
			align-items: center;
			text-align: center;
		}

		.step.vertical & {
			align-items: flex-start;
			text-align: left;
			padding-top: 0.25rem;
		}
	}

	.title {
		font-weight: 500;
		font-size: var(--step-font-size);
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
		line-height: 1.3;

		.step.upcoming & {
			color: light-dark(
				var(--color-text-disabled, #9ca3af),
				var(--color-text-disabled, #6b7280)
			);
		}

		/* Bolder label reinforces the neutral "current" indicator. */
		.step.current & {
			font-weight: 600;
		}
	}

	.description {
		font-size: calc(var(--step-font-size) * 0.85);
		color: light-dark(
			var(--color-text-disabled, #9ca3af),
			var(--color-text-disabled, #6b7280)
		);
		line-height: 1.3;
	}

	.optional {
		font-size: calc(var(--step-font-size) * 0.8);
		font-style: italic;
		color: light-dark(
			var(--color-text-disabled, #9ca3af),
			var(--color-text-disabled, #6b7280)
		);
	}

	/* ========== Connector ========== */
	.connector {
		position: relative;
		overflow: hidden;

		.step.horizontal & {
			width: 100%;
			height: 2px;
			position: absolute;
			top: calc(var(--circle-size) / 2);
			left: calc(50% + var(--circle-size) / 2 + 4px);
			right: calc(-50% + var(--circle-size) / 2 + 4px);
			width: calc(100% - var(--circle-size) - 8px);
			background: light-dark(var(--color-border, #d1d5db), var(--color-border, #4b5563));
		}

		/* Absolutely positioned so the line spans the step's FULL height —
		   including expanded wizard content — keeping it visually continuous
		   from this circle down to the next one. (The step's padding-bottom
		   provides the minimum run between collapsed steps.) */
		.step.vertical & {
			position: absolute;
			top: calc(var(--circle-size) + 0.25rem);
			bottom: 0.25rem;
			left: calc(var(--circle-size) / 2 - 1px);
			width: 2px;
			background: light-dark(var(--color-border, #d1d5db), var(--color-border, #4b5563));
		}
	}

	.fill {
		position: absolute;
		inset: 0;
		background: var(--color-success, #16a34a);
		transform-origin: left;
		transform: scaleX(0);
		transition: transform 300ms ease;

		.step.vertical & {
			transform-origin: top;
			transform: scaleY(0);
		}

		&.filled {
			transform: scaleX(1);

			.step.vertical & {
				transform: scaleY(1);
			}
		}
	}

	/* ========== Step Content (wizard mode) ========== */
	.content {
		padding: 0.75rem 0;
		width: 100%;

		.step.vertical & {
			padding-left: calc(var(--circle-size) + 0.625rem);
		}
	}

	/* ========== Skeleton ========== */
	/* Layout comes from the shared .step/.main/.label/.connector
	   rules (the placeholder markup reuses those classes), so only the shimmer
	   shapes are defined here. The connector renders bare: its border-color
	   background already matches an upcoming step's unfilled track. */
	.steps.skeleton {
		pointer-events: none;
	}

	.skeleton-circle,
	.skeleton-bar {
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

	/* Matches .circle's outer box exactly (border-box, so the real 2px
	   border is already inside --circle-size). */
	.skeleton-circle {
		width: var(--circle-size);
		height: var(--circle-size);
		min-width: var(--circle-size);
		min-height: var(--circle-size);
		border-radius: 9999px;
	}

	/* Text pills in the label's own font scale; block margins pad each 0.7em
	   bar out to the real 1.3 line box so the label column height matches. */
	.skeleton-bar {
		height: 0.7em;
		border-radius: var(--radius-full, 1e5px);

		&.skeleton-title {
			font-size: var(--step-font-size);
			width: 4.5em;
			margin-block: 0.3em;
		}

		&.skeleton-desc {
			font-size: calc(var(--step-font-size) * 0.85);
			width: 4em;
			margin-block: 0.3em;
		}
	}

	/* ========== Animations ========== */
	/* Neutral breathing halo for the current step — derived from the text
	   color so it stays hue-free in both light and dark mode. */
	@keyframes steps-pulse {
		0%,
		100% {
			box-shadow: 0 0 0 3px rgb(from var(--color-text, #888888) r g b / 0.18);
		}
		50% {
			box-shadow: 0 0 0 7px rgb(from var(--color-text, #888888) r g b / 0.05);
		}
	}

	@keyframes steps-shake {
		0%,
		100% {
			transform: translateX(0);
		}
		20% {
			transform: translateX(-3px);
		}
		40% {
			transform: translateX(3px);
		}
		60% {
			transform: translateX(-2px);
		}
		80% {
			transform: translateX(2px);
		}
	}

	@keyframes steps-check-draw {
		to {
			stroke-dashoffset: 0;
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
		.step.current .circle {
			animation: none;
			/* Keep a static halo so "current" stays identifiable without motion. */
			box-shadow: 0 0 0 3px rgb(from var(--color-text, #888888) r g b / 0.18);
		}
		.main {
			transition: none;
		}
		.main:has(button.circle:active) {
			scale: none;
		}
		.step.error .circle {
			animation: none;
		}
		.step.complete .checkmark path {
			animation: none;
			stroke-dashoffset: 0;
		}
		.skeleton-circle::after,
		.skeleton-bar::after {
			animation: none;
		}
		.fill {
			transition: none;
		}
	}
</style>
