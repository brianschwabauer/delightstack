<script lang="ts">
	import {
		Button,
		ButtonGroup,
		Gallery,
		type GallerySize,
	} from '@delightstack/components';
	import { demoImages } from './_gallery-images';

	let size = $state<GallerySize>('0');
	const sizes: GallerySize[] = ['00', '0', '1', '2', '3'];
</script>

<div class="full-width">
	<ButtonGroup>
		{#each sizes as s (s)}
			<Button
				size="0"
				transparent
				active={size === s}
				onclick={() => (size = s)}>
				{s}
			</Button>
		{/each}
	</ButtonGroup>

	<div class="spacer"></div>

	<Gallery items={demoImages} display="masonry" {size} />
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
	.spacer {
		height: 0.75rem;
	}
</style>
