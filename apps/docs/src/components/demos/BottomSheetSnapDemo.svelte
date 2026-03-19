<script>
	import { BottomSheet } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let open = $state(false);
	let snap = $state(0);
</script>

<Button onclick={() => open = true}>Open Multi-Snap Sheet</Button>

<BottomSheet
	bind:open
	bind:snap
	snapPoints={[0.3, 0.6, 1]}
	defaultSnap={0}
>
	<div style="padding: 1.5rem;">
		<h3 style="margin: 0 0 0.75rem; color: var(--color-text, inherit);">Drag Me!</h3>
		<p style="margin: 0 0 0.5rem; color: var(--color-text-secondary, #666);">
			This sheet has three snap points at 30%, 60%, and 100%.
		</p>
		<p style="margin: 0 0 1rem; font-size: 0.85rem; color: var(--sl-color-gray-2, #ccc);">
			Current snap index: {snap}
		</p>
		<Button outline onclick={() => open = false}>Close</Button>
	</div>
</BottomSheet>
