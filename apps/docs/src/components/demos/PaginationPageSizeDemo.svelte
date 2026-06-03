<script>
	import { Pagination } from '@delightstack/components/navigation';

	let page = $state(1);
	let pageSize = $state(25);
</script>

<div style="width: 100%;">
	<Pagination
		bind:page
		bind:page_size={pageSize}
		total_pages={40}
		show_page_size
		page_size_options={[10, 25, 50, 100]}
		onpagesizechange={() => {
			page = 1;
		}} />
	<p style="margin-top: 0.75rem; font-size: 0.875rem; color: var(--sl-color-gray-3);">
		Page {page}, showing {pageSize} per page
	</p>
</div>
