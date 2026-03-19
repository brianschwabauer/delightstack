<script>
	import { BottomSheet } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<Button onclick={() => open = true}>Open Non-Dismissible Sheet</Button>

<BottomSheet bind:open dismissible={false}>
	<div style="padding: 1.5rem;">
		<h3 style="margin: 0 0 0.75rem; color: var(--color-text, inherit);">Required Action</h3>
		<p style="margin: 0 0 1rem; color: var(--color-text-secondary, #666);">You must complete this action. Dragging down or tapping the backdrop will not dismiss this sheet.</p>
		<Button onclick={() => open = false}>Done</Button>
	</div>
</BottomSheet>
