<script>
	import { Tabs, Tab } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);
	let value = $state('overview');
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => (loading = !loading)}>
		{loading ? 'Show loaded' : 'Show skeleton'}
	</Button>
	<div style="width: 100%;">
		<Tabs skeleton={loading} skeleton_count={3} bind:value>
			<Tab value="overview" label="Overview" />
			<Tab value="features" label="Features" />
			<Tab value="pricing" label="Pricing" />
		</Tabs>
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
