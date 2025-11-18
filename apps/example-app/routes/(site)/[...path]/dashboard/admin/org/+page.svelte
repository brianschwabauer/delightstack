<!-- svelte-ignore state_referenced_locally -->
<script lang="ts">
	import Table from '$lib/components/Table.svelte';
	const { data } = $props();
	const { list: raw_list } = $derived(data);
	let list = $state(raw_list);

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

	$inspect(list);
</script>

<article>
	<Table href={(column) => `/dashboard/admin/org/${column.id}`} {list} size={10} {columns}
	></Table>
</article>

<style>
	article {
		width: calc(100% - 2rem);
		max-width: 1200px;
		margin: 2rem auto;
	}
</style>
