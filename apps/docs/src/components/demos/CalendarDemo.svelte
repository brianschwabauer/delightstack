<script>
	import { Calendar } from '@delightstack/components/display';

	let selectedDate = $state(undefined);
</script>

<Calendar bind:value={selectedDate} />
