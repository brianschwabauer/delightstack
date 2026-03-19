<script>
	import { Tabs, Tab, TabContent } from '@delightstack/components/navigation';

	let value = $state('general');
</script>

<div style="display: flex; gap: 1rem; width: 100%;">
	<Tabs bind:value orientation="vertical">
		<Tab value="general" label="General" />
		<Tab value="security" label="Security" />
		<Tab value="notifications" label="Notifications" />
	</Tabs>
	<div style="flex: 1;">
		<TabContent value="general"><p style="margin: 0;">General settings.</p></TabContent>
		<TabContent value="security"><p style="margin: 0;">Security settings.</p></TabContent>
		<TabContent value="notifications"><p style="margin: 0;">Notification settings.</p></TabContent>
	</div>
</div>
