<script>
	import { Calendar } from '@delightstack/components/display';

	let date = $state(undefined);

	const events = [
		{ id: '1', title: 'Team Standup', start: new Date(2026, 2, 12) },
		{
			id: '2',
			title: 'Sprint Review',
			start: new Date(2026, 2, 15),
			end: new Date(2026, 2, 16),
			color: '#10b981',
		},
	];
</script>

<Calendar bind:value={date} {events} month={new Date(2026, 2, 1)} />
