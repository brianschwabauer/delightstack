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
		 *  When undefined, the component auto-collapses to fit the container width using
		 *  pure CSS container queries (no JS measurement, works during SSR). */
		max_items = undefined as number | undefined,

		/** Whether to show a home icon as the first breadcrumb */
		show_home = true,

		/** The href for the home breadcrumb */
		home_href = '/',

		/** The size of the breadcrumbs */
		size = '1' as '0' | '1' | '2' | '3',

		/** Condensed spacing: smaller gaps between items and separators */
		dense = false,

		/** Whether to display skeleton loading state. Only shown when `items` is empty —
		 *  as soon as any real items are provided the skeleton is replaced by them. */
		skeleton = false,

		/** Number of skeleton placeholder items */
		skeleton_count = 3,

		/** The ID of the element */
		id = propId,

		/** Specifies a custom class name */
		class: class_name = '',

		/** Custom rendering snippet */
		children = undefined as undefined | Snippet,

		/** Custom separator snippet */
		separator = undefined as undefined | Snippet,

		/** Called when a breadcrumb item is clicked */
		onclick = undefined as
			| ((detail: { item: BreadcrumbItem; index: number }) => void)
			| undefined,
	} = $props();

	const allItems = $derived<BreadcrumbItem[]>(
		show_home ? [{ label: 'Home', href: home_href }, ...items] : items,
	);

	// Only show the skeleton when explicitly requested AND there is no real data
	// yet. Once any item is provided, the real trail renders instead.
	const showSkeleton = $derived(skeleton && items.length === 0);

	// ──────────────────────────────────────────────────────────────────────
	// Width estimation (em, relative to the breadcrumb font-size).
	//
	// We can't measure the DOM during SSR, so each item's rendered width is
	// *estimated* from its label length. These estimates feed CSS custom
	// properties (`--bc-reveal`) that, combined with container query units
	// (`cqi`), let the browser collapse/expand items purely in CSS — so the
	// collapse is correct on the very first server-rendered paint.
	// ──────────────────────────────────────────────────────────────────────
	const CHAR_EM = 0.52; // approx width of one character
	const LABEL_MAX_EM = 11; // cap (mirrors the label's max-width truncation)
	const BTN_PAD_EM = 1.1; // breadcrumb button horizontal padding (0.55em per side)
	const CUR_PAD_EM = 1; // current (last) item uses lighter padding
	const SEP_EM = 1.4; // separator glyph + its padding
	const HOME_EM = 1; // home icon glyph
	const ELLIPSIS_EM = SEP_EM + 1.5; // leading sep + "…" trigger

	function estItem(
		item: BreadcrumbItem,
		index: number,
		isHome: boolean,
		isLast: boolean,
	): number {
		const lead = index === 0 ? 0 : SEP_EM;
		const pad = isLast ? CUR_PAD_EM : BTN_PAD_EM;
		if (isHome) return lead + pad + HOME_EM;
		const labelW = Math.min(item.label.length * CHAR_EM, LABEL_MAX_EM);
		return lead + pad + labelW;
	}

	const n = $derived(allItems.length);

	// head = always-visible first item; tail = always-visible last N items.
	const tailCount = $derived(max_items !== undefined ? Math.max(1, max_items - 2) : 2);
	const tailStart = $derived(n - tailCount);

	const collapsible = $derived(
		max_items !== undefined ? max_items >= 2 && n > max_items : n >= 4,
	);

	type MiddleEntry = { item: BreadcrumbItem; index: number; reveal: number };

	// Per-item reveal thresholds + the threshold at which the ellipsis disappears.
	const collapse = $derived.by(() => {
		if (!collapsible) {
			return { middle: [] as MiddleEntry[], ellipsisReveal: 0 };
		}
		const isAuto = max_items === undefined;
		const ests = allItems.map((it, i) =>
			estItem(it, i, show_home && i === 0, i === n - 1),
		);
		const middle: MiddleEntry[] = [];

		if (isAuto) {
			const fullTrail = ests.reduce((a, b) => a + b, 0);
			const baseB =
				ests[0] + ELLIPSIS_EM + ests.slice(tailStart).reduce((a, b) => a + b, 0);
			// Reveal middle items from the tail side inward: the right-most middle
			// item needs the least room, the left-most needs the most. Each
			// intermediate threshold includes the ellipsis (it's still showing).
			let suffix = 0;
			const reveals: number[] = [];
			for (let i = tailStart - 1; i >= 1; i--) {
				suffix += ests[i];
				reveals[i] = baseB + suffix;
			}
			// Revealing the left-most middle item shows the *entire* trail — at which
			// point the ellipsis disappears, so drop its width from that threshold
			// (otherwise a trail that fits would still collapse). Keep it monotonic.
			reveals[1] = Math.max(fullTrail, reveals[2] ?? 0);
			for (let i = 1; i < tailStart; i++) {
				middle.push({ item: allItems[i], index: i, reveal: reveals[i] });
			}
			// Ellipsis hides once every middle item fits (the largest threshold).
			const ellipsisReveal = reveals[1] ?? baseB;
			return { middle, ellipsisReveal };
		}

		// Explicit max_items: collapse the whole middle block at once.
		const ALWAYS = 99999;
		for (let i = 1; i < tailStart; i++) {
			middle.push({ item: allItems[i], index: i, reveal: ALWAYS });
		}
		return { middle, ellipsisReveal: ALWAYS };
	});

	const middleEntries = $derived(collapse.middle);
	const ellipsisReveal = $derived(collapse.ellipsisReveal);
	const tailEntries = $derived(
		collapsible
			? allItems.slice(tailStart).map((item, i) => ({
					item,
					index: tailStart + i,
					isLast: tailStart + i === n - 1,
				}))
			: [],
	);

	const skeletonWidths = [4.5, 6, 3.5, 5, 4];

	function handleItemClick(item: BreadcrumbItem, index: number) {
		onclick?.({ item, index });
	}

	let navEl: HTMLElement | undefined = $state(undefined);

	// The inline collapse is pure CSS (so it's correct in SSR). The ellipsis
	// *menu* only matters once the user opens it (client-only), so its contents
	// are derived from measuring which inline copies the CSS has collapsed —
	// letting the menu reuse the real Button/Popover/List components.
	let collapsedSet = $state<Set<number>>(new Set());
	const collapsedEntries = $derived(
		middleEntries.filter((m) => collapsedSet.has(m.index)),
	);

	function syncLayout() {
		if (!navEl) return;
		// CSS collapses items to zero size but leaves them in the DOM (and tab
		// order). Mark the zero-size copies `inert` so only the visible copy is
		// focusable / announced.
		navEl.querySelectorAll<HTMLElement>('[data-bc-inert]').forEach((el) => {
			const r = el.getBoundingClientRect();
			const collapsed = r.width < 1 || r.height < 1;
			if (el.inert !== collapsed) el.inert = collapsed;
		});
		// Track which middle items are currently collapsed → the menu lists exactly
		// those (no duplication of the inline-visible ones).
		const next = new Set<number>();
		navEl.querySelectorAll<HTMLElement>('[data-bc-mid]').forEach((el) => {
			if (el.getBoundingClientRect().width < 1) next.add(Number(el.dataset.bcMid));
		});
		let changed = next.size !== collapsedSet.size;
		if (!changed) {
			for (const i of next) {
				if (!collapsedSet.has(i)) {
					changed = true;
					break;
				}
			}
		}
		if (changed) collapsedSet = next;
	}

	$effect(() => {
		if (!navEl) return;
		const ro = new ResizeObserver(() => syncLayout());
		ro.observe(navEl);
		syncLayout();
		return () => ro.disconnect();
	});

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

	const navClass = $derived(
		['breadcrumbs', `size-${size}`, dense ? 'dense' : '', class_name]
			.filter(Boolean)
			.join(' '),
	);
</script>

{#snippet sep()}
	{#if separator}
		{@render separator()}
	{:else}
		<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M9 18l6-6-6-6"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				fill="none" />
		</svg>
	{/if}
{/snippet}

{#snippet homeIcon()}
	<svg class="home-icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
		<path
			d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			fill="none" />
	</svg>
{/snippet}

{#snippet itemButton(item: BreadcrumbItem, index: number, isLast: boolean)}
	{#if isLast}
		<span class="breadcrumb-label current">
			{#if show_home && index === 0}
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
			{#if show_home && index === 0}
				{@render homeIcon()}
				<span class="sr-only">{item.label}</span>
			{:else}
				<span class="breadcrumb-label">{item.label}</span>
			{/if}
		</Button>
	{/if}
{/snippet}

{#if showSkeleton}
	<nav class={navClass} aria-label="Breadcrumb" aria-hidden="true" {id}>
		<ol class="breadcrumb-list">
			{#if show_home}
				<li class="breadcrumb-item">
					<span class="bc-skeleton-cell">{@render homeIcon()}</span>
				</li>
			{/if}
			{#each { length: skeleton_count } as _, i}
				{#if show_home || i > 0}
					<li class="breadcrumb-separator">{@render sep()}</li>
				{/if}
				<li class="breadcrumb-item">
					<span class="bc-skeleton-cell">
						<span
							class="skeleton-bar"
							style:width="{skeletonWidths[i % skeletonWidths.length]}em"
							style:animation-delay="{i * 150}ms">
						</span>
					</span>
				</li>
			{/each}
		</ol>
	</nav>
{:else if children}
	<nav class={navClass} aria-label="Breadcrumb" {id}>
		{@render children()}
	</nav>
	{#if allItems.length > 0}
		{@html `<script type="application/ld+json">${schemaJson}</script>`}
	{/if}
{:else}
	<nav class={navClass} aria-label="Breadcrumb" bind:this={navEl} {id}>
		<ol class="breadcrumb-list">
			{#if !collapsible}
				{#each allItems as item, i}
					{@const isLast = i === n - 1}
					{#if i > 0}<li class="breadcrumb-separator">{@render sep()}</li>{/if}
					<li
						class="breadcrumb-item"
						class:current={isLast}
						aria-current={isLast ? 'page' : undefined}>
						{@render itemButton(item, i, isLast)}
					</li>
				{/each}
			{:else}
				<!-- Head: always visible -->
				<li class="breadcrumb-item">
					{@render itemButton(allItems[0], 0, n === 1)}
				</li>

				<!-- Ellipsis: a real Button + Popover menu listing the collapsed items.
				     The separator + trigger collapse to zero (pure CSS) once every
				     middle item fits inline; the portaled Popover is unaffected. -->
				<li
					class="breadcrumb-separator bc-collapse-inv"
					style:--bc-reveal="{ellipsisReveal}em">
					{@render sep()}
				</li>
				<li
					class="breadcrumb-item bc-ellipsis bc-collapse-inv"
					style:--bc-reveal="{ellipsisReveal}em"
					data-bc-inert>
					<Button
						transparent
						dense
						aria-label="Show hidden breadcrumbs"
						tooltip="Show hidden breadcrumbs"
						popover_placement="bottom-start">
						{#snippet children()}…{/snippet}
						{#snippet menu({ close })}
							<List filled>
								{#each collapsedEntries as c (c.item.href ?? c.index)}
									<ListItem
										href={c.item.href}
										onclick={() => {
											handleItemClick(c.item, c.index);
											close();
										}}>
										{c.item.label}
									</ListItem>
								{/each}
							</List>
						{/snippet}
					</Button>
				</li>

				<!-- Middle items: collapse from the tail side inward as space shrinks -->
				{#each middleEntries as m (m.item.href ?? m.index)}
					<li class="breadcrumb-separator bc-collapse" style:--bc-reveal="{m.reveal}em">
						{@render sep()}
					</li>
					<li
						class="breadcrumb-item bc-collapse"
						style:--bc-reveal="{m.reveal}em"
						data-bc-inert
						data-bc-mid={m.index}>
						{@render itemButton(m.item, m.index, false)}
					</li>
				{/each}

				<!-- Tail: always visible -->
				{#each tailEntries as t (t.item.href ?? t.index)}
					<li class="breadcrumb-separator">{@render sep()}</li>
					<li
						class="breadcrumb-item"
						class:current={t.isLast}
						aria-current={t.isLast ? 'page' : undefined}>
						{@render itemButton(t.item, t.index, t.isLast)}
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
		/* Establish a query container so descendants can collapse/expand using
		 * container query units (cqi) — the engine of the SSR-safe auto-collapse.
		 * `container-type: inline-size` disables intrinsic sizing, so the element
		 * must fill its parent's width (otherwise it collapses to 0 in any
		 * shrink-to-fit context like a flex/inline parent). */
		container-type: inline-size;
		box-sizing: border-box;
		width: 100%;
		max-width: 100%;
		font-size: var(--text-base, 0.875rem);
		&.size-0 {
			font-size: var(--text-sm, 0.75rem);
		}
		&.size-1 {
			font-size: var(--text-base, 0.875rem);
		}
		&.size-2 {
			font-size: var(--text-lg, 1rem);
		}
		&.size-3 {
			font-size: var(--text-xl, 1.125rem);
		}

		/* The Button component is generously padded for standalone use; tighten the
		 * horizontal padding for the dense breadcrumb trail. Scoped to .breadcrumbs
		 * by Svelte; the inner :global() pierces the child Button without leaking. */
		:global(.button.dense a),
		:global(.button.dense button) {
			padding-inline: 0.55em;
		}
	}
	.breadcrumbs.dense {
		:global(.button.dense a),
		:global(.button.dense button) {
			padding-inline: 0.4em;
		}
	}

	.breadcrumb-list {
		--bc-sep-pad: 0.25rem;
		display: flex;
		align-items: center;
		flex-wrap: nowrap;
		gap: 0;
		list-style: none;
		margin: 0;
		padding: 0;
		min-width: 0;
		color: light-dark(var(--color-text-muted, #6b7280), var(--color-text-muted, #9ca3af));
	}
	.breadcrumbs.dense .breadcrumb-list {
		--bc-sep-pad: 0.0625rem;
	}

	.breadcrumb-item,
	.breadcrumb-separator {
		box-sizing: border-box;
		display: flex;
		align-items: center;
		flex: 0 0 auto;
		min-width: 0;
	}

	.breadcrumb-item.current {
		color: light-dark(var(--color-text, #1a1a1a), var(--color-text, #f5f5f5));
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
		/* Spacing lives in padding (not gap/margin). When a separator collapses,
		 * the padding must collapse too — border-box keeps padding at its set
		 * value even at max-width:0, which would leave a ghost gap — so the
		 * collapsible variants drive padding-inline with the same clamp. */
		padding-inline: var(--bc-sep-pad);
		/* Subtler than the full-contrast crumb labels, but still clearly visible.
		 * Must NOT use --color-text-disabled here: that token is a currentColor-
		 * relative dim meant to be applied to a full-contrast text color. The
		 * separator inherits the already-muted list color, so the disabled token
		 * compounds and washes the chevron into the background in both modes. */
		color: light-dark(var(--color-text-muted, #6b7280), var(--color-text-muted, #9ca3af));
		flex-shrink: 0;
	}
	.breadcrumb-separator.bc-collapse {
		padding-inline: clamp(0px, (100cqi - var(--bc-reveal)) * 1000, var(--bc-sep-pad));
	}
	.breadcrumb-separator.bc-collapse-inv {
		padding-inline: clamp(0px, (var(--bc-reveal) - 100cqi) * 1000, var(--bc-sep-pad));
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

	/* ── CSS-only collapse primitives ───────────────────────────────────────
	 * `--bc-reveal` is an em length estimated from the label. An element with
	 * `.bc-collapse` is visible when the container is at least that wide;
	 * `.bc-collapse-inv` is the inverse (visible only while narrower). The
	 * `* 1000` turns the width difference into a near-instant 0 ↔ full switch. */
	.bc-collapse {
		overflow: clip;
		max-width: clamp(0px, (100cqi - var(--bc-reveal)) * 1000, 100cqi);
	}
	.bc-collapse-inv {
		overflow: clip;
		max-width: clamp(0px, (var(--bc-reveal) - 100cqi) * 1000, 100cqi);
	}

	/* The ellipsis cell collapses to zero (via .bc-collapse-inv) when no items are
	 * hidden; its Button's Popover is portaled, so it isn't affected by the clip. */

	/* ── Skeleton ────────────────────────────────────────────────────────────
	 * Each cell mirrors a dense Button's box (padding 0.5em 1em, line-height 1em)
	 * so toggling skeleton ↔ loaded never shifts the row height. The bar width is
	 * in em, so larger `size` values yield proportionally larger shimmers. */
	.bc-skeleton-cell {
		display: inline-flex;
		align-items: center;
		padding: 0.5em 0.55em;
		line-height: 1em;
	}
	.skeleton-bar {
		display: block;
		height: 1em;
		border-radius: var(--radius-sm, 0.25rem);
		background: light-dark(var(--color-border, #e5e7eb), var(--color-border, #374151));
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
