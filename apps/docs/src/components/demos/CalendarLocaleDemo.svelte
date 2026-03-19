<script>
	import { Calendar } from '@delightstack/components/display';

	let date1 = $state(undefined);
	let date2 = $state(undefined);
</script>

<div style="display: flex; gap: 1.5rem; flex-wrap: wrap;">
	<div>
		<p style="margin-bottom: 0.5rem; font-size: 0.875rem; font-weight: 600;">German (Monday start)</p>
		<Calendar bind:value={date1} locale="de-DE" weekStartsOn={1} />
	</div>
	<div>
		<p style="margin-bottom: 0.5rem; font-size: 0.875rem; font-weight: 600;">US English (Sunday start)</p>
		<Calendar bind:value={date2} locale="en-US" weekStartsOn={0} />
	</div>
</div>
