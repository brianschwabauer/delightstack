<script>
	import { Pagination } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);
	let page = $state(1);
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => (loading = !loading)}>
		{loading ? 'Show loaded' : 'Show skeleton'}
	</Button>
	<!-- total_pages is already known, so the skeleton mirrors the same
	     page-button count and the swap to live controls never shifts. -->
	<Pagination skeleton={loading} bind:page total_pages={5} />
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
