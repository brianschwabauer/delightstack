<script>
	import { ContextMenu, contextMenu } from '@delightstack/components/actions';

	let lastAction = $state('');
</script>

<div
	{@attach contextMenu({
		actions: [
			{ label: 'Edit', onclick: () => (lastAction = 'Edit clicked') },
			{ label: 'Copy', onclick: () => (lastAction = 'Copy clicked') },
			{ label: 'Delete', onclick: () => (lastAction = 'Delete clicked') },
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
	Right-click for file options
	{#if lastAction}
		<div style="margin-top: 0.75rem; font-size: 0.85rem; opacity: 0.7;">{lastAction}</div>
	{/if}
</div>

<ContextMenu />
