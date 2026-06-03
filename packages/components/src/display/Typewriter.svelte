<script lang="ts">
	const propId = $props.id();
	let {
		/** The text to type. A single string or array of strings to cycle through */
		text,

		/** Typing speed in milliseconds per character */
		speed = 50,

		/** Initial delay before typing starts (ms) */
		delay = 1000,

		/** Whether to loop through text array indefinitely */
		loop = false,

		/** Pause duration between cycling texts (ms) */
		pause_between = 2000,

		/** Cursor style: 'block', 'line', 'underscore', or false to hide */
		cursor = 'line' as 'block' | 'line' | 'underscore' | false,

		/** Whether the cursor blinks when idle */
		cursor_blink = true,

		/** Backspace speed in milliseconds per character */
		delete_speed = 30,

		/** Whether the animation is paused */
		paused = false,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: className = '',

		/** Called when typing starts */
		onstart = undefined as (() => void) | undefined,

		/** Called when all text has been typed */
		oncomplete = undefined as (() => void) | undefined,

		/** Called when cycling loops back */
		onloop = undefined as ((detail: { index: number }) => void) | undefined,
	}: {
		text: string | string[];
		speed?: number;
		delay?: number;
		loop?: boolean;
		pause_between?: number;
		cursor?: 'block' | 'line' | 'underscore' | false;
		cursor_blink?: boolean;
		delete_speed?: number;
		paused?: boolean;
		id?: string;
		class?: string;
		onstart?: (() => void) | undefined;
		oncomplete?: (() => void) | undefined;
		onloop?: ((detail: { index: number }) => void) | undefined;
	} = $props();

	const texts = $derived(Array.isArray(text) ? text : [text]);
	const is_multi = $derived(texts.length > 1);
	const full_label = $derived(Array.isArray(text) ? text.join(', ') : text);

	let displayed = $state('');
	let is_typing = $state(false);
	let prefers_reduced_motion = $state(false);

	// Track all active timeouts so we can clean them up
	let active_timeouts: ReturnType<typeof setTimeout>[] = [];

	function safeTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
		const id = setTimeout(() => {
			active_timeouts = active_timeouts.filter((t) => t !== id);
			fn();
		}, ms);
		active_timeouts.push(id);
		return id;
	}

	function clearAllTimeouts() {
		for (const t of active_timeouts) {
			clearTimeout(t);
		}
		active_timeouts = [];
	}

	function getCharDelay(char: string, base_speed: number): number {
		let multiplier = 0.8 + Math.random() * 0.4;

		// Smart punctuation pauses
		if (char === '.' || char === '?' || char === '!') {
			multiplier *= 3;
		} else if (char === ',') {
			multiplier *= 1.8;
		} else if (char === ';' || char === ':') {
			multiplier *= 2;
		} else if (char === '\n') {
			multiplier *= 2;
		}

		// 5% chance of a micro-pause (2x speed)
		if (Math.random() < 0.05) {
			multiplier *= 2;
		}

		return base_speed * multiplier;
	}

	function findCommonPrefixLength(a: string, b: string): number {
		let i = 0;
		while (i < a.length && i < b.length && a[i] === b[i]) {
			i++;
		}
		return i;
	}

	function typeText(target: string, from_index: number, onDone: () => void) {
		if (paused) {
			// When paused, wait and retry
			safeTimeout(() => typeText(target, from_index, onDone), 50);
			return;
		}

		if (from_index >= target.length) {
			onDone();
			return;
		}

		const char = target[from_index];
		const char_delay = getCharDelay(char, speed);

		safeTimeout(() => {
			displayed = target.slice(0, from_index + 1);
			typeText(target, from_index + 1, onDone);
		}, char_delay);
	}

	function deleteText(to_length: number, onDone: () => void) {
		if (paused) {
			safeTimeout(() => deleteText(to_length, onDone), 50);
			return;
		}

		if (displayed.length <= to_length) {
			onDone();
			return;
		}

		const char_delay = delete_speed * (0.8 + Math.random() * 0.4);

		safeTimeout(() => {
			displayed = displayed.slice(0, -1);
			deleteText(to_length, onDone);
		}, char_delay);
	}

	function runSequence(text_index: number) {
		const target = texts[text_index];
		if (!target && target !== '') return;

		is_typing = true;
		onstart?.();

		const common_prefix_len =
			displayed.length > 0 ? findCommonPrefixLength(displayed, target) : 0;

		function startTyping() {
			typeText(target, common_prefix_len, () => {
				is_typing = false;

				if (is_multi) {
					// Pause, then backspace, then type next
					safeTimeout(() => {
						const next_index = (text_index + 1) % texts.length;

						if (next_index === 0 && !loop) {
							oncomplete?.();
							return;
						}

						if (next_index === 0) {
							onloop?.({ index: next_index });
						}

						const next_target = texts[next_index];
						const next_common = findCommonPrefixLength(displayed, next_target);

						is_typing = true;
						deleteText(next_common, () => {
							runSequence(next_index);
						});
					}, pause_between);
				} else {
					// Single text: done
					oncomplete?.();
				}
			});
		}

		// If we need to delete down to common prefix first
		if (displayed.length > common_prefix_len) {
			deleteText(common_prefix_len, startTyping);
		} else {
			startTyping();
		}
	}

	function startAnimation() {
		clearAllTimeouts();
		displayed = '';
		is_typing = false;

		if (prefers_reduced_motion) {
			// Show full text immediately for reduced motion
			displayed = texts[0] || '';
			oncomplete?.();
			return;
		}

		safeTimeout(() => {
			runSequence(0);
		}, delay);
	}

	// Detect prefers-reduced-motion
	$effect(() => {
		const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
		prefers_reduced_motion = mql.matches;

		function handleChange(e: MediaQueryListEvent) {
			prefers_reduced_motion = e.matches;
		}

		mql.addEventListener('change', handleChange);
		return () => mql.removeEventListener('change', handleChange);
	});

	// Start/restart animation when text changes or reduced motion changes
	$effect(() => {
		// Subscribe to reactive dependencies
		const _texts = texts;
		const _reduced = prefers_reduced_motion;

		startAnimation();

		return () => {
			clearAllTimeouts();
		};
	});
</script>

<span
	class={['typewriter', className].filter(Boolean).join(' ')}
	class:cursor-line={cursor === 'line'}
	class:cursor-block={cursor === 'block'}
	class:cursor-underscore={cursor === 'underscore'}
	class:cursor-blink={cursor_blink && !is_typing && cursor !== false}
	class:has-cursor={cursor !== false}
	class:is-typing={is_typing}
	{id}
	aria-label={full_label}>
	<span aria-hidden="true">{displayed}</span>
</span>

<style>
	.typewriter {
		display: inline;
		position: relative;
	}

	.typewriter.has-cursor > span {
		position: relative;
	}

	/* Line cursor — thin vertical bar */
	.typewriter.cursor-line > span::after {
		content: '';
		display: inline-block;
		vertical-align: text-bottom;
		width: 2px;
		height: 1.1em;
		margin-left: 1px;
		background-color: currentColor;
	}

	/* Block cursor — filled rectangle */
	.typewriter.cursor-block > span::after {
		content: '';
		display: inline-block;
		vertical-align: text-bottom;
		width: 0.6em;
		height: 1.1em;
		margin-left: 1px;
		background-color: currentColor;
	}

	/* Underscore cursor — horizontal line at bottom */
	.typewriter.cursor-underscore > span::after {
		content: '';
		display: inline-block;
		vertical-align: baseline;
		width: 0.6em;
		height: 2px;
		margin-left: 1px;
		background-color: currentColor;
	}

	/* Blink animation — step-end for crisp on/off */
	.typewriter.cursor-blink > span::after {
		animation: typewriter-blink 1s step-end infinite;
	}

	/* Stop blinking while typing */
	.typewriter.is-typing > span::after {
		animation: none;
		opacity: 1;
	}

	@keyframes typewriter-blink {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0;
		}
	}

	/* Reduced motion: no blinking */
	@media (prefers-reduced-motion: reduce) {
		.typewriter.cursor-blink > span::after {
			animation: none;
			opacity: 1;
		}
	}
</style>
