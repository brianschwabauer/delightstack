<script lang="ts" module>
	export { default as AccordionItem } from './Accordion.svelte';

	export interface AccordionContext {
		isOpen: (value: string) => boolean;
		toggle: (value: string) => void;
		disabled: boolean;
		dense: boolean;
		comfortable: boolean;
	}
</script>

<script lang="ts">
	import { getContext, setContext, type Snippet } from 'svelte';
	import Expand from './Expand.svelte';

	const propId = $props.id();

	let {
		/* --- AccordionItem props --- */
		/** The value identifying this item (required for AccordionItem) */
		value = $bindable('') as string | string[],

		/** The title text for this item's trigger */
		title = '',

		/** Custom trigger snippet (replaces default title rendering) */
		trigger = undefined as undefined | Snippet,

		/** Whether this individual item is disabled */
		disabled = false,

		/** Child content snippet */
		children = undefined as undefined | Snippet,

		/* --- Accordion container props --- */
		/** Allow multiple panels open simultaneously */
		multiple = false,

		/** Allow closing all items (when false, at least one stays open) */
		collapsible = true,

		/** Whether to display in a condensed view */
		dense = false,

		/** Whether to display in an expanded view */
		comfortable = false,

		/** Show skeleton shimmer placeholders */
		skeleton = false,

		/** Number of skeleton bars to render */
		skeletonCount = 3,

		/** The ID of the element */
		id = propId,

		/** Specifies a custom class name */
		class: className = '',
	} = $props();

	/* ------------------------------------------------------------------ */
	/*  Determine whether this instance is a container or an item         */
	/* ------------------------------------------------------------------ */
	const isItem = $derived(!!title || !!trigger);

	/* ------------------------------------------------------------------ */
	/*  Accordion container behaviour (context is set for containers)     */
	/* ------------------------------------------------------------------ */
	const ctx = $state<AccordionContext>({
		isOpen(val: string) {
			if (Array.isArray(value)) return value.includes(val);
			return value === val;
		},
		toggle(val: string) {
			if (multiple) {
				const arr: string[] = Array.isArray(value)
					? [...value]
					: value
						? [value as string]
						: [];
				const idx = arr.indexOf(val);
				if (idx >= 0) {
					if (!collapsible && arr.length === 1) return;
					arr.splice(idx, 1);
				} else {
					arr.push(val);
				}
				value = arr;
			} else {
				if (value === val) {
					if (!collapsible) return;
					value = '';
				} else {
					value = val;
				}
			}
		},
		disabled,
		dense,
		comfortable,
	});

	// Only set context when this is a container (not an item).
	// Both setContext and getContext run unconditionally at the top level.
	if (!title && !trigger) {
		setContext<AccordionContext>('accordion', ctx);
	}

	$effect(() => {
		ctx.disabled = disabled;
		ctx.dense = dense;
		ctx.comfortable = comfortable;
	});

	/* ------------------------------------------------------------------ */
	/*  AccordionItem behaviour                                           */
	/* ------------------------------------------------------------------ */
	const accordion = getContext<AccordionContext | undefined>('accordion');

	const itemValue = $derived(typeof value === 'string' ? value : '');
	const isOpen = $derived(accordion ? accordion.isOpen(itemValue) : false);
	const isDisabled = $derived(accordion ? accordion.disabled || disabled : disabled);
	const isDense = $derived(accordion ? accordion.dense : dense);
	const isComfortable = $derived(accordion ? accordion.comfortable : comfortable);

	const contentId = $derived(`${id}-content`);
	const triggerId = $derived(`${id}-trigger`);

	function handleToggle(e: Event) {
		e.preventDefault();
		if (isDisabled || !accordion) return;
		accordion.toggle(itemValue);
	}

	function handleKeyDown(e: KeyboardEvent) {
		const target = e.currentTarget as HTMLElement;

		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			handleToggle(e);
			return;
		}

		const container = target.closest('.ds-accordion');
		if (!container) return;

		const summaries = Array.from(
			container.querySelectorAll<HTMLElement>('.summary:not([aria-disabled="true"])'),
		);
		const idx = summaries.indexOf(target);
		if (idx === -1) return;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			summaries[(idx + 1) % summaries.length]?.focus();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			summaries[(idx - 1 + summaries.length) % summaries.length]?.focus();
		} else if (e.key === 'Home') {
			e.preventDefault();
			summaries[0]?.focus();
		} else if (e.key === 'End') {
			e.preventDefault();
			summaries[summaries.length - 1]?.focus();
		}
	}
</script>

{#if isItem}
	<!-- AccordionItem -->
	<div
		class={['accordion-item', className].filter(Boolean).join(' ')}
		class:open={isOpen}
		class:dense={isDense}
		class:comfortable={isComfortable}
		class:disabled={isDisabled}
		{id}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="summary"
			role="button"
			id={triggerId}
			tabindex={isDisabled ? -1 : 0}
			aria-expanded={isOpen}
			aria-controls={contentId}
			aria-disabled={isDisabled}
			onclick={handleToggle}
			onkeydown={handleKeyDown}>
			<svg class="chevron" width="16" height="16" viewBox="0 0 16 16" fill="none">
				<path
					d="M6 3L11 8L6 13"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round" />
			</svg>
			<span class="trigger-content">
				{#if trigger}
					{@render trigger()}
				{:else}
					{title}
				{/if}
			</span>
		</div>
		<div id={contentId} role="region" aria-labelledby={triggerId}>
			<Expand show={isOpen}>
				<div class="panel-content">
					{@render children?.()}
				</div>
			</Expand>
		</div>
	</div>
{:else if skeleton}
	<!-- Skeleton -->
	<div
		class={['ds-accordion skeleton', className].filter(Boolean).join(' ')}
		{id}
		aria-hidden="true">
		{#each { length: skeletonCount } as _, i}
			<div class="skeleton-item">
				<div class="skeleton-bar" style:animation-delay="{i * 150}ms"></div>
			</div>
		{/each}
	</div>
{:else}
	<!-- Accordion container -->
	<div
		class={['ds-accordion', className].filter(Boolean).join(' ')}
		class:dense
		class:comfortable
		class:disabled
		{id}>
		{@render children?.()}
	</div>
{/if}

<style>
	/* ========== Accordion Container ========== */
	.ds-accordion {
		width: 100%;

		&.disabled {
			opacity: 0.5;
			pointer-events: none;
		}
	}

	/* ========== AccordionItem ========== */
	.accordion-item {
		border-bottom: 1px solid
			light-dark(var(--color-border, #e5e7eb), var(--color-border, #374151));
		perspective: 100px;

		&.disabled {
			opacity: 0.5;
			pointer-events: none;
		}
	}

	.accordion-item .summary {
		display: flex;
		align-items: center;
		cursor: pointer;
		padding: 1rem 1.25rem;
		gap: 0.75rem;
		user-select: none;
		outline: none;
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
		-webkit-tap-highlight-color: transparent;
		transition:
			background-color 300ms,
			translate 200ms ease;

		&:focus-visible {
			box-shadow: inset 0 0 0 2px var(--color-accent, #1976d2);
			border-radius: 4px;
		}

		&:hover {
			background: light-dark(
				rgb(from var(--color-text, #000) r g b / 0.04),
				rgb(from var(--color-text, #fff) r g b / 0.06)
			);
			transition: translate 200ms ease;
		}
		&:active {
			translate: 0px 6px clamp(-7px, calc(0.2em - 6px), -2px);
		}
	}

	.accordion-item.dense .summary {
		padding: 0.5rem 0.75rem;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.accordion-item.comfortable .summary {
		padding: 1.25rem 1.5rem;
		gap: 1rem;
	}

	.chevron {
		flex-shrink: 0;
		transition: transform 250ms ease-out;
		color: light-dark(var(--color-text-disabled, #888), var(--color-text-disabled, #888));
	}

	.accordion-item.open .chevron {
		transform: rotate(90deg);
	}

	.trigger-content {
		flex: 1;
		font-weight: 500;
	}

	.panel-content {
		padding: 0 1.25rem 1rem;
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
	}

	.accordion-item.dense .panel-content {
		padding: 0 0.75rem 0.5rem;
		font-size: 0.875rem;
	}

	.accordion-item.comfortable .panel-content {
		padding: 0 1.5rem 1.25rem;
	}

	/* ========== Skeleton ========== */
	.ds-accordion.skeleton {
		pointer-events: none;
	}

	.skeleton-item {
		border-bottom: 1px solid
			light-dark(var(--color-border, #e5e7eb), var(--color-border, #374151));
		padding: 1rem 1.25rem;
	}

	.skeleton-bar {
		height: 1.25rem;
		width: 60%;
		border-radius: 4px;
		background: light-dark(var(--color-border, #e5e7eb), var(--color-border, #374151));
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
			animation: accordion-shimmer 2s infinite;
		}
	}

	@keyframes accordion-shimmer {
		100% {
			transform: translateX(100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-bar::after {
			animation: none;
		}
		.chevron {
			transition: none;
		}
	}
</style>
