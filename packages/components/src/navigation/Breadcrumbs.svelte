<script lang="ts" module>
	export interface BreadcrumbItem {
		label: string;
		href?: string;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	const propId = $props.id();

	let {
		/** The breadcrumb items to display */
		items = [] as BreadcrumbItem[],

		/** Max visible items before collapsing middle items into an ellipsis dropdown */
		maxItems = undefined as number | undefined,

		/** Whether to show a home icon as the first breadcrumb */
		showHome = true,

		/** The href for the home breadcrumb */
		homeHref = '/',

		/** The size of the breadcrumbs. 0=small, 1=default, 2=medium, 3=large */
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

	/* ------------------------------------------------------------------ */
	/*  Size map                                                          */
	/* ------------------------------------------------------------------ */
	const sizeMap: Record<string, string> = {
		'0': 'var(--font-size-0, 0.75rem)',
		'1': 'var(--font-size-1, 0.875rem)',
		'2': 'var(--font-size-2, 1rem)',
		'3': 'var(--font-size-3, 1.125rem)',
	};

	/* ------------------------------------------------------------------ */
	/*  All items including optional home                                  */
	/* ------------------------------------------------------------------ */
	const allItems = $derived<BreadcrumbItem[]>(
		showHome
			? [{ label: 'Home', href: homeHref }, ...items]
			: items,
	);

	/* ------------------------------------------------------------------ */
	/*  Collapsing logic                                                   */
	/* ------------------------------------------------------------------ */
	let dropdownOpen = $state(false);

	const shouldCollapse = $derived(
		maxItems !== undefined && maxItems >= 2 && allItems.length > maxItems,
	);

	// The first item is always shown
	const firstItem = $derived(shouldCollapse ? allItems[0] : undefined);

	// Hidden items shown in the dropdown
	const hiddenItems = $derived(
		shouldCollapse ? allItems.slice(1, allItems.length - (maxItems! - 2)) : [],
	);

	// Tail items shown after the ellipsis
	const tailItems = $derived(
		shouldCollapse ? allItems.slice(allItems.length - (maxItems! - 2)) : [],
	);

	// Visible items when not collapsing
	const visibleItems = $derived(shouldCollapse ? [] : allItems);

	function toggleDropdown() {
		dropdownOpen = !dropdownOpen;
	}

	function closeDropdown() {
		dropdownOpen = false;
	}

	function handleItemClick(item: BreadcrumbItem, index: number) {
		onclick?.({ item, index });
	}

	/* ------------------------------------------------------------------ */
	/*  Schema.org structured data                                         */
	/* ------------------------------------------------------------------ */
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

{#if skeleton}
	<nav
		class={['breadcrumbs', className].filter(Boolean).join(' ')}
		aria-label="Breadcrumb"
		aria-hidden="true"
		style:font-size={sizeMap[size] ?? sizeMap['1']}
		{id}>
		<ol class="breadcrumb-list">
			{#each { length: skeletonCount } as _, i}
				{#if i > 0}
					<li class="breadcrumb-separator" aria-hidden="true">
						{#if separator}
							{@render separator()}
						{:else}
							<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
								<path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
							</svg>
						{/if}
					</li>
				{/if}
				<li class="breadcrumb-item">
					<span class="skeleton-bar" style:animation-delay="{i * 150}ms"></span>
				</li>
			{/each}
		</ol>
	</nav>
{:else if children}
	<nav
		class={['breadcrumbs', className].filter(Boolean).join(' ')}
		aria-label="Breadcrumb"
		style:font-size={sizeMap[size] ?? sizeMap['1']}
		{id}>
		{@render children()}
	</nav>
	{#if allItems.length > 0}
		{@html `<script type="application/ld+json">${schemaJson}</script>`}
	{/if}
{:else}
	<nav
		class={['breadcrumbs', className].filter(Boolean).join(' ')}
		aria-label="Breadcrumb"
		style:font-size={sizeMap[size] ?? sizeMap['1']}
		{id}>
		<ol class="breadcrumb-list">
			{#if shouldCollapse}
				<!-- First item (always visible) -->
				{@const item = firstItem!}
				{@const originalIndex = 0}
				<li class="breadcrumb-item">
					{#if item.href}
						<a
							href={item.href}
							onclick={() => handleItemClick(item, originalIndex)}>
							{#if showHome && originalIndex === 0}
								<svg class="home-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
									<path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
								</svg>
								<span class="sr-only">{item.label}</span>
							{:else}
								<span class="breadcrumb-label">{item.label}</span>
							{/if}
						</a>
					{:else}
						<span class="breadcrumb-label">{item.label}</span>
					{/if}
				</li>

				<!-- Separator before ellipsis -->
				<li class="breadcrumb-separator" aria-hidden="true">
					{#if separator}
						{@render separator()}
					{:else}
						<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
							<path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
						</svg>
					{/if}
				</li>

				<!-- Ellipsis dropdown -->
				<li class="breadcrumb-item breadcrumb-ellipsis-wrapper">
					<button
						type="button"
						class="breadcrumb-ellipsis-btn"
						aria-label="Show hidden breadcrumbs"
						aria-expanded={dropdownOpen}
						onclick={toggleDropdown}>
						&hellip;
					</button>
					{#if dropdownOpen}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="breadcrumb-dropdown" onmouseleave={closeDropdown}>
							{#each hiddenItems as hiddenItem, hi}
								{@const hiddenIndex = hi + 1}
								<a
									href={hiddenItem.href}
									class="breadcrumb-dropdown-item"
									onclick={() => { handleItemClick(hiddenItem, hiddenIndex); closeDropdown(); }}>
									{hiddenItem.label}
								</a>
							{/each}
						</div>
					{/if}
				</li>

				<!-- Tail items -->
				{#each tailItems as item, ti}
					{@const originalIndex = allItems.length - tailItems.length + ti}
					{@const isLast = ti === tailItems.length - 1}

					<!-- Separator -->
					<li class="breadcrumb-separator" aria-hidden="true">
						{#if separator}
							{@render separator()}
						{:else}
							<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
								<path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
							</svg>
						{/if}
					</li>

					<li
						class="breadcrumb-item"
						class:current={isLast}
						aria-current={isLast ? 'page' : undefined}>
						{#if isLast || !item.href}
							<span class="breadcrumb-label">{item.label}</span>
						{:else}
							<a
								href={item.href}
								onclick={() => handleItemClick(item, originalIndex)}>
								<span class="breadcrumb-label">{item.label}</span>
							</a>
						{/if}
					</li>
				{/each}
			{:else}
				<!-- Normal (non-collapsed) rendering -->
				{#each visibleItems as item, i}
					{@const isLast = i === visibleItems.length - 1}

					{#if i > 0}
						<li class="breadcrumb-separator" aria-hidden="true">
							{#if separator}
								{@render separator()}
							{:else}
								<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
									<path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
								</svg>
							{/if}
						</li>
					{/if}

					<li
						class="breadcrumb-item"
						class:current={isLast}
						aria-current={isLast ? 'page' : undefined}>
						{#if isLast}
							{#if showHome && i === 0}
								<svg class="home-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
									<path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
								</svg>
								<span class="sr-only">{item.label}</span>
							{:else}
								<span class="breadcrumb-label">{item.label}</span>
							{/if}
						{:else if item.href}
							<a
								href={item.href}
								onclick={() => handleItemClick(item, i)}>
								{#if showHome && i === 0}
									<svg class="home-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
										<path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
									</svg>
									<span class="sr-only">{item.label}</span>
								{:else}
									<span class="breadcrumb-label">{item.label}</span>
								{/if}
							</a>
						{:else}
							{#if showHome && i === 0}
								<svg class="home-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
									<path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
								</svg>
								<span class="sr-only">{item.label}</span>
							{:else}
								<span class="breadcrumb-label">{item.label}</span>
							{/if}
						{/if}
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
	/* ========== Breadcrumbs Container ========== */
	.breadcrumbs {
		display: block;
	}

	.breadcrumb-list {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		list-style: none;
		margin: 0;
		padding: 0;
		color: light-dark(
			var(--color-text-muted, #6b7280),
			var(--color-text-muted, #9ca3af)
		);
	}

	/* ========== Breadcrumb Item ========== */
	.breadcrumb-item {
		display: flex;
		align-items: center;
		min-width: 0;
	}

	.breadcrumb-item a {
		color: inherit;
		text-decoration: none;
		transition: color 100ms ease;
		display: inline-flex;
		align-items: center;
	}

	.breadcrumb-item a:hover {
		color: light-dark(
			var(--color-text, #1a1a1a),
			var(--color-text, #f5f5f5)
		);
		text-decoration: underline;
	}

	.breadcrumb-item a:focus-visible {
		outline: 2px solid var(--color-accent, #1976d2);
		outline-offset: 2px;
		border-radius: 2px;
	}

	.breadcrumb-item.current {
		color: light-dark(
			var(--color-text, #1a1a1a),
			var(--color-text, #f5f5f5)
		);
		font-weight: 500;
	}

	/* ========== Label Truncation ========== */
	.breadcrumb-label {
		max-width: 150px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ========== Separator ========== */
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

	/* ========== Home Icon ========== */
	.home-icon {
		display: block;
		flex-shrink: 0;
	}

	/* ========== Screen Reader Only ========== */
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

	/* ========== Ellipsis Dropdown ========== */
	.breadcrumb-ellipsis-wrapper {
		position: relative;
	}

	.breadcrumb-ellipsis-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: 1px solid transparent;
		border-radius: var(--radius-2, 0.375rem);
		cursor: pointer;
		padding: 0 0.375rem;
		font-size: 1em;
		font-family: inherit;
		color: inherit;
		line-height: 1;
		letter-spacing: 0.1em;
		transition:
			background-color 100ms ease,
			border-color 100ms ease;
		-webkit-tap-highlight-color: transparent;
	}

	.breadcrumb-ellipsis-btn:hover {
		background: light-dark(
			rgb(from var(--color-text, #000) r g b / 0.06),
			rgb(from var(--color-text, #fff) r g b / 0.08)
		);
		border-color: light-dark(
			var(--color-border, #e5e7eb),
			var(--color-border, #374151)
		);
	}

	.breadcrumb-ellipsis-btn:focus-visible {
		outline: 2px solid var(--color-accent, #1976d2);
		outline-offset: 2px;
	}

	.breadcrumb-dropdown {
		position: absolute;
		top: calc(100% + 0.25rem);
		left: 50%;
		transform: translateX(-50%);
		background: light-dark(
			var(--color-surface-0, #fff),
			var(--color-surface-0, #1a1a1a)
		);
		border: 1px solid light-dark(
			var(--color-border, #e5e7eb),
			var(--color-border, #374151)
		);
		border-radius: var(--radius-2, 0.375rem);
		box-shadow:
			0 4px 6px -1px rgb(0 0 0 / 0.1),
			0 2px 4px -2px rgb(0 0 0 / 0.1);
		min-width: 8rem;
		z-index: 50;
		padding: 0.25rem;
		display: flex;
		flex-direction: column;
	}

	.breadcrumb-dropdown-item {
		display: block;
		padding: 0.375rem 0.75rem;
		color: light-dark(
			var(--color-text, #1a1a1a),
			var(--color-text, #f5f5f5)
		);
		text-decoration: none;
		border-radius: var(--radius-1, 0.25rem);
		white-space: nowrap;
		font-size: 0.875em;
		transition: background-color 100ms ease;
	}

	.breadcrumb-dropdown-item:hover {
		background: light-dark(
			rgb(from var(--color-text, #000) r g b / 0.06),
			rgb(from var(--color-text, #fff) r g b / 0.08)
		);
		text-decoration: none;
	}

	.breadcrumb-dropdown-item:focus-visible {
		outline: 2px solid var(--color-accent, #1976d2);
		outline-offset: -2px;
	}

	/* ========== Skeleton ========== */
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
			animation: breadcrumb-shimmer 2s infinite;
		}
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
