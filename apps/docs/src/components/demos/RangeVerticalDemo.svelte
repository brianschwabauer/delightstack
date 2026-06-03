<script lang="ts">
	import { Range } from '@delightstack/components/form';

	let volume = $state(60);
	let bass = $state(40);
	let treble = $state(75);
</script>

<div style="display: flex; gap: 3rem; align-items: flex-end; padding: 1rem 0;">
	<Range
		vertical
		value={volume}
		label="Volume"
		show_value
		format_value={(v) => `${v}%`} />
	<Range vertical value={bass} min={0} max={100} step={10} show_ticks label="Bass" />
	<Range vertical value={treble} label="Treble" />
</div>
