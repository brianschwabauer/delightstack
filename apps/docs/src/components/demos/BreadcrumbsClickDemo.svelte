<script>
	import { Breadcrumbs } from '@delightstack/components/navigation';

	const items = [
		{ label: 'Home', href: '#' },
		{ label: 'Products', href: '#products' },
		{ label: 'Detail' },
	];

	let lastClicked = $state('');
</script>

<div>
	<Breadcrumbs
		{items}
		show_home={false}
		onclick={({ item, index }) => {
			lastClicked = `Clicked "${item.label}" (index ${index})`;
		}}
	/>
	{#if lastClicked}
		<p style="margin: 0.75rem 0 0; font-size: 0.85rem; color: var(--sl-color-gray-3);">
			{lastClicked}
		</p>
	{/if}
</div>
