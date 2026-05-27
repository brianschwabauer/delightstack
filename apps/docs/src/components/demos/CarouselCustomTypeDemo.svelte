<script lang="ts">
	import { Button, Carousel, type CarouselItem } from '@delightstack/components';

	const items: CarouselItem[] = [
		{
			id: 'plain-image',
			type: 'image',
			src: 'https://picsum.photos/seed/delight-custom-a/1600/1000',
			width: 1600,
			height: 1000,
			name: 'Before',
		},
		{
			id: 'custom-color',
			type: 'custom',
			src: '',
			width: 1600,
			height: 1000,
			name: 'Color picker',
			// Horizontal pointer input belongs to the color slider — the carousel
			// won't try to claim it as a swipe-to-next-slide gesture.
			disable_swipe: true,
		},
		{
			id: 'plain-image-2',
			type: 'image',
			src: 'https://picsum.photos/seed/delight-custom-b/1600/1000',
			width: 1600,
			height: 1000,
			name: 'After',
		},
	];

	let slide = $state(0);
	let hue = $state(200);
</script>

<div class="full-width">
	<div class="frame">
		<Carousel {items} bind:slide inline dismissable={false} fit="cover">
			{#snippet custom({ item, active, gesture_disabled })}
				<div
					class="custom-slide"
					class:active
					style:background="hsl({hue} 70% 35%)">
					<div class="custom-card">
						<div class="custom-label">{item.name}</div>
						<div class="custom-hue">hsl({hue} 70% 35%)</div>
						<input
							type="range"
							min="0"
							max="360"
							bind:value={hue}
							aria-label="Hue" />
						<div class="custom-hint">
							gesture_disabled = <code>{String(gesture_disabled)}</code>
						</div>
					</div>
				</div>
			{/snippet}
		</Carousel>
	</div>

	<div class="controls">
		<Button
			size="1"
			transparent
			onclick={() => (slide = (slide - 1 + items.length) % items.length)}>
			‹ Prev
		</Button>
		<span class="pos">{slide + 1} / {items.length}</span>
		<Button
			size="1"
			transparent
			onclick={() => (slide = (slide + 1) % items.length)}>
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
	.custom-slide {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		transition: background 200ms ease;
	}
	.custom-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		padding: 2rem 3rem;
		background: rgba(0, 0, 0, 0.25);
		border: 1px solid rgba(255, 255, 255, 0.18);
		border-radius: 1rem;
		text-align: center;
		min-width: 280px;
	}
	.custom-label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		opacity: 0.75;
	}
	.custom-hue {
		font-family: var(--font-mono, monospace);
		font-size: 1.1rem;
	}
	input[type='range'] {
		width: 100%;
	}
	.custom-hint {
		font-size: 0.7rem;
		opacity: 0.7;
		code {
			font-family: var(--font-mono, monospace);
		}
	}
</style>
