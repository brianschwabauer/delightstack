<script>
	import { Calendar } from '@delightstack/components/display';

	let date = $state(undefined);
</script>

<Calendar
	bind:value={date}
	min={new Date()}
	max={new Date(2026, 11, 31)}
/>
