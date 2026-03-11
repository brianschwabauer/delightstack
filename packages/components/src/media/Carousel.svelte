<script lang="ts">
	import { ripple } from '@delightstack/utilities';
	import { type Snippet } from 'svelte';

	const propId = $props.id();
	let {
		/** The array of items to display in the carousel */
		items = [] as any[],

		/** The current slide index (bindable) */
		current = $bindable(0),

		/** Enable infinite loop (clones edge slides) */
		loop = false,

		/** Auto-advance interval in ms; true = 5000ms; disabled when prefers-reduced-motion: reduce */
		autoplay = false as boolean | number,

		/** Pause autoplay on hover/touch */
		pauseOnHover = true,

		/** Show prev/next arrow buttons */
		showArrows = true,

		/** Show dot indicators */
		showDots = true,

		/** Number of visible slides at once */
		slidesPerView = 1,

		/** CSS gap between slides */
		gap = '0',

		/** Adjacent slide peek amount (CSS length) */
		peek = '0',

		/** Scroll direction */
		orientation = 'horizontal' as 'horizontal' | 'vertical',

		/** Whether to show a loading skeleton */
		skeleton = false,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: className = '',

		/** Bindable reference to the root element */
		element = $bindable(undefined as HTMLElement | undefined),

		/** Render snippet for each slide */
		slide = undefined as Snippet<[item: any, index: number]> | undefined,

		/** Default slot content */
		children = undefined as Snippet | undefined,

		/** Called when the active slide changes */
		onchange = undefined as ((detail: { index: number }) => void) | undefined,
	}: {
		items?: any[];
		current?: number;
		autoplay?: boolean | number;
		pauseOnHover?: boolean;
		loop?: boolean;
		showArrows?: boolean;
		showDots?: boolean;
		slidesPerView?: number;
		gap?: string;
		peek?: string;
		orientation?: 'horizontal' | 'vertical';
		skeleton?: boolean;
		id?: string;
		class?: string;
		element?: HTMLElement | undefined;
		slide?: Snippet<[item: any, index: number]> | undefined;
		children?: Snippet;
		onchange?: (detail: { index: number }) => void;
	} = $props();

	/* ------------------------------------------------------------------ */
	/*  Derived values                                                     */
	/* ------------------------------------------------------------------ */
	const itemCount = $derived(items.length);
	const isHorizontal = $derived(orientation === 'horizontal');
	const effectiveSlidesPerView = $derived(Math.max(1, Math.min(slidesPerView, itemCount || 1)));
	const autoplayMs = $derived(autoplay === true ? 5000 : autoplay === false ? 0 : autoplay);
	const maxIndex = $derived(Math.max(0, itemCount - 1));

	/** Build the display list: real items with optional clones at edges for loop mode */
	const displayItems = $derived.by(() => {
		if (!loop || itemCount <= 1) {
			return items.map((item, i) => ({ item, real_index: i }));
		}
		// Clone the last `slidesPerView` items before, and first `slidesPerView` after
		const cloneCount = effectiveSlidesPerView;
		const before = items.slice(-cloneCount).map((item, i) => ({
			item,
			real_index: itemCount - cloneCount + i,
		}));
		const after = items.slice(0, cloneCount).map((item, i) => ({
			item,
			real_index: i,
		}));
		const main = items.map((item, i) => ({ item, real_index: i }));
		return [...before, ...main, ...after];
	});

	/** Offset into displayItems for the first real slide */
	const loopOffset = $derived(loop && itemCount > 1 ? effectiveSlidesPerView : 0);

	/* ------------------------------------------------------------------ */
	/*  State                                                              */
	/* ------------------------------------------------------------------ */
	let trackEl = $state<HTMLElement | undefined>(undefined);
	let paused = $state(false);
	let reducedMotion = $state(false);
	let suppressScrollHandler = $state(false);
	let scrollTimeout = $state<ReturnType<typeof setTimeout> | undefined>(undefined);

	/* ------------------------------------------------------------------ */
	/*  Reduced motion detection                                           */
	/* ------------------------------------------------------------------ */
	$effect(() => {
		const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
		reducedMotion = mql.matches;
		function onChange(e: MediaQueryListEvent) {
			reducedMotion = e.matches;
		}
		mql.addEventListener('change', onChange);
		return () => mql.removeEventListener('change', onChange);
	});

	/* ------------------------------------------------------------------ */
	/*  Scrolling helpers                                                   */
	/* ------------------------------------------------------------------ */
	function getSlideWidth(): number {
		if (!trackEl) return 0;
		const trackSize = isHorizontal ? trackEl.clientWidth : trackEl.clientHeight;
		// Parse gap value
		const gapPx = parseLength(gap, trackEl);
		const totalGap = (effectiveSlidesPerView - 1) * gapPx;
		return (trackSize - totalGap) / effectiveSlidesPerView;
	}

	function parseLength(value: string, reference: HTMLElement): number {
		if (!value || value === '0') return 0;
		const temp = document.createElement('div');
		temp.style.position = 'absolute';
		temp.style.visibility = 'hidden';
		temp.style.width = value;
		reference.appendChild(temp);
		const px = temp.clientWidth;
		reference.removeChild(temp);
		return px;
	}

	function scrollToIndex(index: number, smooth = true) {
		if (!trackEl) return;
		const displayIndex = index + loopOffset;
		const slideWidth = getSlideWidth();
		const gapPx = parseLength(gap, trackEl);
		const targetScroll = displayIndex * (slideWidth + gapPx);

		suppressScrollHandler = true;
		trackEl.style.scrollBehavior = smooth ? 'smooth' : 'auto';

		if (isHorizontal) {
			trackEl.scrollLeft = targetScroll;
		} else {
			trackEl.scrollTop = targetScroll;
		}

		// Re-enable scroll handler after animation settles
		setTimeout(() => {
			suppressScrollHandler = false;
		}, smooth ? 400 : 50);
	}

	/* ------------------------------------------------------------------ */
	/*  Initial scroll position (for loop mode)                            */
	/* ------------------------------------------------------------------ */
	$effect(() => {
		if (trackEl && loopOffset > 0) {
			// Scroll to real slide 0 without animation on mount
			scrollToIndex(current, false);
		}
	});

	/* ------------------------------------------------------------------ */
	/*  Detect current slide from scroll position                          */
	/* ------------------------------------------------------------------ */
	function handleScroll() {
		if (suppressScrollHandler || !trackEl) return;
		clearTimeout(scrollTimeout);
		scrollTimeout = setTimeout(() => {
			if (!trackEl) return;

			const slideWidth = getSlideWidth();
			const gapPx = parseLength(gap, trackEl);
			const scrollPos = isHorizontal ? trackEl.scrollLeft : trackEl.scrollTop;
			const displayIndex = Math.round(scrollPos / (slideWidth + gapPx));
			let realIndex = displayIndex - loopOffset;

			// Handle loop wrapping
			if (loop && itemCount > 1) {
				if (realIndex < 0) {
					realIndex = itemCount + realIndex;
					scrollToIndex(realIndex, false);
				} else if (realIndex >= itemCount) {
					realIndex = realIndex - itemCount;
					scrollToIndex(realIndex, false);
				}
			}

			realIndex = Math.max(0, Math.min(maxIndex, realIndex));
			if (realIndex !== current) {
				current = realIndex;
				onchange?.({ index: realIndex });
			}
		}, 80);
	}

	/* ------------------------------------------------------------------ */
	/*  Navigation                                                         */
	/* ------------------------------------------------------------------ */
	function goTo(index: number) {
		let target = index;
		if (loop) {
			if (target < 0) target = itemCount - 1;
			else if (target >= itemCount) target = 0;
		} else {
			target = Math.max(0, Math.min(maxIndex, target));
		}
		if (target === current && !loop) return;
		current = target;
		onchange?.({ index: target });
		scrollToIndex(target);
	}

	function prev() {
		goTo(current - 1);
	}

	function next() {
		goTo(current + 1);
	}

	const canGoPrev = $derived(loop || current > 0);
	const canGoNext = $derived(loop || current < maxIndex);

	/* ------------------------------------------------------------------ */
	/*  Keyboard navigation                                                */
	/* ------------------------------------------------------------------ */
	function handleKeyDown(e: KeyboardEvent) {
		if (skeleton) return;
		const prevKey = isHorizontal ? 'ArrowLeft' : 'ArrowUp';
		const nextKey = isHorizontal ? 'ArrowRight' : 'ArrowDown';
		if (e.key === prevKey) {
			e.preventDefault();
			prev();
		} else if (e.key === nextKey) {
			e.preventDefault();
			next();
		} else if (e.key === 'Home') {
			e.preventDefault();
			goTo(0);
		} else if (e.key === 'End') {
			e.preventDefault();
			goTo(maxIndex);
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Autoplay                                                           */
	/* ------------------------------------------------------------------ */
	$effect(() => {
		if (!autoplayMs || reducedMotion || paused || itemCount <= 1) return;
		const interval = setInterval(() => next(), autoplayMs);
		return () => clearInterval(interval);
	});

	function pauseAutoplay() {
		if (pauseOnHover) paused = true;
	}

	function resumeAutoplay() {
		if (pauseOnHover) paused = false;
	}

	/* ------------------------------------------------------------------ */
	/*  Sync external current changes to scroll position                   */
	/* ------------------------------------------------------------------ */
	let lastSynced = $state(-1);
	$effect(() => {
		const c = current;
		if (trackEl && c !== lastSynced) {
			lastSynced = c;
			scrollToIndex(c);
		}
	});

	/* ------------------------------------------------------------------ */
	/*  CSS custom properties                                              */
	/* ------------------------------------------------------------------ */
	const trackStyle = $derived(
		`--slides-per-view: ${effectiveSlidesPerView}; --carousel-gap: ${gap}; --carousel-peek: ${peek};`,
	);
</script>

{#if skeleton}
	<div
		class={['carousel', 'carousel-skeleton', className].filter(Boolean).join(' ')}
		{id}
		bind:this={element}>
		<div class="skeleton-track">
			{#each { length: effectiveSlidesPerView } as _}
				<div class="skeleton-slide"></div>
			{/each}
		</div>
		{#if showDots}
			<div class="skeleton-dots">
				{#each { length: 3 } as _}
					<div class="skeleton-dot"></div>
				{/each}
			</div>
		{/if}
	</div>
{:else}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class={['carousel', className].filter(Boolean).join(' ')}
		class:vertical={!isHorizontal}
		role="region"
		aria-roledescription="carousel"
		aria-label="Carousel"
		tabindex="0"
		{id}
		bind:this={element}
		onkeydown={handleKeyDown}
		onmouseenter={pauseAutoplay}
		onmouseleave={resumeAutoplay}
		ontouchstart={pauseAutoplay}
		ontouchend={resumeAutoplay}
		onfocusin={pauseAutoplay}
		onfocusout={resumeAutoplay}>

		<!-- Live region for screen readers -->
		<div class="sr-only" aria-live="polite" aria-atomic="true">
			Slide {current + 1} of {itemCount}
		</div>

		<!-- Track -->
		<div
			class="carousel-track"
			class:vertical={!isHorizontal}
			style={trackStyle}
			bind:this={trackEl}
			onscroll={handleScroll}>

			{#if children}
				{@render children()}
			{:else}
				{#each displayItems as { item, real_index }, i}
					<div
						class="carousel-slide"
						role="group"
						aria-roledescription="slide"
						aria-label="{real_index + 1} of {itemCount}"
						style:padding-left={i === 0 ? peek : undefined}
						style:padding-right={i === displayItems.length - 1 ? peek : undefined}>
						{#if slide}
							{@render slide(item, real_index)}
						{/if}
					</div>
				{/each}
			{/if}
		</div>

		<!-- Arrows -->
		{#if showArrows && itemCount > 1}
			<button
				type="button"
				class="carousel-arrow carousel-arrow-prev"
				class:vertical={!isHorizontal}
				aria-label="Previous slide"
				disabled={!canGoPrev}
				onclick={prev}
				{@attach ripple()}>
				{#if isHorizontal}
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				{:else}
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path d="M18 15l-6-6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				{/if}
			</button>

			<button
				type="button"
				class="carousel-arrow carousel-arrow-next"
				class:vertical={!isHorizontal}
				aria-label="Next slide"
				disabled={!canGoNext}
				onclick={next}
				{@attach ripple()}>
				{#if isHorizontal}
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				{:else}
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
						<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				{/if}
			</button>
		{/if}

		<!-- Dot indicators -->
		{#if showDots && itemCount > 1}
			<div class="carousel-dots" role="tablist" aria-label="Slide navigation">
				{#each items as _, i}
					<button
						type="button"
						class="carousel-dot"
						class:active={i === current}
						role="tab"
						aria-selected={i === current}
						aria-label="Go to slide {i + 1}"
						tabindex={i === current ? 0 : -1}
						onclick={() => goTo(i)}>
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.carousel {
		position: relative;
		width: 100%;
		overflow: hidden;
		outline: none;

		&:focus-visible {
			outline: 2px solid var(--color-action, #2563eb);
			outline-offset: 2px;
			border-radius: var(--radius-2, 0.375rem);
		}

		/* Show arrows on hover */
		& .carousel-arrow {
			opacity: 0;
			transition:
				opacity var(--duration-fast, 150ms) var(--ease-default, ease),
				background var(--duration-fast, 150ms) var(--ease-default, ease);
		}

		&:hover .carousel-arrow,
		&:focus-within .carousel-arrow {
			opacity: 1;
		}

		& .carousel-arrow:disabled {
			opacity: 0 !important;
			pointer-events: none;
		}
	}

	/* ========== Track ========== */
	.carousel-track {
		display: flex;
		overflow-x: auto;
		overflow-y: hidden;
		scroll-snap-type: x mandatory;
		scroll-behavior: smooth;
		scrollbar-width: none;
		-webkit-overflow-scrolling: touch;
		gap: var(--carousel-gap, 0);

		&::-webkit-scrollbar {
			display: none;
		}

		&.vertical {
			flex-direction: column;
			overflow-x: hidden;
			overflow-y: auto;
			scroll-snap-type: y mandatory;
		}
	}

	.carousel-slide {
		scroll-snap-align: start;
		flex: 0 0 calc(
			(100% - (var(--slides-per-view, 1) - 1) * var(--carousel-gap, 0px)) /
			var(--slides-per-view, 1)
		);
		min-width: 0;
		overflow: hidden;
	}

	.carousel-track.vertical .carousel-slide {
		flex: none;
		height: calc(
			(100% - (var(--slides-per-view, 1) - 1) * var(--carousel-gap, 0px)) /
			var(--slides-per-view, 1)
		);
		width: 100%;
	}

	/* ========== Arrows ========== */
	.carousel-arrow {
		position: absolute;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border: 1px solid var(--color-border, #e0e0e0);
		border-radius: var(--radius-full, 9999px);
		background: color-mix(in srgb, var(--color-surface, #fff) 90%, transparent);
		color: inherit;
		cursor: pointer;
		padding: 0;
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);

		&:hover {
			background: var(--color-surface, #fff);
		}

		&:focus-visible {
			outline: 2px solid var(--color-action, #2563eb);
			outline-offset: 2px;
		}
	}

	/* Horizontal arrow positioning */
	.carousel-arrow-prev:not(.vertical) {
		left: 0.5rem;
		top: 50%;
		transform: translateY(-50%);
	}

	.carousel-arrow-next:not(.vertical) {
		right: 0.5rem;
		top: 50%;
		transform: translateY(-50%);
	}

	/* Vertical arrow positioning */
	.carousel-arrow-prev.vertical {
		top: 0.5rem;
		left: 50%;
		transform: translateX(-50%);
	}

	.carousel-arrow-next.vertical {
		bottom: 0.5rem;
		left: 50%;
		transform: translateX(-50%);
	}

	/* ========== Dots ========== */
	.carousel-dots {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 0 0.25rem;
	}

	.carousel.vertical .carousel-dots {
		flex-direction: column;
		position: absolute;
		right: 0.5rem;
		top: 50%;
		transform: translateY(-50%);
		padding: 0 0.25rem 0 0.75rem;
	}

	.carousel-dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full, 9999px);
		border: none;
		padding: 0;
		cursor: pointer;
		background: var(--color-border, #ccc);
		transition: background var(--duration-fast, 150ms) var(--ease-default, ease),
			transform var(--duration-fast, 150ms) var(--ease-default, ease);

		&:hover {
			transform: scale(1.3);
		}

		&:focus-visible {
			outline: 2px solid var(--color-action, #2563eb);
			outline-offset: 2px;
		}

		&.active {
			background: var(--color-action, #2563eb);
			transform: scale(1.2);
		}
	}

	/* ========== Skeleton ========== */
	.carousel-skeleton {
		pointer-events: none;
	}

	.skeleton-track {
		display: flex;
		gap: var(--carousel-gap, 0.5rem);
	}

	.skeleton-slide {
		flex: 1;
		min-height: 200px;
		border-radius: var(--radius-3, 0.5rem);
		background: light-dark(
			var(--color-border, #e5e7eb),
			var(--color-border, #374151)
		);
		position: relative;
		overflow: hidden;

		&::after {
			content: '';
			position: absolute;
			inset: 0;
			transform: translateX(-100%);
			background-image: linear-gradient(
				90deg,
				rgb(from var(--color-text, #000) r g b / 0) 0,
				rgb(from var(--color-text, #000) r g b / 0.08) 20%,
				rgb(from var(--color-text, #000) r g b / 0.15) 60%,
				rgb(from var(--color-text, #000) r g b / 0)
			);
			animation: carousel-shimmer 2s infinite;
		}
	}

	.skeleton-dots {
		display: flex;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.75rem 0 0.25rem;
	}

	.skeleton-dot {
		width: 8px;
		height: 8px;
		border-radius: var(--radius-full, 9999px);
		background: light-dark(
			var(--color-border, #e5e7eb),
			var(--color-border, #374151)
		);
	}

	/* ========== Screen-reader only ========== */
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border-width: 0;
	}

	/* ========== Animations ========== */
	@keyframes carousel-shimmer {
		100% {
			transform: translateX(100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.carousel-track {
			scroll-behavior: auto;
		}

		.carousel-arrow,
		.carousel-dot {
			transition: none;
		}

		.skeleton-slide::after {
			animation: none;
		}
	}
</style>
