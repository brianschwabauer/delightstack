<script lang="ts">
	import { ThemeToggle } from '@delightstack/components/actions';

	/**
	 * Bridges the delightstack <ThemeToggle> into Starlight's theming contract.
	 *
	 * Starlight persists the user's choice under `starlight-theme` and resolves
	 * it to `data-theme="light|dark"` on <html> in a pre-paint head script
	 * (ThemeProvider — kept, so there's still no flash of wrong theme).
	 * ThemeToggle persists under its own `delightstack:theme` key, which it
	 * reads back in a mount effect. Seeding that key from Starlight's BEFORE the
	 * toggle mounts keeps the two stores agreeing, with the toggle as the source
	 * of truth from then on.
	 */
	const STARLIGHT_KEY = 'starlight-theme';

	let theme = $state<'light' | 'dark' | 'auto'>('auto');
	let is_dark = $state(false);

	if (typeof localStorage !== 'undefined') {
		try {
			const stored = localStorage.getItem(STARLIGHT_KEY);
			if (stored === 'light' || stored === 'dark' || stored === 'auto') {
				theme = stored;
				localStorage.setItem('delightstack:theme', stored);
			}
		} catch {
			// localStorage unavailable (private mode etc.) — fall back to 'auto'
		}
	}

	// Starlight's chrome themes off <html data-theme="light|dark"> — never
	// 'auto'; the provider resolves auto to the system preference. `is_dark` is
	// the toggle's resolved value, so mirroring it covers both explicit cycles
	// and system-preference flips while in auto mode.
	$effect(() => {
		document.documentElement.dataset.theme = is_dark ? 'dark' : 'light';
	});

	function persist(value: 'light' | 'dark' | 'auto') {
		try {
			localStorage.setItem(STARLIGHT_KEY, value);
		} catch {
			// ignore
		}
	}
</script>

<ThemeToggle bind:theme bind:is_dark onchange={persist} />
