<script>
	import { Calendar } from '@delightstack/components/display';

	let date = $state(undefined);
</script>

<Calendar
	bind:value={date}
	showTimeSlots
	timeSlotInterval={15}
	timeSlotMin="09:00"
	timeSlotMax="17:00"
/>
