<script>
	import { Timeline, TimelineItem } from '@delightstack/components/display';
	async function onclick() {
		return new Promise((resolve) => {
			setTimeout(() => resolve(), 1000);
		});
	}
</script>

<Timeline horizontal>
	<TimelineItem status="complete" title="Order Placed" {onclick} />
	<TimelineItem status="complete" title="Processing" {onclick} />
	<TimelineItem status="active" title="Shipping" {onclick} />
	<TimelineItem status="pending" title="Delivered" {onclick} />
</Timeline>
