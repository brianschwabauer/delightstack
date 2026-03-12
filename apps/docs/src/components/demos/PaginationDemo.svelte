<script>
	import { Pagination } from '@delightstack/components/navigation';

	let page = $state(1);
</script>

<div style="width: 100%;">
	<Pagination bind:page totalPages={10} />
	<p style="margin-top: 0.75rem; font-size: 0.875rem; color: var(--sl-color-gray-3);">Current page: {page}</p>
</div>
