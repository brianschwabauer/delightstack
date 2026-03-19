<script>
	import { Menu, MenuItem, MenuSeparator } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let menuOpen = $state(false);
	let triggerEl = $state(undefined);
</script>

<span bind:this={triggerEl}>
	<Button onclick={() => (menuOpen = !menuOpen)}>Open Menu</Button>
</span>

<Menu bind:open={menuOpen} trigger={triggerEl}>
	<MenuItem onclick={() => {}}>Save</MenuItem>
	<MenuItem disabled>Save As... (Pro)</MenuItem>
	<MenuSeparator />
	<MenuItem onclick={() => {}}>Export</MenuItem>
	<MenuItem disabled>Import (Coming Soon)</MenuItem>
</Menu>
