<script>
	import { Checkbox } from '@delightstack/components/form';

	let checked = $state(false);
</script>

<Checkbox
	bind:checked
	label="Accept terms"
	required
	error={!checked ? 'You must accept the terms' : ''} />
