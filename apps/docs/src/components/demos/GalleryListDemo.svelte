<script lang="ts">
	import {
		Button,
		ButtonGroup,
		Gallery,
		type GallerySize,
		type GalleryRadius,
	} from '@delightstack/components';
	import { demoImages } from './_gallery-images';

	let size = $state<GallerySize>('1');
	let radius = $state<GalleryRadius>('1');
	const sizes: GallerySize[] = ['00', '0', '1', '2', '3'];
	const radii: GalleryRadius[] = ['0', '1', '2', '3'];
</script>

<div class="full-width">
	<div class="control-row">
		<span class="control-label">Size</span>
		<ButtonGroup>
			{#each sizes as s (s)}
				<Button size="0" transparent active={size === s} onclick={() => (size = s)}>
					{s}
				</Button>
			{/each}
		</ButtonGroup>
	</div>

	<div class="control-row">
		<span class="control-label">Radius</span>
		<ButtonGroup>
			{#each radii as r (r)}
				<Button size="0" transparent active={radius === r} onclick={() => (radius = r)}>
					{r}
				</Button>
			{/each}
		</ButtonGroup>
	</div>

	<div class="spacer"></div>

	<Gallery items={demoImages} display="list" {size} {radius} />
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
	.control-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}
	.control-label {
		font-size: 0.85rem;
		font-weight: 600;
		min-width: 3.5rem;
	}
	.spacer {
		height: 0.75rem;
	}
</style>
