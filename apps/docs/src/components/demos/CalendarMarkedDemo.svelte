<script>
	import { Calendar } from '@delightstack/components/display';

	let date = $state(undefined);

	const marked = [
		{ date: new Date(2026, 2, 15), color: 'var(--color-action)', label: 'Meeting' },
		{ date: new Date(2026, 2, 20), color: 'var(--color-error)', label: 'Deadline' },
	];
</script>

<Calendar bind:value={date} {marked} month={new Date(2026, 2, 1)} />
