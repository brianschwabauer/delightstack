<script>
	import { ContextMenu, contextMenu } from '@delightstack/components/actions';

	let lastAction = $state('');
</script>

<div
	{@attach contextMenu({
		actions: [
			{ snippet: emailItem, onclick: () => (lastAction = 'Shared via email') },
			{ snippet: linkItem, onclick: () => (lastAction = 'Link copied to clipboard') },
			{ snippet: embedItem, onclick: () => (lastAction = 'Embed code copied') },
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
	Right-click to share
	{#if lastAction}
		<div style="margin-top: 0.75rem; font-size: 0.85rem; opacity: 0.7;">{lastAction}</div>
	{/if}
</div>

<!-- Each action renders this `row` snippet, giving the menu item a leading
     emoji, a label, and a trailing keyboard-shortcut hint. -->
{#snippet row(emoji, title, hint)}
	<span style="display: flex; align-items: center; gap: 0.6rem; width: 100%;">
		<span style="font-size: 1rem;">{emoji}</span>
		<span style="flex: 1; text-align: left;">{title}</span>
		<span style="font-size: 0.75rem; opacity: 0.55; font-variant-numeric: tabular-nums;">
			{hint}
		</span>
	</span>
{/snippet}

{#snippet emailItem()}{@render row('✉️', 'Email', '⌘E')}{/snippet}
{#snippet linkItem()}{@render row('🔗', 'Copy link', '⌘C')}{/snippet}
{#snippet embedItem()}{@render row('🧩', 'Embed', '⌘B')}{/snippet}

<ContextMenu />
