<script>
	import { Table } from '@delightstack/components/display';

	let users = $state([
		{ rank: 1, name: 'Alice Johnson', role: 'Admin' },
		{ rank: 2, name: 'Bob Smith', role: 'Editor' },
		{ rank: 3, name: 'Carol White', role: 'Viewer' },
		{ rank: 4, name: 'Dave Brown', role: 'Editor' },
		{ rank: 5, name: 'Eve Davis', role: 'Admin' },
		{ rank: 6, name: 'Frank Green', role: 'Viewer' },
	]);

	const columns = [
		{ key: 'rank', label: '#', width: '56px', align: 'right' },
		{ key: 'name', label: 'Name', minWidth: '160px' },
		{ key: 'role', label: 'Role', minWidth: '120px' },
	];

	let selected = $state([]);
	let last = $state('—');
</script>

<Table
	data={users}
	{columns}
	row_key="rank"
	reorderable
	selectable
	bind:selected
	onreorder={(e) => {
		users = e.newData;
		last = `moved ${e.from.length} row(s) → index ${e.to}`;
	}} />

<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--color-text-secondary);">
	{last} · order: {users.map((u) => u.rank).join(', ')}
</p>
