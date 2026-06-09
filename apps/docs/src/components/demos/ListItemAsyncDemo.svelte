<script>
	import { List, ListItem } from '@delightstack/components/display';

	const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
</script>

<List>
	<!-- Resolves slowly -> spinner shows, then a success checkmark confirms it. -->
	<ListItem onclick={async () => await wait(1500)}>Save Item (1.5s)</ListItem>
	<!-- Resolves almost immediately -> treated as instant, no spinner flash. -->
	<ListItem onclick={async () => await wait(60)}>Quick Action (instant)</ListItem>
	<!-- Rejects -> spinner shows, but no success checkmark. -->
	<ListItem
		onclick={async () => {
			await wait(1200);
			throw new Error('failed');
		}}>
		Sync Data (fails)
	</ListItem>
</List>
