<script>
	import { Table } from '@delightstack/components/display';
	import { Button } from '@delightstack/components/actions';

	const users = [
		{ name: 'Alice Johnson', status: 'active', role: 'Admin' },
		{ name: 'Bob Smith', status: 'inactive', role: 'Editor' },
		{ name: 'Carol White', status: 'active', role: 'Viewer' },
		{ name: 'Dave Brown', status: 'pending', role: 'Editor' },
		{ name: 'Eve Davis', status: 'active', role: 'Admin' },
	];

	let lastAction = $state('');
</script>

{#snippet statusCell({ value })}
	<span style="
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.2rem 0.6rem;
		border-radius: 9999px;
		font-size: 0.75rem;
		font-weight: 500;
		background: {value === 'active' ? 'color-mix(in oklch, var(--color-success) 15%, transparent)' : value === 'pending' ? 'color-mix(in oklch, var(--color-warning) 15%, transparent)' : 'color-mix(in oklch, var(--color-error) 15%, transparent)'};
		color: {value === 'active' ? 'var(--color-success)' : value === 'pending' ? 'var(--color-warning)' : 'var(--color-error)'};
	">
		<span style="
			width: 0.5rem;
			height: 0.5rem;
			border-radius: 50%;
			background: currentColor;
		"></span>
		{value}
	</span>
{/snippet}

{#snippet actionsCell({ row })}
	<Button size="0" onclick={() => { lastAction = `Editing ${row.name}`; }}>Edit</Button>
{/snippet}

<Table
	data={users}
	columns={[
		{ key: 'name', label: 'Name', sortable: true },
		{ key: 'status', label: 'Status', cell: statusCell },
		{ key: 'role', label: 'Role' },
		{ key: 'actions', label: '', cell: actionsCell, width: '100px' },
	]}
/>

{#if lastAction}
	<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--color-text-secondary);">
		{lastAction}
	</p>
{/if}
