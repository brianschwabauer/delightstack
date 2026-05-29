<script>
	import { Counter } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	let {
		value = 1234,
		prefix = undefined,
		suffix = undefined,
		decimals = 0,
		duration = 5000,
		delay = 0,
		locale = undefined,
	} = $props();

	let counter = $state();
</script>

<div style="display: inline-flex; align-items: center; gap: 1rem;">
	<span style="font-size: 2.25rem; font-weight: 700;">
		<Counter
			bind:this={counter}
			{value}
			{prefix}
			{suffix}
			{decimals}
			{duration}
			{delay}
			{locale} />
	</span>
	<Button outline dense size="0" onclick={() => counter?.restart()}>Restart</Button>
</div>
