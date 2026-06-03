<script>
	import { Range } from '@delightstack/components/form';

	let difficulty = $state(50);
</script>

<Range
	bind:value={difficulty}
	min={0}
	max={100}
	step={25}
	show_ticks
	tick_labels={['Low', 'Medium', 'High', 'Very High', 'Max']}
	label="Difficulty" />
