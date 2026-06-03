<script>
	import { Modal, Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<Button onclick={() => (open = true)}>Open Modal</Button>

<Modal bind:open title="Edit Profile">
	<p style="margin: 0; color: var(--color-text);">
		Update your profile information below.
	</p>

	{#snippet footer({ close })}
		<Button transparent onclick={close}>Cancel</Button>
		<Button accent onclick={close}>Save Changes</Button>
	{/snippet}
</Modal>
