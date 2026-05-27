<script lang="ts">
	import { Gallery, pickLargestSrc } from '@delightstack/components';
	import { demoImages } from './_gallery-images';

	let gallery = $state<ReturnType<typeof Gallery>>();
</script>

<div class="full-width">
	<p class="caption">
		The Gallery renders nothing of its own here — the thumbnail layout below is plain HTML
		on this page. Clicking a tile calls
		<code>gallery.open(index, event.currentTarget)</code>
		which opens the carousel anchored to that tile.
	</p>

	<div class="thumbs">
		{#each demoImages as item, i (typeof item === 'string' ? i : (item.id ?? i))}
			{@const img = typeof item === 'string' ? { src: item, alt: '' } : item}
			<button
				type="button"
				class="thumb"
				onclick={(e) => gallery?.open(i, e.currentTarget)}>
				<img src={pickLargestSrc(img.src ?? '')} alt={img.alt ?? ''} />
			</button>
		{/each}
	</div>

	<Gallery bind:this={gallery} items={demoImages} display="lightbox" />
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
	.caption {
		font-size: 0.85rem;
		color: var(--color-text-disabled, currentColor);
		margin: 0 0 1rem;
		code {
			font-family: var(--font-mono, monospace);
			background: var(--color-bg-2, rgba(0, 0, 0, 0.06));
			padding: 0.05rem 0.3rem;
			border-radius: 3px;
		}
	}
	.thumbs {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: 0.5rem;
	}
	.thumb {
		all: unset;
		display: block;
		aspect-ratio: 1;
		border-radius: 0.5rem;
		overflow: hidden;
		cursor: pointer;
		position: relative;
		transition:
			transform 150ms ease,
			box-shadow 150ms ease;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
		img {
			width: 100%;
			height: 100%;
			object-fit: cover;
			display: block;
		}
		&:hover {
			transform: translateY(-2px);
			box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
		}
		&:focus-visible {
			outline: 2px solid var(--color-action, currentColor);
			outline-offset: 2px;
		}
	}
</style>
