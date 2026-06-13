<script>
	import { Tabs } from '@delightstack/components/navigation';

	let tab = $state(0);
</script>

<div style="width: 100%;">
	<Tabs
		bind:tab
		tabs={[
			{ label: 'Available' },
			{ label: 'Coming Soon', disabled: true },
			{ label: 'Beta' },
		]}>
		{#snippet children({ tab })}
			<p style="margin: 0;">
				{['This feature is ready to use.', '', 'A preview that may change.'][tab]}
			</p>
		{/snippet}
	</Tabs>
</div>
