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
	import { getContext, setContext, type Snippet } from 'svelte';

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
					{:else if isCurrent}
						<span class="number">{stepIndex + 1}</span>
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

		{#if children && isCurrent}
			<div class="content">
				{@render children()}
			</div>
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
		class={['steps', class_name].filter(Boolean).join(' ')}
		class:vertical={orientation === 'vertical'}
		class:horizontal={orientation !== 'vertical'}
		{id}
		role="group"
		aria-label="Progress">
		{@render children?.()}
	</div>
{/if}

<style>
	/* ========== Steps Container ========== */
	.steps {
		display: flex;
		align-items: flex-start;
		width: 100%;

		&.vertical {
			flex-direction: column;
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
		}

		&.vertical {
			flex-direction: column;
			align-items: flex-start;
			flex: none;
		}
	}

	.main {
		display: flex;
		gap: 0.625rem;

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

		.step.current & {
			background: var(--color-action, #2563eb);
			border-color: var(--color-action, #2563eb);
			color: white;
			animation: steps-pulse 2s ease-in-out infinite;
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

		&:hover {
			opacity: 0.8;
			transition: none;
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

		.step.vertical & {
			width: 2px;
			min-height: 1.5rem;
			flex: 1;
			margin-left: calc(var(--circle-size) / 2 - 1px);
			margin-top: 0.25rem;
			margin-bottom: 0.25rem;
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
	@keyframes steps-pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 rgb(from var(--color-action, #2563eb) r g b / 0.4);
		}
		50% {
			box-shadow: 0 0 0 6px rgb(from var(--color-action, #2563eb) r g b / 0);
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
