<script>
	import { Drawer } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<Button onclick={() => (open = true)}>Open Drawer with Header/Footer</Button>

<Drawer bind:open width="320px">
	{#snippet header()}
		<div
			style="padding: 1rem; border-bottom: 1px solid var(--color-border, #ddd); display: flex; align-items: center; gap: 0.5rem;"
		>
			<svg
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<circle cx="12" cy="12" r="3" />
				<path
					d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
				/>
			</svg>
			<h3 style="margin: 0; font-size: 1.1rem;">Settings</h3>
		</div>
	{/snippet}

	<div style="padding: 1rem; flex: 1;">
		<p style="margin: 0 0 1rem; color: var(--color-text-secondary, #666);">
			This is the main scrollable content area of the drawer. It sits between a fixed header and footer.
		</p>
		<p style="margin: 0; color: var(--color-text-secondary, #666);">
			Configure your preferences here.
		</p>
	</div>

	{#snippet footer()}
		<div
			style="padding: 1rem; border-top: 1px solid var(--color-border, #ddd); display: flex; justify-content: flex-end; gap: 0.5rem;"
		>
			<Button outline onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={() => (open = false)}>Save</Button>
		</div>
	{/snippet}
</Drawer>
