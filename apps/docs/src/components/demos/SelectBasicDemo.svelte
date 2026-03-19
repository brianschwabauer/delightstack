<script>
	import { Select } from '@delightstack/components/form';

	let country = $state('');

	const countries = [
		{ value: 'us', label: 'United States' },
		{ value: 'ca', label: 'Canada' },
		{ value: 'uk', label: 'United Kingdom' },
		{ value: 'de', label: 'Germany' },
	];
</script>

<Select bind:value={country} options={countries} label="Country" placeholder="Select a country" />
