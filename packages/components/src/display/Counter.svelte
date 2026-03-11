<script lang="ts">
	import { intersectionObserver } from '@delightstack/utilities';
	import { untrack } from 'svelte';

	type EasingFunction = (t: number) => number;

	const propId = $props.id();
	let {
		/** The target numeric value to display */
		value,

		/** Animation duration in milliseconds */
		duration = 1000,

		/** Delay before animation starts in milliseconds */
		delay = 0,

		/** Number of decimal places to display */
		decimals = 0,

		/** Text to display before the number */
		prefix = undefined as string | undefined,

		/** Text to display after the number */
		suffix = undefined as string | undefined,

		/** Custom format function — takes precedence over Intl.NumberFormat */
		format = undefined as ((value: number) => string) | undefined,

		/** Animation style */
		animation = 'count' as 'count' | 'flip' | 'fade',

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

	/** Default ease-out cubic */
	function defaultEasing(t: number): number {
		return 1 - Math.pow(1 - t, 3);
	}

	const easeFn = $derived(easing ?? defaultEasing);

	// ── State ──────────────────────────────────────────────────────────

	let has_animated = $state(false);
	let is_animating = $state(false);
	let display_value = $state(value);
	let raf_id = $state(0);

	// Flip-specific state
	let flip_digits: { digit: string; is_flipping: boolean; old_digit: string }[] = $state([]);
	let flip_active = $state(false);

	// Fade-specific state
	let fade_phase = $state<'idle' | 'out' | 'in'>('idle');
	let fade_timeout_ids: number[] = [];

	// Reduced motion query (only runs in browser)
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

	// ── Formatting ─────────────────────────────────────────────────────

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

	// ── Count Animation ────────────────────────────────────────────────

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

	// ── Flip Animation ─────────────────────────────────────────────────

	function animateFlip(from: number, to: number) {
		is_animating = true;
		flip_active = true;
		const old_str = formatNumber(from);
		const new_str = formatNumber(to);
		const max_len = Math.max(old_str.length, new_str.length);
		const old_padded = old_str.padStart(max_len);
		const new_padded = new_str.padStart(max_len);

		// Initialize all digits to old state
		const initial: typeof flip_digits = [];
		for (let i = 0; i < max_len; i++) {
			initial.push({
				digit: old_padded[i],
				is_flipping: false,
				old_digit: old_padded[i],
			});
		}
		flip_digits = initial;

		// Stagger flips from right to left
		const stagger = Math.min(80, duration / (max_len + 1));
		for (let i = max_len - 1; i >= 0; i--) {
			const digit_delay = delay + (max_len - 1 - i) * stagger;
			if (old_padded[i] !== new_padded[i]) {
				const idx = i;
				setTimeout(() => {
					flip_digits[idx] = {
						digit: new_padded[idx],
						is_flipping: true,
						old_digit: old_padded[idx],
					};
				}, digit_delay);
			}
		}

		const total_time = delay + (max_len - 1) * stagger + duration;
		setTimeout(() => {
			display_value = to;
			is_animating = false;
			flip_active = false;
			flip_digits = [];
			oncomplete?.();
		}, total_time);
	}

	// ── Fade Animation ─────────────────────────────────────────────────

	function clearFadeTimeouts() {
		for (const tid of fade_timeout_ids) clearTimeout(tid);
		fade_timeout_ids = [];
	}

	function animateFade(from: number, to: number) {
		clearFadeTimeouts();
		is_animating = true;
		const half = duration / 2;

		// Start with old value visible
		display_value = from;
		fade_phase = 'idle';

		fade_timeout_ids.push(
			setTimeout(() => {
				// Fade out old value
				fade_phase = 'out';

				fade_timeout_ids.push(
					setTimeout(() => {
						// Swap to new value and fade in
						display_value = to;
						fade_phase = 'in';

						fade_timeout_ids.push(
							setTimeout(() => {
								fade_phase = 'idle';
								is_animating = false;
								oncomplete?.();
							}, half) as unknown as number,
						);
					}, half) as unknown as number,
				);
			}, delay) as unknown as number,
		);
	}

	// ── Trigger on intersection ────────────────────────────────────────

	function startAnimation() {
		if (has_animated) return;
		has_animated = true;

		if (prefers_reduced_motion) {
			display_value = value;
			oncomplete?.();
			return;
		}

		switch (animation) {
			case 'flip':
				animateFlip(0, value);
				break;
			case 'fade':
				animateFade(0, value);
				break;
			default:
				animateCount(0, value);
		}
	}

	// ── React to value changes after initial animation ─────────────────

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
		switch (animation) {
			case 'flip':
				animateFlip(from, current_target);
				break;
			case 'fade':
				animateFade(from, current_target);
				break;
			default:
				animateCount(from, current_target);
		}
	});

	// Cleanup on destroy
	$effect(() => {
		return () => {
			if (raf_id) cancelAnimationFrame(raf_id);
			clearFadeTimeouts();
		};
	});
</script>

<span
	class={['counter', `counter-${animation}`, className].filter(Boolean).join(' ')}
	class:fade-out={animation === 'fade' && fade_phase === 'out'}
	class:fade-in={animation === 'fade' && fade_phase === 'in'}
	class:skeleton={skeleton && !has_animated}
	{id}
	role="img"
	aria-live="polite"
	aria-label={aria_label_text}
	style:--counter-duration="{duration}ms"
	style:--counter-fade-duration="{duration / 2}ms"
	{@attach intersectionObserver({ onintersectonce: () => startAnimation() })}>
	{#if prefix}<span class="counter-affix">{prefix}</span>{/if}

	{#if animation === 'flip' && flip_active}
		{#each flip_digits as cell, i (i)}
			{@const is_sep = cell.digit === ',' || cell.digit === '.' || cell.digit === '\u00a0' || cell.digit === ' '}
			{#if is_sep}
				<span class="counter-separator">{cell.digit}</span>
			{:else}
				<span
					class="counter-digit"
					class:flipping={cell.is_flipping}
					style:--flip-duration="{duration}ms">
					<span class="flip-top" aria-hidden="true">
						<span class="flip-top-front">{cell.old_digit}</span>
						<span class="flip-top-back">{cell.digit}</span>
					</span>
					<span class="flip-bottom" aria-hidden="true">
						<span class="flip-bottom-front">{cell.old_digit}</span>
						<span class="flip-bottom-back">{cell.digit}</span>
					</span>
				</span>
			{/if}
		{/each}
	{:else}
		<span class="counter-value">{formatted_value}</span>
	{/if}

	{#if suffix}<span class="counter-affix">{suffix}</span>{/if}
</span>

<style>
	.counter {
		display: inline-flex;
		align-items: baseline;
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
		display: inline;
	}

	.counter-value {
		display: inline;
	}

	/* ── Fade animation ───────────────────────────────────────────── */

	.counter-fade {
		transition: opacity var(--counter-fade-duration, 500ms) ease;
		opacity: 1;
	}

	.counter-fade.fade-out {
		opacity: 0;
	}

	.counter-fade.fade-in {
		opacity: 1;
	}

	/* ── Flip animation ───────────────────────────────────────────── */

	.counter-flip {
		gap: 0;
	}

	.counter-separator {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.counter-digit {
		display: inline-flex;
		flex-direction: column;
		position: relative;
		overflow: hidden;
		height: 1.4em;
		width: 0.65em;
		line-height: 1.4em;
		text-align: center;
	}

	.flip-top,
	.flip-bottom {
		display: flex;
		align-items: center;
		justify-content: center;
		position: absolute;
		width: 100%;
		height: 50%;
		overflow: hidden;
		backface-visibility: hidden;
	}

	.flip-top {
		top: 0;
		transform-origin: bottom center;
	}

	.flip-bottom {
		bottom: 0;
		transform-origin: top center;
	}

	.flip-top-front,
	.flip-top-back,
	.flip-bottom-front,
	.flip-bottom-back {
		position: absolute;
		inset: 0;
		display: flex;
		justify-content: center;
	}

	.flip-top-front,
	.flip-top-back {
		align-items: flex-end;
	}

	.flip-bottom-front,
	.flip-bottom-back {
		align-items: flex-start;
	}

	.flip-top-back,
	.flip-bottom-back {
		opacity: 0;
	}

	/* ── Flipping state ───────────────────────────────────────────── */

	.counter-digit.flipping .flip-top {
		animation: counter-flip-top var(--flip-duration, 1000ms) ease-in-out forwards;
	}

	.counter-digit.flipping .flip-bottom {
		animation: counter-flip-bottom var(--flip-duration, 1000ms) ease-in-out forwards;
	}

	.counter-digit.flipping .flip-top-front {
		animation: counter-digit-hide-at-half var(--flip-duration, 1000ms) step-end forwards;
	}

	.counter-digit.flipping .flip-top-back {
		animation: counter-digit-show-at-half var(--flip-duration, 1000ms) step-end forwards;
	}

	.counter-digit.flipping .flip-bottom-front {
		animation: counter-digit-hide-at-half var(--flip-duration, 1000ms) step-end forwards;
	}

	.counter-digit.flipping .flip-bottom-back {
		animation: counter-digit-show-at-half var(--flip-duration, 1000ms) step-end forwards;
	}

	@keyframes counter-flip-top {
		0% {
			transform: perspective(300px) rotateX(0deg);
		}
		50% {
			transform: perspective(300px) rotateX(-90deg);
		}
		50.01% {
			transform: perspective(300px) rotateX(-90deg);
		}
		100% {
			transform: perspective(300px) rotateX(0deg);
		}
	}

	@keyframes counter-flip-bottom {
		0%,
		50% {
			transform: perspective(300px) rotateX(0deg);
		}
		50.01% {
			transform: perspective(300px) rotateX(90deg);
		}
		100% {
			transform: perspective(300px) rotateX(0deg);
		}
	}

	@keyframes counter-digit-hide-at-half {
		0% {
			opacity: 1;
		}
		50% {
			opacity: 0;
		}
	}

	@keyframes counter-digit-show-at-half {
		0%,
		50% {
			opacity: 0;
		}
		50.01% {
			opacity: 1;
		}
	}

	/* ── Reduced motion ───────────────────────────────────────────── */

	@media (prefers-reduced-motion: reduce) {
		.counter-fade {
			transition: none !important;
		}

		.counter-digit.flipping .flip-top,
		.counter-digit.flipping .flip-bottom,
		.counter-digit.flipping .flip-top-front,
		.counter-digit.flipping .flip-top-back,
		.counter-digit.flipping .flip-bottom-front,
		.counter-digit.flipping .flip-bottom-back {
			animation: none !important;
		}

		.counter-digit.flipping .flip-top-front,
		.counter-digit.flipping .flip-bottom-front {
			opacity: 0;
		}

		.counter-digit.flipping .flip-top-back,
		.counter-digit.flipping .flip-bottom-back {
			opacity: 1;
		}
	}
</style>
