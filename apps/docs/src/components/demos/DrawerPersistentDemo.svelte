<script>
	import { Drawer } from '@delightstack/components/navigation';
</script>

<div style="display: flex; height: 200px; border: 1px solid var(--color-border, #ddd); border-radius: 0.5rem; overflow: hidden; width: 100%;">
	<Drawer open persistent width="180px">
		<nav style="padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem;">
			<a href="#" onclick={(e) => e.preventDefault()} style="text-decoration: none; color: var(--c-primary, hsl(220 70% 55%)); font-weight: 600; font-size: 0.875rem;">Dashboard</a>
			<a href="#" onclick={(e) => e.preventDefault()} style="text-decoration: none; color: inherit; font-size: 0.875rem;">Settings</a>
			<a href="#" onclick={(e) => e.preventDefault()} style="text-decoration: none; color: inherit; font-size: 0.875rem;">Profile</a>
		</nav>
	</Drawer>
	<main style="flex: 1; padding: 1rem; background: var(--sl-color-gray-6);">
		<p style="margin: 0; font-size: 0.875rem; color: var(--sl-color-gray-3);">Main content area. The drawer is always visible in persistent mode.</p>
	</main>
</div>
