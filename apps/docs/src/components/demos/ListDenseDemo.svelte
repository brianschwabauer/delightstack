<script>
	import { List, ListItem } from '@delightstack/components/display';

	let lastAction = $state('');
</script>

<List dense>
	<ListItem
		onclick={() => {
			lastAction = 'Edit';
		}}>
		Edit
	</ListItem>
	<ListItem
		onclick={() => {
			lastAction = 'Duplicate';
		}}>
		Duplicate
	</ListItem>
	<ListItem
		onclick={() => {
			lastAction = 'Delete';
		}}>
		Delete
	</ListItem>
</List>

{#if lastAction}
	<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--color-text-secondary);">
		Action: {lastAction}
	</p>
{/if}
