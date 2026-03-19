<script>
	import { Timeline, TimelineItem } from '@delightstack/components/display';
</script>

<Timeline>
	<TimelineItem title="Step 1" date="Jan 10" status="complete">
		First step completed.
	</TimelineItem>
	<TimelineItem title="Step 2" date="Jan 11" status="active">
		Currently in progress.
	</TimelineItem>
	<TimelineItem title="Step 3" status="pending" />
</Timeline>
