<script lang="ts">
	import Panorama from '@delightstack/components/panorama';
	import type { PanoramaHotspot } from '@delightstack/components';

	const hotspots: PanoramaHotspot[] = [
		{ position: { pitch: 0, yaw: 0 }, label: 'Summit' },
		{ position: { pitch: -10, yaw: 90 }, label: 'East ridge' },
		{ position: { pitch: -15, yaw: 180 }, label: 'Valley floor' },
		{ position: { pitch: -5, yaw: 270 }, label: 'West face' },
	];

	let last_clicked = $state<string | null>(null);
</script>

<div class="full-width">
	<div class="frame">
		<Panorama
			src="https://pannellum.org/images/cerro-toco-0.jpg"
			{hotspots}
			onhotspotclick={({ hotspot }) => (last_clicked = hotspot.label ?? null)} />
	</div>
	<p class="hint">
		{#if last_clicked}
			You clicked <strong>{last_clicked}</strong>.
		{:else}
			Click a labelled hotspot.
		{/if}
	</p>
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
	.frame {
		aspect-ratio: 16 / 9;
		border-radius: 0.5rem;
		overflow: hidden;
		background: var(--color-bg-2, rgba(0, 0, 0, 0.06));
	}
	.hint {
		font-size: 0.78rem;
		color: var(--color-text-disabled, currentColor);
		text-align: center;
		margin: 0.75rem 0 0;
		opacity: 0.75;
	}
</style>
