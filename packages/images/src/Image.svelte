<script lang="ts" module>
	export { decodeThumbHash, imageURL } from './image-helpers';
</script>

<script lang="ts">
	import { decodeThumbHash } from './image-helpers';

	const is_browser = typeof window !== 'undefined';

	interface Props {
		image: {
			id: string;
			processing_status: string;
			file_name: string | null;
			alt_text: string | null;
			width: number | null;
			height: number | null;
			aspect_ratio: number | null;
			thumbhash: string | null;
			background_color_l: number | null;
			background_color_c: number | null;
			background_color_h: number | null;
			variants: { name: string; width: number; height: number; watermarked?: boolean }[] | string | null;
		};
		alt?: string;
		fit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
		loading?: 'lazy' | 'eager';
		ssr_placeholder?: boolean;
		sizes?: string;
		cdn_prefix?: string;
		onload?: () => void;
		class?: string;
		style?: string;
	}

	let {
		image,
		alt,
		fit = 'cover',
		loading = 'lazy',
		ssr_placeholder = false,
		sizes = '100vw',
		cdn_prefix = '/cdn/image',
		onload,
		class: className = '',
		style = '',
	}: Props = $props();

	// Alt text: explicit prop → image.alt_text from DB → file_name without extension → empty string
	const alt_text = $derived(
		alt ?? image.alt_text ?? image.file_name?.replace(/\.[^.]+$/, '') ?? '',
	);

	// Parse variants from JSON string or use directly
	const variants = $derived.by(() => {
		if (!image.variants) return [];
		if (typeof image.variants !== 'string') return image.variants;
		try {
			return JSON.parse(image.variants);
		} catch {
			return [];
		}
	});

	// srcset: all non-original, non-watermarked variants, ascending by width
	const srcset = $derived(
		variants
			.filter((v: { name: string; watermarked?: boolean }) => v.name !== 'original' && !v.watermarked)
			.sort((a: { width: number }, b: { width: number }) => a.width - b.width)
			.map(
				(v: { name: string; width: number }) =>
					`${cdn_prefix}/${image.id}/${v.name} ${v.width}w`,
			)
			.join(', '),
	);

	// Fallback src: largest non-original, non-watermarked variant
	const src = $derived.by(() => {
		const best = variants
			.filter((v: { name: string; watermarked?: boolean }) => v.name !== 'original' && !v.watermarked)
			.sort((a: { width: number }, b: { width: number }) => b.width - a.width)[0];
		return `${cdn_prefix}/${image.id}/${best?.name ?? 'default'}`;
	});

	// Background color for immediate placeholder (CSS only, no JS needed)
	const bg_color = $derived(
		image.background_color_l != null
			? `oklch(${image.background_color_l} ${image.background_color_c} ${image.background_color_h})`
			: undefined,
	);

	// ThumbHash placeholder:
	// ssr_placeholder=true  → decoded on server + client (in the initial HTML)
	// ssr_placeholder=false → decoded on client only (after JS hydrates)
	const placeholder = $derived.by(() => {
		if (!image.thumbhash) return null;
		if (!ssr_placeholder && !is_browser) return null;
		return decodeThumbHash(image.thumbhash);
	});

	let img_el = $state<HTMLImageElement>();
	let loaded = $state(false);
	let instant = $state(false);
	let error_count = $state(0);
	let retry_timer: ReturnType<typeof setTimeout>;

	// Detect cached images — skip the fade transition
	$effect(() => {
		if (img_el?.complete && img_el.naturalWidth > 0) {
			loaded = true;
			instant = true;
		}
	});

	function handleLoad() {
		loaded = true;
		onload?.();
	}

	function handleError() {
		if (error_count >= 3) return;
		error_count++;
		clearTimeout(retry_timer);
		retry_timer = setTimeout(() => {
			if (loaded || !img_el) return;
			const current = img_el.src;
			img_el.src = '';
			img_el.src = current;
		}, error_count ** 2 * 1000); // 1s, 4s, 9s
	}

	$effect(() => () => clearTimeout(retry_timer));

	const is_ready = $derived(image.processing_status === 'processed');
	const is_failed = $derived(image.processing_status === 'failed');
</script>

<div
	class="image {className}"
	style:background-color={bg_color}
	style:aspect-ratio={image.aspect_ratio ?? undefined}
	{style}>
	{#if placeholder && !loaded}
		<img
			class="placeholder"
			src={placeholder}
			alt=""
			aria-hidden="true"
			style:object-fit={fit} />
	{/if}
	{#if is_failed}
		<div class="failed" role="img" aria-label="Image failed to process">
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24">
				<rect x="3" y="3" width="18" height="18" rx="2" />
				<circle cx="8.5" cy="8.5" r="1.5" />
				<path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
				<line x1="4" y1="4" x2="20" y2="20" />
			</svg>
		</div>
	{:else if is_ready}
		<img
			bind:this={img_el}
			class="main"
			class:loaded
			class:instant
			{src}
			srcset={srcset || undefined}
			{sizes}
			alt={alt_text}
			width={image.width ?? undefined}
			height={image.height ?? undefined}
			{loading}
			style:object-fit={fit}
			onload={handleLoad}
			onerror={handleError} />
	{/if}
</div>

<style>
	.image {
		position: relative;
		overflow: hidden;
	}

	.placeholder {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		filter: blur(20px);
		transform: scale(1.1); /* hide blurred edges */
		z-index: 1;
		pointer-events: none;
	}

	.main {
		display: block;
		width: 100%;
		height: 100%;
		position: relative;
		z-index: 2;
		opacity: 0;
		transition: opacity 300ms ease;
	}

	.loaded {
		opacity: 1;
	}

	/* Skip transition for cached images */
	.instant {
		transition: none;
	}

	.failed {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: oklch(0.55 0 0);
		z-index: 2;
	}
</style>
