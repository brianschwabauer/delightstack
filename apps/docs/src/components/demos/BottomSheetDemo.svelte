<script>
	import { BottomSheet } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<Button onclick={() => open = true}>Open Bottom Sheet</Button>

<BottomSheet bind:open snapPoints={[0.4, 0.8]}>
	<div style="padding: 1.5rem;">
		<h3 style="margin: 0 0 0.75rem;">Bottom Sheet</h3>
		<p style="margin: 0 0 1rem; color: var(--color-text-secondary, #666);">Drag the handle to resize or dismiss. This sheet has two snap points.</p>
		<Button outline onclick={() => open = false}>Close</Button>
	</div>
</BottomSheet>
