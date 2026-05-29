<script>
	import { Image } from '@delightstack/components';
	import { Button } from '@delightstack/components';

	// Cache-bust the src so toggling re-runs the load and re-shows the shimmer.
	let nonce = $state(0);
</script>

<div style="display: flex; flex-direction: column; gap: 1rem; width: 100%;">
	<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
		{#key nonce}
			<Image
				src={`https://picsum.photos/seed/skeleton-a-${nonce}/2400/2400`}
				alt="Product"
				lazy={false}
				skeleton
				aspect_ratio="1" />
			<Image
				src={`https://picsum.photos/seed/skeleton-b-${nonce}/2400/2400`}
				alt="Product"
				lazy={false}
				skeleton
				aspect_ratio="1" />
		{/key}
	</div>
	<Button outline dense size="0" onclick={() => nonce++}>Reload images</Button>
</div>
