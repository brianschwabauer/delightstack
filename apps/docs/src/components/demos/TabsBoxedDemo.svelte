<script>
	import { Tabs } from '@delightstack/components/navigation';

	let tab = $state(0);
</script>

<div style="width: 100%;">
	<Tabs
		bind:tab
		boxed
		tabs={[{ label: 'Details' }, { label: 'Activity' }, { label: 'Settings' }]}>
		{#snippet children({ tab })}
			<p style="margin: 0;">
				{['The details panel.', 'A log of recent activity.', 'Tweak your settings.'][tab]}
			</p>
		{/snippet}
	</Tabs>
</div>
