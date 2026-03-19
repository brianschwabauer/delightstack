<script>
	import { Modal, Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<Button onclick={() => (open = true)}>Edit Profile</Button>

<Modal bind:open title="Edit Profile">
	<p style="margin: 0; color: var(--color-text)">Update your profile information below.</p>

	{#snippet footer()}
		<Button transparent onclick={() => (open = false)}>Cancel</Button>
		<Button accent onclick={() => (open = false)}>Save Changes</Button>
	{/snippet}
</Modal>
