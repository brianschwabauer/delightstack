<script>
	import { Modal, Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<Button onclick={() => (open = true)}>Open Modal</Button>

<Modal bind:open title="Welcome to your workspace" width="480px">
	<div
		style="display: flex; flex-direction: column; gap: 0.75em; line-height: 1.6; color: var(--color-text);">
		<p style="margin: 0;">
			Your workspace is where your team's projects, files, and conversations live. Invite
			teammates to collaborate in real time — everything you create here is synced
			automatically across devices.
		</p>
		<p style="margin: 0;">
			You can change the workspace name, icon, and default permissions at any time from
			the settings page. Click outside this dialog or press Escape to close it.
		</p>
	</div>
</Modal>
