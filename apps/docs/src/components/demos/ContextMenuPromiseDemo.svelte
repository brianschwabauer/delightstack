<script>
	import { ContextMenu, contextMenu } from '@delightstack/components/actions';

	let status = $state('');

	// Returning a promise from `onclick` makes the menu item show a spinner while
	// it is pending (and the menu stays open until it resolves).
	function syncToCloud() {
		status = 'Syncing…';
		return new Promise((resolve) => {
			setTimeout(() => {
				status = 'Synced to cloud';
				resolve();
			}, 1500);
		});
	}
</script>

<div
	{@attach contextMenu({
		actions: [
			{ label: 'Sync to cloud', onclick: syncToCloud },
			{ label: 'Rename', onclick: () => (status = 'Renamed') },
		],
	})}
	style="
		border: 2px dashed var(--sl-color-gray-4, #666);
		border-radius: 0.5rem;
		padding: 2rem;
		text-align: center;
		color: var(--sl-color-gray-2, #ccc);
		cursor: context-menu;
		user-select: none;
	">
	Right-click and choose “Sync to cloud”
	{#if status}
		<div style="margin-top: 0.75rem; font-size: 0.85rem; opacity: 0.7;">{status}</div>
	{/if}
</div>

<ContextMenu />
