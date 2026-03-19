<script>
	import { Breadcrumbs } from '@delightstack/components/navigation';

	const items = [
		{ label: 'Products', href: '/products' },
		{ label: 'Electronics', href: '/products/electronics' },
		{ label: 'Headphones' },
	];
</script>

<Breadcrumbs {items}>
	{#snippet separator()}
		<span style="color: var(--sl-color-gray-3);">/</span>
	{/snippet}
</Breadcrumbs>
