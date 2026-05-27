<script lang="ts">
	import { Button, Carousel } from '@delightstack/components';
	import { richMediaItems } from './_gallery-rich-media';

	let slide = $state(0);
	let page = $state(0);
	let num_pages = $state(1);
</script>

<div class="full-width">
	<div class="frame">
		<Carousel
			items={richMediaItems}
			bind:slide
			bind:page
			bind:num_pages
			inline
			dismissable={false}
			fit="contain" />
	</div>

	<div class="controls">
		<Button
			size="1"
			transparent
			onclick={() =>
				(slide = (slide - 1 + richMediaItems.length) % richMediaItems.length)}>
			‹ Prev
		</Button>
		<span class="pos">
			{slide + 1} / {richMediaItems.length}
			{#if num_pages > 1}
				<span class="page-pos">· page {page + 1} / {num_pages}</span>
			{/if}
		</span>
		<Button
			size="1"
			transparent
			onclick={() => (slide = (slide + 1) % richMediaItems.length)}>
			Next ›
		</Button>
	</div>

	<p class="hint">
		Try: swipe up/down on the PDF to flip pages · drag the panorama to look around · press
		space on the video to play/pause · then advance — the video pauses automatically.
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
		min-width: 8ch;
		text-align: center;
	}
	.page-pos {
		opacity: 0.7;
	}
	.hint {
		font-size: 0.78rem;
		color: var(--color-text-disabled, currentColor);
		text-align: center;
		margin: 0.75rem 0 0;
		opacity: 0.75;
		line-height: 1.5;
	}
</style>
