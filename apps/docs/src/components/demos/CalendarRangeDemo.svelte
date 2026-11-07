<script>
	import { Calendar } from '@delightstack/components/display';

	// Start with a week selected so the range treatment is on show.
	const today = new Date();
	const start = Math.min(today.getDate() + 2, 20);
	let dateRange = $state([
		new Date(today.getFullYear(), today.getMonth(), start),
		new Date(today.getFullYear(), today.getMonth(), start + 6),
	]);
</script>

<Calendar mode="range" bind:value={dateRange} />
