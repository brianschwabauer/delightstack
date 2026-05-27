<script lang="ts">
	import { decodeThumbHash } from './carousel';

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

		/**
		 * A base64-encoded [ThumbHash](https://evanw.github.io/thumbhash/) used as
		 * a tiny blurred placeholder while the full image loads. The component
		 * decodes this internally. Takes precedence over {@link placeholder}.
		 */
		thumbhash = undefined as string | undefined,

		/** A small placeholder image URL for the blur-up effect (used when no thumbhash) */
		placeholder = undefined as string | undefined,

		/**
		 * A solid background colour painted on the container — paints before any
		 * image data arrives (no JS needed). Useful for SSR where a dominant
		 * colour avoids any flash of empty box even before the thumbhash decodes.
		 * Accepts any CSS colour value.
		 */
		bg_color = undefined as string | undefined,

		/**
		 * Mark this image as above-the-fold for faster initial paint. When true,
		 * the image uses `loading="eager"` + `fetchpriority="high"`.
		 */
		priority = false,

		/**
		 * Retry-on-error. `true` retries 3 times with exponential backoff
		 * (1s, 4s, 9s); a number sets the max retry count; `false` (default)
		 * disables retries and transitions to the error state immediately.
		 */
		retry = false as boolean | number,

		/** Error fallback: true = built-in broken-image SVG, string = fallback image URL, false = disabled */
		fallback = false as string | boolean,

		/** Responsive srcset attribute passed through to the img element */
		srcset = undefined as string | undefined,

		/**
		 * Responsive sizes attribute. If omitted and the image is lazy with a
		 * srcset, defaults to `auto, 100vw` — modern browsers use the actual
		 * rendered width to pick a variant, older browsers fall back to 100vw.
		 */
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
		thumbhash?: string;
		placeholder?: string;
		bg_color?: string;
		priority?: boolean;
		retry?: boolean | number;
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

	let load_state = $state<ImageState>('loading');
	let fading = $state(false);
	let img_el = $state<HTMLImageElement | undefined>(undefined);
	let retry_count = $state(0);
	let retry_timer: ReturnType<typeof setTimeout> | undefined;

	const max_retries = $derived(
		retry === true ? 3 : typeof retry === 'number' ? Math.max(0, retry) : 0,
	);

	const placeholder_src = $derived(
		thumbhash ? decodeThumbHash(thumbhash) : placeholder,
	);
	const has_placeholder = $derived(!!placeholder_src);
	const show_skeleton = $derived(skeleton && load_state === 'loading' && !has_placeholder);
	const show_placeholder = $derived(has_placeholder && load_state !== 'error');
	const show_fallback = $derived(load_state === 'error' && fallback !== false);
	const fallback_is_url = $derived(typeof fallback === 'string');

	const computed_sizes = $derived(
		sizes ?? (lazy && srcset ? 'auto, 100vw' : undefined),
	);
	const computed_loading = $derived(priority ? 'eager' : lazy ? 'lazy' : 'eager');

	const container_style = $derived.by(() => {
		const parts: string[] = [];
		if (aspect_ratio) parts.push(`aspect-ratio: ${aspect_ratio}`);
		if (width) parts.push(`width: ${width}px`);
		if (height && !aspect_ratio) parts.push(`height: ${height}px`);
		if (bg_color) parts.push(`background-color: ${bg_color}`);
		return parts.join('; ') || undefined;
	});

	function handleLoad(e: Event) {
		load_state = 'loaded';
		fading = false;
		retry_count = 0;
		clearTimeout(retry_timer);
		if (onload) {
			const img = e.target as HTMLImageElement;
			onload({
				natural_width: img.naturalWidth,
				natural_height: img.naturalHeight,
			});
		}
	}

	function handleError(e: Event) {
		// Opt-in retry — schedule another attempt with exponential backoff
		// before transitioning to the error state.
		if (retry_count < max_retries) {
			retry_count++;
			clearTimeout(retry_timer);
			const delay = retry_count ** 2 * 1000; // 1s, 4s, 9s, …
			retry_timer = setTimeout(() => {
				if (!img_el || load_state === 'loaded') return;
				const current = img_el.src;
				img_el.src = '';
				img_el.src = current;
			}, delay);
			return;
		}
		load_state = 'error';
		fading = false;
		if (onerror) {
			onerror({ error: e });
		}
	}

	// Reset retry counter when src changes so a new src gets its own retry budget.
	$effect(() => {
		void src;
		retry_count = 0;
		clearTimeout(retry_timer);
	});

	// Cancel any pending retry on unmount.
	$effect(() => () => clearTimeout(retry_timer));

	/**
	 * Sync load_state with the actual `<img>` load load_state. Runs once on mount and again
	 * whenever `src` changes. For cached images, `el.complete` is `true`
	 * synchronously — without this, the SSR/hydration race causes cached images
	 * to stay invisible because the load event fires before Svelte attaches its
	 * onload listener.
	 */
	$effect(() => {
		void src;
		if (!img_el) return;
		if (img_el.complete && img_el.naturalWidth > 0) {
			load_state = 'loaded';
			fading = false;
		} else if (img_el.complete && img_el.naturalWidth === 0) {
			load_state = 'error';
			fading = false;
		} else {
			load_state = 'loading';
			fading = true;
		}
	});
</script>

<div
	{id}
	class={['image', className].filter(Boolean).join(' ')}
	style={container_style}
	bind:this={element}>
	{#if show_skeleton}
		<div class="skeleton"></div>
	{/if}

	{#if show_placeholder}
		<img
			class="placeholder"
			src={placeholder_src}
			alt=""
			aria-hidden="true"
			style:object-fit={fit}
			style:object-position={position} />
	{/if}

	{#if load_state !== 'error'}
		<img
			class="main"
			class:fading
			bind:this={img_el}
			{src}
			{alt}
			{width}
			{height}
			{srcset}
			sizes={computed_sizes}
			loading={computed_loading}
			fetchpriority={priority ? 'high' : undefined}
			style:object-fit={fit}
			style:object-position={position}
			onload={handleLoad}
			onerror={handleError} />
	{/if}

	{#if show_fallback}
		{#if fallback_is_url}
			<img
				class="fallback-img"
				src={fallback as string}
				{alt}
				style:object-fit={fit}
				style:object-position={position} />
		{:else}
			<div class="fallback">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="fallback-icon"
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
	.image {
		position: relative;
		overflow: hidden;
		display: grid;
		width: 100%;
	}

	.image > * {
		grid-row: 1 / 1;
		grid-column: 1 / 1;
	}

	/* Skeleton shimmer */
	.skeleton {
		background: linear-gradient(
			90deg,
			var(--color-surface-2, rgba(128, 128, 128, 0.1)) 25%,
			var(--color-surface-3, rgba(128, 128, 128, 0.2)) 50%,
			var(--color-surface-2, rgba(128, 128, 128, 0.1)) 75%
		);
		background-size: 200% 100%;
		animation: image-shimmer 1.5s ease-in-out infinite;
	}

	@keyframes image-shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}

	/* Blur-up placeholder — always renders underneath the main image so it shows
	   through while the main image is loading, and is covered once it paints. */
	.placeholder {
		display: block;
		width: 100%;
		height: 100%;
		filter: blur(20px);
		transform: scale(1.1);
		pointer-events: none;
	}

	/* Main image — defaults to opacity 1 so cached images paint instantly during
	   SSR. The `fading` class is added by JS only when the image isn't already
	   loaded; `onload` removes it, triggering the fade-in over the placeholder. */
	.main {
		display: block;
		width: 100%;
		height: 100%;
		transition: opacity 300ms ease;
	}

	.main.fading {
		opacity: 0;
		transition: none;
	}

	.fallback-img {
		display: block;
		width: 100%;
		height: 100%;
	}

	.fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: var(--color-surface-2, rgba(128, 128, 128, 0.1));
		color: var(--color-text-secondary, rgba(128, 128, 128, 0.6));
	}

	.fallback-icon {
		width: 2.5em;
		height: 2.5em;
	}
</style>
