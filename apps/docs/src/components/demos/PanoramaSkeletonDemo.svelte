<script lang="ts">
	import Panorama from '@delightstack/components/panorama';
	import { Button } from '@delightstack/components/actions';

	const SRC = 'https://pannellum.org/images/cerro-toco-0.jpg';

	// Cache-bust the src so each reload re-runs the texture fetch and the
	// built-in skeleton shimmer shows until the panorama is ready again.
	let nonce = $state(0);
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => nonce++}>Reload panorama</Button>
	<div class="frame">
		{#key nonce}
			<Panorama skeleton src={`${SRC}?reload=${nonce}`} />
		{/key}
	</div>
</div>

<style>
	.skeleton-demo {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		align-items: flex-start;
		width: 100%;
	}
	.frame {
		width: 100%;
		aspect-ratio: 16 / 9;
		border-radius: 0.5rem;
		overflow: hidden;
		background: var(--color-bg-2, rgba(0, 0, 0, 0.06));
	}
</style>
