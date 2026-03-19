<script>
	import { Table } from '@delightstack/components/display';

	let sortBy = $state('name');
	let sortDirection = $state('asc');

	const data = [
		{ name: 'Alice', age: 30 },
		{ name: 'Bob', age: 25 },
		{ name: 'Carol', age: 35 },
	];
</script>

<Table
	{data}
	columns={[
		{ key: 'name', label: 'Name', sortable: true },
		{ key: 'age', label: 'Age', sortable: true, align: 'right' },
	]}
	bind:sortBy
	bind:sortDirection
/>
