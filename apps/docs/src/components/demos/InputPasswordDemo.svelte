<script>
	import { Input } from '@delightstack/components/form';

	let value = $state('');
</script>

<Input
	type="password"
	label="Password"
	placeholder="Enter password"
	bind:value
	show_toggle
	strength_indicator />
