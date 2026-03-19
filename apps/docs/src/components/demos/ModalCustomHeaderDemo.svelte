<script>
	import { Modal, Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<Button onclick={() => (open = true)}>Open Settings</Button>

<Modal bind:open>
	{#snippet header()}
		<div style="display: flex; flex-direction: column; gap: 0.25rem;">
			<h2 style="margin: 0; font-size: 1.25rem;">Settings</h2>
			<span style="font-size: 0.85rem; opacity: 0.7;">Configure your preferences</span>
		</div>
	{/snippet}

	<p style="margin: 0; color: var(--color-text)">Settings content goes here.</p>
</Modal>
