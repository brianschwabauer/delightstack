<script>
	import { alert } from '@delightstack/components/actions';
	import { Button } from '@delightstack/components/actions';

	let result = $state('');

	async function handleClick() {
		const confirmed = await alert({
			title: 'Delete?',
			message: 'This cannot be undone.',
			destructive: true,
			continue_text: 'Delete',
		});
		result = confirmed ? 'Confirmed!' : 'Cancelled';
		setTimeout(() => (result = ''), 2000);
	}
</script>

<div style="display: flex; align-items: center; gap: 0.75rem;">
	<Button error onclick={handleClick}>Delete Item</Button>
	{#if result}<span style="color: var(--color-text-muted);">{result}</span>{/if}
</div>
