<script>
	import { Comparison } from '@delightstack/components/display';

	let position = $state(50);
</script>

<div style="max-width: 500px;">
	<Comparison
		before="https://picsum.photos/id/1015/800/400"
		after="https://picsum.photos/id/1016/800/400"
		label_before="Photo A"
		label_after="Photo B"
		snaps={[50]}
		bind:position
	/>
</div>
