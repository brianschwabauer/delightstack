<script>
	import { Range } from '@delightstack/components/form';

	let price = $state(250);
	let opacity = $state(75);
</script>

<div style="display: flex; flex-direction: column; gap: 1.5rem; width: 100%;">
	<Range
		bind:value={price}
		min={0}
		max={1000}
		show_value
		format_value={(v) => `$${v}`}
		label="Budget"
	/>

	<Range
		bind:value={opacity}
		min={0}
		max={100}
		show_value
		format_value={(v) => `${v}%`}
		label="Opacity"
	/>
</div>
