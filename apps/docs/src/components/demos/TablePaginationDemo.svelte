<script>
	import { Table } from '@delightstack/components/display';

	// A bigger dataset so there's something to page through.
	const roles = ['Admin', 'Editor', 'Viewer'];
	const data = Array.from({ length: 42 }, (_, i) => ({
		id: i + 1,
		name: `User ${i + 1}`,
		email: `user${i + 1}@example.com`,
		role: roles[i % roles.length],
	}));

	let page = $state(1);
	let page_size = $state(10);
</script>

<Table
	{data}
	row_key="id"
	bind:page
	bind:page_size
	pagination={{ page_size_options: [5, 10, 25] }}
	columns={[
		{ key: 'name', label: 'Name', sortable: true },
		{ key: 'email', label: 'Email' },
		{ key: 'role', label: 'Role', sortable: true },
	]} />
