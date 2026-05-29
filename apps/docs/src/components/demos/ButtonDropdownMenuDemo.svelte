<script>
	import { Button } from '@delightstack/components/actions';
	import { List, ListItem } from '@delightstack/components/display';
</script>

<Button showChevron>
	Options
	{#snippet menu({ close })}
		<List>
			<ListItem onclick={() => close()}>Edit</ListItem>
			<ListItem onclick={() => close()}>Duplicate</ListItem>
			<ListItem onclick={() => close()}>Remove</ListItem>
		</List>
	{/snippet}
</Button>
