<script>
	import { Table } from '@delightstack/components/display';

	const users = [
		{ name: 'Alice Johnson', email: 'alice@example.com', role: 'Admin' },
		{ name: 'Bob Smith', email: 'bob@example.com', role: 'Editor' },
		{ name: 'Carol White', email: 'carol@example.com', role: 'Viewer' },
		{ name: 'Dave Brown', email: 'dave@example.com', role: 'Editor' },
		{ name: 'Eve Davis', email: 'eve@example.com', role: 'Admin' },
	];

	const columns = [
		{ key: 'name', label: 'Name', sortable: true },
		{ key: 'email', label: 'Email' },
		{ key: 'role', label: 'Role' },
	];

	let selectedUsers = $state([]);
</script>

<Table
	data={users}
	{columns}
	selectable
	bind:selected={selectedUsers}
/>

<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--color-text-secondary);">
	{selectedUsers.length} row{selectedUsers.length !== 1 ? 's' : ''} selected
</p>
