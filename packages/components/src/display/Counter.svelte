<script lang="ts">
	import { intersectionObserver } from '@delightstack/utilities';
	import { untrack } from 'svelte';

	type EasingFunction = (t: number) => number;

	const propId = $props.id();
	let {
		/** The target numeric value to display */
		value,

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

		/** Animation style */
		animation = 'count' as 'count' | 'flip',

		/** Whether to show thousands separators */
		separator = true,

		/** BCP 47 locale for number formatting */
		locale = undefined as string | undefined,

		/** Custom easing function (receives t in 0..1, returns 0..1) */
		easing = undefined as EasingFunction | undefined,

		/** Whether to show a skeleton placeholder before the value is visible */
		skeleton = false,

		/** Callback fired when the animation completes */
		oncomplete = undefined as (() => void) | undefined,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: className = '',
	} = $props();

	const easeFn = $derived(
		easing ??
			/** Heavy ease-out: fast start, slow finish. */
			((t: number) => 1 - Math.pow(1 - t, Math.max(5, Math.min(50, duration * 0.006)))),
	);

	let has_animated = $state(false);
	let is_animating = $state(false);
	let display_value = $state(value);
	let raf_id = $state(0);

	let flip_digits: { digit: string; is_flipping: boolean; old_digit: string }[] = $state(
		[],
	);
	let flip_active = $state(false);

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
		(prefix ?? '') + formatNumber(value) + (suffix ? ` ${suffix}` : ''),
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

	function animateFlip(from: number, to: number) {
		is_animating = true;
		flip_active = true;
		const old_str = formatNumber(from);
		const new_str = formatNumber(to);
		const max_len = Math.max(old_str.length, new_str.length);
		const old_padded = old_str.padStart(max_len);
		const new_padded = new_str.padStart(max_len);

		const initial: typeof flip_digits = [];
		for (let i = 0; i < max_len; i++) {
			initial.push({
				digit: old_padded[i],
				is_flipping: false,
				old_digit: old_padded[i],
			});
		}
		flip_digits = initial;

		const per_digit_duration = Math.min(700, duration);
		const stagger = Math.max(
			40,
			Math.min(120, (duration - per_digit_duration) / Math.max(1, max_len - 1)),
		);

		for (let i = max_len - 1; i >= 0; i--) {
			const digit_delay = delay + (max_len - 1 - i) * stagger;
			if (old_padded[i] !== new_padded[i]) {
				const idx = i;
				setTimeout(() => {
					flip_digits = flip_digits.map((d, j) =>
						j === idx
							? { digit: new_padded[idx], is_flipping: true, old_digit: old_padded[idx] }
							: d,
					);
				}, digit_delay);
			}
		}

		const total_time =
			delay + Math.max(0, max_len - 1) * stagger + per_digit_duration + 50;
		setTimeout(() => {
			display_value = to;
			is_animating = false;
			flip_active = false;
			flip_digits = [];
			oncomplete?.();
		}, total_time);
	}

	function startAnimation() {
		if (has_animated) return;
		has_animated = true;

		if (prefers_reduced_motion) {
			display_value = value;
			oncomplete?.();
			return;
		}

		if (animation === 'flip') animateFlip(0, value);
		else animateCount(0, value);
	}

	$effect(() => {
		const current_target = value;
		const animated = untrack(() => has_animated);
		const prev = untrack(() => display_value);

		if (!animated) return;

		if (prefers_reduced_motion) {
			display_value = current_target;
			return;
		}

		const from = prev;
		if (animation === 'flip') animateFlip(from, current_target);
		else animateCount(from, current_target);
	});

	$effect(() => {
		return () => {
			if (raf_id) cancelAnimationFrame(raf_id);
		};
	});

	export function restart() {
		if (raf_id) cancelAnimationFrame(raf_id);
		flip_active = false;
		flip_digits = [];
		display_value = 0;
		has_animated = false;
		is_animating = false;
		startAnimation();
	}
</script>

<span
	class={['counter', `counter-${animation}`, className].filter(Boolean).join(' ')}
	class:skeleton={skeleton && !has_animated}
	{id}
	role="img"
	aria-live="polite"
	aria-label={aria_label_text}
	style:--counter-duration="{duration}ms"
	{@attach intersectionObserver({ onintersectonce: () => startAnimation() })}>
	{#if prefix}<span class="counter-affix counter-prefix">{prefix}</span>{/if}

	{#if animation === 'flip' && flip_active}
		<span class="counter-digits">
			{#each flip_digits as cell, i (i)}
				{@const is_sep =
					cell.digit === ',' ||
					cell.digit === '.' ||
					cell.digit === ' ' ||
					cell.digit === ' '}
				{#if is_sep}
					<span class="counter-separator">{cell.digit}</span>
				{:else}
					<span class="counter-digit" class:flipping={cell.is_flipping}>
						<span class="flip-card" aria-hidden="true">
							<span class="flip-face flip-front">{cell.old_digit}</span>
							<span class="flip-face flip-back">{cell.digit}</span>
						</span>
					</span>
				{/if}
			{/each}
		</span>
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
		background: var(--color-border, rgb(0 0 0 / 0.1));
		border-radius: var(--radius-2, 0.25rem);
		color: transparent;
		user-select: none;
		animation: counter-skeleton-pulse 1.5s ease-in-out infinite;
	}

	@keyframes counter-skeleton-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
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

	.counter-digits {
		display: inline-flex;
		align-items: stretch;
		gap: 0;
	}

	.counter-separator {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.counter-digit {
		display: inline-block;
		position: relative;
		width: 0.6em;
		height: 1em;
		perspective: 600px;
	}

	.flip-card {
		position: relative;
		width: 100%;
		height: 100%;
		transform-style: preserve-3d;
		transition: transform 0ms linear;
	}

	.counter-digit.flipping .flip-card {
		transform: rotateX(180deg);
		transition: transform var(--counter-duration, 700ms) cubic-bezier(0.22, 1, 0.36, 1);
	}

	.flip-face {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		backface-visibility: hidden;
	}

	.flip-back {
		transform: rotateX(180deg);
	}

	@media (prefers-reduced-motion: reduce) {
		.counter-digit.flipping .flip-card {
			transition: none !important;
			transform: rotateX(180deg);
		}
	}
</style>
