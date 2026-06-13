<script>
	import { Tabs } from '@delightstack/components/navigation';

	let tab = $state(0);
</script>

<div style="width: 100%;">
	<Tabs
		bind:tab
		full_width
		tabs={[{ label: 'First' }, { label: 'Second' }, { label: 'Third' }]}>
		{#snippet children({ tab })}
			<p style="margin: 0;">The {['first', 'second', 'third'][tab]} panel.</p>
		{/snippet}
	</Tabs>
</div>
