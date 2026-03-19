<script>
	import { Chart } from '@delightstack/components/display';

	const data = {
		labels: ['Desktop', 'Mobile', 'Tablet'],
		datasets: [{ label: 'Traffic', data: [65, 30, 5] }],
	};
</script>

<Chart type="donut" {data} innerRadius={0.6} height={300} />
