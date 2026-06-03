<script>
	import { Breadcrumbs } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);

	const items = [
		{ label: 'Products', href: '#products' },
		{ label: 'Electronics', href: '#electronics' },
		{ label: 'Headphones' },
	];
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => (loading = !loading)}>
		{loading ? 'Show loaded' : 'Show skeleton'}
	</Button>
	<!-- Same component, same props: when `items` is empty and `skeleton` is on the
	     shimmer shows; pass real items and it swaps in with no layout shift. -->
	<Breadcrumbs
		skeleton={loading}
		skeleton_count={3}
		home_href="#"
		items={loading ? [] : items} />
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
