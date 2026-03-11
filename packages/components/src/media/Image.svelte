<script lang="ts">
	type ImageState = 'loading' | 'loaded' | 'error';

	let {
		/** The image source URL (required) */
		src,

		/** The alt text for the image (required) */
		alt,

		/** The intrinsic width of the image in pixels */
		width = undefined as number | undefined,

		/** The intrinsic height of the image in pixels */
		height = undefined as number | undefined,

		/** The aspect ratio of the container (e.g. '16/9') to prevent CLS */
		aspect_ratio = undefined as string | undefined,

		/** How the image should be scaled within its container */
		fit = 'cover' as 'cover' | 'contain' | 'fill' | 'none',

		/** The position of the image within its container */
		position = 'center',

		/** Whether the image should be lazily loaded */
		lazy = true,

		/** A small placeholder image URL for the blur-up effect */
		placeholder = undefined as string | undefined,

		/** Error fallback: true = built-in broken-image SVG, string = fallback image URL, false = disabled */
		fallback = false as string | boolean,

		/** Responsive srcset attribute passed through to the img element */
		srcset = undefined as string | undefined,

		/** Responsive sizes attribute passed through to the img element */
		sizes = undefined as string | undefined,

		/** Whether to show a skeleton shimmer animation while loading */
		skeleton = false,

		/** The ID of the element */
		id = undefined as string | undefined,

		/** Specifies a custom class name for the container element */
		class: className = '',

		/** A bindable reference to the root HTML element */
		element = $bindable(undefined as HTMLElement | undefined),

		/** Callback fired when the full image loads */
		onload = undefined as
			| undefined
			| ((detail: { natural_width: number; natural_height: number }) => void),

		/** Callback fired when the image fails to load */
		onerror = undefined as undefined | ((detail: { error: Event }) => void),
	}: {
		src: string;
		alt: string;
		width?: number;
		height?: number;
		aspect_ratio?: string;
		fit?: 'cover' | 'contain' | 'fill' | 'none';
		position?: string;
		lazy?: boolean;
		placeholder?: string;
		fallback?: string | boolean;
		srcset?: string;
		sizes?: string;
		skeleton?: boolean;
		id?: string;
		class?: string;
		element?: HTMLElement | undefined;
		onload?: (detail: { natural_width: number; natural_height: number }) => void;
		onerror?: (detail: { error: Event }) => void;
	} = $props();

	let state = $state<ImageState>('loading');

	const has_placeholder = $derived(!!placeholder);
	const show_skeleton = $derived(skeleton && state === 'loading' && !has_placeholder);
	const show_placeholder = $derived(has_placeholder && state === 'loading');
	const show_image = $derived(state === 'loaded');
	const show_fallback = $derived(state === 'error' && fallback !== false);

	const fallback_is_url = $derived(typeof fallback === 'string');

	const container_style = $derived.by(() => {
		const parts: string[] = [];
		if (aspect_ratio) parts.push(`aspect-ratio: ${aspect_ratio}`);
		if (width) parts.push(`width: ${width}px`);
		if (height && !aspect_ratio) parts.push(`height: ${height}px`);
		return parts.join('; ') || undefined;
	});

	function handleLoad(e: Event) {
		state = 'loaded';
		if (onload) {
			const img = e.target as HTMLImageElement;
			onload({
				natural_width: img.naturalWidth,
				natural_height: img.naturalHeight,
			});
		}
	}

	function handleError(e: Event) {
		state = 'error';
		if (onerror) {
			onerror({ error: e });
		}
	}

	/** Reset state when src changes */
	$effect(() => {
		// Track src to re-run when it changes
		void src;
		state = 'loading';
	});
</script>

<div
	{id}
	class={['ds-image', className].filter(Boolean).join(' ')}
	style={container_style}
	bind:this={element}>
	<!-- Skeleton shimmer -->
	{#if show_skeleton}
		<div class="ds-image-skeleton"></div>
	{/if}

	<!-- Blur-up placeholder -->
	{#if has_placeholder}
		<img
			class="ds-image-placeholder"
			class:fade-out={state === 'loaded'}
			src={placeholder}
			alt=""
			aria-hidden="true"
			style:object-fit={fit}
			style:object-position={position} />
	{/if}

	<!-- Main image -->
	{#if state !== 'error'}
		<img
			class="ds-image-main"
			class:visible={show_image}
			{src}
			{alt}
			{width}
			{height}
			{srcset}
			{sizes}
			loading={lazy ? 'lazy' : 'eager'}
			style:object-fit={fit}
			style:object-position={position}
			onload={handleLoad}
			onerror={handleError} />
	{/if}

	<!-- Error fallback -->
	{#if show_fallback}
		{#if fallback_is_url}
			<img
				class="ds-image-fallback-img"
				src={fallback as string}
				{alt}
				style:object-fit={fit}
				style:object-position={position} />
		{:else}
			<div class="ds-image-fallback">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="ds-image-fallback-icon"
					aria-hidden="true">
					<rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
					<circle cx="8.5" cy="8.5" r="1.5" />
					<polyline points="21 15 16 10 5 21" />
					<line x1="2" y1="2" x2="22" y2="22" />
				</svg>
			</div>
		{/if}
	{/if}
</div>

<style>
	.ds-image {
		position: relative;
		overflow: hidden;
		display: block;
		width: 100%;
	}

	/* Skeleton shimmer */
	.ds-image-skeleton {
		position: absolute;
		inset: 0;
		z-index: 1;
		background: linear-gradient(
			90deg,
			var(--color-surface-2, rgba(128, 128, 128, 0.1)) 25%,
			var(--color-surface-3, rgba(128, 128, 128, 0.2)) 50%,
			var(--color-surface-2, rgba(128, 128, 128, 0.1)) 75%
		);
		background-size: 200% 100%;
		animation: ds-image-shimmer 1.5s ease-in-out infinite;
	}

	@keyframes ds-image-shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}

	/* Blur-up placeholder */
	.ds-image-placeholder {
		position: absolute;
		inset: 0;
		z-index: 2;
		width: 100%;
		height: 100%;
		filter: blur(20px);
		transform: scale(1.1);
		opacity: 1;
		transition:
			opacity 300ms ease,
			filter 300ms ease;
	}

	.ds-image-placeholder.fade-out {
		opacity: 0;
		filter: blur(0px);
	}

	/* Main image */
	.ds-image-main {
		display: block;
		width: 100%;
		height: 100%;
		opacity: 0;
		transition: opacity 300ms ease;
	}

	.ds-image-main.visible {
		opacity: 1;
	}

	/* Fallback image (URL) */
	.ds-image-fallback-img {
		display: block;
		width: 100%;
		height: 100%;
	}

	/* Fallback icon container */
	.ds-image-fallback {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: var(--color-surface-2, rgba(128, 128, 128, 0.1));
		color: var(--color-text-secondary, rgba(128, 128, 128, 0.6));
	}

	.ds-image-fallback-icon {
		width: 2.5em;
		height: 2.5em;
	}
</style>
