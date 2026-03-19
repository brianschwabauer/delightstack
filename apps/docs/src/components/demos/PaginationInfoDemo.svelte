<script>
	import { Pagination } from '@delightstack/components/navigation';

	let page = $state(1);
</script>

<div style="width: 100%;">
	<Pagination bind:page totalPages={20} totalItems={500} pageSize={25} showInfo />
</div>
