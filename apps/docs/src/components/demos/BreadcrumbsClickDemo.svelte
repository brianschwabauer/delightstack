<script>
	import { Breadcrumbs } from '@delightstack/components/navigation';

	const items = [{ label: 'Home' }, { label: 'Products' }, { label: 'Detail' }];

	let status = $state('');

	// Returning a promise from `onclick` makes the clicked crumb show a loading
	// spinner until the promise settles — the trail re-flows smoothly as it
	// appears and disappears.
	function navigate({ item, index }) {
		status = `Loading "${item.label}"…`;
		return new Promise((resolve) => {
			setTimeout(() => {
				status = `Clicked "${item.label}" (index ${index})`;
				resolve();
			}, 1200);
		});
	}
</script>

<div>
	<Breadcrumbs {items} show_home={false} onclick={navigate} />
	{#if status}
		<p style="margin: 0.75rem 0 0; font-size: 0.85rem; color: var(--sl-color-gray-3);">
			{status}
		</p>
	{/if}
</div>
