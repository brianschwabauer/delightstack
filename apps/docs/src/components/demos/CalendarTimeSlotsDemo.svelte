<script>
	import { Calendar } from '@delightstack/components/display';

	let date = $state(undefined);
</script>

<Calendar
	bind:value={date}
	show_time_slots
	time_slot_interval={15}
	time_slot_min="09:00"
	time_slot_max="17:00"
/>
