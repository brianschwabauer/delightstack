<script>
	import { Alert, Button } from '@delightstack/components/actions';

	let showAlert = $state(false);
	let showDestructive = $state(false);
</script>

<div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
	<Button onclick={() => showAlert = true}>Confirm Action</Button>
	<Button error onclick={() => showDestructive = true}>Delete Item</Button>
</div>

<Alert
	bind:open={showAlert}
	title="Save Changes?"
	message="Would you like to save your changes before leaving?"
	continueText="Save"
/>

<Alert
	bind:open={showDestructive}
	title="Delete Item"
	message="This action cannot be undone. Are you sure you want to delete this item?"
	continueText="Delete"
	destructive
/>
