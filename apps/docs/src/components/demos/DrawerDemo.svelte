<script>
	import { Drawer } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<Button onclick={() => open = true}>Open Drawer</Button>

<Drawer bind:open width="320px">
	<div style="padding: 1.5rem;">
		<h3 style="margin: 0 0 0.75rem;">Drawer Panel</h3>
		<p style="margin: 0 0 1rem; color: var(--color-text-secondary, #666);">This is a slide-out drawer panel. Click outside or press Escape to close.</p>
		<Button outline onclick={() => open = false}>Close</Button>
	</div>
</Drawer>
