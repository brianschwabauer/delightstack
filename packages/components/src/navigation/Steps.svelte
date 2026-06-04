<script lang="ts" module>
	export { default as Step } from './Steps.svelte';

	export interface StepsContext {
		current: number;
		orientation: 'horizontal' | 'vertical';
		clickable: boolean;
		linear: boolean;
		size: string;
		totalSteps: number;
		register: () => number;
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
		<div class="step-main">
			{#if canClick}
				<button
					type="button"
					class="step-circle"
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
						<span class="step-number">{stepIndex + 1}</span>
					{/if}
				</button>
			{:else}
				<span class="step-circle" role="img" aria-label={ariaLabel}>
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
						<span class="step-number">{stepIndex + 1}</span>
					{:else}
						<span class="step-number">{stepIndex + 1}</span>
					{/if}
				</span>
			{/if}

			<div class="step-label">
				<span class="step-title">{title}</span>
				{#if description}
					<span class="step-description">{description}</span>
				{/if}
				{#if optional}
					<span class="step-optional">Optional</span>
				{/if}
			</div>
		</div>

		{#if !isLast}
			<div class="step-connector">
				<div class="step-connector-fill" class:filled={connectorFilled}></div>
			</div>
		{/if}

		{#if children && isCurrent}
			<div class="step-content">
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
			<div class="step skeleton-step">
				<div class="step-main">
					<div class="skeleton-circle" style:animation-delay="{i * 150}ms"></div>
					<div class="step-label">
						<div
							class="skeleton-bar skeleton-title"
							style:animation-delay="{i * 150 + 50}ms">
						</div>
						<div
							class="skeleton-bar skeleton-desc"
							style:animation-delay="{i * 150 + 100}ms">
						</div>
					</div>
				</div>
				{#if i < skeleton_count - 1}
					<div class="step-connector">
						<div class="skeleton-connector-line"></div>
					</div>
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

	.step-main {
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
	.step-circle {
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
			light-dark(var(--color-outline, #d1d5db), var(--color-outline, #4b5563));
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
	}

	button.step-circle {
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

	.step.complete .step-circle {
		background: var(--color-success, #16a34a);
		border-color: var(--color-success, #16a34a);
		color: white;
	}

	.step.current .step-circle {
		background: var(--color-action, #2563eb);
		border-color: var(--color-action, #2563eb);
		color: white;
		animation: steps-pulse 2s ease-in-out infinite;
	}

	.step.error .step-circle {
		background: var(--color-error, #dc2626);
		border-color: var(--color-error, #dc2626);
		color: white;
		animation: steps-shake 400ms ease;
	}

	/* ========== Checkmark draw-in ========== */
	.step.complete .checkmark path {
		stroke-dasharray: 30;
		stroke-dashoffset: 30;
		animation: steps-check-draw 400ms ease forwards;
	}

	/* ========== Step Number ========== */
	.step-number {
		line-height: 1;
		user-select: none;
	}

	/* ========== Labels ========== */
	.step-label {
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

	.step-title {
		font-weight: 500;
		font-size: var(--step-font-size);
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
		line-height: 1.3;
	}

	.step.upcoming .step-title {
		color: light-dark(
			var(--color-text-disabled, #9ca3af),
			var(--color-text-disabled, #6b7280)
		);
	}

	.step-description {
		font-size: calc(var(--step-font-size) * 0.85);
		color: light-dark(
			var(--color-text-disabled, #9ca3af),
			var(--color-text-disabled, #6b7280)
		);
		line-height: 1.3;
	}

	.step-optional {
		font-size: calc(var(--step-font-size) * 0.8);
		font-style: italic;
		color: light-dark(
			var(--color-text-disabled, #9ca3af),
			var(--color-text-disabled, #6b7280)
		);
	}

	/* ========== Connector ========== */
	.step-connector {
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
			background: light-dark(var(--color-outline, #d1d5db), var(--color-outline, #4b5563));
		}

		.step.vertical & {
			width: 2px;
			min-height: 1.5rem;
			flex: 1;
			margin-left: calc(var(--circle-size) / 2 - 1px);
			margin-top: 0.25rem;
			margin-bottom: 0.25rem;
			background: light-dark(var(--color-outline, #d1d5db), var(--color-outline, #4b5563));
		}
	}

	.step-connector-fill {
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
	.step-content {
		padding: 0.75rem 0;
		width: 100%;

		.step.vertical & {
			padding-left: calc(var(--circle-size) + 0.625rem);
		}
	}

	/* ========== Skeleton ========== */
	.steps.skeleton {
		pointer-events: none;
	}

	.skeleton-step {
		display: flex;

		.steps.horizontal & {
			flex-direction: column;
			align-items: center;
			flex: 1;
		}

		.steps.vertical & {
			flex-direction: column;
			align-items: flex-start;
			flex: none;
		}
	}

	.skeleton-circle {
		width: var(--circle-size);
		height: var(--circle-size);
		min-width: var(--circle-size);
		min-height: var(--circle-size);
		border-radius: 9999px;
		background: light-dark(var(--color-outline, #e5e7eb), var(--color-outline, #374151));
		position: relative;
		overflow: hidden;

		&::after {
			content: '';
			position: absolute;
			top: 0;
			right: 0;
			bottom: 0;
			left: 0;
			transform: translateX(-100%);
			background-image: linear-gradient(
				90deg,
				rgb(from var(--color-text, #000) r g b / 0) 0,
				rgb(from var(--color-text, #000) r g b / 0.08) 20%,
				rgb(from var(--color-text, #000) r g b / 0.15) 60%,
				rgb(from var(--color-text, #000) r g b / 0)
			);
			animation: steps-shimmer 2s infinite;
		}
	}

	.skeleton-bar {
		border-radius: 4px;
		background: light-dark(var(--color-outline, #e5e7eb), var(--color-outline, #374151));
		position: relative;
		overflow: hidden;

		&::after {
			content: '';
			position: absolute;
			top: 0;
			right: 0;
			bottom: 0;
			left: 0;
			transform: translateX(-100%);
			background-image: linear-gradient(
				90deg,
				rgb(from var(--color-text, #000) r g b / 0) 0,
				rgb(from var(--color-text, #000) r g b / 0.08) 20%,
				rgb(from var(--color-text, #000) r g b / 0.15) 60%,
				rgb(from var(--color-text, #000) r g b / 0)
			);
			animation: steps-shimmer 2s infinite;
		}

		&.skeleton-title {
			width: 4rem;
			height: 0.75rem;
		}

		&.skeleton-desc {
			width: 3rem;
			height: 0.5rem;
			margin-top: 0.25rem;
		}
	}

	.skeleton-connector-line {
		background: light-dark(var(--color-outline, #e5e7eb), var(--color-outline, #374151));

		.steps.horizontal & {
			width: 100%;
			height: 2px;
			position: absolute;
			top: calc(var(--circle-size) / 2);
			left: calc(50% + var(--circle-size) / 2 + 4px);
			width: calc(100% - var(--circle-size) - 8px);
		}

		.steps.vertical & {
			width: 2px;
			min-height: 1.5rem;
			margin-left: calc(var(--circle-size) / 2 - 1px);
			margin-top: 0.25rem;
			margin-bottom: 0.25rem;
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

	@keyframes steps-shimmer {
		100% {
			transform: translateX(100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.step.current .step-circle {
			animation: none;
		}
		.step.error .step-circle {
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
		.step-connector-fill {
			transition: none;
		}
	}
</style>
