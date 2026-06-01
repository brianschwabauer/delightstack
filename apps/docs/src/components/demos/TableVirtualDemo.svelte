<script>
	import { Table } from '@delightstack/components/display';

	const roles = ['Admin', 'Editor', 'Viewer', 'Owner', 'Guest'];

	// 10,000 rows — only the rows near the viewport are ever in the DOM.
	const data = Array.from({ length: 10000 }, (_, i) => ({
		id: i + 1,
		name: `User ${i + 1}`,
		email: `user${i + 1}@example.com`,
		role: roles[i % roles.length],
	}));

	const columns = [
		{ key: 'id', label: '#', width: '80px', align: 'right', sortable: true },
		{ key: 'name', label: 'Name', sortable: true },
		{ key: 'email', label: 'Email' },
		{ key: 'role', label: 'Role', sortable: true },
	];

	let sortBy = $state(undefined);
	let sortDirection = $state('asc');
</script>

<Table
	{data}
	{columns}
	virtual_scroll={{ max_height: 360 }}
	striped
	bind:sort_by={sortBy}
	bind:sort_direction={sortDirection} />

<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--color-text-secondary);">
	{data.length.toLocaleString()} rows — scroll the table; only the visible window renders.
</p>
