<script>
	import { Chart } from '@delightstack/components/display';

	const salesData = {
		labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
		datasets: [
			{ label: '2025', data: [12, 19, 3, 5, 2, 3] },
			{ label: '2024', data: [8, 15, 7, 8, 4, 6] },
		],
	};
</script>

<Chart type="area" data={salesData} show_points />
