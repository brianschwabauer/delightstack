<script>
	import { Menu, MenuCheckboxItem, MenuGroup } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let menuOpen = $state(false);
	let triggerEl = $state(undefined);
	let showGrid = $state(true);
	let showRulers = $state(false);
</script>

<div style="display: flex; align-items: center; gap: 1rem;">
	<span bind:this={triggerEl}>
		<Button onclick={() => menuOpen = !menuOpen}>View Options</Button>
	</span>
	<span style="font-size: 0.85rem; color: var(--sl-color-gray-2, #ccc);">
		Grid: {showGrid ? 'on' : 'off'} | Rulers: {showRulers ? 'on' : 'off'}
	</span>
</div>

<Menu bind:open={menuOpen} trigger={triggerEl} close_on_select={false}>
	<MenuGroup label="View">
		<MenuCheckboxItem bind:checked={showGrid}>Show Grid</MenuCheckboxItem>
		<MenuCheckboxItem bind:checked={showRulers}>Show Rulers</MenuCheckboxItem>
	</MenuGroup>
</Menu>
