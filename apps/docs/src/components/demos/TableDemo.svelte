<script>
	import { Table } from '@delightstack/components/display';

	const data = [
		{ name: 'Alice Johnson', email: 'alice@example.com', role: 'Admin' },
		{ name: 'Bob Smith', email: 'bob@example.com', role: 'Editor' },
		{ name: 'Carol White', email: 'carol@example.com', role: 'Viewer' },
		{ name: 'Dave Brown', email: 'dave@example.com', role: 'Editor' },
		{ name: 'Eve Davis', email: 'eve@example.com', role: 'Admin' },
	];

	const columns = [
		{ key: 'name', label: 'Name', sortable: true },
		{ key: 'email', label: 'Email', sortable: true },
		{ key: 'role', label: 'Role', sortable: true },
	];

	let sortBy = $state(undefined);
	let sortDirection = $state('asc');
</script>

<Table {data} {columns} bind:sort_by={sortBy} bind:sort_direction={sortDirection} />
