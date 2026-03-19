<script>
	import { Timeline, TimelineItem } from '@delightstack/components/display';
</script>

<Timeline horizontal>
	<TimelineItem status="complete" title="Order Placed" />
	<TimelineItem status="complete" title="Processing" />
	<TimelineItem status="active" title="Shipping" />
	<TimelineItem status="pending" title="Delivered" />
</Timeline>
