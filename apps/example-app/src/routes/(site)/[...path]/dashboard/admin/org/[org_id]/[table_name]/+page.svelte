<!-- svelte-ignore state_referenced_locally -->
<script lang="ts">
	import { page } from '$app/state';
	import { toast } from '$lib/components/index.js';
	import Table from '$lib/components/Table.svelte';
	import Button from '$lib/form/Button.svelte';

	const { data } = $props();
	const { list: raw_list, table_info } = $derived(data);
	let list = $state(raw_list);

	const primary_key = $derived(
		table_info.find((table_column) => !!table_column.pk)?.name as string,
	);
	const columns = $derived.by(() => {
		const keys = new Set<string>();
		list.forEach((item) => {
			Object.keys(item).forEach((key) => keys.add(key));
		});
		return Array.from(keys).map((key) => ({
			key,
			name: key
				.replace(/([a-z])([A-Z])/g, '$1 $2')
				.replace(/_/g, ' ')
				.replace(/\b\w/g, (l) => l.toUpperCase()),
			id: key,
			type: 'text' as 'text',
		}));
	});

	async function updateRow(row: any, column: any) {
		if (!primary_key) return;
		const updateFields = table_info
			.map((column) => column.name as string)
			.filter((column) => column && column !== primary_key && !!row[column])
			.map((column) => `${column} = '${row[column].replace(/'/g, '')}'`)
			.join(', ');
		const sql_update = await fetch(`/dashboard/admin/org/${page.params.org_id}/sql`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				sql: `UPDATE ${page.params.table_name} SET ${updateFields} WHERE ${primary_key} = '${row[primary_key]}'`,
			}),
		});
		if (!sql_update.ok) {
			toast.error(`Failed to update row`);
		}
	}
	$inspect(list);
	$inspect(table_info);
</script>

<article>
	{#snippet row(row: any, column: any)}
		<input
			type="text"
			disabled={column.key === primary_key}
			bind:value={row[column.key]}
			style="field-sizing:content; max-width: 150px; min-width: 30px" />
	{/snippet}
	{#snippet action(row: any, column: any)}
		<Button transparent size="0" onclick={() => updateRow(row, column)}>Save</Button>
	{/snippet}
	<Table
		href={null}
		{list}
		size={10}
		columns={[
			...columns.map((column) => ({ ...column, snippet: row })),
			{ type: 'text', key: 'action', id: 'action', snippet: action },
		]}>
	</Table>
</article>

<style>
	article {
		width: calc(100% - 2rem);
		max-width: 1200px;
		margin: 2rem auto;
	}
</style>
