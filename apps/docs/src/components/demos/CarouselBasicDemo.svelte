<script lang="ts">
	import { Button, Carousel } from '@delightstack/components';
	import { featuredImages } from './_gallery-images';

	let slide = $state(0);
</script>

<div class="full-width">
	<div class="frame">
		<Carousel items={featuredImages} bind:slide inline dismissable={false} fit="cover" />
	</div>

	<div class="controls">
		<Button
			size="1"
			transparent
			onclick={() =>
				(slide = (slide - 1 + featuredImages.length) % featuredImages.length)}>
			‹ Prev
		</Button>
		<span class="pos">{slide + 1} / {featuredImages.length}</span>
		<Button
			size="1"
			transparent
			onclick={() => (slide = (slide + 1) % featuredImages.length)}>
			Next ›
		</Button>
	</div>
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
	.controls {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		margin-top: 0.75rem;
	}
	.pos {
		font-family: var(--font-mono, monospace);
		font-size: 0.85rem;
		color: var(--color-text-disabled, currentColor);
		min-width: 4ch;
		text-align: center;
	}
</style>
