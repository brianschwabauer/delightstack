<script lang="ts">
	import { List, ListItem } from '@delightstack/components/display';

	let selected: number[] = $state([]);
</script>

<List type="radio" bind:value={selected}>
	<ListItem>Small</ListItem>
	<ListItem>Medium</ListItem>
	<ListItem>Large</ListItem>
</List>
