<script>
	import { Drawer } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let topOpen = $state(false);
	let bottomOpen = $state(false);
</script>

<div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
	<Button onclick={() => (topOpen = true)}>Open Top Drawer</Button>
	<Button outline onclick={() => (bottomOpen = true)}>Open Bottom Drawer</Button>
</div>

<Drawer bind:open={topOpen} top height="200px">
	<div style="padding: 1.5rem;">
		<h3 style="margin: 0 0 0.75rem;">Top Drawer</h3>
		<p style="margin: 0 0 1rem; color: var(--color-text-secondary, #666);">This drawer slides in from the top edge.</p>
		<Button outline onclick={() => (topOpen = false)}>Close</Button>
	</div>
</Drawer>

<Drawer bind:open={bottomOpen} bottom height="200px">
	<div style="padding: 1.5rem;">
		<h3 style="margin: 0 0 0.75rem;">Bottom Drawer</h3>
		<p style="margin: 0 0 1rem; color: var(--color-text-secondary, #666);">This drawer slides in from the bottom edge.</p>
		<Button outline onclick={() => (bottomOpen = false)}>Close</Button>
	</div>
</Drawer>
