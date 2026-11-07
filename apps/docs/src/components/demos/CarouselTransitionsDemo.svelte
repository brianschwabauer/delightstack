<script lang="ts">
	import { Button, ButtonGroup, Carousel } from '@delightstack/components';
	import { featuredImages } from './_gallery-images';

	let slide = $state(0);
	type Transition = 'none' | 'slide' | 'fade';
	let transition = $state<string | number>('slide');
	const transitions: Array<{ value: Transition; label: string }> = [
		{ value: 'none', label: 'None' },
		{ value: 'slide', label: 'Slide' },
		{ value: 'fade', label: 'Fade' },
	];
</script>

<div class="full-width">
	<div class="picker-row">
		<ButtonGroup bind:value={transition} translucent size="0" aria-label="Transition">
			{#each transitions as t (t.value)}
				<Button value={t.value}>{t.label}</Button>
			{/each}
		</ButtonGroup>
	</div>

	<div class="frame">
		<Carousel
			items={featuredImages}
			bind:slide
			transition={transition as Transition}
			inline
			dismissable={false}
			fit="cover" />
	</div>

	<div class="controls">
		<Button
			transparent
			onclick={() =>
				(slide = (slide - 1 + featuredImages.length) % featuredImages.length)}>
			‹ Prev
		</Button>
		<Button transparent onclick={() => (slide = (slide + 1) % featuredImages.length)}>
			Next ›
		</Button>
	</div>
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
	.picker-row {
		display: flex;
		justify-content: center;
		margin-bottom: 0.75rem;
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
</style>
