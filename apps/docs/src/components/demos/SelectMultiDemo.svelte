<script>
	import { Select } from '@delightstack/components/form';

	let value = $state([]);

	const tags = [
		{ value: 'featured', label: 'Featured' },
		{ value: 'new', label: 'New' },
		{ value: 'sale', label: 'On sale' },
		{ value: 'popular', label: 'Popular' },
		{ value: 'limited', label: 'Limited edition' },
	];
</script>

<Select
	multiple
	label="Tags"
	placeholder="Select tags..."
	bind:value
	options={tags}
	clearable />
