<script>
	import { Comparison } from '@delightstack/components/display';

	let position = $state(50);
</script>

<div style="max-width: 500px;">
	<Comparison
		before="https://picsum.photos/id/1015/800/400"
		after="https://picsum.photos/id/1016/800/400"
		snaps={[25, 50, 75]}
		bind:position
	/>
	<p style="margin-top: 0.5em; font-size: 0.875rem; opacity: 0.7;">Position: {Math.round(position)}%</p>
</div>
