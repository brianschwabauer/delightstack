<script>
	import { ContextMenu, contextMenu } from '@delightstack/components/actions';
</script>

<div
	{@attach contextMenu({
		actions: [
			{ label: 'View Profile', href: '#profile' },
			{ label: 'Open in New Tab', href: '#profile', target: '_blank' },
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
	Right-click for navigation options
</div>

<ContextMenu />
