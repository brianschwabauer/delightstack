<script>
	import { Stat } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	let {
		value,
		label = undefined,
		change = undefined,
		changeLabel = undefined,
		trend = undefined,
		size = '1',
		horizontal = false,
		prefix = undefined,
		suffix = undefined,
		decimals = 0,
	} = $props();

	let stat = $state();
</script>

<div style="display: inline-flex; flex-direction: column; align-items: flex-start; gap: 0.75rem;">
	<Stat
		bind:this={stat}
		{value}
		{label}
		{change}
		{changeLabel}
		{trend}
		{size}
		{horizontal}
		{prefix}
		{suffix}
		{decimals} />
	<Button outline dense size="0" onclick={() => stat?.restart()}>Restart</Button>
</div>
