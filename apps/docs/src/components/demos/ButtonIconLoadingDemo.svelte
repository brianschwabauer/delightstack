<script lang="ts">
	import { Button } from '@delightstack/components/actions';

	const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

	// Resolves slowly -> the spinner overlays the icon, then a checkmark confirms.
	async function save() {
		await wait(1500);
	}
</script>

{#snippet uploadIcon()}
	<svg viewBox="0 0 24 24" fill="currentColor">
		<path
			d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" />
	</svg>
{/snippet}

{#snippet heartIcon()}
	<svg viewBox="0 0 24 24" fill="currentColor">
		<path
			d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
	</svg>
{/snippet}

{#snippet settingsIcon()}
	<svg viewBox="0 0 24 24" fill="currentColor">
		<path
			d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
	</svg>
{/snippet}

<div style="display: flex; gap: 1rem; flex-wrap: wrap; align-items: start;">
	<Button icon accent tooltip="Upload (click me)" onclick={save}>
		{@render uploadIcon()}
	</Button>
	<Button icon loading>{@render settingsIcon()}</Button>
	<Button icon accent loading>{@render heartIcon()}</Button>
	<Button icon error loading>{@render heartIcon()}</Button>
	<Button icon translucent loading>{@render settingsIcon()}</Button>
	<Button icon outline loading>{@render settingsIcon()}</Button>
</div>
