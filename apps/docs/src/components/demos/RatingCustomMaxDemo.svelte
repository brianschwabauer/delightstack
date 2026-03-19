<script>
	import { Rating } from '@delightstack/components/form';

	let rating = $state(0);
</script>

<div style="display: flex; flex-direction: column; gap: 0.5rem;">
	<Rating bind:value={rating} max={10} showValue />
	<p style="margin: 0; font-size: 0.85rem; color: var(--sl-color-gray-3);">
		Rate out of 10
	</p>
</div>
