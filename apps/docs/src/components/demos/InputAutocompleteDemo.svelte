<script>
	import { Input } from '@delightstack/components/form';

	let selectedCity = $state('');

	const cities = [
		{ value: 'nyc', label: 'New York' },
		{ value: 'la', label: 'Los Angeles' },
		{ value: 'chi', label: 'Chicago' },
		{ value: 'hou', label: 'Houston' },
		{ value: 'phx', label: 'Phoenix' },
		{ value: 'phi', label: 'Philadelphia' },
		{ value: 'sa', label: 'San Antonio' },
		{ value: 'sd', label: 'San Diego' },
	];
</script>

<Input label="City" options={cities} bind:value={selectedCity} placeholder="Search cities..." />
