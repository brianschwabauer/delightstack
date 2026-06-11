<script>
	import { Comparison } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => (loading = !loading)}>
		{loading ? 'Show loaded' : 'Show skeleton'}
	</Button>
	<!-- 16:9 images match the skeleton's default aspect (--cmp-aspect),
	     so the skeleton ↔ loaded swap doesn't shift the layout. -->
	<div style="max-width: 500px; width: 100%;">
		<Comparison
			skeleton={loading}
			before="https://picsum.photos/id/1015/800/450"
			after="https://picsum.photos/id/1016/800/450"
			label_before="Before"
			label_after="After" />
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
</style>
