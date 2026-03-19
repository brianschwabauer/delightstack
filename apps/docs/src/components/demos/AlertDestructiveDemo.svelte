<script>
	import { Alert, Button } from '@delightstack/components/actions';

	let showDelete = $state(false);
</script>

<Button error onclick={() => showDelete = true}>Delete Item</Button>

<Alert
	bind:open={showDelete}
	title="Delete Item"
	message="This action cannot be undone. Are you sure you want to delete this item?"
	continueText="Delete"
	cancelText="Keep It"
	destructive
/>
