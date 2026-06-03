<script>
	import { ContextMenu, contextMenu } from '@delightstack/components/actions';

	let viewMode = $state('grid');
</script>

<div
	{@attach contextMenu({
		actions: [
			{
				label: 'Grid View',
				active: viewMode === 'grid',
				onclick: () => (viewMode = 'grid'),
			},
			{
				label: 'List View',
				active: viewMode === 'list',
				onclick: () => (viewMode = 'list'),
			},
			{ label: 'Table View', disabled: true },
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
	Right-click to change view (current: {viewMode})
</div>

<ContextMenu />
