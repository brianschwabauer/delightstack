<script>
	import { Calendar } from '@delightstack/components/display';

	// Start with a selection so the selected state is on show.
	const today = new Date();
	let date = $state(
		new Date(today.getFullYear(), today.getMonth(), Math.min(today.getDate() + 3, 26)),
	);
</script>

<Calendar bind:value={date} />
