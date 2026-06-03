<script>
	import { BottomSheet } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<Button onclick={() => (open = true)}>Open Bottom Sheet</Button>

<BottomSheet bind:open snap_points={[0.5, 0.92]}>
	<div style="padding: 0 1.5rem 1.5rem;">
		<h3 style="margin: 0 0 0.75rem;">Bottom Sheet</h3>
		<p
			style="margin: 0 0 1rem; color: color-mix(in oklch, var(--color-text), transparent 35%);">
			Drag the handle to resize, flick down to dismiss, or tap the handle to toggle
			between snap points. It opens to the largest snap point by default.
		</p>
		<p
			style="margin: 0 0 1rem; color: color-mix(in oklch, var(--color-text), transparent 35%);">
			The sheet is only ever as tall as its content, and stays centered with a maximum
			width on larger screens.
		</p>
		{#each Array(6) as _, i}
			<div
				style="padding: 0.7rem 0; border-bottom: 1px solid var(--color-border, #2a2a2a);">
				Row {i + 1}
			</div>
		{/each}
		<div style="margin-top: 1rem;">
			<Button outline onclick={() => (open = false)}>Close</Button>
		</div>
	</div>
</BottomSheet>
