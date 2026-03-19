<script>
	import { Menu, MenuRadioGroup, MenuRadioItem } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let menuOpen = $state(false);
	let triggerEl = $state(undefined);
	let theme = $state('system');
</script>

<div style="display: flex; align-items: center; gap: 1rem;">
	<span bind:this={triggerEl}>
		<Button onclick={() => menuOpen = !menuOpen}>Theme</Button>
	</span>
	<span style="font-size: 0.85rem; color: var(--sl-color-gray-2, #ccc);">
		Current: {theme}
	</span>
</div>

<Menu bind:open={menuOpen} trigger={triggerEl}>
	<MenuRadioGroup bind:value={theme}>
		<MenuRadioItem value="light">Light</MenuRadioItem>
		<MenuRadioItem value="dark">Dark</MenuRadioItem>
		<MenuRadioItem value="system">System</MenuRadioItem>
	</MenuRadioGroup>
</Menu>
