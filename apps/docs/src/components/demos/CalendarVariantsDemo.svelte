<script>
	import { Calendar } from '@delightstack/components/display';

	let plainDate = $state(undefined);
	let filledDate = $state(undefined);
	let outlineDate = $state(undefined);
</script>

<div class="variant-grid">
	<div class="variant-col">
		<span class="variant-label">Default (transparent)</span>
		<Calendar bind:value={plainDate} />
	</div>
	<div class="variant-col">
		<span class="variant-label">Filled</span>
		<Calendar bind:value={filledDate} filled />
	</div>
	<div class="variant-col">
		<span class="variant-label">Outline</span>
		<Calendar bind:value={outlineDate} outline />
	</div>
</div>

<style>
	.variant-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 2rem;
		align-items: flex-start;
	}
	.variant-col {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.variant-label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted, hsl(0 0% 45%));
	}
</style>
