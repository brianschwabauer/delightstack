<script>
	import { Tabs, Tab } from '@delightstack/components/navigation';

	let value = $state('inbox');
</script>

<Tabs bind:value>
	<Tab value="inbox" label="Inbox" badge={12} />
	<Tab value="sent" label="Sent" />
	<Tab value="drafts" label="Drafts" badge="2" />
</Tabs>
