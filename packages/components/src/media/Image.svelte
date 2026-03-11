<script lang="ts" module>
	/** A singleton of the resolutions that have been loaded per image id */
	export const loadedMediaResolutions = new Map<string, number[]>();

	/** Adds a new resolution to the list of resolutions that have been loaded for the given mediaID */
	export function addLoadedMediaResolution(mediaID?: string, resolution?: number) {
		if (!mediaID || !resolution) return;
		const loadedRes = loadedMediaResolutions.get(mediaID) || [];
		if (loadedRes.includes(resolution)) return;
		loadedMediaResolutions.set(mediaID, Array.from(new Set([...loadedRes, resolution])));
	}

	/**
	 * Returns the URL of the initial preview image that should be used for the given media item
	 * This first chooses the largest already loaded image (if any)
	 * If no image sizes are loaded, it chooses the smallest image size available
	 */
	export function getInitialImageURL(media: string | Partial<Media & ApiMetadata>) {
		if (!media) return '';
		const decoded = typeof media === 'string' ? decodeMedia(media) : media;
		if (!decoded) return '';
		const previews = getMediaPreviews(decoded);
		if (!previews?.length) return decoded.thumbnail || decoded.url || '';
		const maxResolution = Math.max(
			36,
			...(loadedMediaResolutions.get(decoded._id || '') || []),
		);
		return (
			previews.find((v) => (v.resolution || 0) >= maxResolution)?.url ||
			previews[0]?.url ||
			decoded.thumbnail ||
			decoded.url ||
			''
		);
	}
</script>

<!-- svelte-ignore state_referenced_locally -->
<script lang="ts">
	import { intersect, resize } from '@packages/lib';
	import {
		type EncodedMediaURL,
		decodeMedia,
		onIdle,
		getMediaPreviews,
	} from '@packages/lib/utility';
	import { browser } from '$app/environment';
	import { ApiMetadata, Media } from '@packages/api';
	import { page } from '$app/state';
	import { getContext, untrack } from 'svelte';
	import type { Entities } from '$lib/state';

	let {
		/** The source of the media. Use `decodeMedia` to get this info from an encoded url */
		src = undefined as Partial<Media & ApiMetadata> | EncodedMediaURL | undefined | null,

		/** The alt text. Defaults to the name of the file embedded in the url query params */
		alt = undefined as string | undefined,

		/** The amount of blur in pixels to put on the media */
		blur = 0,

		/** The brightness from -100 to 100 (brightest) that the media should be */
		brightness = 0,

		/** How the media should be scaled within the container */
		fit = 'cover' as 'cover' | 'contain',

		/**
		 * How/when the media should be loaded
		 * `none` - don't load the media (besides the tiny blur base64 preview)
		 * `eager` - load the fullres image immediately
		 * `lazy` - load the base64 preview immediately, and the fullres image when the user scrolls to it.
		 */
		loading = 'lazy' as 'none' | 'eager' | 'lazy',

		/** The resolution/width of the file (in px) that should be targeted */
		resolution = 0,

		/** Whether the preview base64 image should be disabled and the full image should be loaded instead */
		disablePreview = false,

		/**
		 * Whether or not the image src should fetch the current uploading/processing status of the image
		 * If the image is uploading, it will show the locally generated thumbnail image
		 */
		checkForUploading = false,

		/** Whether or not the image should be blurred while uploading */
		blurWhileUploading = false,

		/** Specifies a custom class name for the container element */
		class: className = '',

		/** The css style string added to the component from the parent */
		style = '',

		/** A callback function that will be called when the fullres image loads */
		onload = undefined as undefined | (() => void),
	} = $props();

	const entities = getContext<Entities>('entities');
	let intersected = $state(false);
	let loaded = $state<boolean | undefined>(undefined);
	let idleReady = $state(!browser);
	let containerWidth = $state(0);
	let containerHeight = $state(0);
	let initialResolutionFound = $state(false);
	let initialImageSrcFound = false;
	const baseUrlProtocol = page.url.protocol;
	const baseUrlHost = page.url.host;
	let imgSrcA = $state.raw({
		url: '',
		width: 0,
		active: false,
		loaded: false,
		blurred: false,
		numErrored: 0, // The amount of times the image has errored while trying to load
	});
	let imgSrcB = $state.raw({
		url: '',
		width: 0,
		active: false,
		loaded: false,
		blurred: false,
		numErrored: 0, // The amount of times the image has errored while trying to load
	});

	if (browser) onIdle(() => (idleReady = true));
	const media = $derived(
		!src
			? undefined
			: typeof src === 'string'
				? !src.match(/^https?:\/\//)
					? undefined
					: decodeMedia(src)
				: src,
	);
	const mediaEntity = $derived.by(() => {
		if (entities && checkForUploading && media?._id) {
			const mediaEntity = entities.get('media', media._id);
			return mediaEntity;
		}
	});
	const isUploading = $derived.by(() => {
		if (!mediaEntity) return false;
		return mediaEntity.uploading || mediaEntity.processing;
	});
	const sources = $derived.by(() => {
		if (!media) return [];
		if (entities && checkForUploading && media._id) {
			if ((mediaEntity && mediaEntity.uploading) || mediaEntity?.processing) {
				return [{ url: mediaEntity.thumbnail }];
			}
		}
		return getMediaPreviews(media);
	});
	const shouldLoad = $derived(
		loading === 'eager' ||
			disablePreview ||
			(loading === 'lazy' && intersected) ||
			(media?.type === 'image' && !sources.some((v) => v.resolution === 36)),
	);

	// Determine the max resolution of the media that has already loaded (or should be loaded)
	const initialRes = $derived(
		Math.max(
			...(loadedMediaResolutions.get(media?._id || '') || []),
			resolution || 0,
			disablePreview ? 256 : 36,
		),
	);
	const initialSource = $derived(
		sources.find((v) => (v.resolution || 0) >= initialRes) || sources[0],
	);
	let loadedNonPreviewSource = $state(false);
	let largestRes = $state(initialRes);
	$effect(() => {
		const trueWidth = Math.max(
			containerWidth || 0,
			media?.ratio ? Math.ceil(containerHeight * media.ratio) : 0,
		);
		if (trueWidth > untrack(() => largestRes)) {
			if (loadedNonPreviewSource) {
				// Allow sources to be larger than the container width if a non-preview source has been loaded
				largestRes = trueWidth;
			} else {
				// Don't allow sources to be larger than 2048px until a "regular" (non-preview) image is loaded
				// We need this because the 4000px images take too long to load
				largestRes = Math.min(2048, trueWidth);
			}
		}
	});
	const targetSource = $derived(
		!largestRes
			? undefined
			: sources.find((v) => (v.resolution || 0) >= largestRes) ||
					sources[sources.length - 1],
	);

	/** Transforms the image source url to use the current domain (if it's a /cdn image) */
	function transformURL(url: string) {
		const urlObj = new URL(url);
		if (
			urlObj.pathname.startsWith('/cdn/') &&
			baseUrlHost.match(/^(((.+\.)?show\.tours)|localhost:?\d*)$/)
		) {
			if (baseUrlHost.match(/^localhost:/)) {
				urlObj.protocol = 'https:';
				urlObj.host = `staging.show.tours`;
			} else {
				urlObj.host = baseUrlHost;
				urlObj.protocol = baseUrlProtocol;
			}
		}
		return urlObj.href;
	}

	// Set the initial image src based on the provided media & resolution
	// Loads the smaller res preview image first (either the base64 or a previously cached/loaded version)
	function loadInitialImage() {
		if (initialResolutionFound) return;
		const url = initialSource?.url || (typeof src === 'string' ? src : '');
		const resolution = initialSource?.resolution || 0;
		if (!url) return;
		untrack(() => {
			if (!url) return;
			loadNextResolution(transformURL(url), resolution);
			initialResolutionFound = true;
			initialImageSrcFound = true;
		});
	}
	loadInitialImage();
	$effect(() => {
		// Force the 'loadInitialImage' function to run again if the src changes
		if (src && initialImageSrcFound) initialResolutionFound = false;
	});
	$effect(() => loadInitialImage());

	// Determine the next target resolution image based on the current width of the media container
	$effect(() => {
		if (!initialResolutionFound || !shouldLoad || !targetSource?.url) return;
		untrack(() => {
			if (!targetSource?.url) return;
			loadNextResolution(transformURL(targetSource.url), targetSource.resolution || 0);
		});
	});

	// If the next target resolution image is different than the current image, switch to it
	function loadNextResolution(url: string, width: number) {
		if (!url) return;
		if (!imgSrcA.active && !imgSrcB.active) {
			imgSrcA = {
				url,
				width,
				active: true,
				loaded: true,
				blurred: !!width && width < 100,
				numErrored: 0,
			};
			return;
		}
		const activePreview = imgSrcA.active ? imgSrcA.url : imgSrcB.url;
		if (activePreview === url) return;
		if (imgSrcA.active) {
			if (!imgSrcA.loaded && imgSrcB.loaded) {
				imgSrcA = {
					url,
					width,
					active: true,
					loaded: false,
					blurred: false,
					numErrored: 0,
				};
			} else {
				imgSrcA = { ...imgSrcA, active: false };
				imgSrcB = {
					url,
					width,
					active: true,
					loaded: false,
					blurred: false,
					numErrored: 0,
				};
			}
		} else {
			if (imgSrcA.loaded && !imgSrcB.loaded) {
				imgSrcB = {
					url,
					width,
					active: true,
					loaded: false,
					blurred: false,
					numErrored: 0,
				};
			} else {
				imgSrcB = { ...imgSrcB, active: false };
				imgSrcA = {
					url,
					width,
					active: true,
					loaded: false,
					blurred: false,
					numErrored: 0,
				};
			}
		}
	}

	// Determine if the image loaded quickly enough to not animate it on
	let loadStart = $state(0);
	let loadedInstantly = $state(false);
	$effect(() => {
		if (shouldLoad && !loadStart) loadStart = Date.now();
	});

	// Handle when an image loads
	function onLoad(image: 'a' | 'b') {
		const preview = image === 'a' ? imgSrcA : imgSrcB;
		const wasBlurredPreview = imgSrcA?.blurred;
		if (!preview?.blurred && loaded === undefined) {
			loadedInstantly = !loadStart || Date.now() - loadStart < 100;
			loaded = true;
			if (onload) onload();
		}

		const loadedRes = loadedMediaResolutions.get(media?._id || '') || [];
		if (image === 'a') {
			imgSrcA = { ...imgSrcA, loaded: true };
			if (media?._id && !loadedRes.includes(imgSrcA.width) && imgSrcA.width) {
				addLoadedMediaResolution(media._id, imgSrcA.width);
				if (imgSrcA.width > 36 && !loadedNonPreviewSource) {
					loadedNonPreviewSource = true;
				}
			}
		} else if (image === 'b') {
			imgSrcB = { ...imgSrcB, loaded: true };
			if (media?._id && !loadedRes.includes(imgSrcB.width) && imgSrcB.width) {
				addLoadedMediaResolution(media._id, imgSrcB.width);
				if (imgSrcB.width > 36 && !loadedNonPreviewSource) {
					loadedNonPreviewSource = true;
				}
			}
		}
		if (!wasBlurredPreview || loadedInstantly) removeOldImages();
	}

	function removeOldImages() {
		if (imgSrcA.active && imgSrcA.loaded) {
			if (imgSrcB.url) {
				imgSrcB = {
					url: '',
					width: 0,
					active: false,
					loaded: false,
					blurred: false,
					numErrored: 0,
				};
			}
		} else if (imgSrcB.active && imgSrcB.loaded) {
			if (imgSrcA.url) {
				imgSrcA = {
					url: '',
					width: 0,
					active: false,
					loaded: false,
					blurred: false,
					numErrored: 0,
				};
			}
		}
	}

	let imgARetryTimer: ReturnType<typeof setTimeout> | undefined;
	let imgBRetryTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		return () => {
			clearTimeout(imgARetryTimer);
			clearTimeout(imgBRetryTimer);
		};
	});
</script>

{#if imgSrcA.url || imgSrcB.url}
	<div
		class="image {className}"
		{style}
		style:--blur={blurWhileUploading && isUploading
			? `15px`
			: blur
				? `${blur}px`
				: undefined}
		style:--brightness={brightness ? `${(brightness + 100) / 100}` : undefined}
		use:resize={{
			debounce: 1000,
			onResize(element) {
				containerWidth = element.clientWidth;
				containerHeight = element.clientHeight;
			},
		}}
		use:intersect={{
			enabled: loading === 'lazy',
			onintersectonce: () => (intersected = true),
		}}>
		{#if imgSrcA.url}
			<img
				alt="{imgSrcA.blurred ? 'Blurred preview of media: ' : ''}{media?.name ||
					'Unknown media'}"
				src={imgSrcA.url}
				style:transition={loadedInstantly ? 'none' : null}
				class:contain={fit === 'contain'}
				class:blur={imgSrcA.blurred}
				class:active={imgSrcA.active}
				class:show={imgSrcA.loaded || !imgSrcB.url}
				ontransitionend={() => removeOldImages()}
				onload={() => imgSrcA.blurred || onLoad('a')}
				onerror={(e) => {
					if (imgSrcA.numErrored >= 4) return;
					const src = imgSrcA.url;
					const delay = imgSrcA.numErrored ** 3 * 1000 + 1000;
					imgSrcA.numErrored++;
					imgARetryTimer = setTimeout(() => {
						const el = e.target as HTMLImageElement | null;
						if (!el || imgSrcA.loaded || imgSrcA.url !== src) return;
						clearTimeout(imgARetryTimer);
						el.src = src;
					}, delay);
				}} />
		{/if}
		{#if imgSrcB.url}
			<img
				alt={alt || media?.name || 'Unknown media'}
				src={imgSrcB.url}
				style:transition={loadedInstantly ? 'none' : null}
				class:contain={fit === 'contain'}
				class:active={imgSrcB.active}
				class:show={imgSrcB.loaded || !imgSrcB.url}
				ontransitionend={() => removeOldImages()}
				onload={() => onLoad('b')}
				onerror={(e) => {
					if (imgSrcB.numErrored >= 4) return;
					const src = imgSrcB.url;
					const delay = imgSrcB.numErrored ** 3 * 1000 + 1000;
					imgSrcB.numErrored++;
					imgBRetryTimer = setTimeout(() => {
						const el = e.target as HTMLImageElement | null;
						if (!el || imgSrcB.loaded || imgSrcB.url !== src) return;
						clearTimeout(imgBRetryTimer);
						el.src = src;
					}, delay);
				}} />
		{/if}
	</div>
{/if}

<style lang="scss">
	.image {
		display: grid;
		position: relative;
		overflow: hidden;
		width: 100%;
		--blur: 0px;
		--brightness: 1;
		filter: blur(var(--blur)) brightness(var(--brightness));
		grid-template-columns: 100%;
		grid-template-rows: 100%;
		> * {
			grid-column: 1;
			grid-row: 1;
		}
	}

	img {
		opacity: 0;
		z-index: 1;
		position: relative;
		max-width: none;
		max-height: none;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center center;
		transform: scale(1);
		transform-origin: center center;

		&.active {
			z-index: 2;
		}
		&.show {
			opacity: 1;
			transform: scale(1);
		}
		&.blur {
			opacity: 1;
			filter: blur(calc(10px + 1vw + 1vh)) contrast(1.3) saturate(1.2);
			filter: url('#sharpBlur') contrast(1.05) saturate(1.1);
			transition: none;
		}
		&.contain {
			object-fit: contain;
		}
	}

	img.blur ~ img {
		transition:
			opacity 800ms cubic-bezier(0, 0.63, 0.25, 1),
			transform 800ms cubic-bezier(0.25, 1, 0.5, 1);
	}
	img.blur ~ img:not(.show) {
		transform: scale(1.05);
	}
</style>
