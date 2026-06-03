<script>
	import { Select } from '@delightstack/components/form';

	let value = $state(undefined);

	const options = [
		{ value: 'apple', label: 'Apple', group: 'Fruits' },
		{ value: 'banana', label: 'Banana', group: 'Fruits' },
		{ value: 'cherry', label: 'Cherry', group: 'Fruits' },
		{ value: 'carrot', label: 'Carrot', group: 'Vegetables' },
		{ value: 'broccoli', label: 'Broccoli', group: 'Vegetables' },
		{ value: 'spinach', label: 'Spinach', group: 'Vegetables' },
	];
</script>

<Select bind:value {options} label="Food" placeholder="Select a food..." />
