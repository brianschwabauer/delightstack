<script>
	import { List, ListItem } from '@delightstack/components/display';

	// `loading` is driven manually here (as it would be by a store). `loading_success`
	// tells the row whether to flash a confirming checkmark when `loading` clears.
	let with_check = $state(false);
	let without_check = $state(false);

	function runWithCheck() {
		with_check = true;
		setTimeout(() => (with_check = false), 1500);
	}
	function runWithoutCheck() {
		without_check = true;
		setTimeout(() => (without_check = false), 1500);
	}
</script>

<List>
	<ListItem loading={with_check} loading_success onclick={runWithCheck}>
		With checkmark
	</ListItem>
	<ListItem loading={without_check} onclick={runWithoutCheck}>Without checkmark</ListItem>
</List>
