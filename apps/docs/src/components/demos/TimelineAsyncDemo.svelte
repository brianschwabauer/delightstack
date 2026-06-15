<script>
	import { Timeline, TimelineItem } from '@delightstack/components/display';

	// Returning a promise from `onclick` drives a spinner in the step's marker.
	async function deploy() {
		await new Promise((resolve) => setTimeout(resolve, 1500));
	}
</script>

<Timeline>
	<TimelineItem status="complete" date="9:00 AM" title="Build started">
		Compiled successfully.
	</TimelineItem>
	<TimelineItem status="complete" date="9:02 AM" title="Tests passed">
		All checks green.
	</TimelineItem>
	<TimelineItem status="active" date="9:05 AM" title="Deploy" onclick={deploy}>
		Click to deploy — the marker shows a spinner while it runs, then a check.
	</TimelineItem>
</Timeline>
