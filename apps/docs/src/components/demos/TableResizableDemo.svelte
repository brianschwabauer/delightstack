<script>
	import { Table } from '@delightstack/components/display';

	const products = [
		{ sku: 'DS-1001', name: 'Aurora Standing Desk', category: 'Furniture', price: '$649' },
		{ sku: 'DS-1002', name: 'Nimbus Office Chair', category: 'Furniture', price: '$329' },
		{ sku: 'DS-1003', name: 'Halo Desk Lamp', category: 'Lighting', price: '$89' },
		{ sku: 'DS-1004', name: 'Drift Acoustic Panel', category: 'Decor', price: '$48' },
		{ sku: 'DS-1005', name: 'Pulse USB-C Hub', category: 'Electronics', price: '$72' },
	];

	const columns = [
		{ key: 'sku', label: 'SKU', minWidth: '90px' },
		{ key: 'name', label: 'Product', minWidth: '140px' },
		{ key: 'category', label: 'Category', minWidth: '110px' },
		{ key: 'price', label: 'Price', align: 'right', minWidth: '80px' },
	];

	let last = $state('drag any column border (header or rows) · double-click to auto-fit');
</script>

<Table
	data={products}
	{columns}
	resizable
	oncolumnresize={(e) => (last = `${e.column} → ${e.width}px`)} />

<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--color-text-secondary);">
	{last}
</p>
