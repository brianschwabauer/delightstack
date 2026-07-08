<script lang="ts" module>
	export { default as AccordionItem } from './Accordion.svelte';

	export interface AccordionContext {
		/** Returns whether the item with the given value is currently expanded */
		isOpen: (value: string) => boolean;
		/** Expands/collapses the item with the given value */
		toggle: (value: string) => void;
		/** Whether the whole accordion is disabled */
		disabled: boolean;
		/** Whether the accordion uses dense (compact) spacing */
		dense: boolean;
		/** Whether the accordion uses comfortable (roomy) spacing */
		comfortable: boolean;
		/** Whether items are rendered as subtly filled surfaces */
		filled: boolean;
		/** Whether the whole accordion is wrapped in a bordered, rounded outline */
		outline: boolean;
		/** Whether the open item splits away from the list with a separating gap */
		separated: boolean;
	}
</script>

<script lang="ts">
	import { getContext, setContext, untrack, type Snippet } from 'svelte';
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

		/** Render each item as a subtly filled surface */
		filled = false,

		/** Wrap the whole accordion in a bordered, rounded outline */
		outline = false,

		/** Animate the open item apart from the list (rounds the split edges) */
		separated = false,

		/** Show skeleton shimmer placeholders */
		skeleton = false,

		/** Number of skeleton bars to render */
		skeleton_count = 3,

		/** The ID of the element */
		id = propId,

		/** Specifies a custom class name */
		class: class_name = '',
	} = $props();

	/* ------------------------------------------------------------------ */
	/*  Determine whether this instance is a container or an item         */
	/* ------------------------------------------------------------------ */
	const isItem = $derived(!!title || !!trigger);

	/* ------------------------------------------------------------------ */
	/*  Accordion container behaviour (context is set for containers)     */
	/* ------------------------------------------------------------------ */
	// Getters keep the flag fields live — items re-read the current prop values
	// whenever the container updates them (no snapshot + sync effect needed).
	const ctx: AccordionContext = {
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
		get disabled() {
			return disabled;
		},
		get dense() {
			return dense;
		},
		get comfortable() {
			return comfortable;
		},
		get filled() {
			return filled;
		},
		get outline() {
			return outline;
		},
		get separated() {
			return separated;
		},
	};

	// Only set context when this is a container (not an item).
	// Both setContext and getContext run unconditionally at the top level.
	// Container-vs-item is decided once at init (untracked on purpose).
	if (untrack(() => !title && !trigger)) {
		setContext<AccordionContext>('accordion', ctx);
	}

	/* ------------------------------------------------------------------ */
	/*  AccordionItem behaviour                                           */
	/* ------------------------------------------------------------------ */
	const accordion = getContext<AccordionContext | undefined>('accordion');

	const itemValue = $derived(typeof value === 'string' ? value : '');
	const isOpen = $derived(accordion ? accordion.isOpen(itemValue) : false);
	const isDisabled = $derived(accordion ? accordion.disabled || disabled : disabled);
	const isDense = $derived(accordion ? accordion.dense : dense);
	const isComfortable = $derived(accordion ? accordion.comfortable : comfortable);
	const isFilled = $derived(accordion ? accordion.filled : filled);
	const isOutline = $derived(accordion ? accordion.outline : outline);
	const isSeparated = $derived(accordion ? accordion.separated : separated);

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

		const container = target.closest('.accordion');
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
		class={['item', class_name].filter(Boolean).join(' ')}
		class:open={isOpen}
		class:dense={isDense}
		class:comfortable={isComfortable}
		class:filled={isFilled}
		class:outline={isOutline}
		class:separated={isSeparated}
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
			<span class="title">
				{#if trigger}
					{@render trigger()}
				{:else}
					{title}
				{/if}
			</span>
		</div>
		<div id={contentId} role="region" aria-labelledby={triggerId}>
			<Expand show={isOpen}>
				<div class="panel">
					{@render children?.()}
				</div>
			</Expand>
		</div>
	</div>
{:else if skeleton}
	<!-- Skeleton -->
	<div
		class={['accordion skeleton', class_name].filter(Boolean).join(' ')}
		class:dense
		class:comfortable
		{id}
		aria-hidden="true">
		{#each { length: skeleton_count } as _, i}
			<div class="skeleton-item" style:--shimmer-delay="{i * 120}ms">
				<div class="skeleton-chevron"></div>
				<div class="skeleton-bar" style:width="{40 + ((i * 37 + 13) % 35)}%"></div>
			</div>
		{/each}
	</div>
{:else}
	<!-- Accordion container -->
	<div
		class={['accordion', class_name].filter(Boolean).join(' ')}
		class:dense
		class:comfortable
		class:filled
		class:outline
		class:separated
		class:disabled
		{id}>
		{@render children?.()}
	</div>
{/if}

<style>
	/* ========== Accordion Container ========== */
	.accordion {
		width: 100%;
		/* Flex column keeps the open-item margins additive (block-flow would
		   collapse adjacent margins), so the separation gap animates cleanly. */
		display: flex;
		flex-direction: column;

		&.disabled {
			opacity: 0.5;
			pointer-events: none;
		}

		&.skeleton {
			pointer-events: none;
		}

		/* The outline frame and filled surfaces are drawn per-item (see .item)
		   so the single frame can split into rounded pieces in separated mode. */

		&.dense .skeleton-item {
			padding: 0.5rem 0.75rem;
			gap: 0.5rem;
			font-size: 0.875rem;
		}

		&.comfortable .skeleton-item {
			padding: 1.25rem 1.5rem;
			gap: 1rem;
		}
	}

	/* ========== AccordionItem ========== */
	.item {
		/* Subtle hairline separator between items (default & outline variants). */
		border-bottom: 1px solid
			light-dark(var(--color-border, #e5e7eb), var(--color-border, #374151));
		perspective: 100px;
		/* Open items glide apart; surfaces tint and corners round as the frame
		   splits into pieces (separated mode). */
		transition:
			margin 320ms cubic-bezier(0.23, 1, 0.32, 1),
			border-radius 320ms cubic-bezier(0.23, 1, 0.32, 1),
			background-color 300ms,
			border-color 300ms;

		/* The last item never draws a separator — the container edge (outline) or
		   nothing (plain/filled) closes the list. Kept as a transparent 1px so
		   every row stays the same height. */
		&:last-child {
			border-bottom-color: transparent;
		}

		&.disabled {
			opacity: 0.5;
			pointer-events: none;
		}

		.summary {
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

		&.dense .summary {
			padding: 0.5rem 0.75rem;
			gap: 0.5rem;
			font-size: 0.875rem;
		}

		&.comfortable .summary {
			padding: 1.25rem 1.5rem;
			gap: 1rem;
		}

		&.open .chevron {
			transform: rotate(90deg);
		}

		.title {
			flex: 1;
			font-weight: 500;
		}

		.panel {
			padding: 0 1.25rem 1rem;
			color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
		}

		&.dense .panel {
			padding: 0 0.75rem 0.5rem;
			font-size: 0.875rem;
		}

		&.comfortable .panel {
			padding: 0 1.5rem 1.25rem;
		}

		/* ================================================================ */
		/*  Rounded-surface variants (filled & outline)                     */
		/*  Both share one corner radius and keep their group's outer       */
		/*  corners rounded; per-item fills/borders let the single frame    */
		/*  split into rounded pieces when an item opens (separated mode).  */
		/* ================================================================ */
		&.filled,
		&.outline {
			--_cr: var(--radius-lg, 10px);
			overflow: clip;

			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				--_cr: calc(var(--radius-lg, 10px) * var(--squircle-ratio, 2));
			}

			/* The group keeps rounded outer corners even while fully connected. */
			&:first-child {
				border-start-start-radius: var(--_cr);
				border-start-end-radius: var(--_cr);
			}
			&:last-child {
				border-end-start-radius: var(--_cr);
				border-end-end-radius: var(--_cr);
			}
		}

		/* --- Filled — subtly tinted surfaces, hairline-separated.
		   Every item shares one fill; the open item is not tinted darker. --- */
		&.filled {
			background: light-dark(
				rgb(from var(--color-text, #000) r g b / 0.04),
				rgb(from var(--color-text, #fff) r g b / 0.05)
			);
		}

		/* --- Outline — per-item borders that merge into one frame --- */
		&.outline {
			border-inline: 1px solid
				light-dark(var(--color-border, #e5e7eb), var(--color-border, #374151));
		}
		/* Only the first item draws the frame's top edge while connected. */
		&.outline:first-child {
			border-top: 1px solid
				light-dark(var(--color-border, #e5e7eb), var(--color-border, #374151));
		}
		/* The frame's bottom edge (overrides the transparent last-child separator). */
		&.outline:last-child {
			border-bottom-color: light-dark(
				var(--color-border, #e5e7eb),
				var(--color-border, #374151)
			);
		}

		/* ================================================================ */
		/*  Separated mode — the open item splits away from the list        */
		/* ================================================================ */
		&.separated.open {
			margin-block: 0.625rem;
		}
		/* Never push the group's own outer edge — only gap toward a neighbour. */
		&.separated.open:first-child {
			margin-top: 0;
		}
		&.separated.open:last-child {
			margin-bottom: 0;
		}

		/* The active item becomes its own fully-rounded piece. */
		&.filled.separated.open,
		&.outline.separated.open {
			border-radius: var(--_cr);
		}
		/* Outline active closes its (now exposed) top edge. */
		&.outline.separated.open {
			border-top: 1px solid
				light-dark(var(--color-border, #e5e7eb), var(--color-border, #374151));
		}
		/* Filled active drops the hairline that would cross its rounded bottom. */
		&.filled.separated.open {
			border-bottom-color: transparent;
		}

		/* The item just ABOVE the active one rounds its bottom. */
		&.filled.separated:has(+ :global(.item.open)),
		&.outline.separated:has(+ :global(.item.open)) {
			border-end-start-radius: var(--_cr);
			border-end-end-radius: var(--_cr);
		}
		/* Filled: drop its hairline too — the rounded edge is the boundary. */
		&.filled.separated:has(+ :global(.item.open)) {
			border-bottom-color: transparent;
		}

		/* The item just BELOW the active one rounds its top. */
		&.filled.separated.open + :global(.item),
		&.outline.separated.open + :global(.item) {
			border-start-start-radius: var(--_cr);
			border-start-end-radius: var(--_cr);
		}
		/* Outline: that lower piece needs a top edge to close it. */
		&.outline.separated.open + :global(.item) {
			border-top: 1px solid
				light-dark(var(--color-border, #e5e7eb), var(--color-border, #374151));
		}
	}

	.chevron {
		flex-shrink: 0;
		/* Back-out spring so the rotation overshoots slightly and settles, rather
		   than a flat ease-out. Matches the chevron flip in Button/Select/Table. */
		transition: transform 250ms var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
		color: light-dark(var(--color-text-disabled, #888), var(--color-text-disabled, #888));
	}

	/* ========== Skeleton ========== */
	/* Mirrors .summary metrics (incl. dense/comfortable, nested above) so each
	   placeholder row is exactly the height of the real accordion header. */
	.skeleton-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem 1.25rem;
		border-bottom: 1px solid
			light-dark(var(--color-border, #e5e7eb), var(--color-border, #374151));
	}

	.skeleton-chevron,
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

	/* The real header leads with a 16px chevron icon. */
	.skeleton-chevron {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		border-radius: var(--radius-sm, 2px);
	}

	/* Title line — the bar's margins pad it out to one full text line (1lh)
	   so the row matches the real header's height exactly. */
	.skeleton-bar {
		height: 0.7em;
		margin-block: calc((1lh - 0.7em) / 2);
		border-radius: var(--radius-full, 1e5px);
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
		.skeleton-chevron::after,
		.skeleton-bar::after {
			animation: none;
		}
		.chevron,
		.item {
			transition: none;
		}
	}
</style>
