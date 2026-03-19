<script>
	import { Tabs, Tab } from '@delightstack/components/navigation';

	let value = $state('all');
</script>

<Tabs bind:value pills>
	<Tab value="all" label="All" />
	<Tab value="active" label="Active" badge="3" />
	<Tab value="archived" label="Archived" />
</Tabs>
