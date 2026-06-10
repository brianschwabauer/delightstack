<script lang="ts">
	import { List, ListItem } from '@delightstack/components/display';

	let selected: number[] = $state([]);
</script>

<List type="toggle" bind:value={selected}>
	<ListItem>Wi-Fi</ListItem>
	<ListItem>Bluetooth</ListItem>
	<ListItem>Airplane Mode</ListItem>
</List>
