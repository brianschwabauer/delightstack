<script lang="ts" module>
	export { default as TimelineItem } from './Timeline.svelte';

	export interface TimelineContext {
		/** Whether the timeline flows horizontally instead of vertically */
		horizontal: boolean;
		/** Whether items alternate sides of the timeline axis */
		alternate: boolean;
		/** Whether the timeline uses dense (compact) spacing */
		dense: boolean;
		/** Whether the timeline uses comfortable (roomy) spacing */
		comfortable: boolean;
		/** Whether continuous motion (the active pulse) is allowed */
		animate: boolean;
		/** Whether items should play their entrance reveal as they scroll in */
		reveal: boolean;
		/** Registers a new item with the timeline and returns its index */
		register: () => number;
	}
</script>

<script lang="ts">
	import { intersectionObserver, ripple } from '@delightstack/utilities';
	import { scrollbar } from '../actions/scrollbar';
	import { getContext, setContext, untrack, type Component, type Snippet } from 'svelte';
	import { fade, type TransitionConfig } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import Button from './../actions/Button.svelte';
	import Progress from '../feedback/Progress.svelte';

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

		/** Makes the item clickable — turns it into a link. Mirrors `<Button>`. */
		href = undefined as string | undefined,

		/** Link target (only used with `href`). */
		target = undefined as '_self' | '_blank' | '_parent' | '_top' | undefined,

		/** Called when the item is clicked. Makes the item interactive (like
		    `href`). Return a promise to drive a loading spinner in the marker:
		    a spinner appears if the work outlasts ~100ms, then a brief success
		    check confirms a resolve (mirrors `<Button>`). */
		onclick = undefined as
			| undefined
			| ((event: MouseEvent | KeyboardEvent) => void)
			| ((event: MouseEvent | KeyboardEvent) => Promise<void>),

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

		/** Play the entrance + pulse animations. On by default. */
		animate = true,

		/** Loading skeleton */
		skeleton = false,

		/** Skeleton items count */
		skeleton_count = 3,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: class_name = '',

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
		// Once a skeleton has been shown, the real content takes its place — the
		// space was already occupied, so re-animating it in reads as a jump. Latch
		// this and suppress the entrance reveal for everything that loads after.
		// Seeded once from the initial prop on purpose (the effect below latches
		// it to true if a skeleton ever shows).
		let had_skeleton = $state(untrack(() => skeleton));

		// Getters keep the context live — items re-read the current prop values
		// whenever the container updates them (no snapshot + sync effect needed).
		const ctx: TimelineContext = {
			get horizontal() {
				return horizontal;
			},
			get alternate() {
				return alternate;
			},
			get dense() {
				return dense;
			},
			get comfortable() {
				return comfortable;
			},
			get animate() {
				return animate;
			},
			get reveal() {
				return animate && !had_skeleton;
			},
			register() {
				return item_counter++;
			},
		};
		setContext<TimelineContext>('timeline', ctx);

		$effect(() => {
			if (skeleton) had_skeleton = true;
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
	const do_reveal = $derived(isItem ? parentContext.reveal : false);
	const do_motion = $derived(isItem ? parentContext.animate : false);

	/** An item is interactive when it has somewhere to go or something to do. */
	const interactive = $derived(isItem && (!!onclick || !!href));

	/* ------------------------------------------------------------------ */
	/*  Promise-aware onclick (mirrors <Button>)                           */
	/*  A returned promise drives a spinner in the marker: it appears only */
	/*  if the work outlasts SHOW_DELAY (sub-100ms work reads as instant), */
	/*  stays at least MIN_VISIBLE so it can't blink, then a success check  */
	/*  confirms a resolve.                                                 */
	/* ------------------------------------------------------------------ */
	const SHOW_DELAY = 100;
	const MIN_VISIBLE = 1000;
	const CHECK_HOLD = 1000;

	let in_flight = $state(false); // a returned promise is running
	let spinner_visible = $state(false); // the spinner is actually rendered
	let check_visible = $state(false); // the success checkmark is rendered
	let show_timer: ReturnType<typeof setTimeout> | undefined;
	let hide_timer: ReturnType<typeof setTimeout> | undefined;
	let check_timer: ReturnType<typeof setTimeout> | undefined;
	let spinner_shown_at = 0;

	function clearTimers() {
		clearTimeout(show_timer);
		clearTimeout(hide_timer);
		clearTimeout(check_timer);
		show_timer = hide_timer = check_timer = undefined;
	}
	$effect(() => clearTimers); // tear down pending timers on destroy

	function flashCheck() {
		clearTimeout(check_timer);
		check_visible = true;
		check_timer = setTimeout(() => (check_visible = false), CHECK_HOLD);
	}

	function settle(success: boolean) {
		// Settled before the spinner appeared → treat as instant, no spinner.
		if (show_timer) {
			clearTimeout(show_timer);
			show_timer = undefined;
			in_flight = false;
			return;
		}
		// Keep the spinner for the rest of its minimum-visible window so it
		// doesn't blink away the instant the promise resolves.
		const remaining = Math.max(0, MIN_VISIBLE - (performance.now() - spinner_shown_at));
		clearTimeout(hide_timer);
		hide_timer = setTimeout(() => {
			spinner_visible = false;
			in_flight = false;
			if (success) flashCheck();
		}, remaining);
	}

	function handleActivate(event: MouseEvent | KeyboardEvent) {
		if (in_flight) return;
		const result = onclick?.(event);
		if (!(result instanceof Promise)) return;

		clearTimers();
		check_visible = false;
		in_flight = true;
		// Hold off on the spinner — work that settles within SHOW_DELAY was
		// effectively instant and never needs one.
		show_timer = setTimeout(() => {
			show_timer = undefined;
			spinner_visible = true;
			spinner_shown_at = performance.now();
		}, SHOW_DELAY);

		result.then(
			() => settle(true),
			() => settle(false),
		);
	}

	function handleKey(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			handleActivate(event);
		}
	}

	// The success check draws its stroke on as it spring-pops in.
	function checkIn(_node: Element): TransitionConfig {
		const reduce =
			typeof matchMedia !== 'undefined' &&
			matchMedia('(prefers-reduced-motion: reduce)').matches;
		return {
			duration: reduce ? 0 : 440,
			easing: backOut,
			css: (t: number) =>
				`transform: scale(${0.3 + 0.7 * t}); opacity: ${Math.min(1, t * 2)}; --check-draw: ${24 * (1 - t)};`,
		};
	}

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
	/*                                                                     */
	/*  The intersection attachment's `onintersectonce` latches inside its */
	/*  factory closure, so a single sentinel element would only ever fire */
	/*  once. Re-keying the sentinel per completed load recreates the      */
	/*  element (and a fresh observer), re-arming it for the next batch —  */
	/*  and if the new batch didn't push it out of view, the fresh         */
	/*  observer fires immediately and keeps loading. The in-flight guard  */
	/*  keeps overlapping intersections from double-invoking `onloadmore`. */
	/* ------------------------------------------------------------------ */
	let load_in_flight = false;
	let load_generation = $state(0);

	async function handleLoadMore() {
		if (load_in_flight || !onloadmore) return;
		load_in_flight = true;
		try {
			await onloadmore();
		} finally {
			load_in_flight = false;
			load_generation += 1;
		}
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
		can_scroll_next =
			scroll_el.scrollLeft + scroll_el.clientWidth < scroll_el.scrollWidth - 4;
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
		class={['item', class_name].filter(Boolean).join(' ')}
		class:horizontal={is_horizontal}
		class:vertical={!is_horizontal}
		class:alternate={is_alternate}
		class:even={is_alternate && !is_even}
		class:odd={is_alternate && is_even}
		class:dense={is_dense}
		class:comfortable={is_comfortable}
		class:reveal={do_reveal}
		class:motion={do_motion}
		class:interactive
		class:visible
		class:complete={status === 'complete'}
		class:active={status === 'active'}
		class:pending={status === 'pending'}
		{id}
		style:--marker-color={color || undefined}
		{@attach intersectionObserver({ onintersectonce: () => (visible = true) })}>
		<!-- The marker + content together form one clickable surface (`.lead`),
		     so the step circle is part of the touch target — not just the text.
		     The connector lives outside it (it's the rail, not the button). -->
		<svelte:element
			this={href ? 'a' : 'div'}
			class="lead"
			class:interactive
			href={href || undefined}
			target={href ? target : undefined}
			rel={href && target === '_blank' ? 'noreferrer' : undefined}
			role={interactive && !href ? 'button' : undefined}
			tabindex={interactive && !href ? 0 : undefined}
			aria-busy={in_flight ? 'true' : undefined}
			onclick={interactive ? handleActivate : undefined}
			onkeydown={interactive && !href ? handleKey : undefined}>
			<div class="marker">
				<span class="node" class:busy={spinner_visible || check_visible}>
					{#if spinner_visible || check_visible}
						<!-- Promise-aware feedback: a spinner while the work runs, then a
						     brief success check, both sitting in the step's circle. -->
						<span class="feedback" transition:fade={{ duration: 150 }}>
							{#if spinner_visible}
								<span class="layer" out:fade={{ duration: 120 }}>
									<Progress size="00" color="currentColor" />
								</span>
							{:else}
								<span class="layer" in:checkIn>
									<svg
										class="check"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										stroke-width="3.5"
										stroke-linecap="round"
										stroke-linejoin="round"
										aria-hidden="true">
										<polyline points="20 6 9 17 4 12" />
									</svg>
								</span>
							{/if}
						</span>
					{/if}
					{#if icon}
						{@const Icon = icon}
						<span class="glyph"><Icon /></span>
					{:else if status === 'complete'}
						<span class="glyph">
							<svg
								class="check"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="3.5"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true">
								<polyline points="20 6 9 17 4 12" />
							</svg>
						</span>
					{/if}
				</span>
			</div>
			<div class="content">
				<!-- The ripple + hover tint share one rounded panel that hugs the text,
				     so the press reads as intentional (not the whole arbitrary row).
				     The panel sits over the text but the click still bubbles to the
				     `.lead`, so the marker stays part of the touch target. -->
				{#if interactive}
					<span class="surface" aria-hidden="true" {@attach ripple({ zIndex: 0 })}></span>
				{/if}
				{#if date}
					<time datetime={iso_date}>{formatted_date}</time>
				{/if}
				{#if title}
					<div class="title">{title}</div>
				{/if}
				{#if children}
					<div class="body">
						{@render children()}
					</div>
				{/if}
			</div>
		</svelte:element>
		<div class="connector"></div>
	</li>
{:else if skeleton}
	<!-- Skeleton -->
	<ol
		class={['timeline skeleton', horizontal ? 'horizontal' : 'vertical', class_name]
			.filter(Boolean)
			.join(' ')}
		class:dense
		class:comfortable
		{id}
		aria-hidden="true">
		{#each { length: skeleton_count } as _, i}
			<li
				class="item skeleton-item"
				class:horizontal
				class:vertical={!horizontal}
				class:dense
				class:comfortable>
				<div class="lead">
					<div class="marker">
						<span class="skeleton-circle" style:--shimmer-delay="{i * 120}ms"></span>
					</div>
					<div class="content">
						<div
							class="skeleton-bar skeleton-date"
							style:--shimmer-delay="{i * 120 + 60}ms">
						</div>
						<div
							class="skeleton-bar skeleton-title-bar"
							style:--shimmer-delay="{i * 120 + 120}ms">
						</div>
						<div
							class="skeleton-bar skeleton-body-bar"
							style:--shimmer-delay="{i * 120 + 180}ms">
						</div>
					</div>
				</div>
				<div class="connector"></div>
			</li>
		{/each}
	</ol>
{:else if horizontal}
	<!-- Horizontal timeline container with chevron next/prev controls -->
	<div class={['wrap', class_name].filter(Boolean).join(' ')} {id}>
		{#if can_scroll_prev}
			<Button
				icon
				size="00"
				class="timeline-nav timeline-nav-prev"
				aria-label="Scroll back"
				onclick={scrollPrev}>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true">
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
			role="list"
			{@attach scrollbar()}>
			{@render children?.()}
			{#if pending}
				<li class="item pending-item horizontal" class:motion={animate}>
					<div class="lead">
						<div class="marker">
							<span class="node pending-node"></span>
						</div>
					</div>
				</li>
			{/if}
			{#if onloadmore}
				{#key load_generation}
					<li
						class="sentinel"
						aria-hidden="true"
						{@attach intersectionObserver({ onintersectonce: () => handleLoadMore() })}>
					</li>
				{/key}
			{/if}
		</ol>
		{#if can_scroll_next}
			<Button
				icon
				size="00"
				class="timeline-nav timeline-nav-next"
				aria-label="Scroll forward"
				onclick={scrollNext}>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true">
					<polyline points="9 18 15 12 9 6" />
				</svg>
			</Button>
		{/if}
	</div>
{:else}
	<!-- Timeline container -->
	<ol
		class={['timeline vertical', class_name].filter(Boolean).join(' ')}
		class:alternate
		class:dense
		class:comfortable
		{id}
		role="list">
		{@render children?.()}
		{#if pending}
			<li class="item pending-item vertical" class:motion={animate}>
				<div class="lead">
					<div class="marker">
						<span class="node pending-node"></span>
					</div>
				</div>
			</li>
		{/if}
		{#if onloadmore}
			{#key load_generation}
				<li
					class="sentinel"
					aria-hidden="true"
					{@attach intersectionObserver({ onintersectonce: () => handleLoadMore() })}>
				</li>
			{/key}
		{/if}
	</ol>
{/if}

<style>
	/* ============================================================
	 * Timeline
	 *
	 * Geometry is driven by a small set of custom properties set on
	 * each .item (and swapped by the dense/comfortable density flags),
	 * so the marker, rail and content stay in lockstep without any
	 * per-shape offset hacks:
	 *
	 *   --node   marker diameter        --gap   marker → content gap
	 *   --rail   rail thickness         --run   space below an item (= rail length)
	 *   --node-gap  breathing room between the node and the rail
	 *
	 * The rail is a real progress line: each item's connector is the
	 * segment that descends to the NEXT node, coloured by THIS item's
	 * status — completed segments read solid, the active segment fades
	 * into the muted "not yet" stretch ahead.
	 * ============================================================ */

	/* ========== Container ========== */
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
			scroll-snap-type: x proximity;
			-webkit-overflow-scrolling: touch;
			gap: 0;
			/* overflow-x clips the y-axis too, so leave room for the active node's
			   glow + pulse ring (which reach beyond the marker). */
			padding-block: 1.4rem;
			scrollbar-width: none;
		}
		&.horizontal::-webkit-scrollbar {
			display: none;
		}
	}

	/* ========== Horizontal Navigation ========== */
	.wrap {
		position: relative;
		width: 100%;

		/* The nav controls are <Button icon> instances (rendered by the Button
		 * component), so target their forwarded class names with :global, scoped
		 * inside the wrap. We only position + float them; Button owns appearance. */
		:global(.timeline-nav) {
			position: absolute;
			top: 50%;
			transform: translateY(-50%);
			z-index: 3;
			background: var(--color-surface, #fff);
			box-shadow: var(--shadow-md, 0 3px 10px rgb(0 0 0 / 0.12));
			opacity: 0;
			animation: timeline-nav-fade 200ms var(--ease-out, ease) forwards;
		}
		:global(.timeline-nav-prev) {
			left: -0.75rem;
		}
		:global(.timeline-nav-next) {
			right: -0.75rem;
		}
	}
	@keyframes timeline-nav-fade {
		to {
			opacity: 1;
		}
	}

	/* ========== Item: geometry ========== */
	.item {
		/* geometry */
		--node: 18px;
		--rail: 2px;
		--gap: 1rem;
		--run: 1.9rem;
		--node-gap: 4px;
		--fs-date: 0.72rem;
		--fs-title: 0.9rem;
		--fs-body: 0.83rem;

		/* the marker / rail accent — `color` prop wins, else the status hue */
		--accent: var(--marker-color, var(--color-action, #2563eb));
		--node-fg: var(--color-action-text, #fff);
		/* rail segment colour (overridden per status below) */
		--rail-color: var(--color-border, #e5e7eb);

		position: relative;
		display: block;

		&.dense {
			--node: 14px;
			--gap: 0.7rem;
			--run: 1.1rem;
			--node-gap: 3px;
			--fs-date: 0.68rem;
			--fs-title: 0.83rem;
			--fs-body: 0.78rem;
		}

		&.comfortable {
			--node: 24px;
			--rail: 2.5px;
			--gap: 1.25rem;
			--run: 2.6rem;
			--node-gap: 5px;
			--fs-date: 0.78rem;
			--fs-title: 1rem;
			--fs-body: 0.9rem;
		}

		/* Vertical layout — the rail trails below each item. */
		&.vertical {
			padding-bottom: var(--run);
		}

		/* Horizontal layout. Equal-width columns (min-width drives the spacing)
		   with the node centred, so adjacent nodes sit one item-width apart and
		   the rail can span cleanly from one to the next. */
		&.horizontal {
			min-width: 9rem;
			scroll-snap-align: start;

			&.dense {
				min-width: 6.5rem;
			}
			&.comfortable {
				min-width: 12.5rem;
			}
		}
	}

	/* ========== Lead: the marker + content row (one clickable surface) ========== */
	.lead {
		display: flex;
		width: 100%;
		box-sizing: border-box;
		color: inherit;
		text-decoration: none;

		.item.vertical & {
			flex-direction: row;
			align-items: flex-start;
			gap: var(--gap);
		}

		.item.horizontal & {
			flex-direction: column;
			align-items: center;
		}
	}

	/* status → accent hue + rail-segment colour */
	.item.complete {
		--accent: var(--marker-color, var(--color-success, #16a34a));
		--node-fg: var(--color-success-text, #fff);
		--rail-color: var(--marker-color, var(--color-success, #16a34a));
	}
	.item.active {
		--accent: var(--marker-color, var(--color-action, #2563eb));
	}
	.item.pending {
		--accent: var(--marker-color, var(--color-text-muted, #9ca3af));
	}

	/* ========== Entrance reveal (only with the `reveal` class) ==========
	   Each node springs in while its rail draws toward the next one. Gated on
	   `.reveal` so a timeline with `animate={false}` — or one revealed after a
	   skeleton — simply appears, fully formed. */
	.item.reveal {
		opacity: 0;
		transform: translateY(14px);
		transition:
			opacity 520ms var(--ease-out, ease),
			transform 520ms var(--ease-out, ease);
	}
	.item.reveal.visible {
		opacity: 1;
		transform: none;
	}
	.item.reveal.horizontal {
		transform: translateX(18px);
	}
	.item.reveal.horizontal.visible {
		transform: none;
	}

	/* ========== Alternate Mode (vertical) ==========
	   Each item is a half-width column whose node lands exactly on the central
	   axis, so the rail stays a single straight line with events fanning out
	   left/right. */
	.item.vertical.alternate {
		width: calc(50% + var(--node) / 2);
	}

	.item.vertical.alternate.odd {
		margin-left: calc(50% - var(--node) / 2);
	}

	.item.vertical.alternate.even {
		text-align: right;
	}
	.item.vertical.alternate.even .lead {
		flex-direction: row-reverse;
	}

	/* ========== Marker / node ========== */
	.marker {
		position: relative;
		z-index: 1;
		flex-shrink: 0;
		display: flex;
		align-items: flex-start;
		justify-content: center;
	}
	.item.horizontal .marker {
		align-items: center;
	}

	.node {
		position: relative;
		width: var(--node);
		height: var(--node);
		border-radius: var(--radius-full, 1e5px);
		display: grid;
		place-items: center;
		color: var(--node-fg);
		background: var(--accent);
		/* soft halo so a filled marker reads as lit, not flat */
		box-shadow: 0 0 0 4px rgb(from var(--accent) r g b / 0.12);
		/* reveal: spring-pop; hover: gentle grow. Colour/shadow snap in (see below). */
		scale: var(--node-scale, 1);
		transition:
			scale 360ms var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)),
			background-color 240ms ease,
			box-shadow 240ms ease;
	}
	/* start collapsed only while a reveal is pending */
	.item.reveal .node {
		--node-scale: 0;
	}
	.item.reveal.visible .node {
		--node-scale: 1;
	}

	/* Resting glyph (a custom icon, or the complete-status check). The wrapper is
	   sized to the node and its svg fills it — so it works whatever the icon
	   component renders, and stays separate from the `.feedback` layers. */
	.node > .glyph {
		display: grid;
		place-items: center;
		width: 63%;
		height: 63%;
	}
	.node > .glyph :global(svg) {
		width: 100%;
		height: 100%;
	}
	/* The resting glyph fades away while the promise feedback occupies the node. */
	.node.busy > .glyph {
		opacity: 0;
	}

	/* ========== Promise-aware feedback (spinner → success check) ========== */
	.feedback {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		z-index: 1;
	}
	.feedback .layer {
		grid-area: 1 / 1; /* stack the spinner and the check in one cell */
		display: grid;
		place-items: center;
	}
	/* Fit the (fixed 16px) spinner to the node and give it a faint same-colour
	   track so it reads as one ring inside the marker. */
	.feedback :global(.progress) {
		scale: calc(var(--node) / 20);
	}
	.feedback :global(circle.track) {
		stroke: rgb(from currentColor r g b / 0.25);
	}
	.feedback :global(circle.arc) {
		stroke: currentColor;
	}
	.feedback .check {
		width: 64%;
		height: 64%;
	}
	.feedback .check polyline {
		stroke-dasharray: 24;
		stroke-dashoffset: var(--check-draw, 0);
	}
	/* Hold the active ping while the step is working — the spinner is the focus. */
	.item.active.motion .node.busy::before {
		animation: none;
	}

	/* Active — the "you are here" node: a steady glow plus an expanding ping. */
	.item.active .node {
		box-shadow:
			0 0 0 4px rgb(from var(--accent) r g b / 0.18),
			0 0 14px 1px rgb(from var(--accent) r g b / 0.45);
	}
	.item.active.motion .node::before {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: inherit;
		background: var(--accent);
		z-index: -1;
		animation: timeline-ping 2.4s var(--ease-out, ease-out) infinite;
	}

	/* Pending — a clean hollow ring with a faint fill. */
	.item.pending .node,
	.pending-node {
		background: rgb(from var(--accent) r g b / 0.1);
		box-shadow: inset 0 0 0 var(--rail) var(--accent);
		color: var(--accent);
	}
	.pending-node {
		--accent: var(--marker-color, var(--color-text-muted, #9ca3af));
		width: var(--node, 18px);
		height: var(--node, 18px);
		border-radius: var(--radius-full, 1e5px);
	}
	.pending-item.motion .pending-node {
		animation: timeline-breathe 2.4s ease-in-out infinite;
	}

	/* ========== Connector (the progress rail) ========== */
	.connector {
		position: absolute;
		border-radius: var(--radius-full, 1e5px);
		background: var(--rail-color);
		z-index: 0;
	}

	.item.vertical > .connector {
		left: calc(var(--node) / 2 - var(--rail) / 2);
		top: calc(var(--node) + var(--node-gap));
		bottom: var(--node-gap);
		width: var(--rail);
	}

	/* The node is centred (50%); the next item's node sits one full item-width
	   away, so the segment runs from this node's right edge to the next node's
	   left edge (minus the breathing gap at each end). */
	.item.horizontal > .connector {
		top: calc(var(--node) / 2 - var(--rail) / 2);
		left: calc(50% + var(--node) / 2 + var(--node-gap));
		width: calc(100% - var(--node) - 2 * var(--node-gap));
		height: var(--rail);
	}

	/* draw-in: the rail grows toward the next node after this one pops */
	.item.reveal.vertical > .connector {
		transform: scaleY(0);
		transform-origin: top center;
		transition: transform 560ms var(--ease-out, ease) 120ms;
	}
	.item.reveal.vertical.visible > .connector {
		transform: scaleY(1);
	}
	.item.reveal.horizontal > .connector {
		transform: scaleX(0);
		transform-origin: left center;
		transition: transform 560ms var(--ease-out, ease) 120ms;
	}
	.item.reveal.horizontal.visible > .connector {
		transform: scaleX(1);
	}

	/* The active segment fades from "done" into the muted road ahead. */
	.item.active.vertical > .connector {
		background: linear-gradient(to bottom, var(--accent), var(--color-border, #e5e7eb));
	}
	.item.active.horizontal > .connector {
		background: linear-gradient(to right, var(--accent), var(--color-border, #e5e7eb));
	}

	/* Hide the trailing connector — the last node has nowhere to go. The
	   pending-item carries the `.item` class, so an item followed by the
	   pending node still draws its rail; only the genuine last node drops it. */
	.item:not(:has(~ .item)) > .connector {
		display: none;
	}

	/* Alternate mode: the rail hugs the central axis on both sides. */
	.item.vertical.alternate.even > .connector {
		left: auto;
		right: calc(var(--node) / 2 - var(--rail) / 2);
	}

	/* ========== Interactive lead (clickable step) ==========
	   The whole marker + content surface is the touch target (mirrors Button:
	   pointer cursor, ripple, press scale, snap-in / ease-out hover). The hover
	   tint is painted only behind the text, by a pseudo-element, so an item
	   gaining an onclick/href never changes its layout. */
	.lead.interactive {
		position: relative;
		cursor: pointer;
		outline: none;
		-webkit-tap-highlight-color: transparent;
		transition: scale 180ms ease;
	}
	.lead.interactive:active {
		scale: 0.985;
	}
	.lead.interactive:focus-visible {
		outline: 2px solid var(--color-action, #2563eb);
		outline-offset: 3px;
		border-radius: var(--radius-md, 5px);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md, 5px) * var(--squircle-ratio, 2));
		}
	}

	/* Hovering the step leans its marker in and deepens its title. */
	.lead.interactive:hover .node {
		--node-scale: 1.1;
		box-shadow: 0 0 0 6px rgb(from var(--accent) r g b / 0.18);
		transition: scale 320ms var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1));
	}
	.item.active .lead.interactive:hover .node {
		box-shadow:
			0 0 0 6px rgb(from var(--accent) r g b / 0.22),
			0 0 16px 1px rgb(from var(--accent) r g b / 0.5);
	}
	.lead.interactive:hover .title {
		color: var(--color-text-active, var(--color-text, #1a1a1a));
		transition: none;
	}

	/* ========== Content ========== */
	.content {
		flex: 1;
		min-width: 0;
		position: relative;
		/* own stacking context so the tint (::before, z-index -1) tucks behind the
		   text without escaping behind the whole item */
		isolation: isolate;
		/* nudge the first text line so it sits centred against the node */
		padding-top: calc(var(--node) / 2 - 0.5em);

		.item.horizontal & {
			margin-top: 0.85rem;
			padding-top: 0;
			text-align: center;
		}
	}
	/* The hover tint — a rounded panel behind the text only. Absolutely
	   positioned, so it adds no layout (interactive and plain items match). */
	.content::before {
		content: '';
		position: absolute;
		inset: -0.3rem -0.6rem;
		z-index: -1;
		border-radius: var(--radius-md, 5px);
		background: transparent;
		transition: background-color 240ms ease;
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md, 5px) * var(--squircle-ratio, 2));
		}
	}
	.item.horizontal .content::before {
		inset: -0.3rem -0.7rem;
	}
	.lead.interactive:hover .content::before {
		background: rgb(from var(--color-text, #333) r g b / 0.06);
		transition: none;
	}

	/* The ripple panel — the same rounded footprint as the tint, sitting on top
	   so it catches the press and clips the ripple to a clean, intentional shape
	   (not the whole arbitrary marker+content row). Transparent, so the tint
	   behind the text stays the resting look. Clicks still bubble to `.lead`, so
	   the marker remains part of the touch target. */
	.surface {
		position: absolute;
		inset: -0.3rem -0.6rem;
		z-index: 2;
		border-radius: var(--radius-md, 5px);
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-md, 5px) * var(--squircle-ratio, 2));
		}
	}
	.item.horizontal .surface {
		inset: -0.3rem -0.7rem;
	}

	time {
		display: block;
		font-size: var(--fs-date);
		font-weight: var(--font-weight-semibold, 600);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-text-muted, #6b7280);
		margin-bottom: 0.3em;
		line-height: 1.2;
	}

	.title {
		font-weight: var(--font-weight-semibold, 600);
		font-size: var(--fs-title);
		color: var(--color-text, #1a1a1a);
		line-height: 1.35;
		transition: color 240ms ease;
	}

	.body {
		margin-top: 0.25em;
		font-size: var(--fs-body);
		color: var(--color-text-muted, #6b7280);
		line-height: 1.55;
	}

	/* ========== Pending Indicator (trailing) ========== */
	.pending-item {
		padding-bottom: 0;
	}

	/* ========== Load-more Sentinel ========== */
	.sentinel {
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

	.skeleton-item > .connector {
		background: var(--skeleton-bg, rgb(from var(--color-text, #888) r g b / 0.1));
	}

	.skeleton-circle,
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

	/* Same footprint as the real .node. */
	.skeleton-circle {
		width: var(--node, 18px);
		height: var(--node, 18px);
		border-radius: var(--radius-full, 1e5px);
	}

	/* Flex column so the bars' line-padding margins don't collapse — each bar's
	   margins pad it out to its real text line's 1lh, keeping skeleton items
	   exactly as tall as loaded ones. */
	.skeleton-item .content {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
	}

	.skeleton-item.horizontal .content {
		align-items: center;
	}

	.skeleton-bar {
		height: 0.7em;
		border-radius: var(--radius-full, 1e5px);
		max-width: 100%;

		&.skeleton-date {
			width: 5rem;
			font-size: var(--fs-date);
			line-height: 1.2;
			margin-block: calc((1lh - 0.7em) / 2) calc((1lh - 0.7em) / 2 + 0.3em);
		}

		&.skeleton-title-bar {
			width: 8rem;
			font-size: var(--fs-title);
			line-height: 1.35;
			margin-block: calc((1lh - 0.7em) / 2);
		}

		&.skeleton-body-bar {
			width: 12rem;
			font-size: var(--fs-body);
			line-height: 1.55;
			margin-block: calc((1lh - 0.7em) / 2 + 0.25em) calc((1lh - 0.7em) / 2);
		}
	}

	/* ========== Animations ========== */
	@keyframes timeline-ping {
		0% {
			transform: scale(1);
			opacity: 0.55;
		}
		70%,
		100% {
			transform: scale(2.6);
			opacity: 0;
		}
	}

	@keyframes timeline-breathe {
		0%,
		100% {
			opacity: 0.55;
		}
		50% {
			opacity: 1;
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

	/* ========== Reduced Motion ========== */
	@media (prefers-reduced-motion: reduce) {
		.item.reveal {
			opacity: 1 !important;
			transform: none !important;
			transition: none !important;
		}

		.node {
			scale: 1 !important;
			transition: none !important;
		}

		.item.active .node::before,
		.pending-node {
			animation: none !important;
		}

		.item.reveal > .connector {
			transform: none !important;
			transition: none !important;
		}

		.skeleton-circle::after,
		.skeleton-bar::after {
			animation: none;
		}
	}
</style>
