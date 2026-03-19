<script>
	import { Menu, MenuItem, MenuSeparator } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let menuOpen = $state(false);
	let triggerEl = $state(undefined);
	let lastAction = $state('');
</script>

<div style="display: flex; align-items: center; gap: 1rem;">
	<span bind:this={triggerEl}>
		<Button onclick={() => menuOpen = !menuOpen}>Open Menu</Button>
	</span>
	{#if lastAction}
		<span style="font-size: 0.85rem; color: var(--sl-color-gray-2, #ccc);">{lastAction}</span>
	{/if}
</div>

<Menu bind:open={menuOpen} trigger={triggerEl}>
	<MenuItem shortcut="⌘C" onclick={() => lastAction = 'Copy'}>Copy</MenuItem>
	<MenuItem shortcut="⌘V" onclick={() => lastAction = 'Paste'}>Paste</MenuItem>
	<MenuSeparator />
	<MenuItem badge="3" onclick={() => lastAction = 'Notifications'}>Notifications</MenuItem>
</Menu>
