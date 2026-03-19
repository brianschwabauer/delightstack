<script>
	import { BottomSheet } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<Button onclick={() => (open = true)}>Open Sheet (No Backdrop)</Button>

<BottomSheet bind:open showBackdrop={false} blocking={false}>
	<div style="padding: 1.5rem;">
		<h3 style="margin: 0 0 0.75rem;">Non-Blocking Sheet</h3>
		<p style="margin: 0 0 1rem; color: var(--color-text-secondary, #666);">
			This sheet has no backdrop overlay and does not block body scroll. You can still interact with
			the page behind it.
		</p>
		<Button outline onclick={() => (open = false)}>Close</Button>
	</div>
</BottomSheet>
