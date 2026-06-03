<script>
	import { Modal, Button } from '@delightstack/components/actions';

	let showBasic = $state(false);
	let showFooter = $state(false);
</script>

<div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
	<Button onclick={() => (showBasic = true)}>Open Modal</Button>
	<Button outline onclick={() => (showFooter = true)}>Modal with Footer</Button>
</div>

<Modal bind:open={showBasic} title="Example Modal">
	<p style="margin: 0; line-height: 1.6;">
		This is a modal dialog with some example content. Click outside or press Escape to
		close.
	</p>
</Modal>

<Modal bind:open={showFooter} title="Confirm Action">
	<p style="margin: 0; line-height: 1.6;">
		Are you sure you want to proceed with this action? This will apply the changes
		immediately.
	</p>

	{#snippet footer()}
		<Button transparent onclick={() => (showFooter = false)}>Cancel</Button>
		<Button onclick={() => (showFooter = false)}>Save Changes</Button>
	{/snippet}
</Modal>
