<script>
	import { Timeline, TimelineItem } from '@delightstack/components/display';

	let selected = $state('');
</script>

<div class="interactive-demo">
	<Timeline>
		<TimelineItem
			status="complete"
			date="Jan 10"
			title="Order Confirmed"
			onclick={() => (selected = 'Order Confirmed')}>
			Tap to view the confirmation.
		</TimelineItem>
		<TimelineItem
			status="complete"
			date="Jan 11"
			title="Shipped"
			onclick={() => (selected = 'Shipped')}>
			Tap to track the package.
		</TimelineItem>
		<TimelineItem
			status="active"
			date="Jan 12"
			title="Out for Delivery"
			onclick={() => (selected = 'Out for Delivery')}>
			Tap for live updates.
		</TimelineItem>
		<TimelineItem status="pending" title="Delivered" />
	</Timeline>

	<p class="result">
		{selected ? `You clicked: ${selected}` : 'Click an event above.'}
	</p>
</div>

<style>
	.interactive-demo {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		width: 100%;
	}
	.result {
		margin: 0;
		font-size: 0.85rem;
		color: var(--color-text-muted);
	}
</style>
