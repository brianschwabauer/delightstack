<script>
	import { Tabs, Tab } from '@delightstack/components/navigation';

	let value = $state('tab1');
</script>

<Tabs bind:value boxed>
	<Tab value="tab1" label="Tab 1" />
	<Tab value="tab2" label="Tab 2" />
	<Tab value="tab3" label="Tab 3" />
</Tabs>
