<script lang="ts">
	import { tooltip } from '@delightstack/utilities';

	/**
	 * A theme toggle component that cycles between light, dark, and auto modes.
	 * Uses an animated SVG icon that morphs between sun and moon shapes.
	 * Persists the selected theme to localStorage and applies it to the document.
	 */

	const STORAGE_KEY = 'delightstack:theme';

	let {
		/** The current theme: 'light', 'dark', or 'auto' */
		theme = $bindable('auto') as 'light' | 'dark' | 'auto',

		/**
		 * Whether the current effective theme is dark.
		 * When theme is 'auto', this reflects the system preference.
		 * Starts as false until the component mounts and checks the system preference.
		 */
		isDark = $bindable(false) as boolean,

		/** The size of the toggle button: '0' (small), '1' (medium), '2' (large) */
		size = '1' as '0' | '1' | '2',

		/** Whether the system/auto option should be disabled (only light/dark) */
		disableAuto = false,

		/** Tooltip text shown on hover */
		tooltip: tooltipMessage = '',

		/** The ID of the element. @defaults to a random ID */
		id = undefined as string | undefined,

		/** Specifies a custom class name for the container element */
		class: className = '',

		/** Called when the theme changes */
		onchange = undefined as ((theme: 'light' | 'dark' | 'auto') => void) | undefined,
	} = $props();

	const SIZE_MAP = { '0': 18, '1': 24, '2': 32 } as const;
	const svgSize = $derived(SIZE_MAP[size]);

	/** Whether the system prefers dark mode */
	let systemPrefersDark = $state(false);

	/** Compute the effective dark state from theme + system preference */
	const effectiveDark = $derived(
		theme === 'dark' ? true : theme === 'light' ? false : systemPrefersDark,
	);

	// Keep the readonly isDark binding in sync
	$effect(() => {
		isDark = effectiveDark;
	});

	// On mount: read localStorage, detect system preference, watch for changes
	$effect(() => {
		// Read stored theme
		try {
			const stored = localStorage.getItem(STORAGE_KEY);
			if (stored === 'light' || stored === 'dark' || stored === 'auto') {
				theme = disableAuto && stored === 'auto' ? 'light' : stored;
			}
		} catch {
			// localStorage may not be available
		}

		// Detect system preference
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

	// Apply theme to document whenever effective dark state changes
	$effect(() => {
		document.documentElement.style.colorScheme = effectiveDark ? 'dark' : 'light';
	});

	/** Persist theme to localStorage */
	function persistTheme(value: 'light' | 'dark' | 'auto') {
		try {
			localStorage.setItem(STORAGE_KEY, value);
		} catch {
			// localStorage may not be available
		}
	}

	/** Cycle to the next theme state */
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

	/** Label for accessibility */
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
	class={['theme-toggle', className].filter(Boolean).join(' ')}
	class:is-dark={effectiveDark}
	class:is-auto={theme === 'auto'}
	aria-label={ariaLabel}
	onclick={cycleTheme}
	onkeydown={handleKeyDown}
	{@attach tooltip(tooltipMessage || ariaLabel)}>
	<svg
		width={svgSize}
		height={svgSize}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true">
		<!-- Sun/moon center circle - grows larger for moon -->
		<circle class="center" cx="12" cy="12" r={effectiveDark ? 9 : 5} />

		<!-- Moon mask - clips the circle to create crescent -->
		{#if effectiveDark}
			<circle
				class="moon-mask"
				cx="18"
				cy="6"
				r="5.5"
				fill="var(--theme-toggle-bg, var(--surface-1, #fff))"
				stroke="var(--theme-toggle-bg, var(--surface-1, #fff))"
				stroke-width="2" />
		{/if}

		<!-- Sun rays - retract when transitioning to moon -->
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
	{#if theme === 'auto'}
		<span class="auto-indicator">A</span>
	{/if}
</button>

<style>
	.theme-toggle {
		--toggle-duration: 500ms;
		--toggle-easing: cubic-bezier(0.25, 0, 0.3, 1);

		display: inline-flex;
		align-items: center;
		justify-content: center;
		position: relative;
		background: none;
		border: none;
		padding: 0.5em;
		cursor: pointer;
		color: currentColor;
		border-radius: var(--radius-round, 50%);
		transition: background-color 200ms;
		-webkit-tap-highlight-color: transparent;

		&:hover {
			background-color: rgb(from currentColor r g b / 0.08);
		}
		&:focus-visible {
			outline: 2px solid currentColor;
			outline-offset: 2px;
		}

		svg {
			overflow: visible;
		}

		.center {
			transition:
				r var(--toggle-duration) var(--toggle-easing),
				cx var(--toggle-duration) var(--toggle-easing),
				cy var(--toggle-duration) var(--toggle-easing);
			transform-origin: center;
		}

		.moon-mask {
			transition:
				cx var(--toggle-duration) var(--toggle-easing),
				cy var(--toggle-duration) var(--toggle-easing),
				r var(--toggle-duration) var(--toggle-easing);
		}

		.rays {
			transform-origin: center;
			transition:
				opacity var(--toggle-duration) var(--toggle-easing),
				transform var(--toggle-duration) var(--toggle-easing);
		}

		/* Sun state (light mode) */
		&:not(.is-dark) {
			.rays {
				opacity: 1;
				transform: rotate(0deg) scale(1);
			}
		}

		/* Moon state (dark mode) */
		&.is-dark {
			.rays {
				opacity: 0;
				transform: rotate(45deg) scale(0);
			}
		}

		.auto-indicator {
			position: absolute;
			bottom: 0;
			right: 0;
			font-size: 0.55em;
			font-weight: 700;
			line-height: 1;
			opacity: 0.7;
			pointer-events: none;
		}
	}
</style>
