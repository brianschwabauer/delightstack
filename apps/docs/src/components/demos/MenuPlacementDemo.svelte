<script>
	import { Menu, MenuItem } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let menuOpen = $state(false);
	let triggerEl = $state(undefined);
</script>

<span bind:this={triggerEl}>
	<Button onclick={() => (menuOpen = !menuOpen)}>Right-Aligned Menu</Button>
</span>

<Menu bind:open={menuOpen} trigger={triggerEl} placement="right-start">
	<MenuItem onclick={() => {}}>Option A</MenuItem>
	<MenuItem onclick={() => {}}>Option B</MenuItem>
	<MenuItem onclick={() => {}}>Option C</MenuItem>
</Menu>
