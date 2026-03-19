<script>
	import { Chart } from '@delightstack/components/display';

	const emptyData = { labels: [], datasets: [] };
</script>

<div style="display: flex; gap: 1rem; flex-wrap: wrap;">
	<div style="flex: 1; min-width: 250px;">
		<Chart type="bar" skeleton height={300} data={emptyData} />
	</div>
	<div style="flex: 1; min-width: 250px;">
		<Chart type="pie" skeleton height={300} data={emptyData} />
	</div>
</div>
