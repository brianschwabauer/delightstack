<script>
	import { Range } from '@delightstack/components/form';

	let value = $state([100, 500]);
</script>

<Range
	range
	bind:value
	min={0}
	max={1000}
	step={50}
	format_value={(v) => `$${v}`}
	show_value
	label="Price range"
/>
