<script lang="ts" module>
	export { default as TimelineItem } from './Timeline.svelte';

	export interface TimelineContext {
		horizontal: boolean;
		alternate: boolean;
		dense: boolean;
		comfortable: boolean;
		register: () => number;
	}
</script>

<script lang="ts">
	import { intersectionObserver } from '@delightstack/utilities';
	import { getContext, setContext, type Component, type Snippet } from 'svelte';
	import Button from './../actions/Button.svelte';

	const propId = $props.id();

	let {
		/* --- TimelineItem props --- */
		/** Timestamp for this event */
		date = undefined as Date | string | undefined,

		/** Event title */
		title = '',

		/** Marker icon component */
		icon = undefined as Component | undefined,

		/** Marker color override */
		color = '' as string,

		/** Event status */
		status = undefined as 'complete' | 'active' | 'pending' | undefined,

		/* --- Timeline container props --- */
		/** Horizontal layout */
		horizontal = false,

		/** Alternate sides */
		alternate = false,

		/** Show pending indicator at end */
		pending = false,

		/** Compact spacing */
		dense = false,

		/** Relaxed spacing */
		comfortable = false,

		/** Loading skeleton */
		skeleton = false,

		/** Skeleton items count */
		skeletonCount = 3,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: className = '',

		/** Child content snippet */
		children = undefined as undefined | Snippet,

		/** On-demand loading */
		onloadmore = undefined as (() => void | Promise<void>) | undefined,
	} = $props();

	/* ------------------------------------------------------------------ */
	/*  Determine whether this instance is a container or an item         */
	/* ------------------------------------------------------------------ */
	const parentContext = getContext<TimelineContext | undefined>('timeline');
	const isItem = !!parentContext;

	/* ------------------------------------------------------------------ */
	/*  Timeline container behaviour                                       */
	/* ------------------------------------------------------------------ */
	let item_counter = 0;

	if (!isItem) {
		const ctx = $state<TimelineContext>({
			horizontal,
			alternate,
			dense,
			comfortable,
			register() {
				return item_counter++;
			},
		});
		setContext<TimelineContext>('timeline', ctx);

		$effect(() => {
			ctx.horizontal = horizontal;
			ctx.alternate = alternate;
			ctx.dense = dense;
			ctx.comfortable = comfortable;
		});
	}

	/* ------------------------------------------------------------------ */
	/*  TimelineItem behaviour                                             */
	/* ------------------------------------------------------------------ */
	const item_index = isItem ? parentContext.register() : -1;

	const is_horizontal = $derived(isItem ? parentContext.horizontal : horizontal);
	const is_alternate = $derived(isItem ? parentContext.alternate : alternate);
	const is_dense = $derived(isItem ? parentContext.dense : dense);
	const is_comfortable = $derived(isItem ? parentContext.comfortable : comfortable);
	const is_even = $derived(item_index % 2 === 0);

	/* ------------------------------------------------------------------ */
	/*  Scroll-reveal for items                                            */
	/* ------------------------------------------------------------------ */
	let visible = $state(false);

	/* ------------------------------------------------------------------ */
	/*  Date formatting                                                    */
	/* ------------------------------------------------------------------ */
	const formatted_date = $derived.by(() => {
		if (!date) return '';
		const d = typeof date === 'string' ? new Date(date) : date;
		if (isNaN(d.getTime())) return typeof date === 'string' ? date : '';
		return d.toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		});
	});

	const iso_date = $derived.by(() => {
		if (!date) return '';
		const d = typeof date === 'string' ? new Date(date) : date;
		if (isNaN(d.getTime())) return '';
		return d.toISOString();
	});

	/* ------------------------------------------------------------------ */
	/*  Load-more sentinel                                                 */
	/* ------------------------------------------------------------------ */
	function handleLoadMore() {
		onloadmore?.();
	}

	/* ------------------------------------------------------------------ */
	/*  Horizontal scroll: chevron next/prev buttons                       */
	/* ------------------------------------------------------------------ */
	let scroll_el = $state<HTMLElement | undefined>(undefined);
	let can_scroll_prev = $state(false);
	let can_scroll_next = $state(false);

	function updateScrollState() {
		if (!scroll_el) return;
		can_scroll_prev = scroll_el.scrollLeft > 4;
		can_scroll_next = scroll_el.scrollLeft + scroll_el.clientWidth < scroll_el.scrollWidth - 4;
	}

	function scrollNext() {
		if (!scroll_el) return;
		scroll_el.scrollBy({ left: scroll_el.clientWidth * 0.8, behavior: 'smooth' });
	}
	function scrollPrev() {
		if (!scroll_el) return;
		scroll_el.scrollBy({ left: -scroll_el.clientWidth * 0.8, behavior: 'smooth' });
	}

	$effect(() => {
		if (!horizontal || !scroll_el) return;
		updateScrollState();
		const el = scroll_el;
		const onScroll = () => updateScrollState();
		el.addEventListener('scroll', onScroll, { passive: true });
		const ro = new ResizeObserver(updateScrollState);
		ro.observe(el);
		return () => {
			el.removeEventListener('scroll', onScroll);
			ro.disconnect();
		};
	});
</script>

{#if isItem}
	<!-- TimelineItem -->
	<li
		class={['timeline-item', className].filter(Boolean).join(' ')}
		class:horizontal={is_horizontal}
		class:vertical={!is_horizontal}
		class:alternate={is_alternate}
		class:even={is_alternate && !is_even}
		class:odd={is_alternate && is_even}
		class:dense={is_dense}
		class:comfortable={is_comfortable}
		class:visible
		class:complete={status === 'complete'}
		class:active={status === 'active'}
		class:pending={status === 'pending'}
		{id}
		style:--marker-color={color || undefined}
		{@attach intersectionObserver({ onintersectonce: () => (visible = true) })}>
		<div class="timeline-marker">
			{#if icon}
				{@const Icon = icon}
				<span class="marker-icon">
					<Icon />
				</span>
			{:else}
				<span class="marker-dot"></span>
			{/if}
		</div>
		<div class="timeline-connector"></div>
		<div class="timeline-content">
			{#if date}
				<time class="timeline-date" datetime={iso_date}>{formatted_date}</time>
			{/if}
			{#if title}
				<div class="timeline-title">{title}</div>
			{/if}
			{#if children}
				<div class="timeline-body">
					{@render children()}
				</div>
			{/if}
		</div>
	</li>
{:else if skeleton}
	<!-- Skeleton -->
	<ol
		class={['timeline skeleton', horizontal ? 'horizontal' : 'vertical', className].filter(Boolean).join(' ')}
		class:dense
		class:comfortable
		{id}
		aria-hidden="true">
		{#each { length: skeletonCount } as _, i}
			<li class="timeline-item skeleton-item" class:horizontal class:vertical={!horizontal}>
				<div class="timeline-marker">
					<span class="skeleton-circle" style:animation-delay="{i * 150}ms"></span>
				</div>
				<div class="timeline-connector"></div>
				<div class="timeline-content">
					<div class="skeleton-bar skeleton-date" style:animation-delay="{i * 150 + 50}ms"></div>
					<div class="skeleton-bar skeleton-title-bar" style:animation-delay="{i * 150 + 100}ms"></div>
					<div class="skeleton-bar skeleton-body-bar" style:animation-delay="{i * 150 + 150}ms"></div>
				</div>
			</li>
		{/each}
	</ol>
{:else if horizontal}
	<!-- Horizontal timeline container with chevron next/prev controls -->
	<div class={['timeline-horizontal-wrap', className].filter(Boolean).join(' ')} {id}>
		{#if can_scroll_prev}
			<Button
				icon
				size="00"
				class="timeline-nav timeline-nav-prev"
				aria-label="Scroll back"
				onclick={scrollPrev}>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<polyline points="15 18 9 12 15 6" />
				</svg>
			</Button>
		{/if}
		<ol
			bind:this={scroll_el}
			class="timeline horizontal"
			class:alternate
			class:dense
			class:comfortable
			role="list">
			{@render children?.()}
			{#if pending}
				<li class="timeline-item timeline-pending horizontal">
					<div class="timeline-marker">
						<span class="marker-dot pending-dot"></span>
					</div>
				</li>
			{/if}
			{#if onloadmore}
				<li
					class="timeline-sentinel"
					aria-hidden="true"
					{@attach intersectionObserver({ onintersectonce: () => handleLoadMore() })}>
				</li>
			{/if}
		</ol>
		{#if can_scroll_next}
			<Button
				icon
				size="00"
				class="timeline-nav timeline-nav-next"
				aria-label="Scroll forward"
				onclick={scrollNext}>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<polyline points="9 18 15 12 9 6" />
				</svg>
			</Button>
		{/if}
	</div>
{:else}
	<!-- Timeline container -->
	<ol
		class={['timeline vertical', className].filter(Boolean).join(' ')}
		class:alternate
		class:dense
		class:comfortable
		{id}
		role="list">
		{@render children?.()}
		{#if pending}
			<li class="timeline-item timeline-pending vertical">
				<div class="timeline-marker">
					<span class="marker-dot pending-dot"></span>
				</div>
			</li>
		{/if}
		{#if onloadmore}
			<li
				class="timeline-sentinel"
				aria-hidden="true"
				{@attach intersectionObserver({ onintersectonce: () => handleLoadMore() })}>
			</li>
		{/if}
	</ol>
{/if}

<style>
	/* ========== Timeline Container ========== */
	.timeline {
		list-style: none;
		padding: 0;
		margin: 0;
		position: relative;
		width: 100%;

		&.vertical {
			display: flex;
			flex-direction: column;
		}

		&.horizontal {
			display: flex;
			flex-direction: row;
			overflow-x: auto;
			scroll-snap-type: x mandatory;
			-webkit-overflow-scrolling: touch;
			gap: 0;
			/* Hide the native scrollbar — we navigate via chevron controls */
			scrollbar-width: none;
		}
		&.horizontal::-webkit-scrollbar {
			display: none;
		}
	}

	/* ========== Horizontal Navigation ========== */
	.timeline-horizontal-wrap {
		position: relative;
		width: 100%;
	}
	/* The nav controls are <Button icon> instances (rendered by the Button
	 * component), so target their forwarded class names with :global, scoped
	 * inside the wrap. We only position + float them; Button owns appearance. */
	.timeline-horizontal-wrap :global(.timeline-nav) {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		z-index: 2;
		box-shadow:
			0 2px 6px rgba(0, 0, 0, 0.12),
			0 1px 2px rgba(0, 0, 0, 0.08);
		opacity: 0;
		animation: timeline-nav-fade 200ms ease forwards;
	}
	.timeline-horizontal-wrap :global(.timeline-nav-prev) {
		left: -0.75rem;
	}
	.timeline-horizontal-wrap :global(.timeline-nav-next) {
		right: -0.75rem;
	}
	@keyframes timeline-nav-fade {
		to { opacity: 1; }
	}

	/* ========== Timeline Item ========== */
	.timeline-item {
		position: relative;
		display: flex;
		opacity: 0;
		transform: translateY(20px);
		transition:
			opacity 500ms ease,
			transform 500ms ease;

		&.visible {
			opacity: 1;
			transform: translateY(0);
		}

		/* Vertical layout */
		&.vertical {
			flex-direction: row;
			padding-bottom: 1.5rem;
			gap: 1rem;
			padding-left: 0;

			&.dense {
				padding-bottom: 0.75rem;
				gap: 0.625rem;
			}

			&.comfortable {
				padding-bottom: 2.25rem;
				gap: 1.25rem;
			}
		}

		/* Horizontal layout */
		&.horizontal {
			flex-direction: column;
			align-items: center;
			min-width: 140px;
			padding-right: 1rem;
			scroll-snap-align: start;

			opacity: 0;
			transform: translateX(20px);

			&.visible {
				opacity: 1;
				transform: translateX(0);
			}

			&.dense {
				min-width: 104px;
				padding-right: 0.625rem;
			}

			&.comfortable {
				min-width: 200px;
				padding-right: 1.75rem;
			}
		}
	}

	/* ========== Alternate Mode (vertical) ========== */
	.timeline.vertical.alternate {
		padding-left: 50%;
	}

	.timeline-item.vertical.alternate {
		&.odd {
			flex-direction: row;
		}

		&.even {
			flex-direction: row-reverse;
			text-align: right;
			margin-left: calc(-100% + 12px);
		}
	}

	/* ========== Marker ========== */
	.timeline-marker {
		position: relative;
		z-index: 1;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.marker-dot {
		width: 12px;
		height: 12px;
		border-radius: 9999px;
		background: light-dark(
			var(--marker-color, var(--color-action, #2563eb)),
			var(--marker-color, var(--color-action, #3b82f6))
		);
		border: 2px solid light-dark(
			var(--color-bg, #fff),
			var(--color-bg, #1a1a1a)
		);
		box-shadow: 0 0 0 2px light-dark(
			var(--marker-color, var(--color-action, #2563eb)),
			var(--marker-color, var(--color-action, #3b82f6))
		);

		/* Complete status */
		.timeline-item.complete & {
			background: var(--marker-color, var(--color-success, #16a34a));
			box-shadow: 0 0 0 2px var(--marker-color, var(--color-success, #16a34a));
		}

		/* Active status */
		.timeline-item.active & {
			background: var(--marker-color, var(--color-action, #2563eb));
			box-shadow: 0 0 0 2px var(--marker-color, var(--color-action, #2563eb));
			animation: timeline-pulse 2s ease-in-out infinite;
		}

		/* Pending status */
		.timeline-item.pending & {
			background: transparent;
			border: 2px dashed light-dark(
				var(--marker-color, var(--color-text-muted, #9ca3af)),
				var(--marker-color, var(--color-text-muted, #6b7280))
			);
			box-shadow: none;
		}
	}

	.pending-dot {
		background: transparent;
		border: 2px dashed light-dark(
			var(--color-text-muted, #9ca3af),
			var(--color-text-muted, #6b7280)
		);
		box-shadow: none;
		animation: timeline-pulse 2s ease-in-out infinite;
	}

	.marker-icon {
		width: 24px;
		height: 24px;
		border-radius: 9999px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: light-dark(
			var(--marker-color, var(--color-action, #2563eb)),
			var(--marker-color, var(--color-action, #3b82f6))
		);
		color: white;
		font-size: 0.75rem;

		.timeline-item.complete & {
			background: var(--marker-color, var(--color-success, #16a34a));
		}

		.timeline-item.active & {
			background: var(--marker-color, var(--color-action, #2563eb));
			animation: timeline-pulse 2s ease-in-out infinite;
		}

		.timeline-item.pending & {
			background: transparent;
			border: 2px dashed light-dark(
				var(--marker-color, var(--color-text-muted, #9ca3af)),
				var(--marker-color, var(--color-text-muted, #6b7280))
			);
			color: light-dark(
				var(--color-text-muted, #9ca3af),
				var(--color-text-muted, #6b7280)
			);
		}

		& :global(svg) {
			width: 14px;
			height: 14px;
		}
	}

	.timeline-item.dense .marker-icon {
		width: 20px;
		height: 20px;
		font-size: 0.625rem;

		& :global(svg) {
			width: 12px;
			height: 12px;
		}
	}

	.timeline-item.comfortable .marker-icon {
		width: 32px;
		height: 32px;
		font-size: 0.875rem;

		& :global(svg) {
			width: 18px;
			height: 18px;
		}
	}

	/* ========== Connector (line between items) ========== */
	.timeline-connector {
		.timeline-item.vertical & {
			position: absolute;
			left: 5px;
			top: 16px;
			bottom: 0;
			width: 2px;
			background: light-dark(
				var(--color-border, #e5e7eb),
				var(--color-border, #374151)
			);
		}

		.timeline-item.vertical:last-child &,
		.timeline-pending & {
			display: none;
		}

		.timeline-item.horizontal & {
			position: absolute;
			top: 5px;
			left: 16px;
			right: 0;
			height: 2px;
			background: light-dark(
				var(--color-border, #e5e7eb),
				var(--color-border, #374151)
			);
		}

		.timeline-item.horizontal:last-child & {
			display: none;
		}
	}

	/* Connector adjustments for icon markers */
	.timeline-item.vertical:has(.marker-icon) .timeline-connector {
		left: 11px;
		top: 28px;
	}

	.timeline-item.vertical.dense:has(.marker-icon) .timeline-connector {
		left: 9px;
		top: 24px;
	}

	.timeline-item.vertical.comfortable:has(.marker-icon) .timeline-connector {
		left: 15px;
		top: 36px;
	}

	.timeline-item.horizontal:has(.marker-icon) .timeline-connector {
		top: 11px;
		left: 28px;
	}

	.timeline-item.horizontal.dense:has(.marker-icon) .timeline-connector {
		top: 9px;
		left: 24px;
	}

	.timeline-item.horizontal.comfortable:has(.marker-icon) .timeline-connector {
		top: 15px;
		left: 36px;
	}

	/* Alternate mode connector */
	.timeline-item.vertical.alternate .timeline-connector {
		left: -1px;
	}

	.timeline-item.vertical.alternate:has(.marker-icon) .timeline-connector {
		left: 11px;
	}

	.timeline-item.vertical.alternate.even:has(.marker-icon) .timeline-connector {
		left: auto;
		right: 11px;
	}

	.timeline-item.vertical.alternate.even .timeline-connector {
		left: auto;
		right: -1px;
	}

	/* ========== Content ========== */
	.timeline-content {
		flex: 1;
		min-width: 0;
		padding-top: 0;

		.timeline-item.horizontal & {
			margin-top: 0.75rem;
			text-align: center;
		}
	}

	.timeline-date {
		display: block;
		font-size: 0.75rem;
		color: light-dark(
			var(--color-text-muted, #6b7280),
			var(--color-text-muted, #9ca3af)
		);
		margin-bottom: 0.25rem;
		line-height: 1.3;

		.timeline-item.dense & {
			font-size: 0.6875rem;
			margin-bottom: 0.125rem;
		}

		.timeline-item.comfortable & {
			font-size: 0.8125rem;
			margin-bottom: 0.375rem;
		}
	}

	.timeline-title {
		font-weight: 600;
		font-size: 0.875rem;
		color: light-dark(
			var(--color-text, #1a1a1a),
			var(--color-text, #f5f5f5)
		);
		line-height: 1.4;

		.timeline-item.dense & {
			font-size: 0.8125rem;
		}

		.timeline-item.comfortable & {
			font-size: 1rem;
		}
	}

	.timeline-body {
		margin-top: 0.125rem;
		font-size: 0.8125rem;
		color: light-dark(
			var(--color-text-muted, #6b7280),
			var(--color-text-muted, #9ca3af)
		);
		line-height: 1.5;

		.timeline-item.dense & {
			margin-top: 0.0625rem;
			font-size: 0.75rem;
		}

		.timeline-item.comfortable & {
			margin-top: 0.25rem;
			font-size: 0.875rem;
		}
	}

	/* ========== Pending Indicator ========== */
	.timeline-pending {
		padding-bottom: 0;
	}

	/* ========== Load-more Sentinel ========== */
	.timeline-sentinel {
		height: 1px;
		width: 1px;
		overflow: hidden;
		position: absolute;
		bottom: 0;
	}

	/* ========== Skeleton ========== */
	.timeline.skeleton {
		pointer-events: none;
	}

	.skeleton-item {
		opacity: 1 !important;
		transform: none !important;
	}

	.skeleton-circle {
		width: 12px;
		height: 12px;
		border-radius: 9999px;
		background: light-dark(
			var(--color-border, #e5e7eb),
			var(--color-border, #374151)
		);
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
			animation: timeline-shimmer 2s infinite;
		}
	}

	.skeleton-bar {
		border-radius: 4px;
		background: light-dark(
			var(--color-border, #e5e7eb),
			var(--color-border, #374151)
		);
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
			animation: timeline-shimmer 2s infinite;
		}

		&.skeleton-date {
			width: 5rem;
			height: 0.625rem;
			margin-bottom: 0.375rem;
		}

		&.skeleton-title-bar {
			width: 8rem;
			height: 0.875rem;
			margin-bottom: 0.375rem;
		}

		&.skeleton-body-bar {
			width: 12rem;
			height: 0.625rem;
		}
	}

	/* ========== Animations ========== */
	@keyframes timeline-pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 rgb(from var(--color-action, #2563eb) r g b / 0.4);
		}
		50% {
			box-shadow: 0 0 0 6px rgb(from var(--color-action, #2563eb) r g b / 0);
		}
	}

	@keyframes timeline-shimmer {
		100% {
			transform: translateX(100%);
		}
	}

	/* ========== Reduced Motion ========== */
	@media (prefers-reduced-motion: reduce) {
		.timeline-item {
			opacity: 1 !important;
			transform: none !important;
			transition: none !important;
		}

		.marker-dot,
		.marker-icon,
		.pending-dot {
			animation: none !important;
		}

		.skeleton-circle::after,
		.skeleton-bar::after {
			animation: none;
		}
	}
</style>
