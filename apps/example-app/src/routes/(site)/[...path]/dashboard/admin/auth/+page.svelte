<script lang="ts">
	import Table from '$lib/components/Table.svelte';
	import Button from '$lib/form/Button.svelte';

	const { data } = $props();
	const { indexes, tables } = $derived(data);

	async function deleteDatabase() {
		if (!tables.length) return;
		await fetch('/dashboard/admin/auth/sql', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				sql: `PRAGMA foreign_keys = OFF; ${tables.map((v) => `DROP TABLE IF EXISTS ${v.name}`).join('; ')}; PRAGMA foreign_keys = ON;`,
			}),
		});
	}
</script>

<article>
	<Table
		list={tables}
		size={10}
		href={(v) => `/dashboard/admin/auth/${v.name}`}
		columns={[
			{
				key: 'name',
				name: 'Table Name',
				id: 'name',
				type: 'text',
			},
		]}></Table>
	<Table
		style="margin: 2rem 0;"
		list={indexes}
		size={10}
		href={(v) => `/dashboard/admin/auth/${v.name}`}
		columns={[
			{
				key: 'name',
				name: 'Indexes',
				id: 'name',
				type: 'text',
			},
		]}></Table>
	<Button
		error
		transparent
		fullWidth
		style="margin: 2rem 0;"
		onclick={() => deleteDatabase()}>
		Delete Database
	</Button>
</article>

<style>
	article {
		width: calc(100% - 2rem);
		max-width: 1200px;
		margin: 2rem auto;
	}
</style>
