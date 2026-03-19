<script>
	import { BottomSheet } from '@delightstack/components/navigation';
	import { Button } from '@delightstack/components/actions';

	let open = $state(false);
</script>

<Button onclick={() => open = true}>Open Sheet with Header</Button>

<BottomSheet bind:open>
	{#snippet header()}
		<div style="padding: 0.75rem 1rem; border-bottom: 1px solid var(--color-border, #333);">
			<h3 style="margin: 0; color: var(--color-text, inherit);">Filters</h3>
		</div>
	{/snippet}

	<div style="padding: 1rem;">
		<p style="margin: 0 0 1rem; color: var(--color-text-secondary, #666);">Scrollable filter content goes here. The header above stays fixed while this area scrolls.</p>
		<Button outline onclick={() => open = false}>Close</Button>
	</div>
</BottomSheet>
