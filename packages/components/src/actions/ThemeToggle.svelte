<script lang="ts">
	import { tooltip, ripple } from '@delightstack/utilities';

	/**
	 * A theme toggle component that cycles between light, dark, and auto modes.
	 * Uses a moon-with-stars icon for dark and a sun for light; transitions
	 * between them with a soft fade/scale microinteraction.
	 */

	const STORAGE_KEY = 'delightstack:theme';

	let {
		/** The current theme: 'light', 'dark', or 'auto' */
		theme = $bindable('auto') as 'light' | 'dark' | 'auto',

		/** Whether the current effective theme is dark. */
		isDark = $bindable(false) as boolean,

		/** The size of the toggle button: '0' (small), '1' (medium), '2' (large) */
		size = '1' as '0' | '1' | '2',

		/** Whether the system/auto option should be disabled (only light/dark) */
		disableAuto = false,

		/** Show a text label beside the icon ("Light" / "Dark" / "Auto"). */
		showLabel = false,

		/** Custom text label override. Falls back to the current mode name. */
		label = undefined as string | undefined,

		/** Tooltip text shown on hover */
		tooltip: tooltipMessage = '',

		/** The ID of the element. @defaults to a random ID */
		id = undefined as string | undefined,

		/** Specifies a custom class name for the container element */
		class: className = '',

		/** Called when the theme changes */
		onchange = undefined as ((theme: 'light' | 'dark' | 'auto') => void) | undefined,
	} = $props();

	const SIZE_MAP = { '0': 18, '1': 22, '2': 28 } as const;
	const svgSize = $derived(SIZE_MAP[size]);

	let systemPrefersDark = $state(false);

	const effectiveDark = $derived(
		theme === 'dark' ? true : theme === 'light' ? false : systemPrefersDark,
	);

	$effect(() => {
		isDark = effectiveDark;
	});

	$effect(() => {
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored === 'light' || stored === 'dark' || stored === 'auto') {
				theme = disableAuto && stored === 'auto' ? 'light' : stored;
			}
		} catch {
			// ignore
		}

		const mql = window.matchMedia('(prefers-color-scheme: dark)');
		systemPrefersDark = mql.matches;

		function handleChange(e: MediaQueryListEvent) {
			systemPrefersDark = e.matches;
		}
		mql.addEventListener('change', handleChange);

		return () => {
			mql.removeEventListener('change', handleChange);
		};
	});

	$effect(() => {
		document.documentElement.style.colorScheme = effectiveDark ? 'dark' : 'light';
	});

	function persistTheme(value: 'light' | 'dark' | 'auto') {
		try {
			localStorage.setItem(STORAGE_KEY, value);
		} catch {
			// ignore
		}
	}

	function cycleTheme() {
		if (disableAuto) {
			theme = theme === 'light' ? 'dark' : 'light';
		} else {
			if (theme === 'light') theme = 'dark';
			else if (theme === 'dark') theme = 'auto';
			else theme = 'light';
		}
		persistTheme(theme);
		onchange?.(theme);
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			cycleTheme();
		}
	}

	const modeLabel = $derived(theme === 'auto' ? 'Auto' : theme === 'dark' ? 'Dark' : 'Light');
	const ariaLabel = $derived(
		theme === 'auto'
			? 'Theme: auto (system preference)'
			: theme === 'dark'
				? 'Theme: dark'
				: 'Theme: light',
	);
</script>

<button
	type="button"
	{id}
	class={['theme-toggle', `size-${size}`, className].filter(Boolean).join(' ')}
	class:is-dark={effectiveDark}
	class:is-auto={theme === 'auto'}
	class:has-label={showLabel}
	aria-label={ariaLabel}
	onclick={cycleTheme}
	onkeydown={handleKeyDown}
	{@attach tooltip(tooltipMessage || (showLabel ? '' : ariaLabel))}
	{@attach ripple({})}>
	<span class="icon" style:width="{svgSize}px" style:height="{svgSize}px">
		<svg
			class="sun"
			width={svgSize}
			height={svgSize}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true">
			<circle cx="12" cy="12" r="5" />
			<g class="rays">
				<line x1="12" y1="1" x2="12" y2="3" />
				<line x1="12" y1="21" x2="12" y2="23" />
				<line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
				<line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
				<line x1="1" y1="12" x2="3" y2="12" />
				<line x1="21" y1="12" x2="23" y2="12" />
				<line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
				<line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
			</g>
		</svg>
		<svg
			class="moon"
			width={svgSize}
			height={svgSize}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true">
			<!-- Crescent moon facing left, with two small twinkling stars. -->
			<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
			<circle class="star star-1" cx="7" cy="5" r="0.9" />
			<circle class="star star-2" cx="4" cy="10" r="0.6" />
		</svg>
	</span>
	{#if showLabel}
		<span class="label">{label ?? modeLabel}</span>
	{/if}
	{#if theme === 'auto'}
		<span class="auto-indicator" aria-hidden="true">A</span>
	{/if}
</button>

<style>
	.theme-toggle {
		--icon-duration: 500ms;
		--icon-easing: cubic-bezier(0.22, 1, 0.36, 1);

		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 0.5em;
		background: none;
		border: none;
		padding: 0.5em;
		cursor: pointer;
		color: currentColor;
		border-radius: var(--radius-round, 9999px);
		font: inherit;
		overflow: hidden;
		transition:
			background-color 250ms ease,
			translate 200ms ease;
		-webkit-tap-highlight-color: transparent;
	}
	.theme-toggle.has-label {
		padding: 0.4em 0.9em;
		border-radius: var(--radius-3, 8px);
	}
	.theme-toggle:hover {
		background-color: rgb(from currentColor r g b / 0.08);
	}
	.theme-toggle:active {
		translate: 0px 1px clamp(-10px, calc(0.2em - 12px), -2px);
	}
	.theme-toggle:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: 2px;
	}

	.icon {
		position: relative;
		display: inline-block;
		flex-shrink: 0;
	}
	.icon svg {
		position: absolute;
		inset: 0;
		transition:
			opacity var(--icon-duration) var(--icon-easing),
			transform var(--icon-duration) var(--icon-easing);
		transform-origin: center;
	}

	/* Light mode: sun visible, moon hidden */
	.theme-toggle:not(.is-dark) .sun {
		opacity: 1;
		transform: scale(1) rotate(0deg);
	}
	.theme-toggle:not(.is-dark) .moon {
		opacity: 0;
		transform: scale(0.4) rotate(-90deg);
	}

	/* Dark mode: moon visible, sun hidden */
	.theme-toggle.is-dark .sun {
		opacity: 0;
		transform: scale(0.4) rotate(90deg);
	}
	.theme-toggle.is-dark .moon {
		opacity: 1;
		transform: scale(1) rotate(0deg);
	}

	.rays {
		transform-origin: center;
		transition:
			opacity var(--icon-duration) var(--icon-easing),
			transform var(--icon-duration) var(--icon-easing);
	}
	.theme-toggle:not(.is-dark) .rays {
		opacity: 1;
		transform: scale(1) rotate(0deg);
	}
	.theme-toggle.is-dark .rays {
		opacity: 0;
		transform: scale(0) rotate(45deg);
	}

	.moon .star {
		transform-origin: center;
		opacity: 0.85;
		animation: twinkle 2.4s ease-in-out infinite;
	}
	.moon .star-2 {
		animation-delay: 1.2s;
	}
	@keyframes twinkle {
		0%, 100% {
			opacity: 0.4;
			transform: scale(0.85);
		}
		50% {
			opacity: 1;
			transform: scale(1.15);
		}
	}

	.label {
		font-size: 0.9em;
		line-height: 1;
	}

	.auto-indicator {
		position: absolute;
		bottom: 0.15em;
		right: 0.15em;
		font-size: 0.55em;
		font-weight: 700;
		line-height: 1;
		opacity: 0.7;
		pointer-events: none;
	}

	@media (prefers-reduced-motion: reduce) {
		.icon svg,
		.rays {
			transition: none;
		}
		.moon .star {
			animation: none;
		}
	}
</style>
