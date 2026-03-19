<script>
	import { Tabs, Tab } from '@delightstack/components/navigation';

	let value = $state('a');
</script>

<Tabs bind:value>
	<Tab value="a" label="Available" />
	<Tab value="b" label="Coming Soon" disabled />
</Tabs>
