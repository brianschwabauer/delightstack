<script>
	import { Select } from '@delightstack/components/form';

	let selected = $state([]);
	let tags = $state([
		{ value: 'featured', label: 'Featured' },
		{ value: 'new', label: 'New' },
		{ value: 'sale', label: 'On Sale' },
	]);
</script>

<Select
	creatable
	searchable
	multiple
	bind:value={selected}
	options={tags}
	label="Tags"
	placeholder="Select or create tags..."
	oncreate={({ value }) => {
		tags = [...tags, { value, label: value }];
	}}
/>
