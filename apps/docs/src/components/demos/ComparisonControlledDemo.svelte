<script>
	import { Comparison } from '@delightstack/components/display';

	let position = $state(50);
</script>

<div style="max-width: 500px;">
	<Comparison
		before="https://picsum.photos/id/1069/800/400"
		after="https://picsum.photos/id/1073/800/400"
		bind:position
	/>
	<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--sl-color-gray-2, #6b7280);">
		Position: {Math.round(position)}%
	</p>
</div>
