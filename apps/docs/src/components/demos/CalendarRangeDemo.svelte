<script>
	import { Calendar } from '@delightstack/components/display';

	let dateRange = $state(undefined);
</script>

<Calendar mode="range" bind:value={dateRange} />
