<script>
	import { BottomSheet } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<Button onclick={() => (open = true)}>Open Non-Dismissible Sheet</Button>

<BottomSheet bind:open dismissible={false} snap_points={[0.4, 0.85]}>
	<div style="padding: 0 1.5rem 1.5rem;">
		<h3 style="margin: 0 0 0.75rem; color: var(--color-text, inherit);">Required Action</h3>
		<p style="margin: 0 0 1rem; color: color-mix(in oklch, var(--color-text), transparent 35%);">
			You must complete this action. Dragging down, tapping the backdrop, or pressing Escape will not
			dismiss this sheet — it only snaps to the smaller size.
		</p>
		<Button onclick={() => (open = false)}>Done</Button>
	</div>
</BottomSheet>
