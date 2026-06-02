<script>
	import { Table } from '@delightstack/components/display';

	let people = $state([
		{ id: 1, name: 'Alice Johnson', age: 30, role: 'Admin', active: true },
		{ id: 2, name: 'Bob Smith', age: 25, role: 'Editor', active: false },
		{ id: 3, name: 'Carol White', age: 35, role: 'Viewer', active: true },
		{ id: 4, name: 'Dave Brown', age: 28, role: 'Editor', active: true },
		{ id: 5, name: 'Eve Davis', age: 42, role: 'Admin', active: false },
	]);

	// Autocomplete suggestions for the name column.
	const NAMES = [
		'Alice Johnson',
		'Bob Smith',
		'Bob Smithsonian',
		'Bob Schmidt',
		'Carol White',
		'Carol Danvers',
		'Dave Brown',
		'Eve Davis',
		'Frank Green',
		'Grace Hopper',
	];

	let last = $state('—');

	const columns = [
		{
			key: 'name',
			label: 'Name',
			minWidth: '180px',
			options: NAMES,
			// Async commit → the cell shows a spinner, then a success check.
			onedit: ({ row, value }) =>
				new Promise((resolve) => {
					setTimeout(() => {
						row.name = value;
						last = `name → "${value}"`;
						resolve();
					}, 800);
				}),
		},
		{
			key: 'age',
			label: 'Age',
			width: '90px',
			align: 'right',
			editor: 'number',
			validate: (v) =>
				typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 120
					? null
					: 'Enter 0–120',
			onedit: ({ row, value }) => {
				row.age = value;
				last = `age → ${value}`;
			},
		},
		{
			key: 'role',
			label: 'Role',
			minWidth: '120px',
			editor: 'select',
			options: ['Admin', 'Editor', 'Viewer'],
			onedit: ({ row, value }) => {
				row.role = value;
				last = `role → ${value}`;
			},
		},
		{
			key: 'active',
			label: 'Active',
			width: '90px',
			align: 'center',
			editor: 'boolean',
			onedit: ({ row, value }) => {
				row.active = value;
				last = `active → ${value}`;
			},
		},
	];
</script>

<Table data={people} {columns} row_key="id" editable striped />

<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--color-text-secondary);">
	Click a cell or Tab in to edit · ↑↓ move rows · Tab moves cells · Enter saves · last: {last}
</p>
