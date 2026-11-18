<script>
	import { ContextMenu, contextMenu } from '@delightstack/components/actions';

	let lastAction = $state('');

	// Show each platform's own keys: glyphs on Apple (⌘X), names elsewhere (Ctrl+X)
	const apple =
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');
	const mod = apple ? '⌘' : 'Ctrl';
	const shift = apple ? '⇧' : 'Shift';
	const del = apple ? '⌫' : 'Del';
</script>

<div
	{@attach contextMenu({
		dense: true,
		actions: [
			{
				label: 'Cut',
				shortcut: [mod, 'X'],
				group: 'edit',
				onclick: () => (lastAction = 'Cut'),
			},
			{
				label: 'Copy',
				shortcut: [mod, 'C'],
				group: 'edit',
				onclick: () => (lastAction = 'Copy'),
			},
			{
				label: 'Duplicate',
				shortcut: [mod, 'D'],
				group: 'edit',
				onclick: () => (lastAction = 'Duplicate'),
			},
			{
				label: 'Bring to front',
				shortcut: [shift, ']'],
				group: 'arrange',
				onclick: () => (lastAction = 'Bring to front'),
			},
			{
				label: 'Send to back',
				shortcut: [shift, '['],
				group: 'arrange',
				onclick: () => (lastAction = 'Send to back'),
			},
			{
				label: 'Delete',
				shortcut: [del],
				group: 'delete',
				danger: true,
				onclick: () => (lastAction = 'Delete'),
			},
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
	Right-click for editing actions
	{#if lastAction}
		<div style="margin-top: 0.75rem; font-size: 0.85rem; opacity: 0.7;">{lastAction}</div>
	{/if}
</div>

<ContextMenu />
