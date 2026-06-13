<script>
	import { Tabs } from '@delightstack/components/navigation';

	let tab = $state(0);
</script>

<div style="width: 100%;">
	<Tabs
		bind:tab
		tabs={[
			{ label: 'Inbox', badge: 12 },
			{ label: 'Sent' },
			{ label: 'Drafts', badge: '2' },
		]}>
		{#snippet children({ tab })}
			<p style="margin: 0;">
				{['12 unread messages.', 'Your sent mail.', '2 unfinished drafts.'][tab]}
			</p>
		{/snippet}
	</Tabs>
</div>
