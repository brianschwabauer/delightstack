<script>
	import { Menu, MenuItem, MenuSeparator } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let menuOpen = $state(false);
	let triggerEl = $state(undefined);
</script>

<span bind:this={triggerEl}>
	<Button onclick={() => menuOpen = !menuOpen}>Open Menu</Button>
</span>

<Menu bind:open={menuOpen} trigger={triggerEl}>
	<MenuItem onclick={() => {}}>Edit</MenuItem>
	<MenuItem onclick={() => {}}>Duplicate</MenuItem>
	<MenuItem shortcut="Ctrl+S" onclick={() => {}}>Save</MenuItem>
	<MenuSeparator />
	<MenuItem danger onclick={() => {}}>Delete</MenuItem>
</Menu>
