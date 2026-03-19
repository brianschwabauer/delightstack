<script>
	import { Timeline, TimelineItem } from '@delightstack/components/display';
</script>

<Timeline>
	<TimelineItem status="complete" date="Jan 10" title="Order Confirmed">
		Your order has been confirmed.
	</TimelineItem>
	<TimelineItem status="complete" date="Jan 11" title="Shipped">
		Package picked up by carrier.
	</TimelineItem>
	<TimelineItem status="active" date="Jan 12" title="Out for Delivery">
		Expected delivery today.
	</TimelineItem>
	<TimelineItem status="pending" title="Delivered" />
</Timeline>
