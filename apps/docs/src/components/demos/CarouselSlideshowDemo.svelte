<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Button, Carousel } from '@delightstack/components';
	import { featuredImages } from './_gallery-images';

	let slide = $state(0);
	let playing = $state(true);
	let timer: ReturnType<typeof setInterval> | undefined;

	function start() {
		stop();
		timer = setInterval(() => {
			slide = (slide + 1) % featuredImages.length;
		}, 4000);
	}
	function stop() {
		if (timer) clearInterval(timer);
		timer = undefined;
	}

	$effect(() => {
		if (playing) start();
		else stop();
	});
	onDestroy(stop);
</script>

<div class="full-width">
	<div class="frame">
		<Carousel
			items={featuredImages}
			bind:slide
			transition="fade"
			animation="zoom"
			inline
			dismissable={false}
			fit="cover" />
	</div>

	<div class="controls">
		<Button transparent active={playing} onclick={() => (playing = !playing)}>
			{playing ? 'Pause' : '▶ Play'}
		</Button>
		<span class="pos">{slide + 1} / {featuredImages.length}</span>
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
