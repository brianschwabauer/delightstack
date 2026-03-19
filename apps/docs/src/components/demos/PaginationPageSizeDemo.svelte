<script>
	import { Pagination } from '@delightstack/components/navigation';

	let page = $state(1);
	let pageSize = $state(25);
</script>

<div style="width: 100%;">
	<Pagination
		bind:page
		bind:pageSize
		totalPages={40}
		showPageSize
		pageSizeOptions={[10, 25, 50, 100]}
		onpagesizechange={() => {
			page = 1;
		}}
	/>
	<p style="margin-top: 0.75rem; font-size: 0.875rem; color: var(--sl-color-gray-3);">
		Page {page}, showing {pageSize} per page
	</p>
</div>
