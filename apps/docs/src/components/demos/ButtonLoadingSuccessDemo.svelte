<script>
	import { Button } from '@delightstack/components/actions';

	// The `loading` flag is driven manually here (as it would be by a store or
	// form). `loading_success` tells the button whether to flash a confirming
	// checkmark when `loading` flips back to false.
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

<div style="display: flex; gap: 1rem; flex-wrap: wrap; align-items: start;">
	<Button loading={with_check} loading_success onclick={runWithCheck}>
		With checkmark
	</Button>
	<Button loading={without_check} onclick={runWithoutCheck}>Without checkmark</Button>
</div>
