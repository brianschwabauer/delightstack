<script>
	import { BottomSheet } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<Button onclick={() => (open = true)}>Open Sheet with Header</Button>

<BottomSheet bind:open snap_points={[0.5, 0.92]}>
	{#snippet header()}
		<div style="padding: 0 1rem 0.75rem; border-bottom: 1px solid var(--color-border, #333);">
			<h3 style="margin: 0; color: var(--color-text, inherit);">Filters</h3>
		</div>
	{/snippet}

	<div style="padding: 1rem;">
		<p style="margin: 0 0 1rem; color: color-mix(in oklch, var(--color-text), transparent 35%);">
			The header above stays fixed and acts as a drag area, while this region scrolls once the sheet
			is fully expanded.
		</p>
		{#each Array(12) as _, i}
			<label
				style="display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0; border-bottom: 1px solid var(--color-border, #2a2a2a);">
				<input type="checkbox" />
				Option {i + 1}
			</label>
		{/each}
		<div style="margin-top: 1rem;">
			<Button outline onclick={() => (open = false)}>Close</Button>
		</div>
	</div>
</BottomSheet>
