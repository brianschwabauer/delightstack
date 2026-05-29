<script>
	import { Stat } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	let s0 = $state();
	let s1 = $state();
	let s2 = $state();
	let s3 = $state();

	function restartAll() {
		for (const s of [s0, s1, s2, s3]) s?.restart();
	}
</script>

<div style="display: flex; flex-direction: column; align-items: flex-start; gap: 1rem;">
	<div style="display: flex; align-items: flex-start; gap: 2.5rem; flex-wrap: wrap;">
		<Stat bind:this={s0} value={42} label="Tasks" size="0" />
		<Stat bind:this={s1} value={42} label="Tasks" size="1" />
		<Stat bind:this={s2} value={42} label="Tasks" size="2" />
		<Stat bind:this={s3} value={42} label="Tasks" size="3" />
	</div>
	<Button outline dense size="0" onclick={restartAll}>Restart</Button>
</div>
