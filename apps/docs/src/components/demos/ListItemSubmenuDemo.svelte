<script>
	import { List, ListItem } from '@delightstack/components/display';

	let lastAction = $state('');
</script>

<List>
	<ListItem
		onclick={() => {
			lastAction = 'Clicked: Document A';
		}}>
		Document A
		{#snippet menu()}
			<List>
				<ListItem
					onclick={() => {
						lastAction = 'Edit Document A';
					}}>
					Edit
				</ListItem>
				<ListItem
					onclick={() => {
						lastAction = 'Duplicate Document A';
					}}>
					Duplicate
				</ListItem>
				<ListItem
					onclick={() => {
						lastAction = 'Delete Document A';
					}}>
					Delete
				</ListItem>
			</List>
		{/snippet}
	</ListItem>
	<ListItem
		onclick={() => {
			lastAction = 'Clicked: Document B';
		}}>
		Document B
		{#snippet menu()}
			<List>
				<ListItem
					onclick={() => {
						lastAction = 'Edit Document B';
					}}>
					Edit
				</ListItem>
				<ListItem
					onclick={() => {
						lastAction = 'Duplicate Document B';
					}}>
					Duplicate
				</ListItem>
				<ListItem
					onclick={() => {
						lastAction = 'Delete Document B';
					}}>
					Delete
				</ListItem>
			</List>
		{/snippet}
	</ListItem>
	<ListItem
		onclick={() => {
			lastAction = 'Clicked: Document C';
		}}>
		Document C
		{#snippet menu()}
			<List>
				<ListItem
					onclick={() => {
						lastAction = 'Edit Document C';
					}}>
					Edit
				</ListItem>
				<ListItem
					onclick={() => {
						lastAction = 'Delete Document C';
					}}>
					Delete
				</ListItem>
			</List>
		{/snippet}
	</ListItem>
</List>

{#if lastAction}
	<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--color-text-secondary);">
		{lastAction}
	</p>
{/if}
