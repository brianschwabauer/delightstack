<script>
	import { Pagination } from '@delightstack/components/navigation';

	let page = $state(1);
</script>

<div style="width: 100%;">
	<Pagination bind:page total_pages={20} total_items={500} page_size={25} show_info />
</div>
