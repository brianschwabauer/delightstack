<script>
	import { Select } from '@delightstack/components/form';

	let category = $state('');

	const categories = [
		{ value: 'electronics', label: 'Electronics' },
		{ value: 'clothing', label: 'Clothing' },
		{ value: 'books', label: 'Books' },
		{ value: 'home', label: 'Home & Garden' },
	];
</script>

<Select
	bind:value={category}
	options={categories}
	label="Category"
	placeholder="Select a category"
	required
	error={!category ? 'Please select a category' : ''} />
