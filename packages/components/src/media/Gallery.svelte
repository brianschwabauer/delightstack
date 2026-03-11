<script lang="ts" module>
	export interface GalleryImage {
		src: string;
		thumbnail?: string;
		alt: string;
		caption?: string;
		width?: number;
		height?: number;
	}
</script>

<script lang="ts">
	import { type Snippet } from 'svelte';
	import Modal from '../actions/Modal.svelte';
	import Image from './Image.svelte';

	const propId = $props.id();
	let {
		/** Array of gallery images */
		images = [] as GalleryImage[],

		/** Number of columns in the grid */
		columns = 3,

		/** Gap between grid items */
		gap = '0.5rem',

		/** Use CSS columns masonry layout instead of grid */
		masonry = false,

		/** Thumbnail aspect ratio (e.g. '1', '4/3'); omit for natural ratio */
		aspect_ratio = undefined as string | undefined,

		/** Enable lightbox on click */
		lightbox = true,

		/** Compact grid gap (0.25rem) */
		dense = false,

		/** Relaxed grid gap (1rem) */
		comfortable = false,

		/** Show loading skeleton */
		skeleton = false,

		/** Number of skeleton items to render */
		skeletonCount = 6,

		/** Element ID */
		id = propId,

		/** Additional CSS classes */
		class: className = '',

		/** Bind to the underlying DOM element */
		element = $bindable(undefined as HTMLElement | undefined),

		/** Custom render snippet for each grid item */
		item = undefined as undefined | Snippet<[image: GalleryImage, index: number]>,

		/** Fired when an image is clicked */
		onselect = undefined as undefined | ((detail: { image: GalleryImage; index: number }) => void),

		/** Fired when lightbox opens */
		onlightboxopen = undefined as undefined | ((detail: { index: number }) => void),

		/** Fired when lightbox closes */
		onlightboxclose = undefined as undefined | (() => void),
	}: {
		images?: GalleryImage[];
		columns?: number;
		gap?: string;
		masonry?: boolean;
		aspect_ratio?: string;
		lightbox?: boolean;
		dense?: boolean;
		comfortable?: boolean;
		skeleton?: boolean;
		skeletonCount?: number;
		id?: string;
		class?: string;
		element?: HTMLElement | undefined;
		item?: Snippet<[image: GalleryImage, index: number]>;
		onselect?: (detail: { image: GalleryImage; index: number }) => void;
		onlightboxopen?: (detail: { index: number }) => void;
		onlightboxclose?: () => void;
	} = $props();

	let lightbox_open = $state(false);
	let lightbox_index = $state(0);
	let touch_start_x = $state(0);
	let touch_start_y = $state(0);

	const effective_gap = $derived(dense ? '0.25rem' : comfortable ? '1rem' : gap);
	const current_image = $derived(images[lightbox_index] as GalleryImage | undefined);

	function handleImageClick(image: GalleryImage, index: number) {
		onselect?.({ image, index });
		if (lightbox) {
			lightbox_index = index;
			lightbox_open = true;
			onlightboxopen?.({ index });
		}
	}

	function closeLightbox() {
		lightbox_open = false;
		onlightboxclose?.();
	}

	function navigatePrev() {
		if (images.length === 0) return;
		lightbox_index = (lightbox_index - 1 + images.length) % images.length;
	}

	function navigateNext() {
		if (images.length === 0) return;
		lightbox_index = (lightbox_index + 1) % images.length;
	}

	function handleLightboxKeydown(event: KeyboardEvent) {
		if (!lightbox_open) return;
		switch (event.key) {
			case 'ArrowLeft':
				event.preventDefault();
				navigatePrev();
				break;
			case 'ArrowRight':
				event.preventDefault();
				navigateNext();
				break;
			case 'Home':
				event.preventDefault();
				lightbox_index = 0;
				break;
			case 'End':
				event.preventDefault();
				lightbox_index = images.length - 1;
				break;
		}
	}

	function handleTouchStart(event: TouchEvent) {
		const touch = event.touches[0];
		if (!touch) return;
		touch_start_x = touch.clientX;
		touch_start_y = touch.clientY;
	}

	function handleTouchEnd(event: TouchEvent) {
		const touch = event.changedTouches[0];
		if (!touch) return;
		const dx = touch.clientX - touch_start_x;
		const dy = touch.clientY - touch_start_y;
		const threshold = 50;
		// Only swipe if horizontal movement is greater than vertical
		if (Math.abs(dx) > threshold && Math.abs(dx) > Math.abs(dy)) {
			if (dx < 0) navigateNext();
			else navigatePrev();
		}
	}

	const skeleton_items = $derived(Array.from({ length: skeletonCount }, (_, i) => i));
</script>

<svelte:window onkeydown={handleLightboxKeydown} />

{#if skeleton}
	<div
		{id}
		class={['ds-gallery', masonry ? 'ds-gallery-masonry' : 'ds-gallery-grid', className].filter(Boolean).join(' ')}
		style:--gallery-columns={columns}
		style:--gallery-gap={effective_gap}
		bind:this={element}
		role="list">
		{#each skeleton_items as _, i (i)}
			<div class="ds-gallery-skeleton" role="listitem">
				<div class="ds-gallery-skeleton-shimmer"></div>
			</div>
		{/each}
	</div>
{:else}
	<div
		{id}
		class={['ds-gallery', masonry ? 'ds-gallery-masonry' : 'ds-gallery-grid', className].filter(Boolean).join(' ')}
		style:--gallery-columns={columns}
		style:--gallery-gap={effective_gap}
		bind:this={element}
		role="list">
		{#each images as image, index (index)}
			{#if item}
				<div
					class="ds-gallery-item"
					role="listitem"
					style:aspect-ratio={aspect_ratio}>
					{@render item(image, index)}
				</div>
			{:else}
				<div role="listitem" style:aspect-ratio={aspect_ratio}>
					<button
						class="ds-gallery-item"
						type="button"
						style:aspect-ratio={aspect_ratio}
						onclick={() => handleImageClick(image, index)}
						aria-label={image.alt}>
						<Image
							src={image.thumbnail || image.src}
							alt={image.alt}
							fit="cover"
							lazy={true}
							width={image.width}
							height={image.height}
							aspect_ratio={aspect_ratio} />
						{#if lightbox}
							<div class="ds-gallery-overlay" aria-hidden="true">
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24">
									<circle cx="11" cy="11" r="8" />
									<line x1="21" y1="21" x2="16.65" y2="16.65" />
									<line x1="11" y1="8" x2="11" y2="14" />
									<line x1="8" y1="11" x2="14" y2="11" />
								</svg>
							</div>
						{/if}
					</button>
				</div>
			{/if}
		{/each}
	</div>

	{#if lightbox && current_image}
		<Modal
			bind:open={lightbox_open}
			closable={true}
			maxWidth="95vw"
			maxHeight="95svh"
			class="ds-gallery-lightbox"
			onclose={onlightboxclose}>
			{#snippet children()}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="ds-lightbox-content"
					ontouchstart={handleTouchStart}
					ontouchend={handleTouchEnd}>
					<!-- Counter -->
					<div class="ds-lightbox-counter" aria-live="polite">
						{lightbox_index + 1} of {images.length}
					</div>

					<!-- Close button -->
					<button
						class="ds-lightbox-close"
						type="button"
						aria-label="Close lightbox"
						onclick={closeLightbox}>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="24" height="24">
							<line x1="18" y1="6" x2="6" y2="18" />
							<line x1="6" y1="6" x2="18" y2="18" />
						</svg>
					</button>

					<!-- Previous button -->
					{#if images.length > 1}
						<button
							class="ds-lightbox-nav ds-lightbox-prev"
							type="button"
							aria-label="Previous image"
							onclick={navigatePrev}>
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="32" height="32">
								<polyline points="15 18 9 12 15 6" />
							</svg>
						</button>
					{/if}

					<!-- Image -->
					{#key lightbox_index}
						<div class="ds-lightbox-image-wrapper">
							<img
								class="ds-lightbox-image"
								src={current_image.src}
								alt={current_image.alt}
								style:max-width="100%"
								style:max-height="calc(95svh - 8rem)" />
						</div>
					{/key}

					<!-- Next button -->
					{#if images.length > 1}
						<button
							class="ds-lightbox-nav ds-lightbox-next"
							type="button"
							aria-label="Next image"
							onclick={navigateNext}>
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="32" height="32">
								<polyline points="9 18 15 12 9 6" />
							</svg>
						</button>
					{/if}

					<!-- Caption -->
					{#if current_image.caption}
						<p class="ds-lightbox-caption">{current_image.caption}</p>
					{/if}
				</div>
			{/snippet}
		</Modal>
	{/if}
{/if}

<style>
	/* Grid layout */
	.ds-gallery-grid {
		display: grid;
		grid-template-columns: repeat(var(--gallery-columns, 3), 1fr);
		gap: var(--gallery-gap, 0.5rem);
	}

	/* Masonry layout */
	.ds-gallery-masonry {
		columns: var(--gallery-columns, 3);
		column-gap: var(--gallery-gap, 0.5rem);
	}

	.ds-gallery-masonry > :global(*) {
		break-inside: avoid;
		margin-bottom: var(--gallery-gap, 0.5rem);
	}

	/* Gallery item */
	.ds-gallery-item {
		position: relative;
		overflow: hidden;
		border-radius: var(--radius-sm);
		cursor: pointer;
		border: none;
		padding: 0;
		background: none;
		display: block;
		width: 100%;
	}

	button.ds-gallery-item {
		appearance: none;
		font: inherit;
		color: inherit;
		text-align: inherit;
	}

	.ds-gallery-item :global(.ds-image) {
		display: block;
		width: 100%;
		height: 100%;
		transition: transform var(--duration-fast, 150ms) var(--ease-default, ease);
	}

	.ds-gallery-item:hover :global(.ds-image) {
		transform: scale(1.03);
	}

	/* Hover overlay */
	.ds-gallery-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: color-mix(in srgb, var(--color-surface-invert, #000) 40%, transparent);
		opacity: 0;
		transition: opacity var(--duration-fast, 150ms) var(--ease-default, ease);
		color: #fff;
		pointer-events: none;
	}

	.ds-gallery-item:hover .ds-gallery-overlay {
		opacity: 1;
	}

	.ds-gallery-item:focus-visible {
		outline: 2px solid var(--color-action, #3b82f6);
		outline-offset: 2px;
	}

	/* Skeleton */
	.ds-gallery-skeleton {
		position: relative;
		overflow: hidden;
		border-radius: var(--radius-sm);
		aspect-ratio: 1;
		background-color: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.06));
	}

	.ds-gallery-skeleton-shimmer {
		position: absolute;
		inset: 0;
		background: linear-gradient(
			90deg,
			transparent 25%,
			light-dark(rgba(0, 0, 0, 0.04), rgba(255, 255, 255, 0.04)) 50%,
			transparent 75%
		);
		background-size: 200% 100%;
		animation: ds-gallery-shimmer 1.5s ease-in-out infinite;
	}

	@keyframes ds-gallery-shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}

	/* Lightbox content */
	.ds-lightbox-content {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 300px;
		user-select: none;
		-webkit-user-select: none;
	}

	/* Counter */
	.ds-lightbox-counter {
		position: absolute;
		top: 0;
		left: 50%;
		transform: translateX(-50%);
		color: var(--color-text-muted, #999);
		font-size: 0.875rem;
		padding: 0.25rem 0.75rem;
		border-radius: var(--radius-sm);
		z-index: 2;
		white-space: nowrap;
	}

	/* Close button */
	.ds-lightbox-close {
		position: absolute;
		top: 0;
		right: 0;
		z-index: 2;
		background: none;
		border: none;
		padding: 0.5rem;
		cursor: pointer;
		color: var(--color-text-muted, #999);
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: color var(--duration-fast, 150ms) var(--ease-default, ease);
	}

	.ds-lightbox-close:hover {
		color: var(--color-text, #fff);
	}

	.ds-lightbox-close:focus-visible {
		outline: 2px solid var(--color-action, #3b82f6);
		outline-offset: 2px;
	}

	/* Nav buttons */
	.ds-lightbox-nav {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		z-index: 2;
		background: none;
		border: none;
		padding: 0.5rem;
		cursor: pointer;
		color: var(--color-text-muted, #999);
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		transition: color var(--duration-fast, 150ms) var(--ease-default, ease);
	}

	.ds-lightbox-nav:hover {
		color: var(--color-text, #fff);
	}

	.ds-lightbox-nav:focus-visible {
		outline: 2px solid var(--color-action, #3b82f6);
		outline-offset: 2px;
	}

	.ds-lightbox-prev {
		left: 0;
	}

	.ds-lightbox-next {
		right: 0;
	}

	/* Image wrapper for fade animation */
	.ds-lightbox-image-wrapper {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2rem 3rem;
		animation: ds-lightbox-fade-in var(--duration-fast, 150ms) var(--ease-default, ease);
	}

	@keyframes ds-lightbox-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	.ds-lightbox-image {
		display: block;
		max-width: 100%;
		max-height: calc(95svh - 8rem);
		object-fit: contain;
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-sm);
	}

	/* Caption */
	.ds-lightbox-caption {
		color: var(--color-text-muted, #999);
		font-size: 0.875rem;
		text-align: center;
		margin: 0.5rem 0 0;
		padding: 0 1rem;
		animation: ds-lightbox-caption-in calc(var(--duration-fast, 150ms) * 2) var(--ease-default, ease);
	}

	@keyframes ds-lightbox-caption-in {
		0%,
		50% {
			opacity: 0;
			transform: translateY(4px);
		}
		100% {
			opacity: 1;
			transform: translateY(0);
		}
	}
</style>
