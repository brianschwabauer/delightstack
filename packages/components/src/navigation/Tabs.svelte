<script lang="ts" module>
	export { default as Tab } from './Tabs.svelte';
	export { default as TabContent } from './Tabs.svelte';

	export interface TabsContext {
		value: string;
		pills: boolean;
		boxed: boolean;
		segment: boolean;
		size: string;
		orientation: 'horizontal' | 'vertical';
		disabled: boolean;
		select: (value: string) => void;
		register: (value: string, el: HTMLElement) => void;
		unregister: (value: string) => void;
	}
</script>

<script lang="ts">
	import { getContext, setContext, onMount, type Snippet } from 'svelte';

	const propId = $props.id();

	let {
		/* --- Shared --- */
		/** The tab value (bindable for Tabs container; required string for Tab/TabContent) */
		value = $bindable(''),

		/* --- Tab item props --- */
		/** The label text for a Tab item */
		label = '',

		/** A badge displayed next to the Tab label */
		badge = undefined as string | number | undefined,

		/* --- Tabs container props --- */
		/** Whether to use pill-shaped tab buttons */
		pills = false,

		/** Whether to use a boxed tab style */
		boxed = false,

		/** Whether to use a segmented-control tab style */
		segment = false,

		/** The orientation of the tab list */
		orientation = 'horizontal' as 'horizontal' | 'vertical',

		/** The size of the tabs. 0=small, 1=default, 2=medium, 3=large */
		size = '1' as '0' | '1' | '2' | '3',

		/** Whether tab buttons should stretch to fill the available width */
		full_width = false,

		/** Whether all tabs are disabled */
		disabled = false,

		/** Whether to show a skeleton loading state */
		skeleton = false,

		/** Number of skeleton tab placeholders */
		skeleton_count = 3,

		/** Called when the active tab changes (Tabs container only) */
		onchange = undefined as ((detail: { value: string }) => void) | undefined,

		/** The ID of the element */
		id = propId,

		/** Specifies a custom class name */
		class: class_name = '',

		/** The child content */
		children = undefined as undefined | Snippet,
	} = $props();

	/* ------------------------------------------------------------------ */
	/*  Detect role: Tabs container, Tab item, or TabContent              */
	/* ------------------------------------------------------------------ */
	const parentContext = getContext<TabsContext | undefined>('tabs');

	// Role detection:
	// - No parent context → Tabs container
	// - Has parent context + (label or badge) → Tab item
	// - Has parent context + no label/badge → TabContent
	const isContainer = !parentContext;
	const isTab = $derived(!!parentContext && (!!label || badge !== undefined));
	const isTabContent = $derived(!!parentContext && !label && badge === undefined);

	/* ------------------------------------------------------------------ */
	/*  Tabs container logic                                              */
	/* ------------------------------------------------------------------ */
	let tabElementsMap = new Map<string, HTMLElement>();
	let tabRegistrationCount = $state(0);
	let indicatorStyle = $state('');
	let listEl = $state<HTMLElement | undefined>(undefined);
	let mounted = $state(false);

	if (isContainer) {
		const ctx = $state<TabsContext>({
			value,
			pills,
			boxed,
			segment,
			size,
			orientation,
			disabled,
			select(val: string) {
				value = val;
				onchange?.({ value: val });
			},
			register(val: string, el: HTMLElement) {
				tabElementsMap.set(val, el);
				tabRegistrationCount++;
			},
			unregister(val: string) {
				tabElementsMap.delete(val);
				tabRegistrationCount++;
			},
		});
		setContext<TabsContext>('tabs', ctx);

		// Keep context in sync
		$effect(() => {
			ctx.value = value;
			ctx.pills = pills;
			ctx.boxed = boxed;
			ctx.segment = segment;
			ctx.size = size;
			ctx.orientation = orientation;
			ctx.disabled = disabled;
		});

		onMount(() => {
			mounted = true;
		});

		// Update the sliding indicator when value or tab registrations change
		$effect(() => {
			// Track reactive dependencies
			const _val = value;
			const _count = tabRegistrationCount;
			const _pills = pills;
			const _boxed = boxed;
			const _segment = segment;
			const _orientation = orientation;

			if (!mounted || !listEl) {
				indicatorStyle = 'opacity: 0;';
				return;
			}

			// Use requestAnimationFrame to ensure DOM is settled after registration
			requestAnimationFrame(() => {
				const activeEl = tabElementsMap.get(_val);
				if (!activeEl || !listEl) {
					indicatorStyle = 'opacity: 0;';
					return;
				}

				const isVertical = _orientation === 'vertical';

				if (isVertical) {
					const top = activeEl.offsetTop;
					const height = activeEl.offsetHeight;
					if (_segment || _boxed) {
						indicatorStyle = `transform: translateY(${top}px); height: ${height}px; width: 100%; opacity: 1;`;
					} else {
						indicatorStyle = `transform: translateY(${top}px); height: ${height}px; opacity: 1;`;
					}
				} else {
					const left = activeEl.offsetLeft;
					const width = activeEl.offsetWidth;
					if (_segment || _boxed) {
						indicatorStyle = `transform: translateX(${left}px); width: ${width}px; height: 100%; opacity: 1;`;
					} else {
						indicatorStyle = `transform: translateX(${left}px); width: ${width}px; opacity: 1;`;
					}
				}
			});
		});
	}

	/* ------------------------------------------------------------------ */
	/*  Tab item logic                                                    */
	/* ------------------------------------------------------------------ */
	let tabEl = $state<HTMLElement | undefined>(undefined);

	const isSelected = $derived(parentContext ? parentContext.value === value : false);
	const isDisabled = $derived(
		parentContext ? parentContext.disabled || disabled : disabled,
	);

	if (!isContainer) {
		onMount(() => {
			if (parentContext && tabEl && value) {
				parentContext.register(value, tabEl);
			}
			return () => {
				if (parentContext && value) {
					parentContext.unregister(value);
				}
			};
		});
	}

	function selectTab() {
		if (isDisabled || !parentContext) return;
		parentContext.select(value);
	}

	function onTabKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			selectTab();
			return;
		}

		const isVertical = parentContext?.orientation === 'vertical';
		const nextKey = isVertical ? 'ArrowDown' : 'ArrowRight';
		const prevKey = isVertical ? 'ArrowUp' : 'ArrowLeft';

		if (e.key === nextKey) {
			e.preventDefault();
			focusSibling(e.currentTarget as HTMLElement, 1);
		} else if (e.key === prevKey) {
			e.preventDefault();
			focusSibling(e.currentTarget as HTMLElement, -1);
		} else if (e.key === 'Home') {
			e.preventDefault();
			focusSibling(e.currentTarget as HTMLElement, 0, 'first');
		} else if (e.key === 'End') {
			e.preventDefault();
			focusSibling(e.currentTarget as HTMLElement, 0, 'last');
		}
	}

	function focusSibling(
		current: HTMLElement,
		direction: number,
		target?: 'first' | 'last',
	) {
		const list = current.closest('[role="tablist"]');
		if (!list) return;
		const tabs = Array.from(
			list.querySelectorAll<HTMLElement>('[role="tab"]:not([aria-disabled="true"])'),
		);
		if (tabs.length === 0) return;

		let next: HTMLElement | undefined;
		if (target === 'first') {
			next = tabs[0];
		} else if (target === 'last') {
			next = tabs[tabs.length - 1];
		} else {
			const idx = tabs.indexOf(current);
			if (idx === -1) return;
			next = tabs[(idx + direction + tabs.length) % tabs.length];
		}
		if (next) {
			next.focus();
			next.click();
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Size map                                                          */
	/* ------------------------------------------------------------------ */
	const sizeMap: Record<string, string> = {
		'0': 'var(--text-sm, 0.75rem)',
		'1': 'var(--text-base, 0.875rem)',
		'2': 'var(--text-lg, 1rem)',
		'3': 'var(--text-xl, 1.125rem)',
	};

	/* Pseudo-random skeleton tab widths (em) — real tab labels vary, so the
	   placeholders should too. */
	const skeletonWidths = [5, 6.5, 4.25, 5.75];
</script>

{#if isContainer}
	<!-- Tabs Container -->
	<div
		{id}
		class={['tabs', class_name].filter(Boolean).join(' ')}
		class:pills
		class:boxed
		class:segment
		class:vertical={orientation === 'vertical'}
		class:horizontal={orientation === 'horizontal'}
		class:full-width={full_width}
		class:disabled
		style:font-size={sizeMap[size] ?? sizeMap['1']}>
		{#if skeleton}
			<div
				class="tab-list skeleton"
				role="tablist"
				aria-orientation={orientation}
				aria-hidden="true">
				{#each { length: skeleton_count } as _, i}
					<div
						class="tab-skeleton"
						style:width="{skeletonWidths[i % skeletonWidths.length]}em"
						style:--shimmer-delay="{i * 120}ms">
					</div>
				{/each}
			</div>
		{:else}
			<div
				class="tab-list"
				role="tablist"
				aria-orientation={orientation}
				bind:this={listEl}>
				<div class="tab-indicator" style={indicatorStyle}></div>
				{@render children?.()}
			</div>
		{/if}
	</div>
{:else if isTab}
	<!-- Tab Item -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<button
		type="button"
		role="tab"
		class={['tab', class_name].filter(Boolean).join(' ')}
		class:active={isSelected}
		class:disabled={isDisabled}
		class:pills={parentContext?.pills}
		class:boxed={parentContext?.boxed}
		class:segment={parentContext?.segment}
		aria-selected={isSelected}
		aria-disabled={isDisabled || undefined}
		aria-controls={value ? `tabpanel-${value}` : undefined}
		id={value ? `tab-${value}` : undefined}
		tabindex={isSelected ? 0 : -1}
		bind:this={tabEl}
		onclick={selectTab}
		onkeydown={onTabKeyDown}>
		{#if children}
			{@render children()}
		{:else}
			<span class="tab-label">{label}</span>
		{/if}
		{#if badge !== undefined}
			<span class="tab-badge">{badge}</span>
		{/if}
	</button>
{:else if isTabContent}
	<!-- TabContent Panel -->
	{#if parentContext && parentContext.value === value}
		<div
			class={['tab-content', class_name].filter(Boolean).join(' ')}
			role="tabpanel"
			id="tabpanel-{value}"
			aria-labelledby={value ? `tab-${value}` : undefined}
			tabindex={0}>
			{@render children?.()}
		</div>
	{/if}
{/if}

<style>
	/* ========== Tabs Container ========== */
	.tabs {
		display: flex;
		flex-direction: column;
		width: 100%;

		&.vertical {
			flex-direction: row;
		}

		&.disabled {
			opacity: 0.5;
			pointer-events: none;
		}
	}

	.tab-list {
		display: flex;
		position: relative;
		border-bottom: 1px solid var(--color-border, #e0e0e0);
		gap: 0;
		perspective: 100px;

		.tabs.vertical & {
			flex-direction: column;
			border-bottom: none;
			border-right: 1px solid var(--color-border, #e0e0e0);
		}

		.tabs.pills & {
			border-bottom: none;
			gap: 0.25rem;
		}

		.tabs.pills.vertical & {
			border-right: none;
		}

		.tabs.boxed & {
			background: var(--color-surface, #f5f5f5);
			border: 1px solid var(--color-border, #e0e0e0);
			border-radius: var(--radius-lg, 0.5rem);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius-lg, 0.5rem) * var(--squircle-ratio, 2));
			}
			padding: 0.25rem;
			gap: 0;
		}

		.tabs.segment & {
			background: var(--color-bg-muted, #ebebeb);
			border-radius: var(--radius-lg, 0.5rem);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius-lg, 0.5rem) * var(--squircle-ratio, 2));
			}
			padding: 0.25rem;
			border-bottom: none;
			gap: 0;
		}

		.tabs.full-width & {
			width: 100%;

			:global(> .tab) {
				flex: 1;
			}
		}
	}

	/* ========== Sliding Indicator ========== */
	.tab-indicator {
		position: absolute;
		bottom: 0;
		left: 0;
		height: 2px;
		background: var(--color-accent, #1976d2);
		border-radius: 1px;
		transition:
			transform 200ms cubic-bezier(0.4, 0, 0.2, 1),
			width 200ms cubic-bezier(0.4, 0, 0.2, 1),
			height 200ms cubic-bezier(0.4, 0, 0.2, 1),
			opacity 150ms ease;
		pointer-events: none;
		z-index: 1;
		opacity: 0;

		.tabs.vertical & {
			bottom: auto;
			left: auto;
			right: 0;
			top: 0;
			width: 2px;
			height: auto;
		}

		.tabs.pills & {
			display: none;
		}

		.tabs.boxed & {
			bottom: 0;
			top: 0;
			height: auto;
			background: var(--color-action, #fff);
			border-radius: calc(var(--radius-lg, 0.5rem) - 0.125rem);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(
					(var(--radius-lg, 0.5rem) - 0.125rem) * var(--squircle-ratio, 2)
				);
			}
			box-shadow: 0 1px 3px rgb(0 0 0 / 0.08);
		}

		.tabs.segment & {
			bottom: 0;
			top: 0;
			height: auto;
			background: var(--color-surface, #fff);
			border-radius: calc(var(--radius-lg, 0.5rem) - 0.125rem);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(
					(var(--radius-lg, 0.5rem) - 0.125rem) * var(--squircle-ratio, 2)
				);
			}
			box-shadow:
				0 1px 3px rgb(0 0 0 / 0.08),
				0 1px 2px rgb(0 0 0 / 0.06);
		}

		.tabs.vertical.boxed &,
		.tabs.vertical.segment & {
			left: 0;
			right: 0;
			top: 0;
			width: auto;
		}
	}

	/* ========== Tab Item ========== */
	.tab {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5em;
		position: relative;
		z-index: 2;
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 0.625em 1em;
		font-size: inherit;
		font-family: inherit;
		color: var(--color-text-muted, #666);
		white-space: nowrap;
		transition:
			color 150ms ease,
			background-color 150ms ease,
			translate 200ms ease;
		outline: none;
		-webkit-tap-highlight-color: transparent;

		&:hover:not(.disabled) {
			color: var(--color-text, #333);
			transition: translate 200ms ease;
		}
		&:active:not(.disabled) {
			translate: 0px 3px 0px;
		}

		&:focus-visible {
			box-shadow: inset 0 0 0 2px var(--color-accent, #1976d2);
			border-radius: var(--radius-md, 0.375rem);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius-md, 0.375rem) * var(--squircle-ratio, 2));
			}
		}

		&.active {
			color: var(--color-accent, #1976d2);
			font-weight: 600;
		}

		&.disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}

		/* ---- Pills variant ---- */
		&.pills {
			border-radius: var(--radius-full, 9999px);
			padding: 0.5em 1em;

			&:hover:not(.disabled):not(.active) {
				background: rgb(from var(--color-text, #333) r g b / 0.06);
				transition: none;
			}

			&.active {
				background: var(--color-accent, #1976d2);
				color: var(--color-accent-text, #fff);
			}
		}

		/* ---- Boxed variant ---- */
		&.boxed {
			border-radius: calc(var(--radius-lg, 0.5rem) - 0.125rem);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(
					(var(--radius-lg, 0.5rem) - 0.125rem) * var(--squircle-ratio, 2)
				);
			}
			padding: 0.5em 1em;

			&.active {
				color: var(--color-text, #333);
			}
		}

		/* ---- Segment variant ---- */
		&.segment {
			border-radius: calc(var(--radius-lg, 0.5rem) - 0.125rem);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(
					(var(--radius-lg, 0.5rem) - 0.125rem) * var(--squircle-ratio, 2)
				);
			}
			padding: 0.5em 1em;

			&.active {
				color: var(--color-text, #333);
				font-weight: 600;
			}
		}
	}

	.tab-label {
		pointer-events: none;
	}

	.tab-badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--color-accent, #1976d2);
		color: var(--color-accent-text, #fff);
		border-radius: var(--radius-full, 9999px);
		font-size: 0.75em;
		line-height: 1;
		padding: 0.15em 0.5em;
		min-width: 1.35em;
		min-height: 1.35em;
		font-weight: 600;
		pointer-events: none;

		.tab.pills.active & {
			background: var(--color-accent-text, #fff);
			color: var(--color-accent, #1976d2);
		}
	}

	/* ========== Skeleton ========== */
	/* The list keeps its real chrome (underline border / boxed / segment
	   surfaces come from .tab-list), so only the bars need defining. A small
	   gap separates the bars where real tabs touch (their padding provides the
	   visual separation that solid bars lack). */
	.tab-list.skeleton {
		pointer-events: none;
		gap: 0.375em;

		.tabs.full-width & > .tab-skeleton {
			flex: 1;
		}
	}

	/* Each bar is a whole tab's box: the real block padding (0.625em, or 0.5em
	   for pills/boxed/segment) around one line box (1lh), so the list height —
	   including the indicator strip — never shifts when the real tabs arrive. */
	.tab-skeleton {
		height: calc(1lh + 1.25em);
		flex-shrink: 0;
		border-radius: var(--radius-md, 0.375rem);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md, 0.375rem) * var(--squircle-ratio, 2));
		}
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

		.tabs.pills &,
		.tabs.boxed &,
		.tabs.segment & {
			height: calc(1lh + 1em);
		}

		.tabs.pills & {
			border-radius: var(--radius-full, 9999px);
		}

		.tabs.boxed &,
		.tabs.segment & {
			border-radius: calc(var(--radius-lg, 0.5rem) - 0.125rem);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(
					(var(--radius-lg, 0.5rem) - 0.125rem) * var(--squircle-ratio, 2)
				);
			}
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
		.tab-skeleton::after {
			animation: none;
		}
	}

	/* ========== TabContent Panel ========== */
	.tab-content {
		padding: 1em 0;
		outline: none;

		&:focus-visible {
			outline: 2px solid var(--color-accent, #1976d2);
			outline-offset: 2px;
			border-radius: var(--radius-md, 0.375rem);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius-md, 0.375rem) * var(--squircle-ratio, 2));
			}
		}
	}
</style>
