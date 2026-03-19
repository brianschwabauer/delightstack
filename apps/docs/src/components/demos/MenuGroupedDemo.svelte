<script>
	import { Menu, MenuItem, MenuGroup } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let menuOpen = $state(false);
	let triggerEl = $state(undefined);
	let lastAction = $state('');
</script>

<div style="display: flex; align-items: center; gap: 1rem;">
	<span bind:this={triggerEl}>
		<Button onclick={() => menuOpen = !menuOpen}>File Menu</Button>
	</span>
	{#if lastAction}
		<span style="font-size: 0.85rem; color: var(--sl-color-gray-2, #ccc);">{lastAction}</span>
	{/if}
</div>

<Menu bind:open={menuOpen} trigger={triggerEl}>
	<MenuGroup label="File">
		<MenuItem onclick={() => lastAction = 'New'}>New</MenuItem>
		<MenuItem onclick={() => lastAction = 'Open'}>Open</MenuItem>
		<MenuItem onclick={() => lastAction = 'Save'}>Save</MenuItem>
	</MenuGroup>
	<MenuGroup label="Edit">
		<MenuItem onclick={() => lastAction = 'Undo'}>Undo</MenuItem>
		<MenuItem onclick={() => lastAction = 'Redo'}>Redo</MenuItem>
	</MenuGroup>
</Menu>
