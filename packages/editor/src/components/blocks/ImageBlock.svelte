<script lang="ts">
	import { Button } from '@delightstack/components';
	import type { BlockProps } from '../../types/index.js';

	type ImageAttrs = {
		src: string;
		srcset: string | null;
		image_id: string | null;
		alt: string;
		caption: string;
		width: number | null;
		height: number | null;
		aspect_ratio: number | null;
		thumbhash: string | null;
		background_color: string | null;
		width_pct: number | null;
		uploading: boolean;
		upload_id: string | null;
		blob_url: string | null;
		upload_error: string | null;
		block_id: string | null;
	};

	let { attrs, editor, delete_node }: BlockProps<ImageAttrs> = $props();

	const upload = $derived(
		attrs.upload_id
			? editor.uploads.find((entry) => entry.upload_id === attrs.upload_id)
			: undefined,
	);
	const progress = $derived(upload?.progress ?? 0);
	const aspect_ratio = $derived(
		attrs.aspect_ratio ??
			(attrs.width && attrs.height ? attrs.width / attrs.height : undefined),
	);
</script>

<figure class="image" style:aspect-ratio={aspect_ratio}>
	{#if attrs.upload_error}
		<div class="error" contenteditable="false">
			<span>Upload failed{upload?.error ? `: ${upload.error}` : ''}</span>
			<Button dense transparent error size="0" onclick={() => delete_node()}>
				Remove
			</Button>
		</div>
	{:else if attrs.uploading && attrs.blob_url}
		<img
			src={attrs.blob_url}
			alt={attrs.alt}
			class="uploading"
			draggable="false"
			data-resize-anchor />
		<div class="progress" contenteditable="false" aria-label="Uploading">
			<span class="ring" style:--sweep="{Math.round(progress * 360)}deg"></span>
		</div>
	{:else if attrs.src}
		<img
			src={attrs.src}
			srcset={attrs.srcset || undefined}
			alt={attrs.alt}
			width={attrs.width || undefined}
			height={attrs.height || undefined}
			style:background-color={attrs.background_color || undefined}
			draggable="false"
			data-resize-anchor />
	{/if}
	{#if attrs.caption && !attrs.uploading}
		<figcaption>{attrs.caption}</figcaption>
	{/if}
</figure>

<style>
	.image {
		position: relative;
		margin: 0;

		img {
			display: block;
			inline-size: 100%;
			block-size: auto;
			border-radius: var(--radius, 8px);

			@supports (corner-shape: squircle) {
				corner-shape: squircle;
				border-radius: calc(var(--radius, 8px) * var(--squircle-ratio, 2));
			}
		}

		img.uploading {
			filter: blur(1px) brightness(0.85);
		}
	}

	.progress {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		pointer-events: none;
	}

	.ring {
		inline-size: 3rem;
		block-size: 3rem;
		border-radius: 50%;
		background: conic-gradient(
			white var(--sweep, 0deg),
			rgb(255 255 255 / 25%) var(--sweep, 0deg)
		);
		mask: radial-gradient(
			farthest-side,
			transparent calc(100% - 5px),
			black calc(100% - 4px)
		);
		filter: drop-shadow(0 1px 4px rgb(0 0 0 / 40%));
		transition: --sweep 200ms ease;
	}

	.error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.875rem 1rem;
		border-radius: var(--radius, 8px);
		background: color-mix(in oklab, var(--color-error, #ef4444) 10%, transparent);
		border: 1px solid color-mix(in oklab, var(--color-error, #ef4444) 35%, transparent);
		color: var(--color-text);
		font-size: 0.875rem;
	}

	figcaption {
		margin-block-start: 0.375rem;
		font-size: 0.8125rem;
		color: var(--color-text-muted);
		text-align: center;
	}
</style>
