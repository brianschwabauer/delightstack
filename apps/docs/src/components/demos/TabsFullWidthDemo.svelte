<script>
	import { Tabs, Tab } from '@delightstack/components/navigation';

	let value = $state('a');
</script>

<div style="width: 100%;">
	<Tabs bind:value full_width>
		<Tab value="a" label="First" />
		<Tab value="b" label="Second" />
		<Tab value="c" label="Third" />
	</Tabs>
</div>
