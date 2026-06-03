<script>
	import { Table } from '@delightstack/components/display';
</script>

<Table
	skeleton
	skeleton_count={5}
	columns={[
		{ key: 'name', label: 'Name' },
		{ key: 'email', label: 'Email' },
		{ key: 'status', label: 'Status' },
	]}
	data={[]} />
