<script>
	import { List, ListItem } from '@delightstack/components/display';
</script>

<List>
	<ListItem onclick={async () => {
		await new Promise((resolve) => setTimeout(resolve, 1500));
	}}>
		Save Item
	</ListItem>
	<ListItem onclick={async () => {
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}}>
		Sync Data
	</ListItem>
</List>
