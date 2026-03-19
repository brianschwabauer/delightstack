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
		{ key: 'name', label: 'Name' },
		{ key: 'email', label: 'Email' },
		{ key: 'role', label: 'Role' },
	];
</script>

<Table {data} {columns} striped dense />
