<script lang="ts">
	import { intersectionObserver } from '@delightstack/utilities';
	import { untrack } from 'svelte';

	type EasingFunction = (t: number) => number;

	const propId = $props.id();
	let {
		/** The target numeric value to display. May be assigned later (e.g.
		 *  while stats load) — pair with `skeleton` to show a placeholder
		 *  until it arrives. */
		value = undefined as number | undefined,

		/** Animation duration in milliseconds */
		duration = 5000,

		/** Delay before animation starts in milliseconds */
		delay = 0,

		/** Number of decimal places to display */
		decimals = 0,

		/** Text to display before the number (rendered smaller, top-aligned) */
		prefix = undefined as string | undefined,

		/** Text to display after the number (rendered smaller, top-aligned) */
		suffix = undefined as string | undefined,

		/** Custom format function — takes precedence over Intl.NumberFormat */
		format = undefined as ((value: number) => string) | undefined,

		/** Whether to show thousands separators */
		separator = true,

		/** BCP 47 locale for number formatting */
		locale = undefined as string | undefined,

		/** Custom easing function (receives t in 0..1, returns 0..1) */
		easing = undefined as EasingFunction | undefined,

		/** Show a number-shaped shimmer placeholder while `value` is not yet
		 *  available. It dismisses itself (and the count-up starts) as soon as
		 *  `value` arrives. Width can be tuned via `--counter-skeleton-width`. */
		skeleton = false,

		/** Callback fired when the animation completes */
		oncomplete = undefined as (() => void) | undefined,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: class_name = '',
	} = $props();

	const easeFn = $derived(
		easing ??
			/** Heavy ease-out: fast start, slow finish. */
			((t: number) => 1 - Math.pow(1 - t, Math.max(5, Math.min(50, duration * 0.006)))),
	);

	let has_animated = $state(false);
	let is_animating = $state(false);
	let has_intersected = $state(false);

	/** Placeholder shows until the value exists; the count-up is deferred so
	 *  it doesn't run invisibly behind the shimmer. */
	const show_skeleton = $derived(skeleton && value == null);
	/** Start at 0 so SSR and the initial client render match (no hydration jump):
	 *  the count then animates up from 0 once the element scrolls into view. The
	 *  true value is always exposed via `aria-label` for assistive tech. */
	let display_value = $state(0);
	let raf_id = $state(0);

	let prefers_reduced_motion = $state(false);
	$effect(() => {
		if (typeof window !== 'undefined') {
			const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
			prefers_reduced_motion = mql.matches;
			const handler = (e: MediaQueryListEvent) => {
				prefers_reduced_motion = e.matches;
			};
			mql.addEventListener('change', handler);
			return () => mql.removeEventListener('change', handler);
		}
	});

	function formatNumber(n: number): string {
		if (format) return format(n);
		const options: Intl.NumberFormatOptions = {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals,
			useGrouping: separator,
		};
		return new Intl.NumberFormat(locale, options).format(n);
	}

	const formatted_value = $derived(formatNumber(display_value));

	const aria_label_text = $derived(
		value == null
			? 'Loading'
			: (prefix ?? '') + formatNumber(value) + (suffix ? ` ${suffix}` : ''),
	);

	function animateCount(from: number, to: number) {
		if (raf_id) cancelAnimationFrame(raf_id);
		is_animating = true;
		const start_time = performance.now() + delay;

		function step(now: number) {
			const elapsed = now - start_time;
			if (elapsed < 0) {
				raf_id = requestAnimationFrame(step);
				return;
			}
			const progress = Math.min(elapsed / duration, 1);
			const eased = easeFn(progress);
			display_value = from + (to - from) * eased;

			if (progress < 1) {
				raf_id = requestAnimationFrame(step);
			} else {
				display_value = to;
				is_animating = false;
				raf_id = 0;
				oncomplete?.();
			}
		}

		raf_id = requestAnimationFrame(step);
	}

	function startAnimation() {
		if (has_animated || value == null) return;
		has_animated = true;

		if (prefers_reduced_motion) {
			display_value = value;
			oncomplete?.();
			return;
		}

		animateCount(0, value);
	}

	// Kick off the count-up once the counter is both on screen and has a real
	// value (the skeleton may still be covering it when it first intersects).
	// The animation itself is untracked: animateCount reads AND writes raf_id
	// (and display_value), which would otherwise re-trigger this effect
	// forever (effect_update_depth_exceeded).
	$effect(() => {
		if (!has_intersected || show_skeleton) return;
		untrack(() => startAnimation());
	});

	$effect(() => {
		const current_target = value;
		const animated = untrack(() => has_animated);
		const prev = untrack(() => display_value);

		if (!animated || current_target == null) return;

		if (prefers_reduced_motion) {
			display_value = current_target;
			return;
		}

		untrack(() => animateCount(prev, current_target));
	});

	$effect(() => {
		return () => {
			if (raf_id) cancelAnimationFrame(raf_id);
		};
	});

	export function restart() {
		if (raf_id) cancelAnimationFrame(raf_id);
		display_value = 0;
		has_animated = false;
		is_animating = false;
		startAnimation();
	}
</script>

<span
	class={['counter', class_name].filter(Boolean).join(' ')}
	class:skeleton={show_skeleton}
	{id}
	role="img"
	aria-live="polite"
	aria-busy={show_skeleton || undefined}
	aria-label={aria_label_text}
	{@attach intersectionObserver({ onintersectonce: () => (has_intersected = true) })}>
	{#if prefix}<span class="counter-affix counter-prefix">{prefix}</span>{/if}

	{#if show_skeleton}
		<!-- Known affixes render for real; only the unknown number is a pill. -->
		<span class="skeleton-pill"></span>
	{:else}
		<span class="counter-value">{formatted_value}</span>
	{/if}

	{#if suffix}<span class="counter-affix counter-suffix">{suffix}</span>{/if}
</span>

<style>
	.counter {
		display: inline-flex;
		align-items: flex-start;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		line-height: 1;
	}

	.counter.skeleton {
		user-select: none;
	}

	/* A digits-sized pill standing in for the unknown number. `ch` units track
	   the counter's own font, so a 3rem stat gets a proportionally large pill. */
	.skeleton-pill {
		display: inline-block;
		width: var(--counter-skeleton-width, 4ch);
		height: 0.8em;
		margin-top: 0.1em;
		border-radius: var(--radius-full, 1e5px);
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
		.skeleton-pill::after {
			animation: none;
		}
	}

	.counter-affix {
		display: inline-block;
		font-size: 0.5em;
		line-height: 1;
		font-weight: 500;
		opacity: 0.85;
		align-self: flex-start;
		padding-top: 0.15em;
	}
	.counter-prefix {
		margin-right: 0.1em;
	}
	.counter-suffix {
		margin-left: 0.1em;
	}

	.counter-value {
		display: inline;
	}
</style>
