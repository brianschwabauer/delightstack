<script lang="ts">
	import { List, ListItem } from '@delightstack/components/display';

	let selected: number[] = $state([]);
</script>

<List type="checkbox" bind:value={selected}>
	<ListItem>Notifications</ListItem>
	<ListItem>Email Updates</ListItem>
	<ListItem>SMS Alerts</ListItem>
</List>
