<script>
	import { Select } from '@delightstack/components/form';

	let value = $state([]);

	const tags = [
		{ value: 'featured', label: 'Featured' },
		{ value: 'new', label: 'New' },
		{ value: 'sale', label: 'On Sale' },
		{ value: 'popular', label: 'Popular' },
		{ value: 'limited', label: 'Limited Edition' },
	];
</script>

<Select multiple label="Tags" placeholder="Select tags..." bind:value options={tags} clearable />
