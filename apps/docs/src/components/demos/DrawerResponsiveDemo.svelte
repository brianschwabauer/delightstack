<script>
	import { Drawer } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<div>
	<p style="margin: 0 0 0.75rem; font-size: 0.85rem; color: var(--sl-color-gray-3);">
		This drawer is persistent (always visible) on screens wider than 1024px and becomes an overlay on smaller screens. Resize the browser to see the change.
	</p>
	<Button onclick={() => (open = true)}>Toggle Drawer (mobile)</Button>

	<Drawer bind:open breakpoint="(min-width: 1024px)" width="220px">
		<nav style="padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem;">
			<a href="#" onclick={(e) => e.preventDefault()} style="text-decoration: none; color: inherit; font-size: 0.875rem;">Home</a>
			<a href="#" onclick={(e) => e.preventDefault()} style="text-decoration: none; color: inherit; font-size: 0.875rem;">About</a>
			<a href="#" onclick={(e) => e.preventDefault()} style="text-decoration: none; color: inherit; font-size: 0.875rem;">Contact</a>
		</nav>
	</Drawer>
</div>
