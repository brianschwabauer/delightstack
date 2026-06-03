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
	auto_resize
	maxlength={500}
	show_counter />
