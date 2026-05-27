<script lang="ts">
	import {
		Button,
		ButtonGroup,
		Gallery,
		type GallerySize,
	} from '@delightstack/components';
	import { demoImages } from './_gallery-images';

	let sizing = $state<GallerySize>('small');
	const sizes: GallerySize[] = ['small', 'default', 'large'];
</script>

<div class="full-width">
	<ButtonGroup>
		{#each sizes as size (size)}
			<Button
				size="0"
				transparent
				active={sizing === size}
				onclick={() => (sizing = size)}>
				{size}
			</Button>
		{/each}
	</ButtonGroup>

	<div class="spacer"></div>

	<Gallery items={demoImages} display="masonry" {sizing} />
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
