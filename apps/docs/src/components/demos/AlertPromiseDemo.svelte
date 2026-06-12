<script>
	import { Alert, Button } from '@delightstack/components/actions';

	let showAlert = $state(false);
	let status = $state('');

	async function handleContinue() {
		await new Promise((resolve) => setTimeout(resolve, 2000));
		showAlert = false;
		status = 'Processed!';
		setTimeout(() => (status = ''), 2000);
	}
</script>

<div style="display: flex; align-items: center; gap: 0.75rem;">
	<Button onclick={() => (showAlert = true)}>Process Data</Button>
	{#if status}<span style="color: var(--color-text-muted);">{status}</span>{/if}
</div>

<Alert
	bind:open={showAlert}
	title="Process Data"
	message="This may take a moment."
	continue_text="Process"
	oncontinue={handleContinue} />
