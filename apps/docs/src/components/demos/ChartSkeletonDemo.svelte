<script>
	import { Chart } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);

	const empty = { labels: [], datasets: [] };
	const bar_data = {
		labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
		datasets: [{ label: 'Revenue', data: [4200, 5800, 4900, 7100, 6300, 8500] }],
	};
	const pie_data = {
		labels: ['Direct', 'Search', 'Referral', 'Social'],
		datasets: [{ label: 'Traffic', data: [44, 28, 17, 11] }],
	};
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => (loading = !loading)}>
		{loading ? 'Show loaded' : 'Show skeleton'}
	</Button>
	<div style="display: flex; gap: 1rem; flex-wrap: wrap; width: 100%;">
		<div style="flex: 1; min-width: 250px;">
			<Chart
				type="bar"
				skeleton={loading}
				height={300}
				data={loading ? empty : bar_data} />
		</div>
		<div style="flex: 1; min-width: 250px;">
			<Chart
				type="pie"
				skeleton={loading}
				height={300}
				data={loading ? empty : pie_data} />
		</div>
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
