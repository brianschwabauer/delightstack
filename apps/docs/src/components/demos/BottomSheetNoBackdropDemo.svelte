<script>
	import { BottomSheet } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<Button onclick={() => (open = true)}>Open Sheet (No Backdrop)</Button>

<BottomSheet bind:open backdrop={false} blocking={false} snapPoints={[0.5, 0.9]}>
	<div style="padding: 0 1.5rem 1.5rem;">
		<h3 style="margin: 0 0 0.75rem;">No Backdrop</h3>
		<p style="margin: 0 0 1rem; color: color-mix(in oklch, var(--color-text), transparent 35%);">
			The backdrop has no blur or tint, so the page behind stays clearly visible. Tapping the
			transparent area still dismisses the sheet.
		</p>
		<Button outline onclick={() => (open = false)}>Close</Button>
	</div>
</BottomSheet>
