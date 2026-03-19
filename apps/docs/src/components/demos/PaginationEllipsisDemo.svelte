<script>
	import { Pagination } from '@delightstack/components/navigation';

	let page = $state(25);
</script>

<div style="width: 100%;">
	<Pagination bind:page totalPages={50} siblingCount={2} boundaryCount={2} />
	<p style="margin-top: 0.75rem; font-size: 0.875rem; color: var(--sl-color-gray-3);">
		siblingCount=2, boundaryCount=2
	</p>
</div>
