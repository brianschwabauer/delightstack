<script>
	import { Calendar } from '@delightstack/components/display';

	let selectedDates = $state([]);
</script>

<Calendar mode="multiple" bind:value={selectedDates} />
