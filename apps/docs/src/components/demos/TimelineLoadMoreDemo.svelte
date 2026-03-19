<script>
	import { Timeline, TimelineItem } from '@delightstack/components/display';

	let events = $state([
		{ id: 1, date: 'Jan 1', title: 'Project Kickoff', description: 'Initial planning and team formation.', status: 'complete' },
		{ id: 2, date: 'Jan 15', title: 'Design Phase', description: 'Wireframes and mockups created.', status: 'complete' },
		{ id: 3, date: 'Feb 1', title: 'Development Sprint 1', description: 'Core features implemented.', status: 'complete' },
	]);

	let nextId = 4;
	let hasMore = $state(true);

	const moreEvents = [
		{ date: 'Feb 15', title: 'Development Sprint 2', description: 'Additional features and refinements.', status: 'active' },
		{ date: 'Mar 1', title: 'QA Testing', description: 'Comprehensive testing and bug fixes.', status: 'pending' },
		{ date: 'Mar 15', title: 'Beta Launch', description: 'Public beta release.', status: 'pending' },
	];

	async function loadMoreEvents() {
		await new Promise((resolve) => setTimeout(resolve, 1500));
		const batch = moreEvents.map((e) => ({ ...e, id: nextId++ }));
		events = [...events, ...batch];
		hasMore = false;
	}
</script>

<Timeline onloadmore={hasMore ? loadMoreEvents : undefined} pending={hasMore}>
	{#each events as event (event.id)}
		<TimelineItem
			date={event.date}
			title={event.title}
			status={event.status}
		>
			{event.description}
		</TimelineItem>
	{/each}
</Timeline>
