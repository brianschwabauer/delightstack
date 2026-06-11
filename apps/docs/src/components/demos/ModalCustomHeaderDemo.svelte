<script>
	import { Modal, Button } from '@delightstack/components/actions';
	import { List, ListItem } from '@delightstack/components/display';

	let open = $state(false);
	// Notifications and Auto-save start enabled
	let enabled = $state([0, 2]);
</script>

<Button onclick={() => (open = true)}>Open Settings</Button>

<Modal bind:open width="420px">
	{#snippet header()}
		<div style="display: flex; flex-direction: column; gap: 0; line-height: 1.2;">
			<h2 style="margin: 0; font-size: 1.25rem; line-height: 1.25;">Settings</h2>
			<span style="font-size: 0.75rem; opacity: 0.7; line-height: 1.3;">
				Configure your preferences
			</span>
		</div>
	{/snippet}

	<List type="toggle" bind:value={enabled}>
		<ListItem>
			<div style="display: flex; flex-direction: column; gap: 0.15rem;">
				<span>Notifications</span>
				<span style="font-size: 0.85rem; opacity: 0.7;">
					Get notified when someone mentions you
				</span>
			</div>
		</ListItem>
		<ListItem>
			<div style="display: flex; flex-direction: column; gap: 0.15rem;">
				<span>Sounds</span>
				<span style="font-size: 0.85rem; opacity: 0.7;">
					Play a sound for incoming messages
				</span>
			</div>
		</ListItem>
		<ListItem>
			<div style="display: flex; flex-direction: column; gap: 0.15rem;">
				<span>Auto-save</span>
				<span style="font-size: 0.85rem; opacity: 0.7;">
					Save drafts automatically while you type
				</span>
			</div>
		</ListItem>
	</List>
</Modal>
