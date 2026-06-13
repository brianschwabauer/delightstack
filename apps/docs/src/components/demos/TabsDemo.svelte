<script>
	import { Tabs } from '@delightstack/components/navigation';

	let tab = $state(0);
</script>

{#snippet overview()}
	<p style="margin: 0;">
		Welcome to the overview panel. Get a quick summary of everything you need to know.
	</p>
{/snippet}
{#snippet features()}
	<p style="margin: 0;">
		Explore the features that make this component powerful and flexible.
	</p>
{/snippet}
{#snippet pricing()}
	<p style="margin: 0;">View our pricing plans and find the one that fits your needs.</p>
{/snippet}

<div style="width: 100%;">
	<Tabs
		bind:tab
		tabs={[
			{ label: 'Overview', content: overview },
			{ label: 'Features', content: features },
			{ label: 'Pricing', content: pricing },
		]} />
</div>
