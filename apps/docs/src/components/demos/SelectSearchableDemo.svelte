<script>
	import { Select } from '@delightstack/components/form';

	let value = $state(undefined);

	const countries = [
		{ value: 'us', label: 'United States' },
		{ value: 'ca', label: 'Canada' },
		{ value: 'uk', label: 'United Kingdom' },
		{ value: 'au', label: 'Australia' },
		{ value: 'de', label: 'Germany' },
		{ value: 'fr', label: 'France' },
		{ value: 'jp', label: 'Japan' },
		{ value: 'br', label: 'Brazil' },
	];
</script>

<Select searchable label="Country" placeholder="Search countries..." bind:value options={countries} />
