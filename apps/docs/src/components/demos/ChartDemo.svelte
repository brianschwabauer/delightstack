<script>
	import { Chart } from '@delightstack/components/display';

	const data = {
		labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
		datasets: [
			{ label: 'Revenue', data: [4200, 5800, 4900, 7100, 6300, 8500] },
			{ label: 'Expenses', data: [3100, 3400, 3800, 4200, 3600, 4100] },
		],
	};
</script>

<Chart type="bar" {data} height={300} />
