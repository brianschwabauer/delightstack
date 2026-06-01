<script>
	import { Pagination } from '@delightstack/components/navigation';

	let page = $state(25);
</script>

<div style="width: 100%;">
	<Pagination bind:page total_pages={50} sibling_count={2} boundary_count={2} />
	<p style="margin-top: 0.75rem; font-size: 0.875rem; color: var(--sl-color-gray-3);">
		sibling_count=2, boundary_count=2
	</p>
</div>
