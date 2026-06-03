<script>
	import { Pagination } from '@delightstack/components/navigation';

	let page1 = $state(1);
	let page2 = $state(1);
	let page3 = $state(1);
</script>

<div style="display: flex; flex-direction: column; gap: 1rem; width: 100%;">
	<div>
		<p style="margin-bottom: 0.5rem; font-size: 0.8rem; color: var(--sl-color-gray-3);">
			Size "0" (small)
		</p>
		<Pagination bind:page={page1} total_pages={10} size="0" />
	</div>
	<div>
		<p style="margin-bottom: 0.5rem; font-size: 0.8rem; color: var(--sl-color-gray-3);">
			Size "2" (medium)
		</p>
		<Pagination bind:page={page2} total_pages={10} size="2" />
	</div>
	<div>
		<p style="margin-bottom: 0.5rem; font-size: 0.8rem; color: var(--sl-color-gray-3);">
			Size "3" (large)
		</p>
		<Pagination bind:page={page3} total_pages={10} size="3" />
	</div>
</div>
