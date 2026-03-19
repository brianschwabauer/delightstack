<script>
	import { Drawer } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<Button onclick={() => open = true}>Open Right Drawer</Button>

<Drawer bind:open right>
	<div style="padding: 1.5rem;">
		<h3 style="margin: 0 0 0.75rem;">Right Drawer</h3>
		<p style="margin: 0 0 1rem; color: var(--color-text-secondary, #666);">This drawer slides in from the right edge.</p>
		<Button outline onclick={() => open = false}>Close</Button>
	</div>
</Drawer>
