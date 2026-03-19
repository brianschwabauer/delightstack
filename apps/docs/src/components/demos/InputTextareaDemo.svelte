<script>
	import { Input } from '@delightstack/components/form';

	let value = $state('');
</script>

<Input
	type="textarea"
	label="Bio"
	placeholder="Tell us about yourself..."
	bind:value
	rows={4}
	autoResize
	maxlength={500}
	showCounter
/>
