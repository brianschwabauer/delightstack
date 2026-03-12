<script>
	import { Tabs, Tab, TabContent } from '@delightstack/components/navigation';

	let value = $state('tab1');
</script>

<Tabs bind:value>
	<Tab value="tab1" label="Overview" />
	<Tab value="tab2" label="Features" />
	<Tab value="tab3" label="Pricing" />
</Tabs>
<TabContent value="tab1">
	<p>Welcome to the overview panel. Get a quick summary of everything you need to know.</p>
</TabContent>
<TabContent value="tab2">
	<p>Explore the features that make this component powerful and flexible.</p>
</TabContent>
<TabContent value="tab3">
	<p>View our pricing plans and find the one that fits your needs.</p>
</TabContent>
