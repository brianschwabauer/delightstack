<script>
	import { BottomSheet } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let open = $state(false);
	let snap = $state(0);
</script>

<Button onclick={() => (open = true)}>Open Multi-Snap Sheet</Button>

<BottomSheet bind:open bind:snap snapPoints={[0.3, 0.6, 1]}>
	<div style="padding: 0 1.5rem 1.5rem;">
		<h3 style="margin: 0 0 0.75rem; color: var(--color-text, inherit);">Drag Me!</h3>
		<p style="margin: 0 0 0.5rem; color: color-mix(in oklch, var(--color-text), transparent 35%);">
			This sheet has three snap points at 30%, 60%, and 100%. Drag between them, or use the buttons
			to jump.
		</p>
		<p style="margin: 0 0 1rem; font-size: 0.85rem; color: var(--color-action, #3b82f6);">
			Current snap index: <strong>{snap}</strong>
		</p>
		<div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.5rem;">
			<Button size="0" outline onclick={() => (snap = 0)}>30%</Button>
			<Button size="0" outline onclick={() => (snap = 1)}>60%</Button>
			<Button size="0" outline onclick={() => (snap = 2)}>100%</Button>
			<Button size="0" onclick={() => (open = false)}>Close</Button>
		</div>
		{#each Array(16) as _, i}
			<div
				style="padding: 0.75rem 0; border-bottom: 1px solid var(--color-border, #2a2a2a);">
				List item {i + 1}
			</div>
		{/each}
	</div>
</BottomSheet>
