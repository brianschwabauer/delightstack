<script>
	import { Callout } from '@delightstack/components/feedback';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => (loading = !loading)}>
		{loading ? 'Show loaded' : 'Show skeleton'}
	</Button>
	<div style="width: 100%;">
		<Callout skeleton={loading}>Your changes are automatically saved.</Callout>
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
