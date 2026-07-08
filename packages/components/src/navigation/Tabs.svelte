<script lang="ts" module>
	import type { Snippet } from 'svelte';

	/** A single tab descriptor in the `tabs` array. */
	export interface TabItem {
		/** The label text shown in the tab button. */
		label: string;
		/** An optional badge (count or short string) shown after the label. */
		badge?: string | number;
		/** Whether this individual tab is disabled. */
		disabled?: boolean;
		/** The panel content for this tab. When omitted, the component's
		    children are used as the panel instead (gate them yourself with the
		    bound `tab` index). */
		content?: Snippet;
	}

	/** How the panel content animates when the active tab changes. */
	export type TabsTransition = 'none' | 'fade' | 'slide';
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { ripple } from '@delightstack/utilities';

	const propId = $props.id();

	let {
		/** The index of the active tab (bindable). */
		tab = $bindable(0),

		/** The tabs to render, in order. The array index is the tab's value. */
		tabs = [] as TabItem[],

		/** Use pill-shaped tab buttons. */
		pills = false,

		/** Use a boxed (segmented-control) tab style. */
		boxed = false,

		/** The orientation of the tab list. */
		orientation = 'horizontal' as 'horizontal' | 'vertical',

		/** The size of the tabs. 0=small, 1=default, 2=medium, 3=large. */
		size = '1' as '0' | '1' | '2' | '3',

		/** Stretch tab buttons to fill the available width. */
		full_width = false,

		/** Disable every tab. */
		disabled = false,

		/** How the panel content animates between tabs. */
		transition = 'none' as TabsTransition,

		/** Show a skeleton loading state in place of the tab list. */
		skeleton = false,

		/** Number of skeleton tab placeholders. */
		skeleton_count = 3,

		/** Called when the active tab changes. */
		onchange = undefined as ((detail: { tab: number }) => void) | undefined,

		/** The ID of the element. */
		id = propId,

		/** Additional class name(s). */
		class: class_name = '',

		/** Panel content used when a tab has no `content` snippet. Receives the
		    active tab index and a `select` helper. */
		children = undefined as
			| undefined
			| Snippet<[{ tab: number; select: (i: number) => void }]>,
	} = $props();

	/* ------------------------------------------------------------------ */
	/*  Active tab + selection                                            */
	/* ------------------------------------------------------------------ */
	function select(i: number) {
		const item = tabs[i];
		if (disabled || !item || item.disabled || i === tab) return;
		tab = i;
		onchange?.({ tab: i });
	}

	/** Track navigation direction (for the slide transition). */
	let prevTab = tab;
	let direction = $state(1);
	$effect(() => {
		const next = tab;
		untrack(() => {
			if (next !== prevTab) {
				direction = next > prevTab ? 1 : -1;
				prevTab = next;
			}
		});
	});

	const activeContent = $derived(tabs[tab]?.content);

	/* ------------------------------------------------------------------ */
	/*  Sliding indicator                                                 */
	/* ------------------------------------------------------------------ */
	let listEl = $state<HTMLElement | undefined>(undefined);
	let tabEls = $state<HTMLElement[]>([]);
	let indicatorStyle = $state('opacity: 0;');

	function measure() {
		const el = tabEls[tab];
		if (!listEl || !el) {
			indicatorStyle = 'opacity: 0;';
			return;
		}
		if (boxed) {
			// The thumb sits exactly on the active tab's box, so the list's padding
			// shows as an equal gutter on all four sides (no top/left mismatch).
			indicatorStyle =
				`transform: translate(${el.offsetLeft}px, ${el.offsetTop}px);` +
				` width: ${el.offsetWidth}px; height: ${el.offsetHeight}px; opacity: 1;`;
		} else if (orientation === 'vertical') {
			indicatorStyle = `transform: translateY(${el.offsetTop}px); height: ${el.offsetHeight}px; opacity: 1;`;
		} else {
			indicatorStyle = `transform: translateX(${el.offsetLeft}px); width: ${el.offsetWidth}px; opacity: 1;`;
		}
	}

	// Re-measure whenever anything that affects geometry changes. Effects run
	// after the DOM updates, so offsets are already settled — no rAF needed.
	$effect(() => {
		// Touch every geometry input so the effect re-runs when any of them change
		// (measure() reads tab/orientation/variant, but not these layout inputs).
		const _deps = [tabs.length, pills, full_width, size, skeleton];
		void _deps;
		if (!skeleton) measure();
	});

	// Late layout shifts (font load, container resize, full-width reflow) don't
	// touch any of the tracked state above, so observe the list directly.
	$effect(() => {
		if (!listEl || skeleton) return;
		const ro = new ResizeObserver(() => measure());
		ro.observe(listEl);
		for (const el of tabEls) if (el) ro.observe(el);
		return () => ro.disconnect();
	});

	/* ------------------------------------------------------------------ */
	/*  Keyboard navigation (roving focus, auto-activation)               */
	/* ------------------------------------------------------------------ */
	function enabledStep(from: number, step: number): number {
		const n = tabs.length;
		for (let i = 1; i <= n; i++) {
			const idx = (from + step * i + n * i) % n;
			if (!tabs[idx]?.disabled) return idx;
		}
		return from;
	}

	function firstEnabled(): number {
		const i = tabs.findIndex((t) => !t?.disabled);
		return i === -1 ? 0 : i;
	}

	function lastEnabled(): number {
		for (let i = tabs.length - 1; i >= 0; i--) if (!tabs[i]?.disabled) return i;
		return tabs.length - 1;
	}

	function focusIndex(i: number) {
		const el = tabEls[i];
		if (el) el.focus();
		select(i);
	}

	function onKeyDown(e: KeyboardEvent, i: number) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			select(i);
			return;
		}
		const vertical = orientation === 'vertical';
		const next = vertical ? 'ArrowDown' : 'ArrowRight';
		const prev = vertical ? 'ArrowUp' : 'ArrowLeft';
		if (e.key === next) {
			e.preventDefault();
			focusIndex(enabledStep(i, 1));
		} else if (e.key === prev) {
			e.preventDefault();
			focusIndex(enabledStep(i, -1));
		} else if (e.key === 'Home') {
			e.preventDefault();
			focusIndex(firstEnabled());
		} else if (e.key === 'End') {
			e.preventDefault();
			focusIndex(lastEnabled());
		}
	}

	/* ------------------------------------------------------------------ */
	/*  Transitions                                                       */
	/* ------------------------------------------------------------------ */
	let reduce_motion = $state(false);
	$effect(() => {
		const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
		reduce_motion = mq.matches;
		const on = () => (reduce_motion = mq.matches);
		mq.addEventListener('change', on);
		return () => mq.removeEventListener('change', on);
	});

	const effTransition = $derived<TabsTransition>(reduce_motion ? 'none' : transition);

	const DURATION = 300;
	const EASE = (t: number) => 1 - Math.pow(1 - t, 3); // cubic-out
	/** Slide travel distance (rem). Bold enough to read as a real slide. */
	const SLIDE = 4.5;

	function panelIn(_node: HTMLElement) {
		if (effTransition === 'fade') {
			return { duration: DURATION, easing: EASE, css: (t: number) => `opacity: ${t}` };
		}
		// slide: incoming panel flies in from the direction of travel
		const d = direction;
		return {
			duration: DURATION,
			easing: EASE,
			css: (t: number) =>
				`opacity: ${t}; transform: translateX(${(1 - t) * d * SLIDE}rem)`,
		};
	}

	function panelOut(_node: HTMLElement) {
		if (effTransition === 'fade') {
			return { duration: DURATION, easing: EASE, css: (t: number) => `opacity: ${t}` };
		}
		// slide: outgoing panel exits opposite the direction of travel
		const d = direction;
		return {
			duration: DURATION,
			easing: EASE,
			css: (t: number) =>
				`opacity: ${t}; transform: translateX(${(1 - t) * -d * SLIDE}rem)`,
		};
	}

	/* ------------------------------------------------------------------ */
	const sizeMap: Record<string, string> = {
		'0': 'var(--text-sm, 0.815rem)',
		'1': 'var(--text-base, 1rem)',
		'2': 'var(--text-lg, 1.1rem)',
		'3': 'var(--text-xl, 1.25rem)',
	};

	// Pseudo-random skeleton tab widths (em) — real labels vary, so should these.
	const skeletonWidths = [5, 6.5, 4.25, 5.75];

	const hasPanel = $derived(!!activeContent || !!children);
	const panelId = $derived(`tabpanel-${id}`);
</script>

<div
	{id}
	class={['tabs', class_name].filter(Boolean).join(' ')}
	class:pills
	class:boxed
	class:vertical={orientation === 'vertical'}
	class:full-width={full_width}
	class:disabled
	style:font-size={sizeMap[size] ?? sizeMap['1']}>
	{#if skeleton}
		<div class="list skeleton" role="tablist" aria-hidden="true">
			{#each { length: skeleton_count } as _, i}
				<div
					class="skeleton-tab"
					style:width="{skeletonWidths[i % skeletonWidths.length]}em"
					style:--shimmer-delay="{i * 120}ms">
				</div>
			{/each}
		</div>
	{:else}
		<div class="list" role="tablist" aria-orientation={orientation} bind:this={listEl}>
			<div class="indicator" style={indicatorStyle}></div>
			{#each tabs as t, i (i)}
				{@const isDisabled = disabled || !!t.disabled}
				<button
					type="button"
					role="tab"
					class="tab"
					class:active={tab === i}
					class:disabled={isDisabled}
					aria-selected={tab === i}
					aria-disabled={isDisabled || undefined}
					aria-controls={hasPanel ? panelId : undefined}
					id="tab-{id}-{i}"
					tabindex={tab === i ? 0 : -1}
					bind:this={tabEls[i]}
					onclick={() => select(i)}
					onkeydown={(e) => onKeyDown(e, i)}
					{@attach ripple({ enabled: !isDisabled, zIndex: 0 })}>
					<span class="label">{t.label}</span>
					{#if t.badge !== undefined}
						<span class="badge">{t.badge}</span>
					{/if}
				</button>
			{/each}
		</div>

		{#if hasPanel}
			<div class="panels" class:animated={effTransition !== 'none'}>
				{#if effTransition === 'none'}
					<div
						class="panel"
						role="tabpanel"
						id={panelId}
						aria-labelledby="tab-{id}-{tab}"
						tabindex="0">
						{#if activeContent}
							{@render activeContent()}
						{:else if children}
							{@render children({ tab, select })}
						{/if}
					</div>
				{:else}
					{#key tab}
						<div
							class="panel"
							role="tabpanel"
							id={panelId}
							aria-labelledby="tab-{id}-{tab}"
							tabindex="0"
							in:panelIn
							out:panelOut>
							{#if activeContent}
								{@render activeContent()}
							{:else if children}
								{@render children({ tab, select })}
							{/if}
						</div>
					{/key}
				{/if}
			</div>
		{/if}
	{/if}
</div>

<style>
	/* ========== Container ========== */
	.tabs {
		display: flex;
		flex-direction: column;
		width: 100%;
		min-width: 0;

		&.vertical {
			flex-direction: row;
			align-items: flex-start;
		}

		&.disabled {
			opacity: 0.6;
			pointer-events: none;
		}
	}

	/* ========== Tab list ========== */
	.list {
		display: flex;
		position: relative;
		gap: 0;
		flex-shrink: 0;
		border-bottom: 1px solid var(--color-border, #e0e0e0);

		.tabs.vertical & {
			flex-direction: column;
			border-bottom: none;
			border-right: 1px solid var(--color-border, #e0e0e0);
		}

		.tabs.pills & {
			border-bottom: none;
			gap: 0.3rem;
		}

		.tabs.pills.vertical & {
			border-right: none;
		}

		.tabs.boxed & {
			background: var(--color-bg-muted, #f1f1f1);
			border: 1px solid var(--color-border, #e0e0e0);
			border-radius: var(--radius-lg, 10px);
			padding: 0.3rem;
			gap: 0;
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius-lg, 10px) * var(--squircle-ratio, 2));
			}
		}

		.tabs.full-width & {
			width: 100%;
		}
		.tabs.full-width & > .tab {
			flex: 1;
		}
	}

	/* ========== Sliding indicator ========== */
	.indicator {
		position: absolute;
		bottom: -1px;
		left: 0;
		height: 2px;
		background: var(--color-action, #1976d2);
		border-radius: var(--radius-full, 1e5px);
		pointer-events: none;
		z-index: 1;
		opacity: 0;
		transition:
			transform 260ms var(--ease-spring, cubic-bezier(0.34, 1.4, 0.64, 1)),
			width 260ms var(--ease-spring, cubic-bezier(0.34, 1.4, 0.64, 1)),
			height 260ms var(--ease-spring, cubic-bezier(0.34, 1.4, 0.64, 1)),
			opacity 150ms ease;

		.tabs.vertical & {
			bottom: auto;
			left: auto;
			right: -1px;
			top: 0;
			width: 2px;
			height: auto;
		}

		.tabs.pills & {
			display: none;
		}

		/* Boxed: the indicator becomes the active "thumb" — an elevated surface
		   that glides between options. measure() gives it the active tab's exact
		   box (translate x/y + width/height), so the list padding reads as an
		   equal gutter on every side. */
		.tabs.boxed & {
			top: 0;
			bottom: auto;
			left: 0;
			height: auto;
			background: var(--color-surface, #fff);
			border-radius: calc(var(--radius-lg, 10px) - 0.2rem);
			box-shadow:
				0 1px 2px rgb(0 0 0 / 0.06),
				0 2px 6px rgb(0 0 0 / 0.08);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc((var(--radius-lg, 10px) - 0.2rem) * var(--squircle-ratio, 2));
			}
		}
	}

	/* ========== Tab button ========== */
	.tab {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.5em;
		position: relative;
		z-index: 2;
		flex-shrink: 0;
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 0.7em 1.05em;
		margin: 0;
		font-size: inherit;
		font-family: inherit;
		font-weight: 500;
		line-height: 1.2;
		color: var(--color-text-muted, #666);
		white-space: nowrap;
		outline: none;
		border-radius: var(--radius-md, 5px);
		-webkit-tap-highlight-color: transparent;
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md, 5px) * var(--squircle-ratio, 2));
		}
		/* OUT transition: colours/background snap in on hover, ease back out;
		   the press scale always eases (both directions) so it feels physical. */
		transition:
			color 220ms ease,
			background-color 220ms ease,
			scale 160ms ease;

		&:hover:not(.disabled):not(.active) {
			color: var(--color-text, #222);
			background: rgb(from var(--color-text, #333) r g b / 0.06);
			/* snap the colour/background in; keep the scale easing */
			transition: scale 160ms ease;
		}

		&:active:not(.disabled) {
			scale: 0.9;
		}

		&:focus-visible {
			box-shadow: inset 0 0 0 2px var(--color-action, #1976d2);
			border-radius: var(--radius-md, 5px);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius-md, 5px) * var(--squircle-ratio, 2));
			}
		}

		&.active {
			color: var(--color-action, #1976d2);
		}

		&.disabled {
			opacity: 0.45;
			cursor: not-allowed;
		}

		/* ---- Pills (variant class lives on the container) ---- */
		.tabs.pills & {
			border-radius: var(--radius-full, 1e5px);
			padding: 0.5em 1.1em;

			&.active {
				background: var(--color-action, #1976d2);
				color: var(--color-action-text, #fff);
			}
		}

		/* ---- Boxed (text rides above the gliding thumb) ---- */
		.tabs.boxed & {
			border-radius: calc(var(--radius-lg, 10px) - 0.2rem);
			padding: 0.5em 1.1em;
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc((var(--radius-lg, 10px) - 0.2rem) * var(--squircle-ratio, 2));
			}
			&.active {
				color: var(--color-text-active, var(--color-text, #222));
			}
		}
	}

	.label {
		position: relative;
		z-index: 1;
		pointer-events: none;
	}

	/* ========== Badge ========== */
	.badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--color-action, #1976d2);
		color: var(--color-action-text, #fff);
		border-radius: var(--radius-full, 1e5px);
		font-size: 0.72em;
		font-weight: 600;
		line-height: 1;
		padding: 0.2em 0.45em;
		min-width: 1.5em;
		min-height: 1.35em;
		position: relative;
		z-index: 1;
		pointer-events: none;
		transition:
			background-color 220ms ease,
			color 220ms ease;
	}

	/* Inactive tabs get a quieter, tinted badge; the active one inverts inside
	   pills so it stays legible on the filled background. */
	.tab:not(.active) .badge {
		background: rgb(from var(--color-text, #333) r g b / 0.1);
		color: var(--color-text-muted, #666);
	}
	.tabs.pills .tab.active .badge {
		background: var(--color-action-text, #fff);
		color: var(--color-action, #1976d2);
	}

	/* ========== Panels ========== */
	.panels {
		min-width: 0;

		.tabs.vertical & {
			flex: 1;
			padding-left: 1.25em;
		}
	}

	/* When animated, stack incoming/outgoing panels in one grid cell so they
	   crossfade/slide over each other without a layout jump. */
	.panels.animated {
		display: grid;
		overflow: hidden;
	}
	.panels.animated > .panel {
		grid-area: 1 / 1;
	}

	.panel {
		padding: 1.1em 0;
		outline: none;

		.tabs.vertical & {
			padding-top: 0;
		}

		&:focus-visible {
			outline: 2px solid var(--color-action, #1976d2);
			outline-offset: 2px;
			border-radius: var(--radius-md, 5px);
			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius-md, 5px) * var(--squircle-ratio, 2));
			}
		}
	}

	/* ========== Skeleton ========== */
	.list.skeleton {
		pointer-events: none;
		gap: 0.4em;
		border-bottom-color: var(--color-border, #e0e0e0);

		.tabs.full-width & > .skeleton-tab {
			flex: 1;
		}
	}

	.skeleton-tab {
		/* Match a real tab's box exactly so toggling skeleton ↔ loaded never
		   shifts the row: line-height 1.2 (same as .tab) makes 1lh resolve to the
		   real line box instead of inheriting the page's larger line-height, and
		   1.4em is the default tab's block padding (0.7em × 2). */
		line-height: 1.2;
		height: calc(1lh + 1.4em);
		flex-shrink: 0;
		border-radius: var(--radius-md, 5px);
		position: relative;
		overflow: hidden;
		background: var(--skeleton-bg, rgb(from var(--color-text, #888) r g b / 0.1));
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md, 5px) * var(--squircle-ratio, 2));
		}

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
		.tabs.boxed & {
			height: calc(1lh + 1em);
		}
		.tabs.pills & {
			border-radius: var(--radius-full, 1e5px);
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
		.skeleton-tab::after {
			animation: none;
		}
		.indicator {
			transition: opacity 150ms ease;
		}
	}
</style>
