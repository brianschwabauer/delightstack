<script lang="ts">
	/**
	 * A simple theme toggle component that switches between light, dark, auto modes.
	 * If auto mode is selected, the theme will follow the system preference.
	 */
	let {
		/** Whether the system/auto theme should be disabled as an option */
		disableAuto = false,

		/** Whether to show the toggle as an icon instead of a select dropdown */
		icon = false,

		/** The current theme: 'light', 'dark', or 'auto' */
		theme = $bindable('auto') as 'light' | 'dark' | 'auto',

		/**
		 * Whether the theme is dark (this can happen when theme is 'auto' and the user has dark mode enabled)
		 * This starts off as undefined until the component mounts and checks the system preference
		 */
		isDark = $bindable(undefined) as boolean | undefined,

		/** Emits the current theme: 'light', 'dark', or 'auto' */
		onchange = (() => {}) as (theme: 'light' | 'dark' | 'auto') => void,
	} = $props();
</script>
