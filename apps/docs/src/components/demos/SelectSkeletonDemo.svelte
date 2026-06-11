<script>
	import { Select } from '@delightstack/components/form';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);
	let country = $state('');

	const countries = [
		{ value: 'us', label: 'United States' },
		{ value: 'ca', label: 'Canada' },
		{ value: 'uk', label: 'United Kingdom' },
		{ value: 'de', label: 'Germany' },
	];
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => (loading = !loading)}>
		{loading ? 'Show loaded' : 'Show skeleton'}
	</Button>
	<div style="max-width: 320px; width: 100%;">
		<Select
			skeleton={loading}
			bind:value={country}
			options={countries}
			label="Country"
			placeholder="Select a country" />
	</div>
</div>

<style>
	.skeleton-demo {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		align-items: flex-start;
		width: 100%;
	}
</style>
