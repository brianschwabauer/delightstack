<script lang="ts">
	import { Button, Gallery, type GalleryItem } from '@delightstack/components';

	const items: GalleryItem[] = [
		{
			id: 'plain-image-1',
			type: 'image',
			src: 'https://picsum.photos/seed/delight-custom-a/1600/1000',
			width: 1600,
			height: 1000,
			name: 'Before',
		},
		{
			id: 'custom-counter',
			type: 'custom',
			src: '',
			width: 1600,
			height: 1000,
			name: 'Interactive counter',
			caption:
				'Custom slide with disable_swipe so horizontal drag stays inside the widget.',
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

	let gallery = $state<ReturnType<typeof Gallery>>();
	let count = $state(0);
</script>

<div class="full-width">
	<div class="controls">
		<Button size="1" transparent onclick={() => gallery?.open(0)}>Open at image</Button>
		<Button size="1" transparent onclick={() => gallery?.open(1)}>
			Open at custom slide
		</Button>
	</div>
	<p class="hint">
		The Gallery is in <code>display="lightbox"</code>
		mode (no thumbnails) since
		<code>type: 'custom'</code>
		items don't have a thumbnail representation. Open the modal using the buttons above. On
		the custom slide, drag the slider horizontally — the carousel won't try to swipe to the
		next slide.
	</p>

	<Gallery bind:this={gallery} {items} display="lightbox">
		{#snippet custom({ item, active, gesture_disabled })}
			<div class="custom-slide" class:active>
				<div class="custom-card">
					<div class="custom-label">{item.name}</div>
					<div class="custom-count">{count}</div>
					<div class="custom-actions">
						<button onclick={() => count--}>−</button>
						<button onclick={() => (count = 0)}>reset</button>
						<button onclick={() => count++}>+</button>
					</div>
					<div class="custom-hint">
						active = <code>{String(active)}</code>
						· gesture_disabled =
						<code>{String(gesture_disabled)}</code>
					</div>
				</div>
			</div>
		{/snippet}
	</Gallery>
</div>

<style>
	.full-width {
		width: 100%;
		display: block;
	}
	.controls {
		display: flex;
		gap: 0.5rem;
		justify-content: center;
		margin-bottom: 0.75rem;
	}
	.hint {
		font-size: 0.78rem;
		color: var(--color-text-disabled, currentColor);
		text-align: center;
		margin: 0 0 0.75rem;
		opacity: 0.75;
		line-height: 1.5;
		code {
			font-family: var(--font-mono, monospace);
			background: var(--color-bg-2, rgba(0, 0, 0, 0.06));
			padding: 0.05rem 0.3rem;
			border-radius: 3px;
		}
	}
	.custom-slide {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, #1e293b, #0f172a);
		color: white;
	}
	.custom-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		padding: 2rem 3rem;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 1rem;
		text-align: center;
	}
	.custom-label {
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		opacity: 0.6;
	}
	.custom-count {
		font-size: 4rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}
	.custom-actions {
		display: flex;
		gap: 0.5rem;
		button {
			all: unset;
			padding: 0.4rem 1rem;
			background: rgba(255, 255, 255, 0.08);
			border-radius: 0.4rem;
			cursor: pointer;
			font-family: inherit;
			&:hover {
				background: rgba(255, 255, 255, 0.16);
			}
		}
	}
	.custom-hint {
		font-size: 0.7rem;
		opacity: 0.5;
		code {
			font-family: var(--font-mono, monospace);
		}
	}
</style>
