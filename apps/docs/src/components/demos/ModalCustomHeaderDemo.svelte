<script>
	import { Modal, Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<Button onclick={() => (open = true)}>Open Settings</Button>

<Modal bind:open>
	{#snippet header()}
		<div style="display: flex; flex-direction: column; gap: 0; line-height: 1.2;">
			<h2 style="margin: 0; font-size: 1.25rem; line-height: 1.25;">Settings</h2>
			<span style="font-size: 0.85rem; opacity: 0.7; line-height: 1.3;">Configure your preferences</span>
		</div>
	{/snippet}

	<p style="margin: 0; color: var(--color-text)">Settings content goes here.</p>
</Modal>
