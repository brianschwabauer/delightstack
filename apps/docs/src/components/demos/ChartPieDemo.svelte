<script>
	import { Chart } from '@delightstack/components/display';

	const data = {
		labels: ['Chrome', 'Firefox', 'Safari', 'Edge'],
		datasets: [{ label: 'Browser Share', data: [65, 15, 12, 8] }],
	};
</script>

<Chart type="pie" {data} />
