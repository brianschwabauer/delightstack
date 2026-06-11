<script>
	import { Timeline, TimelineItem } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	let loading = $state(true);
</script>

<div class="skeleton-demo">
	<Button dense onclick={() => (loading = !loading)}>
		{loading ? 'Show loaded' : 'Show skeleton'}
	</Button>
	<div style="width: 100%;">
		<Timeline skeleton={loading} skeleton_count={3}>
			<TimelineItem title="Order placed" date="Jan 10" status="complete">
				Your order has been received.
			</TimelineItem>
			<TimelineItem title="Shipped" date="Jan 11" status="active">
				Package is on its way.
			</TimelineItem>
			<TimelineItem title="Delivered" status="pending" />
		</Timeline>
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
