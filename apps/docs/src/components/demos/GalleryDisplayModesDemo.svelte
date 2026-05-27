<script lang="ts">
	import {
		Button,
		ButtonGroup,
		Gallery,
		type GalleryDisplay,
	} from '@delightstack/components';
	import { demoImages } from './_gallery-images';

	let display = $state<GalleryDisplay>('masonry');

	const modes: Array<{ value: GalleryDisplay; label: string; hint: string }> = [
		{
			value: 'masonry',
			label: 'masonry',
			hint: 'Brick-style packed grid that respects each image’s aspect ratio. Best for varied photo sets.',
		},
		{
			value: 'masonry-row',
			label: 'masonry-row',
			hint: 'Justified rows: images keep their aspect ratio but every row fills the width edge-to-edge.',
		},
		{
			value: 'grid',
			label: 'grid',
			hint: 'Uniform square cells. Images crop to fit. Best when consistency matters more than the original ratio.',
		},
		{
			value: 'list',
			label: 'list',
			hint: 'Vertical list with small thumbnail + name. Compact, scannable, file-manager feel.',
		},
		{
			value: 'slider',
			label: 'slider',
			hint: 'Inline carousel — one image at a time with paging controls.',
		},
		{
			value: 'slideshow',
			label: 'slideshow',
			hint: 'Like slider but optimised for autoplay (try toggling autoplay below).',
		},
		{
			value: 'lightbox',
			label: 'lightbox',
			hint: 'Headless mode — Gallery renders nothing of its own. Use it with your own thumbnails. See the dedicated example further down.',
		},
	];

	const current = $derived(modes.find((m) => m.value === display)!);
</script>

<div class="full-width">
	<ButtonGroup>
		{#each modes as mode (mode.value)}
			<Button
				size="0"
				transparent
				active={display === mode.value}
				onclick={() => (display = mode.value)}>
				{mode.label}
			</Button>
		{/each}
	</ButtonGroup>

	<p class="hint">{current.hint}</p>

	{#if display === 'lightbox'}
		<p class="lightbox-note">
			In <code>display="lightbox"</code>
			the Gallery renders nothing here. See the
			<strong>Lightbox</strong>
			example below for a complete usage.
		</p>
	{:else}
		<Gallery
			items={demoImages}
			{display}
			sizing={display === 'masonry' ? 'small' : 'default'}
			aspect_ratio="16/9" />
	{/if}
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
	.hint {
		margin: 0.75rem 0 1rem;
		font-size: 0.85rem;
		color: var(--color-text-disabled, currentColor);
		min-height: 2.5em;
	}
	.lightbox-note {
		padding: 2rem;
		text-align: center;
		color: var(--color-text-disabled, currentColor);
		border: 1px dashed var(--color-outline, currentColor);
		border-radius: 0.5rem;
		code {
			font-family: var(--font-mono, monospace);
			background: var(--color-bg-2, rgba(0, 0, 0, 0.06));
			padding: 0.1rem 0.3rem;
			border-radius: 3px;
		}
	}
</style>
