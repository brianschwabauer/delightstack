<script>
	import { Tabs } from '@delightstack/components/navigation';

	let tab = $state(0);
</script>

<div style="width: 100%;">
	<Tabs
		bind:tab
		pills
		tabs={[{ label: 'All' }, { label: 'Active', badge: '3' }, { label: 'Archived' }]}>
		{#snippet children({ tab })}
			<p style="margin: 0;">
				{[
					'Everything in one place.',
					'Three items still in progress.',
					'Tucked away for later.',
				][tab]}
			</p>
		{/snippet}
	</Tabs>
</div>
