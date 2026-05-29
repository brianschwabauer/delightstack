<script lang="ts" module>
	export interface BreadcrumbItem {
		label: string;
		href?: string;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import Button from '../actions/Button.svelte';
	import List from '../display/List.svelte';
	import ListItem from '../display/ListItem.svelte';

	const propId = $props.id();

	let {
		/** The breadcrumb items to display */
		items = [] as BreadcrumbItem[],

		/** Max visible items before collapsing middle items into an ellipsis dropdown.
		 *  When undefined, the component auto-collapses to fit the container width. */
		maxItems = undefined as number | undefined,

		/** Whether to show a home icon as the first breadcrumb */
		showHome = true,

		/** The href for the home breadcrumb */
		homeHref = '/',

		/** The size of the breadcrumbs */
		size = '1' as '0' | '1' | '2' | '3',

		/** Whether to display skeleton loading state */
		skeleton = false,

		/** Number of skeleton placeholder items */
		skeletonCount = 3,

		/** The ID of the element */
		id = propId,

		/** Specifies a custom class name */
		class: className = '',

		/** Custom rendering snippet */
		children = undefined as undefined | Snippet,

		/** Custom separator snippet */
		separator = undefined as undefined | Snippet,

		/** Called when a breadcrumb item is clicked */
		onclick = undefined as ((detail: { item: BreadcrumbItem; index: number }) => void) | undefined,
	} = $props();

	const allItems = $derived<BreadcrumbItem[]>(
		showHome ? [{ label: 'Home', href: homeHref }, ...items] : items,
	);

	let containerEl: HTMLElement | undefined = $state(undefined);
	let availableWidth = $state(0);
	let allItemsWidth = $state(0);

	function measureWidths() {
		if (!containerEl) return;
		availableWidth = containerEl.clientWidth;
		// Sum the natural width of all rendered breadcrumb children. We
		// re-measure on resize and on items change.
		const measure = containerEl.querySelector('.measurer') as HTMLElement | null;
		if (measure) allItemsWidth = measure.scrollWidth;
	}

	$effect(() => {
		if (!containerEl) return;
		const ro = new ResizeObserver(() => measureWidths());
		ro.observe(containerEl);
		measureWidths();
		return () => ro.disconnect();
	});

	// Re-measure whenever items change
	$effect(() => {
		void allItems;
		queueMicrotask(measureWidths);
	});

	// Auto-collapse target: if all items fit, show them all. Otherwise progressively
	// reduce to show first 1 + last N until they fit. Always keeps last item visible.
	const autoLimit = $derived.by(() => {
		if (allItems.length === 0) return 0;
		if (availableWidth === 0 || allItemsWidth === 0) return allItems.length;
		if (allItemsWidth <= availableWidth) return allItems.length;
		// Conservative heuristic: when overflow, target ~3 visible items (first + last 2)
		// Then 4, 5, ... up to the full count. The measurer keeps re-firing as items
		// are added back in via ResizeObserver, so we don't need pixel-perfect math.
		for (let visible = 3; visible < allItems.length; visible++) {
			// Estimate per-item width as the average of all
			const estPerItem = allItemsWidth / allItems.length;
			const estimated = estPerItem * visible + 60; // 60px for ellipsis + separators
			if (estimated <= availableWidth) return visible;
		}
		return 3;
	});

	const resolvedMaxItems = $derived(maxItems ?? autoLimit);

	const shouldCollapse = $derived(
		resolvedMaxItems >= 2 && allItems.length > resolvedMaxItems,
	);

	const firstItem = $derived(shouldCollapse ? allItems[0] : undefined);
	const hiddenItems = $derived(
		shouldCollapse ? allItems.slice(1, allItems.length - (resolvedMaxItems - 2)) : [],
	);
	const tailItems = $derived(
		shouldCollapse ? allItems.slice(allItems.length - (resolvedMaxItems - 2)) : [],
	);
	const visibleItems = $derived(shouldCollapse ? [] : allItems);

	function handleItemClick(item: BreadcrumbItem, index: number) {
		onclick?.({ item, index });
	}

	const schemaJson = $derived(
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'BreadcrumbList',
			itemListElement: allItems.map((item, i) => ({
				'@type': 'ListItem',
				position: i + 1,
				name: item.label,
				...(item.href ? { item: item.href } : {}),
			})),
		}),
	);
</script>

{#snippet sep()}
	<li class="breadcrumb-separator" aria-hidden="true">
		{#if separator}
			{@render separator()}
		{:else}
			<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
				<path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
			</svg>
		{/if}
	</li>
{/snippet}

{#snippet homeIcon()}
	<svg class="home-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
		<path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
	</svg>
{/snippet}

{#snippet itemButton(item: BreadcrumbItem, index: number, isLast: boolean)}
	{#if isLast}
		<span class="breadcrumb-label current">
			{#if showHome && index === 0}
				{@render homeIcon()}
				<span class="sr-only">{item.label}</span>
			{:else}
				{item.label}
			{/if}
		</span>
	{:else}
		<Button
			transparent
			dense
			href={item.href}
			onclick={item.href ? undefined : () => handleItemClick(item, index)}>
			{#if showHome && index === 0}
				{@render homeIcon()}
				<span class="sr-only">{item.label}</span>
			{:else}
				<span class="breadcrumb-label">{item.label}</span>
			{/if}
		</Button>
	{/if}
{/snippet}

{#if skeleton}
	<nav
		class={['breadcrumbs', `size-${size}`, className].filter(Boolean).join(' ')}
		aria-label="Breadcrumb"
		aria-hidden="true"
		{id}>
		<ol class="breadcrumb-list">
			{#each { length: skeletonCount } as _, i}
				{#if i > 0}{@render sep()}{/if}
				<li class="breadcrumb-item">
					<span class="skeleton-bar" style:animation-delay="{i * 150}ms"></span>
				</li>
			{/each}
		</ol>
	</nav>
{:else if children}
	<nav
		class={['breadcrumbs', `size-${size}`, className].filter(Boolean).join(' ')}
		aria-label="Breadcrumb"
		{id}>
		{@render children()}
	</nav>
	{#if allItems.length > 0}
		{@html `<script type="application/ld+json">${schemaJson}</script>`}
	{/if}
{:else}
	<nav
		class={['breadcrumbs', `size-${size}`, className].filter(Boolean).join(' ')}
		aria-label="Breadcrumb"
		bind:this={containerEl}
		{id}>
		<!-- Hidden measurer to compute the natural width of all items
		     for the auto-collapse heuristic. -->
		<ol class="breadcrumb-list measurer" aria-hidden="true">
			{#each allItems as item, i}
				{#if i > 0}{@render sep()}{/if}
				<li class="breadcrumb-item">
					{@render itemButton(item, i, i === allItems.length - 1)}
				</li>
			{/each}
		</ol>

		<ol class="breadcrumb-list visible-list">
			{#if shouldCollapse}
				{@const fi = firstItem!}
				<li class="breadcrumb-item">
					{@render itemButton(fi, 0, false)}
				</li>

				{@render sep()}

				<li class="breadcrumb-item">
					<Button
						transparent
						dense
						tooltip="Show hidden items"
						popoverPlacement="bottom-start">
						{#snippet children()}…{/snippet}
						{#snippet menu({ close })}
							<List>
								{#each hiddenItems as h, hi (h.href ?? hi)}
									{@const hIndex = hi + 1}
									<ListItem
										href={h.href}
										onclick={() => {
											handleItemClick(h, hIndex);
											close();
										}}>
										{h.label}
									</ListItem>
								{/each}
							</List>
						{/snippet}
					</Button>
				</li>

				{#each tailItems as item, ti}
					{@const originalIndex = allItems.length - tailItems.length + ti}
					{@const isLast = ti === tailItems.length - 1}
					{@render sep()}
					<li
						class="breadcrumb-item"
						class:current={isLast}
						aria-current={isLast ? 'page' : undefined}>
						{@render itemButton(item, originalIndex, isLast)}
					</li>
				{/each}
			{:else}
				{#each visibleItems as item, i}
					{@const isLast = i === visibleItems.length - 1}
					{#if i > 0}{@render sep()}{/if}
					<li
						class="breadcrumb-item"
						class:current={isLast}
						aria-current={isLast ? 'page' : undefined}>
						{@render itemButton(item, i, isLast)}
					</li>
				{/each}
			{/if}
		</ol>
	</nav>

	{#if allItems.length > 0}
		{@html `<script type="application/ld+json">${schemaJson}</script>`}
	{/if}
{/if}

<style>
	.breadcrumbs {
		display: block;
		position: relative;
		font-size: var(--font-size-1, 0.875rem);
		&.size-0 { font-size: var(--font-size-0, 0.75rem); }
		&.size-1 { font-size: var(--font-size-1, 0.875rem); }
		&.size-2 { font-size: var(--font-size-2, 1rem); }
		&.size-3 { font-size: var(--font-size-3, 1.125rem); }
	}

	.breadcrumb-list {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		list-style: none;
		margin: 0;
		padding: 0;
		color: light-dark(
			var(--color-text-muted, #6b7280),
			var(--color-text-muted, #9ca3af)
		);
	}

	.measurer {
		visibility: hidden;
		position: absolute;
		top: -9999px;
		left: 0;
		pointer-events: none;
		flex-wrap: nowrap;
		white-space: nowrap;
	}

	.breadcrumb-item {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.breadcrumb-item.current {
		color: light-dark(
			var(--color-text, #1a1a1a),
			var(--color-text, #f5f5f5)
		);
		font-weight: 500;
	}

	.breadcrumb-label {
		max-width: 150px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		display: inline-block;
	}
	.breadcrumb-label.current {
		padding: 0 0.5em;
	}

	.breadcrumb-separator {
		color: light-dark(
			var(--color-text-disabled, #9ca3af),
			var(--color-text-disabled, #6b7280)
		);
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	.breadcrumb-separator svg {
		display: block;
	}

	.home-icon {
		display: block;
		flex-shrink: 0;
	}

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

	.skeleton-bar {
		display: block;
		height: 0.875em;
		width: 4rem;
		border-radius: var(--radius-1, 0.25rem);
		background: light-dark(
			var(--color-border, #e5e7eb),
			var(--color-border, #374151)
		);
		position: relative;
		overflow: hidden;
	}
	.skeleton-bar::after {
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
		animation: breadcrumb-shimmer 2s infinite;
	}

	@keyframes breadcrumb-shimmer {
		100% {
			transform: translateX(100%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton-bar::after {
			animation: none;
		}
	}
</style>
