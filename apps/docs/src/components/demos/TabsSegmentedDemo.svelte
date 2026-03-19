<script>
	import { Tabs, Tab } from '@delightstack/components/navigation';

	let value = $state('day');
</script>

<Tabs bind:value segment>
	<Tab value="day" label="Day" />
	<Tab value="week" label="Week" />
	<Tab value="month" label="Month" />
</Tabs>
