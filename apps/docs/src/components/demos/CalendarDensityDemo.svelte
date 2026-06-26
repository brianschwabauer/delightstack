<script>
	import { Calendar } from '@delightstack/components/display';

	let denseDate = $state(undefined);
	let comfortableDate = $state(undefined);
</script>

<div class="density-grid">
	<div class="density-col">
		<span class="density-label">Dense</span>
		<Calendar bind:value={denseDate} outline dense />
	</div>
	<div class="density-col">
		<span class="density-label">Comfortable</span>
		<Calendar bind:value={comfortableDate} outline comfortable />
	</div>
</div>

<style>
	.density-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 2rem;
		align-items: flex-start;
	}
	.density-col {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.density-label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--color-text-muted, hsl(0 0% 45%));
	}
</style>
