<script lang="ts" module>
	import type { Component } from 'svelte';
	import type { CarouselItem } from './carousel';

	/** A single action button that can be shown on a gallery item or in the carousel header. */
	export interface GalleryItemAction {
		/** The icon component to show for the action */
		icon?: Component<Record<string, unknown>>;

		/** The main action text - e.g. 'Download' or 'Pay now' */
		name?: string;

		/** A short descriptor of the action - e.g. file size or filename */
		tooltip?: string;

		/** The link that the button should go to */
		href?: string;

		/** Called when the button is clicked */
		click?: (event: Event) => unknown;

		/** Anchor target (only used if href is provided) */
		target?: '_blank' | '_self';

		/** The list of subactions (shown in a context menu) */
		actions?: GalleryItemAction[];
	}

	export type GalleryDisplay =
		| 'grid'
		| 'masonry'
		| 'masonry-row'
		| 'list'
		| 'slider'
		| 'slideshow'
		| 'lightbox';

	/**
	 * Thumbnail size on the delightstack numeric scale: `'1'` is the standard,
	 * lower (`'0'`, `'00'`) is smaller, higher (`'2'`, `'3'`) is larger.
	 */
	export type GallerySize = '00' | '0' | '1' | '2' | '3';

	/**
	 * Gap between gallery items on the delightstack numeric scale: `'0'` removes
	 * the gap, `'1'` is the standard, `'2'`/`'3'` are progressively larger.
	 */
	export type GallerySpacing = '0' | '1' | '2' | '3';

	/**
	 * Corner radius of gallery items on the delightstack numeric scale: `'0'` is
	 * square, `'1'` is the standard, `'2'`/`'3'` are progressively rounder.
	 */
	export type GalleryRadius = '0' | '1' | '2' | '3';

	export type GalleryItem = string | (Partial<CarouselItem> & { favorite?: boolean });
</script>

<script lang="ts">
	import { type TransitionConfig, fade } from 'svelte/transition';
	import { circInOut } from 'svelte/easing';
	import { onDestroy, onMount, untrack, type Snippet } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { focusTrap, intersectionObserver, ripple } from '@delightstack/utilities';

	// Minimal subset of the focus-trap instance we use, declared locally so the
	// 'focus-trap' package doesn't need to be a direct dep of this package.
	interface FocusTrapInstance {
		active: boolean;
		deactivate: () => void;
	}
	import Button from '../actions/Button.svelte';
	import List from '../display/List.svelte';
	import ListItem from '../display/ListItem.svelte';
	import Portal from '../actions/Portal.svelte';
	import { contextMenu } from '../actions/ContextMenu.svelte';
	import Carousel from './Carousel.svelte';
	import {
		decodeThumbHash,
		getItemThumbnailSrc,
		isResponsiveSrcset,
		normalizeCarouselItem,
		pickLargestSrc,
	} from './carousel';

	let {
		/**
		 * How the gallery should be displayed - whether a grid, slideshow, etc.
		 *
		 * Use `'lightbox'` for a headless mode: Gallery renders no thumbnails of its
		 * own, and you provide your own trigger elements (buttons, images, cards) that
		 * open the carousel by setting `slide` to the desired index (`-1` keeps it
		 * closed). For a nice open animation from your trigger element, call the
		 * exported `open(index, fromElement)` method instead of setting `slide`
		 * directly.
		 */
		display = 'masonry' as GalleryDisplay,

		/** The size of the thumbnails in the gallery (`'00'`–`'3'`, default `'1'`) */
		size = '1' as GallerySize,

		/** The size of the spacing between thumbnails in the gallery (`'0'`–`'3'`, default `'1'`) */
		spacing = '1' as GallerySpacing,

		/**
		 * Whether the grid/masonry/masonry-row layouts keep their outside gap —
		 * the padding around the gallery that matches the interior `spacing` gap.
		 * `true` always pads, `false` never pads. The default (`undefined`) is
		 * "auto": the gap is kept when the gallery is full-bleed (spanning the
		 * whole viewport width, where edge-to-edge tiles would touch the screen
		 * edges) and dropped when the gallery sits inside a narrower container
		 * (where the padding reads as the gallery not filling its container).
		 * Auto is resolved in pure CSS (it compares the gallery's containing
		 * block against `100vw`), so it tracks resizes for free — but that means
		 * a gallery stretched wider than its parent (negative-margin bleed)
		 * reads as contained; pass an explicit value there.
		 */
		outside_gap = undefined as boolean | undefined,

		/** The border radius of the gallery items (`'0'`–`'3'`, default `'1'`) */
		radius = '1' as GalleryRadius,

		/** The currently displayed item index. -1 closes the modal/slider. */
		slide = $bindable(display === 'slider' || display === 'slideshow' ? 0 : -1) as number,

		/** The object-fit attribute for all items in the gallery */
		fit = 'contain' as 'cover' | 'contain',

		/** The list of items to display. Strings are treated as image URLs. */
		items = [] as GalleryItem[],

		/** The duration (in ms) between slide auto-transitions */
		duration = 8000,

		/** Whether the gallery should auto transition between slides */
		autoplay = false,

		/**
		 * Whether a video should start playing automatically when the modal/lightbox
		 * is launched onto it (e.g. clicking a video thumbnail, or `open()`). Only
		 * the slide the lightbox opens to auto-plays, and only when it's a video.
		 * Navigating/swiping between slides does NOT auto-play. Because the launch is
		 * a user gesture, the browser permits playback, with sound.
		 */
		autoplay_video = false,

		/** The css aspect ratio the gallery should be forced into (only when not a modal) */
		aspect_ratio = undefined as string | undefined,

		/** Whether the full screen button should be disabled */
		disable_fullscreen = false,

		/**
		 * Whether the gallery is 'inline' in the page - not a modal or fullscreen.
		 * If 'inline', vertical gestures & mouse wheel are disabled.
		 * @default true when display is 'slider' and not in fullscreen
		 */
		inline = undefined as boolean | undefined,

		/**
		 * How the slider controls should be displayed.
		 * - inline: the controls sit below the slideshow element
		 * - overlay: the controls overlay on top of the slideshow element
		 * - disable: the controls are not shown at all
		 * - default: 'inline' when the carousel is inline, 'overlay' when modal
		 */
		controls = 'default' as 'default' | 'inline' | 'overlay' | 'disable',

		/** The currently displayed page (a vertical carousel within the current slide - used for pdf pages) */
		page = $bindable(0) as number,

		/** The amount of pages available in the current slide (applies to PDFs) */
		num_pages = $bindable(1) as number,

		/** The display style of the metadata (name, description, etc) for each item */
		meta_display = 'hover' as 'none' | 'always' | 'hover',

		/** How file names should be displayed in the fullscreen/carousel view */
		meta_display_fullscreen = 'none' as 'none' | 'always',

		/** The display style of the actions (download buttons, etc) for each item */
		action_display = 'hover' as 'none' | 'always' | 'hover',

		/**
		 * The list of potential actions a user can take on each gallery item.
		 * Each gallery item can have multiple actions.
		 */
		actions = [] as GalleryItemAction[][],

		/**
		 * Snippet used to render `type: 'custom'` items in the carousel.
		 * Pass-through to Carousel. See Carousel's `custom` prop for the
		 * full signature.
		 */
		custom = undefined as
			| Snippet<
					[
						{
							item: CarouselItem;
							onload: () => void;
							onerror: (err: unknown) => void;
							active: boolean;
							gesture_disabled: boolean;
						},
					]
			  >
			| undefined,

		/**
		 * Called when an item's thumbnail/text is clicked.
		 * If the function returns false, the default behavior (opening the modal/slider) is prevented.
		 */
		onclick = undefined as
			| undefined
			| ((event: MouseEvent | KeyboardEvent, index: number) => void | false),

		/** The css style string added to the component from the parent */
		style = '',
	} = $props();

	/** The percent (0-1) of how 'closed' the gallery is - while swiping/dismissing the gallery away */
	let dismissing = $state(0);

	/**
	 * Item IDs whose `<img>` was *not* loaded at mount time and therefore needs
	 * the fade-in transition when its `onload` eventually fires. On SSR this
	 * stays empty so the rendered HTML has the main image at its default
	 * (visible) opacity — cached images then paint instantly without waiting
	 * for hydration.
	 */
	const fadingKeys = new SvelteSet<string>();
	function thumbnailKey(item: { id?: string; src?: string }) {
		return item.id || item.src || '';
	}

	/**
	 * Attachment that fades a thumbnail in once its media settles. The load/error
	 * listeners live here rather than as `onload`/`onerror` attributes so they are
	 * torn down with the element: a thumbnail that is still in flight when the
	 * gallery unmounts (navigating away from a page, an item leaving the list)
	 * still fires its media event on the now-detached node, and an attribute
	 * handler would run after the item's `{@const key}` derived was destroyed —
	 * reading a destroyed derived (`derived_inert`) and writing state outside of
	 * Svelte's batch (`invariant_violation: Batch has scheduled roots`).
	 */
	function fadeInWhenSettled(key: string, loadEvent: 'load' | 'loadeddata') {
		return (el: HTMLImageElement | HTMLVideoElement) => {
			const settled =
				el instanceof HTMLVideoElement
					? // < HAVE_CURRENT_DATA: no frame to show yet, fade in when one arrives.
						el.readyState >= 2 || !!el.poster
					: el.complete && el.naturalWidth > 0;
			if (settled) return;
			fadingKeys.add(key);
			const settle = () => fadingKeys.delete(key);
			el.addEventListener(loadEvent, settle, { once: true });
			el.addEventListener('error', settle, { once: true });
			return () => {
				el.removeEventListener(loadEvent, settle);
				el.removeEventListener('error', settle);
				fadingKeys.delete(key);
			};
		};
	}

	/** The instance of the focus trap class - used to programmatically deactivate the focus trap */
	let focusTrapInstance: FocusTrapInstance | undefined;

	/** The element that the carousel item will be animated from */
	let animationTarget = $state<HTMLElement | undefined>(undefined);

	/** The instance of the carousel (can be used to control it) */
	let carousel = $state<ReturnType<typeof Carousel> | undefined>(undefined);

	/** Whether or not the gallery is being viewed in fullscreen */
	let fullscreenActive = $state(false);

	/** Whether the slider element is currently visible on screen */
	let intersected = $state(false);

	const list = $derived(
		items
			.map((v) => normalizeCarouselItem(v as string | Partial<CarouselItem>))
			.filter((v): v is CarouselItem => !!v)
			.map((item, i) => {
				const original = items[i] as Partial<CarouselItem> & { favorite?: boolean };
				return {
					...item,
					favorite: typeof original === 'object' ? !!original?.favorite : false,
				};
			}),
	);

	/**
	 * Video slides draw their caption inside the player chrome (see the
	 * Carousel's `caption_display`), so the bottom-pinned overlay below sits
	 * those out rather than covering the controls with a second scrim.
	 */
	const captionInPlayer = $derived(list[slide]?.type === 'video');

	const sliderActive = $derived(
		display === 'slider' || display === 'slideshow' || slide >= 0,
	);
	const isModal = $derived(
		fullscreenActive || (display !== 'slider' && display !== 'slideshow' && slide >= 0),
	);
	$effect(() => {
		if (typeof window !== 'undefined') {
			if (isModal) {
				window.document.body.style.overflow = 'hidden';
			} else {
				window.document.body.style.overflow = '';
			}
		}
	});

	// Prevent the modal from automatically being active when switching between display modes
	let previousDisplay = undefined as typeof display | undefined;
	$effect.pre(() => {
		const wasSliderLike = previousDisplay === 'slider' || previousDisplay === 'slideshow';
		const isSliderLike = display === 'slider' || display === 'slideshow';
		if (wasSliderLike) {
			if (!isSliderLike) slide = -1;
		} else {
			if (isSliderLike) slide = 0;
		}
		if (previousDisplay) untrack(() => pause());
		previousDisplay = display;
	});

	/** Autoplay state */
	let autoplayPaused = $state(false);
	const autoplayTransitionInterval = 300; // ms between progress ticks
	let autoplayTransitionStart = $state<number | undefined>(undefined);
	let autoplayTransitionProgress = $state<number | undefined>(undefined);
	let autoplayTransitionTimer = $state<ReturnType<typeof setInterval> | undefined>(
		undefined,
	);
	$effect.pre(() => {
		if (autoplay && intersected && !autoplayTransitionTimer && !autoplayPaused) play();
	});
	onDestroy(() => pause());

	/**
	 * Opens the gallery modal at the given item index.
	 *
	 * Primarily intended for `display="lightbox"`, where the developer renders
	 * their own thumbnails: pass `event.currentTarget` (or another element) as
	 * `from` to anchor the open animation to that element. Equivalent to setting
	 * `slide = index` directly, except it also captures the animation origin.
	 */
	export function open(index: number, from?: HTMLElement) {
		if (!list[index]) return;
		dismissing = 0;
		animationTarget = from;
		slide = index;
	}

	/** Closes the gallery modal */
	export function close() {
		if (fullscreenActive) return closeFullscreen();
		if (!sliderActive) return;
		if ((display === 'slider' || display === 'slideshow') && isModal)
			return closeFullscreen();
		if (focusTrapInstance?.active) {
			focusTrapInstance.deactivate();
		} else {
			slide = -1;
		}
	}

	/** Navigates to the item at the given index */
	export function goto(i: number) {
		if (!sliderActive || !list[i]) return;
		pause();
		slide = i;
	}

	/** Navigates to the next item */
	export function next(amount = 1) {
		if (!sliderActive) return;
		pause();
		const target = Math.floor(slide + amount) % list.length;
		slide = target;
	}

	/** Navigates to the previous item */
	export function prev(amount = 1) {
		if (!sliderActive) return;
		pause();
		const target = Math.floor(slide - amount + list.length) % list.length;
		slide = target;
	}

	/** Starts the slideshow */
	export function play() {
		if (!sliderActive || autoplayTransitionTimer) return;
		autoplayPaused = false;
		autoplayTransitionStart = Date.now();
		autoplayTransitionTimer = setInterval(() => {
			if (!autoplayTransitionStart) return clearInterval(autoplayTransitionTimer);
			const now = Date.now();
			if (!intersected) {
				autoplayTransitionStart = Math.min(
					now,
					Math.floor(
						now -
							duration * (autoplayTransitionProgress || 0) +
							autoplayTransitionInterval,
					),
				);
				return;
			}
			autoplayTransitionProgress = (now - autoplayTransitionStart) / duration;
			if (autoplayTransitionProgress >= 1) {
				autoplayTransitionStart = now;
				setTimeout(() => (autoplayTransitionProgress = 0), 10);
				const target = Math.floor(slide + 1) % list.length;
				slide = target;
			}
		}, autoplayTransitionInterval);
	}

	/** Pauses the slideshow */
	export function pause() {
		if (!autoplayTransitionTimer) return;
		clearInterval(autoplayTransitionTimer);
		autoplayTransitionTimer = undefined;
		autoplayTransitionStart = undefined;
		autoplayTransitionProgress = undefined;
		autoplayPaused = true;
	}

	/** Handles when a grid item is clicked (opens the modal) */
	function onItemClick(i: number, evt: MouseEvent | KeyboardEvent) {
		if (onclick) {
			const result = onclick(evt, i);
			if (result === false) {
				evt.preventDefault();
				return;
			}
		}
		let target = evt.target as HTMLElement;
		let isActionButton = false;
		while (target && !isActionButton && !target.classList.contains('gallery-item')) {
			isActionButton =
				target.classList.contains('actions') || target.classList.contains('button');
			target = target.parentElement as HTMLElement;
		}
		if (isActionButton) return;
		dismissing = 0;
		animationTarget = (evt.target as HTMLElement) || undefined;
		slide = i;
	}

	/** Returns the gallery item element that triggered this carousel open so focus can be returned to it */
	function focusTrapSetReturnFocus(
		elFocusedBeforeActivation: HTMLElement | SVGElement,
	): HTMLElement | false {
		const items = Array.from(document.querySelectorAll('.gallery.grid .gallery-item'));
		const target = items[slide] as HTMLElement;
		return target || elFocusedBeforeActivation;
	}

	/** Opens the media player in full screen mode */
	async function openFullscreen() {
		const promise =
			document?.documentElement?.requestFullscreen() ||
			(document?.documentElement as any)?.mozRequestFullScreen() ||
			(document?.documentElement as any)?.webkitRequestFullscreen() ||
			(document?.documentElement as any)?.msRequestFullscreen();
		if (!promise) return;
		fullscreenActive = true;
		await promise.catch(() => {
			fullscreenActive = false;
		});
		if (document.fullscreenElement === null && fullscreenActive) fullscreenActive = false;
	}

	/** Closes the fullscreen mode */
	function closeFullscreen() {
		document?.exitFullscreen() ||
			(document as any)?.mozCancelFullScreen() ||
			(document as any)?.webkitExitFullscreen() ||
			(document as any)?.msExitFullscreen();
		if (carousel) carousel.reset();
	}

	/** Toggles fullscreen mode */
	export function toggleFullscreen() {
		if (fullscreenActive) {
			closeFullscreen();
		} else {
			openFullscreen();
		}
	}

	onMount(() => {
		const listener = () => {
			if (document.fullscreenElement === null) fullscreenActive = false;
		};
		document.addEventListener('fullscreenchange', listener);
		document.addEventListener('webkitfullscreenchange', listener);
		document.addEventListener('mozfullscreenchange', listener);
		document.addEventListener('msfullscreenchange', listener);
		return () => {
			document.removeEventListener('fullscreenchange', listener);
			document.removeEventListener('webkitfullscreenchange', listener);
			document.removeEventListener('mozfullscreenchange', listener);
			document.removeEventListener('msfullscreenchange', listener);
		};
	});

	/** Animates the scale of the gallery item on dismiss */
	function carouselCloseTransition(node: HTMLElement): () => TransitionConfig {
		return () => {
			const duration = 300;
			const start = 0.5;
			const el = node.querySelector<HTMLElement>('.carousel .item.active');
			if (!el) {
				const parentOpacity = +getComputedStyle(node).opacity;
				return { duration: 150, css: (_t, u) => `opacity: ${parentOpacity - u}` };
			}
			const activePageEl = node.querySelector<HTMLElement>(
				'.carousel .item.active > *.active:not(.preview)',
			);
			let inactivePageEls: HTMLElement[] = [];
			if (activePageEl) {
				inactivePageEls = Array.from(
					node.querySelectorAll<HTMLElement>('.carousel .item.active > *:not(.active)'),
				);
			} else {
				inactivePageEls = Array.from(
					node.querySelectorAll<HTMLElement>(
						'.carousel .item.active > *:not(:first-child)',
					),
				);
			}
			inactivePageEls.forEach((el) => {
				el.style.opacity = '0';
			});
			const style = getComputedStyle(el);
			const targetOpacity = +style.opacity;
			const transform = style.transform === 'none' ? '' : style.transform;
			return {
				duration,
				easing: circInOut,
				tick: (_t, u) => {
					const sd = 1 - start;
					el.style.transformOrigin = 'center center';
					el.style.opacity = `${targetOpacity - u}`;
					el.style.transform = `${transform} perspective(100px) translate3d(0px, ${
						500 * u
					}px, ${sd * u * -300}px)`;
				},
			};
		};
	}

	/** The full set of context-menu actions for the slide at the given index */
	function flattenActions(itemActions: GalleryItemAction[] | undefined) {
		return (
			itemActions?.flatMap((parentAction) =>
				[parentAction, ...(parentAction.actions || [])]
					.filter((action) => !!action?.name)
					.map((action) => ({
						label: action.name,
						icon: action.icon || parentAction.icon,
						href: action.href,
						target: action.target,
						onclick: action.click
							? (event: PointerEvent) => {
									action.click?.(event);
								}
							: undefined,
					})),
			) || []
		);
	}
</script>

<!-- Inline icons (kept terse to avoid pulling in an icon dep) -->
{#snippet iconPlay()}
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path d="M8 5v14l11-7L8 5z" />
	</svg>
{/snippet}
{#snippet iconPause()}
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path d="M6 5h4v14H6zM14 5h4v14h-4z" />
	</svg>
{/snippet}
{#snippet iconDocument()}
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path
			d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm0 7V3.5L19.5 9H14z" />
	</svg>
{/snippet}
{#snippet iconEmbed()}
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true">
		<polyline points="16 18 22 12 16 6" />
		<polyline points="8 6 2 12 8 18" />
	</svg>
{/snippet}
{#snippet iconPanorama()}
	<!-- Panoramic photo: a wide frame with curved (barrel) top/bottom edges
	     and a mountain scene — reads more clearly as "360 panorama" than the
	     previous globe/grid ellipse. -->
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true">
		<path d="M2 6c6.5 1.6 13.5 1.6 20 0v12c-6.5-1.6-13.5-1.6-20 0V6z" />
		<path d="M6 15l3.5-4 2.5 3 3-4 3 5" />
	</svg>
{/snippet}
{#snippet iconChevronLeft()}
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true">
		<polyline points="15 18 9 12 15 6" />
	</svg>
{/snippet}
{#snippet iconChevronRight()}
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true">
		<polyline points="9 18 15 12 9 6" />
	</svg>
{/snippet}
{#snippet iconFullscreen()}
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path
			d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
	</svg>
{/snippet}
{#snippet iconFullscreenExit()}
	<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
		<path
			d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
	</svg>
{/snippet}
{#snippet iconClose()}
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true">
		<line x1="18" y1="6" x2="6" y2="18" />
		<line x1="6" y1="6" x2="18" y2="18" />
	</svg>
{/snippet}
{#snippet iconDownload()}
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true">
		<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
		<polyline points="7 10 12 15 17 10" />
		<line x1="12" y1="15" x2="12" y2="3" />
	</svg>
{/snippet}

{#snippet itemThumbnail(item: (typeof list)[number], sizesFallback: string)}
	{@const key = thumbnailKey(item)}
	{@const eager = !!item.priority}
	{@const isImage = !item.type || item.type === 'image'}
	{@const thumbSrc = getItemThumbnailSrc(item)}
	{#if item.thumbhash}
		<img
			class="thumbnail-blur"
			src={decodeThumbHash(item.thumbhash)}
			alt=""
			aria-hidden="true"
			draggable="false" />
	{/if}
	{#if item.poster_video}
		<!--
			Animated poster: a muted looping <video> in place of the thumbnail <img>.
			It loads nothing until it nears the viewport (preload="none" + the
			observer below), plays only while near, and under prefers-reduced-motion
			never plays — only the first frame is fetched as a still.
		-->
		<video
			class="thumbnail-video"
			class:fading={fadingKeys.has(key)}
			class:no-blur={!item.thumbhash}
			src={item.poster_video}
			poster={thumbSrc}
			muted
			loop
			playsinline
			preload="none"
			draggable="false"
			aria-label={item.alt ?? item.name ?? undefined}
			{@attach (el: HTMLVideoElement) => {
				el.muted = true;
			}}
			{@attach fadeInWhenSettled(key, 'loadeddata')}
			{@attach intersectionObserver({
				rootMargin: '25%',
				onintersectchange: ({ isIntersecting, target }) => {
					const el = target as HTMLVideoElement;
					if (!isIntersecting) return el.pause();
					const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
					// Lift preload off "none" so pause/resume logic outside this
					// component (or the browser itself) is free to fetch frames.
					if (el.preload === 'none') el.preload = reduced ? 'metadata' : 'auto';
					if (!reduced) el.play().catch(() => {});
				},
			})}>
		</video>
	{:else if thumbSrc}
		{@const responsive = isImage && isResponsiveSrcset(item.src)}
		<!--
			Match the Carousel's image attributes for single-URL sources so the
			lightbox <img> hits this thumbnail's memory-cached pixels instead of
			re-fetching. Mismatched srcset/sizes attributes between the two <img>
			elements make Chrome treat them as separate "responsive selections"
			and bypass the memory cache when devtools "Disable cache" is on.
		-->
		<img
			class="thumbnail-img"
			class:fading={fadingKeys.has(key)}
			class:no-blur={!item.thumbhash}
			src={thumbSrc}
			srcset={responsive ? item.src : undefined}
			sizes={responsive ? (eager ? sizesFallback : `auto, ${sizesFallback}`) : undefined}
			alt={item.alt ?? item.name ?? ''}
			loading={eager ? 'eager' : 'lazy'}
			fetchpriority={eager ? 'high' : undefined}
			draggable="false"
			{@attach fadeInWhenSettled(key, 'load')} />
	{:else}
		<!-- No thumbnail available — render a styled placeholder so the type-icon
		     overlay has a background and the layout slot still has its expected
		     aspect ratio. -->
		<div class="thumbnail-placeholder" aria-hidden="true"></div>
	{/if}
{/snippet}

{#snippet galleryItemAction(
	index: number,
	style: 'overlay' | 'transparent' = 'overlay',
	button_size: '00' | '0' | '1' = '00',
)}
	{@const itemActions = actions?.[index]}
	{#if itemActions?.length}
		<div class="actions" class:hover-only={action_display === 'hover'}>
			{#each itemActions as action (action)}
				{#if action?.actions?.length}
					<Button
						icon
						overlay={style === 'overlay'}
						transparent={style === 'transparent'}
						dense
						size={button_size}
						tooltip={action.tooltip || action.name}>
						{#if action.icon}
							<action.icon></action.icon>
						{:else}
							{@render iconDownload()}
						{/if}
						{#snippet menu()}
							<List>
								{#each action?.actions || [] as subAction (subAction)}
									<ListItem
										onclick={(e) => {
											if (subAction.click) subAction.click(e);
										}}
										href={subAction.href}
										target={subAction.target}>
										<span class="list-item-icon">
											{#if subAction.icon}
												<subAction.icon></subAction.icon>
											{:else if action.icon}
												<action.icon></action.icon>
											{:else}
												{@render iconDownload()}
											{/if}
										</span>
										{subAction.name}
									</ListItem>
								{/each}
							</List>
						{/snippet}
					</Button>
				{:else}
					<Button
						icon
						overlay={style === 'overlay'}
						transparent={style === 'transparent'}
						dense
						size={button_size}
						tooltip={action.tooltip || action.name}
						href={action.href}
						target={action.target}
						onclick={(e) => {
							if (action.click) action.click(e);
						}}>
						{#if action.icon}
							<action.icon></action.icon>
						{:else}
							{@render iconDownload()}
						{/if}
					</Button>
				{/if}
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet galleryItem(item: (typeof list)[number], index: number)}
	<div
		class="gallery-item"
		role="button"
		tabindex="0"
		{@attach ripple({ zIndex: 1, opacity: 0.2, color: 'white' })}
		class:favorite={item.favorite}
		style:--ratio={(display === 'masonry-row' || display === 'masonry') &&
		item.width &&
		item.height
			? item.width / item.height
			: undefined}
		{@attach contextMenu({ actions: flattenActions(actions?.[index]) })}
		onclick={(e) => onItemClick(index, e)}
		onkeydown={(e) => e.key !== 'Enter' || onItemClick(index, e)}>
		<div class="image">
			{@render itemThumbnail(item, '100vw')}
		</div>
		{#if item.type === 'video' || item.type === 'pdf' || item.type === 'embed' || item.panorama}
			<div class="icon">
				{#if item.type === 'video'}
					{@render iconPlay()}
				{:else if item.type === 'pdf'}
					{@render iconDocument()}
				{:else if item.type === 'embed'}
					{@render iconEmbed()}
				{:else if item.panorama}
					{@render iconPanorama()}
				{/if}
			</div>
		{/if}
		{#if meta_display === 'always' || meta_display === 'hover'}
			{#if item.name}
				<div class="name" class:hover-only={meta_display === 'hover'}>{item.name}</div>
			{/if}
		{/if}
		{#if action_display === 'always' || action_display === 'hover'}
			{@render galleryItemAction(index, 'overlay')}
		{/if}
	</div>
{/snippet}

{#if display === 'grid' || display === 'masonry' || display === 'masonry-row'}
	<div
		class="gallery display-{display} size-{size} spacing-{spacing} radius-{radius}"
		class:outside-gap-on={outside_gap === true}
		class:outside-gap-off={outside_gap === false}
		role="group"
		{style}>
		{#each list as item, i (i)}
			{@render galleryItem(item, i)}
		{/each}
	</div>
{/if}

{#if display === 'list'}
	<div
		class="gallery display-list size-{size} spacing-{spacing} radius-{radius}"
		role="group"
		{style}>
		{#each list as item, index (index)}
			<div class="list-item">
				<div
					class="info"
					role="button"
					tabindex="0"
					{@attach ripple({
						zIndex: 1,
						opacity: 0.2,
						color: 'var(--color-text, currentColor)',
					})}
					onclick={(e) => onItemClick(index, e)}
					onkeydown={(e) => e.key !== 'Enter' || onItemClick(index, e)}
					{@attach contextMenu({ actions: flattenActions(actions?.[index]) })}>
					<div class="thumbnail">
						{@render itemThumbnail(item, '64px')}
						{#if item.type === 'video' || item.type === 'pdf' || item.type === 'embed' || item.panorama}
							<div class="icon">
								{#if item.type === 'video'}
									{@render iconPlay()}
								{:else if item.type === 'pdf'}
									{@render iconDocument()}
								{:else if item.type === 'embed'}
									{@render iconEmbed()}
								{:else if item.panorama}
									{@render iconPanorama()}
								{/if}
							</div>
						{/if}
					</div>
					<div class="name">{item.name || ''}</div>
				</div>
				{#if action_display === 'always' || action_display === 'hover'}
					{@render galleryItemAction(index, 'transparent')}
				{/if}
			</div>
		{/each}
	</div>
{/if}

{#snippet sliderControls()}
	<div
		class="controls"
		in:fade={{ duration: 150 }}
		out:fade={{ duration: 150 }}
		style:opacity={1 - dismissing}>
		<!-- Always rendered (and positioned absolutely) so it never re-mounts as
		     `num_pages` settles while a PDF loads its pages — that remounting was
		     replaying the scale-in transition repeatedly. Visibility is toggled
		     purely with CSS instead. -->
		<nav class="pages" class:shown={num_pages > 1} aria-hidden={num_pages <= 1}>
			<Button
				icon
				transparent
				size="0"
				disabled={page <= 0}
				onclick={() => (page = Math.max(0, page - 1))}
				tooltip="Previous page">
				<span class="visuallyhidden">Previous page</span>
				<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
					<path
						d="M10 3L5 8L10 13"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round" />
				</svg>
			</Button>
			<span class="page-counter" aria-live="polite">
				<span class="page-current">{page + 1}</span>
				<span class="page-separator">/</span>
				<span class="page-total">{num_pages}</span>
			</span>
			<Button
				icon
				transparent
				size="0"
				disabled={page >= num_pages - 1}
				onclick={() => (page = Math.min(num_pages - 1, page + 1))}
				tooltip="Next page">
				<span class="visuallyhidden">Next page</span>
				<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
					<path
						d="M6 3L11 8L6 13"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round" />
				</svg>
			</Button>
		</nav>
		{#if isModal}
			<Button icon transparent dense size="1" class="close" onclick={() => close()}>
				<span class="visuallyhidden">Close</span>
				{@render iconClose()}
			</Button>
			{#if actions?.length}
				{@render galleryItemAction(slide, 'transparent', '1')}
			{/if}
		{:else}
			{#if disable_fullscreen === false}
				<Button
					icon
					transparent
					dense
					size="0"
					class="fullscreen"
					tooltip="Toggle Fullscreen"
					onclick={() => toggleFullscreen()}>
					<span class="visuallyhidden">Fullscreen</span>
					{#if fullscreenActive}
						{@render iconFullscreenExit()}
					{:else}
						{@render iconFullscreen()}
					{/if}
				</Button>
			{/if}
			{#if list.length > 1}
				<Button
					icon
					transparent
					dense
					size="0"
					class="play"
					tooltip={autoplayTransitionTimer ? 'Pause Slideshow' : 'Start Slideshow'}
					onclick={() => (autoplayTransitionTimer ? pause() : play())}>
					<span class="visuallyhidden">Start Slideshow</span>
					{#if autoplayTransitionTimer}
						{@render iconPause()}
					{:else}
						{@render iconPlay()}
					{/if}
					{#if autoplayTransitionTimer}
						{@const progress = autoplayTransitionProgress || 0}
						<svg
							class="progress"
							viewBox="0 0 56 56"
							style:--progress={progress}
							style:--speed="{autoplayTransitionInterval}ms"
							style:transition={progress >= 0.99 || progress < 0.01 ? 'none' : null}>
							<circle cx="28" cy="28" r="26" />
						</svg>
					{/if}
				</Button>
			{/if}
		{/if}
		<div class="spacer"></div>
		{#if list.length > 1}
			<div class="pagination">{Math.max(0, slide) + 1} / {list.length}</div>
		{/if}
		{#if list.length > 1}
			<Button
				icon
				transparent
				dense
				size={isModal ? '1' : '0'}
				class="prev"
				onclick={() => prev()}
				tooltip="Previous Item">
				<span class="visuallyhidden">Previous Item</span>
				{@render iconChevronLeft()}
			</Button>
			<Button
				icon
				transparent
				dense
				size={isModal ? '1' : '0'}
				class="next"
				onclick={() => next()}
				tooltip="Next Item">
				<span class="visuallyhidden">Next Item</span>
				{@render iconChevronRight()}
			</Button>
		{/if}
	</div>
{/snippet}

{#snippet slider()}
	{#if sliderActive}
		<div
			class="gallery slider size-{size} radius-{radius}"
			class:modal={isModal}
			class:controls-inline={controls === 'inline' ||
				(controls === 'default' && !isModal)}
			class:controls-overlay={controls === 'overlay' ||
				(controls === 'default' && isModal)}
			class:fullscreen={fullscreenActive}
			style={!isModal && (display === 'slider' || display === 'slideshow') ? style : null}
			style:--aspect-ratio={isModal || !aspect_ratio ? null : aspect_ratio}
			aria-label="Media Gallery Carousel"
			out:carouselCloseTransition
			{@attach intersectionObserver({
				enabled: true,
				onintersectchange: (event) => (intersected = event.isIntersecting),
			})}
			{@attach focusTrap({
				preventScroll: true,
				onPostDeactivate: () => (slide = -1),
				allowOutsideClick: true,
				enabled: isModal,
				escapeDeactivates: (e) => {
					e.stopPropagation();
					return true;
				},
				setReturnFocus: focusTrapSetReturnFocus,
				oninit: (instance) => (focusTrapInstance = instance),
				initialFocus: false,
			})}
			{@attach contextMenu({ actions: flattenActions(actions?.[slide]) })}>
			<div
				class="bg"
				in:fade={{ duration: 350 }}
				out:fade={{ duration: 350 }}
				style:opacity={1 - dismissing}>
			</div>
			<Carousel
				items={list}
				bind:dismissing
				bind:this={carousel}
				bind:slide
				bind:page
				bind:num_pages
				caption_display={meta_display_fullscreen === 'always' && isModal
					? 'always'
					: 'none'}
				animation={(display === 'slider' || display === 'slideshow') &&
				autoplayTransitionTimer &&
				list.length > 1
					? 'zoom'
					: 'none'}
				transition={(display === 'slider' || display === 'slideshow') &&
				autoplayTransitionTimer
					? 'fade'
					: 'none'}
				inline={inline ??
					((display === 'slider' || display === 'slideshow') && !fullscreenActive)}
				{autoplay_video}
				dismissable={isModal}
				disable_entry_exit_animation={display === 'slider' || display === 'slideshow'}
				animation_target={animationTarget}
				{fit}
				{custom}
				oninteraction={() => pause()}
				onclose={() => {
					if (fullscreenActive) return closeFullscreen();
					slide = -1;
				}} />
			{#if meta_display_fullscreen === 'always' && isModal && !captionInPlayer && (list[slide]?.caption || list[slide]?.name)}
				<div class="fullscreen-name" style:opacity={1 - dismissing}>
					{list[slide]?.caption || list[slide]?.name}
				</div>
			{/if}
			{#if controls !== 'disable'}
				{@render sliderControls()}
			{/if}
			<div class="visuallyhidden" aria-live="polite" aria-atomic="true" inert>
				Media Item {slide + 1} of {list.length}
			</div>
		</div>
	{/if}
{/snippet}

{#if (display !== 'slider' && display !== 'slideshow') || isModal}
	<Portal>
		{@render slider()}
	</Portal>
{:else}
	{@render slider()}
{/if}

<style>
	.visuallyhidden {
		border: 0;
		clip: rect(0 0 0 0);
		clip-path: inset(50%);
		height: 1px;
		margin: -1px;
		overflow: hidden;
		padding: 0;
		position: absolute;
		width: 1px;
		white-space: nowrap;
	}

	.pagination {
		white-space: nowrap;
	}

	.list-item-icon {
		display: inline-flex;
		align-items: center;
		padding-right: 0.5rem;
		font-size: 1.1rem;
	}

	.list-item-icon :global(svg),
	.icon :global(svg) {
		width: 1em;
		height: 1em;
	}

	.gallery {
		/* Galleries are the largest surface and reach --radius-3xl at their
		   biggest size by design, so they clamp each radius tier to that ceiling
		   rather than the smaller shared --radius-cap: an over-rounded radius
		   token can't blob a gallery, while the shipped looks (incl. the 3xl
		   tier) are never clipped. Private (--_cap) so the raised ceiling doesn't
		   leak to nested components. Both radius systems funnel through these:
		   the slider .bg/.carousel/.controls use them directly, and the grid/
		   masonry size remaps assign them to --radius-lg. */
		--_cap: var(--radius-3xl, 60px);
		--_rxl: min(var(--radius-xl, 0.75rem), var(--_cap));
		--_r2xl: min(var(--radius-2xl, 1rem), var(--_cap));
		--_r3xl: min(var(--radius-3xl, 1.5rem), var(--_cap));

		/* The outside gap: the padding around grid/masonry/masonry-row layouts
		   that matches the interior gap. The default is "auto" — a pure-CSS step
		   function that keeps the gap only when the gallery is full-bleed. The
		   percentage resolves (at the padding site) against the containing
		   block, so `100% - 100vw` is ~0 for a full-bleed parent and steeply
		   negative inside a narrower container; the 32px slack absorbs a classic
		   desktop scrollbar (100vw includes it, the parent doesn't), and the
		   ×999 turns the difference into a hard on/off clamped to [0, gap]. */
		--gallery-outside-gap: clamp(
			0px,
			(100% - 100vw + 32px) * 999,
			var(--gallery-gap, 12px)
		);
		&.outside-gap-on {
			--gallery-outside-gap: var(--gallery-gap, 12px);
		}
		&.outside-gap-off {
			--gallery-outside-gap: 0px;
		}
	}

	.gallery-item {
		position: relative;
		display: grid;
		grid-template-rows: 1fr;
		grid-template-columns: 1fr;
		cursor: pointer;
		border-radius: var(--radius-lg);
		@supports (corner-shape: squircle) {
			corner-shape: squircle;
			border-radius: calc(var(--radius-lg) * var(--squircle-ratio, 2));
		}
		isolation: isolate;
		overflow: hidden;
		transition:
			box-shadow 150ms ease,
			scale 150ms ease;
		box-shadow: var(--shadow-sm);
		background-color: var(--color-bg-muted, var(--bg-high));

		.image {
			position: absolute;
			inset: 0;
			transition: transform 150ms ease;
			transform: scale(1);
			will-change: transform;
			overflow: hidden;
		}
		.thumbnail-blur,
		.thumbnail-img,
		.thumbnail-video,
		.thumbnail-placeholder {
			position: absolute;
			inset: 0;
			width: 100%;
			height: 100%;
			object-fit: cover;
			display: block;
		}
		.thumbnail-blur {
			z-index: 0;
			filter: blur(24px) saturate(1.2) contrast(1.05);
			transform: scale(1.2);
			pointer-events: none;
			user-select: none;
		}
		.thumbnail-placeholder {
			z-index: 0;
			background: linear-gradient(
				135deg,
				light-dark(rgba(0, 0, 0, 0.04), rgba(255, 255, 255, 0.04)),
				light-dark(rgba(0, 0, 0, 0.1), rgba(255, 255, 255, 0.1))
			);
		}
		.thumbnail-img,
		.thumbnail-video {
			z-index: 1;
			opacity: 1;
			transform: scale(1);
			transition:
				opacity 400ms ease,
				transform 700ms cubic-bezier(0.22, 1, 0.36, 1);
			&.no-blur {
				transition:
					opacity 250ms ease,
					transform 400ms ease;
			}
			/* JS adds .fading after mount only when the image isn't already loaded.
			   When .fading is removed (on `onload`), the default transition above
			   smoothly fades the image in over the blur. */
			&.fading {
				opacity: 0;
				transform: scale(1.04);
				transition: none;
			}
		}

		&:active {
			scale: 0.98;
		}
		&:hover {
			box-shadow: var(--shadow-md);
			.image {
				opacity: 0.97;
				transform: scale(1.018);
			}
		}
		&:focus {
			outline: solid 4px var(--color-text, var(--text));
		}
		&:focus:not(:focus-visible) {
			outline: none;
		}
		> :global(*) {
			grid-row: 1 / 1;
			grid-column: 1 / 1;
			position: relative;
		}
		.icon {
			display: flex;
			align-items: center;
			justify-content: center;
			justify-self: center;
			align-self: center;
			color: white;
			background-color: rgba(0, 0, 0, 0.6);
			border-radius: 100%;
			width: min(max(20%, 3rem), 7rem);
			aspect-ratio: 1 / 1;
			padding: 0.5rem;
			backdrop-filter: blur(10px);
			:global(svg) {
				width: max(2rem, 70%);
				height: max(2rem, 70%);
			}
		}
		.name {
			position: absolute;
			bottom: 0;
			left: 0;
			right: 0;
			width: 100%;
			color: white;
			background-color: rgba(0, 0, 0, 0.6);
			padding: max(0.5rem, calc(var(--radius-lg, 0px) / 2))
				max(1rem, var(--radius-lg, 0px));
			text-overflow: ellipsis;
			overflow: hidden;
			white-space: nowrap;
			backdrop-filter: blur(5px);
			&.hover-only {
				transition: transform 250ms ease;
				backdrop-filter: none;
				transform: translate3d(0, 100%, 0);
			}
		}
		.actions {
			position: absolute;
			top: max(4px, min(16px, var(--radius-lg, 0px)));
			right: max(4px, min(16px, var(--radius-lg, 0px)));
			z-index: 2;
			display: flex;
			gap: 0.25rem;
			&.hover-only {
				opacity: 0;
				transition: opacity 250ms ease;
			}
		}
		&:focus-visible,
		&:has(.actions:focus-within) {
			.actions {
				opacity: 1;
			}
			.name {
				transform: translate3d(0px, 0px, 0px);
			}
		}

		@media (hover: hover) and (pointer: fine) {
			&:hover {
				.name.hover-only {
					transform: translate3d(0px, 0px, 0px);
				}
				.actions.hover-only {
					opacity: 1;
				}
			}
		}
		@media not ((hover: hover) and (pointer: fine)) {
			.actions.hover-only {
				display: none;
			}
		}
	}

	.gallery.slider {
		z-index: 1;
		perspective: 100px;
		perspective-origin: center center;
		user-select: none;
		-webkit-user-select: none;
		-webkit-tap-highlight-color: transparent;
		transform: translateZ(0px);
		position: relative;
		margin: 0 auto;

		:global(.carousel) {
			position: relative;
			z-index: 1;
			height: 100%;
		}
		.bg {
			position: absolute;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			z-index: -1;
		}

		.controls {
			display: flex;
			position: absolute;
			align-items: center;
			bottom: 0;
			left: 0;
			right: 0;
			width: 100%;
			height: 3.5rem;
			gap: 1rem;
			padding: 0 1rem;
			pointer-events: none;
			:global(.button) {
				pointer-events: all;
			}
			.spacer {
				flex: 1;
			}
		}

		nav.pages {
			position: absolute;
			z-index: 2;
			display: flex;
			align-items: center;
			gap: 0.125rem;
			padding-inline: 0.25rem;
			/* Show/hide via CSS (no remount) so the entry animation can't replay
			   as num_pages settles during PDF load. */
			transform-origin: center center;
			opacity: 0;
			scale: 0.6;
			visibility: hidden;
			transition:
				opacity 300ms cubic-bezier(0.34, 1.56, 0.64, 1),
				scale 300ms cubic-bezier(0.34, 1.56, 0.64, 1),
				visibility 0s linear 300ms;
			&.shown {
				opacity: 1;
				scale: 1;
				visibility: visible;
				transition:
					opacity 300ms cubic-bezier(0.34, 1.56, 0.64, 1),
					scale 300ms cubic-bezier(0.34, 1.56, 0.64, 1),
					visibility 0s linear 0s;
			}
			/* Force a high-contrast white pill so the page numbers are
			   readable on top of any media (dark images, videos, PDFs,
			   panoramas) inside a modal. The inherited button colors
			   pick this up via --color-text. */
			color: #1e293b;
			--color-text: #1e293b;
			--color-action: #3b82f6;
			background-color: #ffffff;
			border-radius: 9999px;
			box-shadow:
				0 4px 12px rgb(0 0 0 / 0.18),
				0 1px 3px rgb(0 0 0 / 0.12);
			border: none;
			outline: none;
			font-weight: 500;

			.page-counter {
				display: inline-flex;
				align-items: baseline;
				gap: 0.25rem;
				min-width: 4rem;
				justify-content: center;
				padding-inline: 0.5rem;
				font-variant-numeric: tabular-nums;
				font-size: 1.35rem;
				line-height: 1;
				user-select: none;
			}

			.page-separator {
				opacity: 0.4;
				font-weight: 400;
			}

			/* The chevron Buttons inherit `--color-text` from the pill. The
			   `disabled` attribute lives on the inner <button> rendered by
			   `Button.svelte`, so dim the wrapper via :has() — the transparent
			   variant has no background of its own to dim otherwise. */
			:global(.button:has(> button[disabled])) {
				opacity: 0.3;
				cursor: default;
			}
		}

		.pagination {
			z-index: 1;
		}

		:global(.play svg.progress) {
			stroke-width: 3;
			stroke-dasharray: 163.41;
			stroke-dashoffset: calc(163.41 - (163.41 * var(--progress, 0)));
			transition: stroke-dashoffset var(--speed, 300ms) linear;
			width: 70%;
			height: 70%;
			stroke: white;
			fill: none;
			transform: rotate(-90deg) !important;
			transform-origin: center center;
			opacity: 0.25;
			position: absolute;
			top: 15%;
			left: 15%;
		}
	}

	.gallery.slider:not(.modal) {
		container: gallery-slider / inline-size;
		:global(.carousel) {
			aspect-ratio: var(--aspect-ratio);
		}
		.bg {
			background-color: var(--color-bg-muted, var(--bg-high));
		}
		&.size-0 {
			--aspect-ratio: 1 / 1;
			height: auto;
			&.radius-1 {
				.bg,
				:global(.carousel) {
					@container (min-width: 80ch) {
						border-radius: var(--radius-lg, 0.5rem);
						@supports (corner-shape: squircle) {
							corner-shape: squircle;
							border-radius: calc(var(--radius-lg, 0.5rem) * var(--squircle-ratio, 2));
						}
					}
				}
			}
			&.radius-2 {
				.bg,
				:global(.carousel) {
					@container (min-width: 80ch) {
						border-radius: var(--_rxl);
						@supports (corner-shape: squircle) {
							corner-shape: squircle;
							border-radius: calc(var(--_rxl) * var(--squircle-ratio, 2));
						}
					}
				}
			}
			&.radius-3 {
				.bg,
				:global(.carousel) {
					@container (min-width: 80ch) {
						border-radius: var(--_r2xl);
						@supports (corner-shape: squircle) {
							corner-shape: squircle;
							border-radius: calc(var(--_r2xl) * var(--squircle-ratio, 2));
						}
					}
				}
			}
		}
		&.size-1 {
			&.radius-1 {
				.bg,
				:global(.carousel) {
					@container (min-width: 1200px) {
						border-radius: var(--_rxl);
						@supports (corner-shape: squircle) {
							corner-shape: squircle;
							border-radius: calc(var(--_rxl) * var(--squircle-ratio, 2));
						}
					}
				}
			}
			&.radius-2 {
				.bg,
				:global(.carousel) {
					@container (min-width: 1200px) {
						border-radius: var(--_r2xl);
						@supports (corner-shape: squircle) {
							corner-shape: squircle;
							border-radius: calc(var(--_r2xl) * var(--squircle-ratio, 2));
						}
					}
				}
			}
			&.radius-3 {
				.bg,
				:global(.carousel) {
					@container (min-width: 1200px) {
						border-radius: var(--_r3xl);
						@supports (corner-shape: squircle) {
							corner-shape: squircle;
							border-radius: calc(var(--_r3xl) * var(--squircle-ratio, 2));
						}
					}
				}
			}
		}
	}

	.gallery.slider:not(.modal).controls-overlay {
		&.radius-1 {
			.controls {
				border-top-left-radius: var(--_rxl);
				border-top-right-radius: var(--_rxl);
				@supports (corner-shape: squircle) {
					corner-shape: squircle;
					border-top-left-radius: calc(var(--_rxl) * var(--squircle-ratio, 2));
					border-top-right-radius: calc(var(--_rxl) * var(--squircle-ratio, 2));
				}
			}
		}
		&.radius-2 {
			.controls {
				border-top-left-radius: var(--_r2xl);
				border-top-right-radius: var(--_r2xl);
				border-bottom-left-radius: var(--_r2xl);
				border-bottom-right-radius: var(--_r2xl);
				@supports (corner-shape: squircle) {
					corner-shape: squircle;
					border-top-left-radius: calc(var(--_r2xl) * var(--squircle-ratio, 2));
					border-top-right-radius: calc(var(--_r2xl) * var(--squircle-ratio, 2));
					border-bottom-left-radius: calc(var(--_r2xl) * var(--squircle-ratio, 2));
					border-bottom-right-radius: calc(var(--_r2xl) * var(--squircle-ratio, 2));
				}
			}
		}
		&.radius-3 {
			.controls {
				border-top-left-radius: var(--_r3xl);
				border-top-right-radius: var(--_r3xl);
				border-bottom-left-radius: var(--_r3xl);
				border-bottom-right-radius: var(--_r3xl);
				@supports (corner-shape: squircle) {
					corner-shape: squircle;
					border-top-left-radius: calc(var(--_r3xl) * var(--squircle-ratio, 2));
					border-top-right-radius: calc(var(--_r3xl) * var(--squircle-ratio, 2));
					border-bottom-left-radius: calc(var(--_r3xl) * var(--squircle-ratio, 2));
					border-bottom-right-radius: calc(var(--_r3xl) * var(--squircle-ratio, 2));
				}
			}
		}
		.controls {
			z-index: 2;
			justify-content: center;
			> .spacer {
				display: none;
			}
			background-color: color-mix(
				in oklch,
				var(--color-bg-muted, var(--bg-high)),
				transparent 30%
			);
			backdrop-filter: blur(10px);
			width: fit-content;
			left: 50%;
			transform: translateX(-50%);
			padding: 0.25rem;
			gap: 0.5rem;
		}
	}
	.gallery.slider.modal.controls-overlay {
		.controls {
			z-index: 3;
			bottom: 0.5rem;
			gap: 0.5rem;
			nav.pages {
				left: 50%;
				transform: translate3d(-50%, 0, 0);
				bottom: 3.5rem;
				z-index: 2;
			}
			/* The lightbox backdrop is always dark regardless of light/dark mode,
			   so don't let the transparent Button variant's light-dark() tokens
			   leak in (its light-mode --color-text-active is near-black). Pin a
			   fixed dark-surface palette: white icons on a translucent white pill
			   that gets *brighter* on hover, never darker. */
			:global(> .button),
			.actions :global(> .button) {
				--color-text: rgb(255 255 255 / 0.92);
				--color-text-active: #ffffff;
				--color-text-disabled: rgb(255 255 255 / 0.4);
				--color-bg: rgb(255 255 255 / 0.12);
				--color-bg-active: rgb(255 255 255 / 0.28);
			}
			:global(> .button button),
			.actions :global(> .button button) {
				backdrop-filter: blur(8px);
			}
			.pagination {
				margin: 0 0.5rem;
			}
			.actions {
				position: absolute;
				bottom: 0;
				left: 5rem;
				z-index: 2;
				display: flex;
				:global(> .button button svg) {
					filter: drop-shadow(0px 0px 1px rgba(0, 0, 0, 0.95))
						drop-shadow(0px 0px 3px rgba(0, 0, 0, 0.25))
						drop-shadow(0px 0px 10px rgba(0, 0, 0, 0.5));
				}
			}

			@media (min-width: 768px) {
				nav.pages {
					bottom: 1rem;
				}
				display: block;
				position: static;
				height: unset;
				width: unset;
				bottom: unset;
				left: unset;
				right: unset;
				:global(> .button) {
					bottom: 1rem;
					position: absolute;
				}
				:global(> .button button svg) {
					filter: drop-shadow(0px 0px 1px rgba(0, 0, 0, 0.95))
						drop-shadow(0px 0px 3px rgba(0, 0, 0, 0.25))
						drop-shadow(0px 0px 10px rgba(0, 0, 0, 0.5));
				}
				.actions {
					position: absolute;
					top: 4.75rem;
					right: 0.875rem;
					left: unset;
					bottom: unset;
					display: flex;
					flex-direction: column;
					justify-content: center;
					align-items: center;
				}
				.pagination {
					position: absolute;
					font-size: 1.5rem;
					top: 0.875rem;
					right: 4.25rem;
					height: 3rem;
					margin: 0;
					display: flex;
					align-items: center;
					text-align: right;
					z-index: 2;
					backdrop-filter: blur(5px);
					padding: 0 1rem;
					border-radius: 9999px;
				}
				:global(.play) {
					z-index: 2;
				}
				:global(.close) {
					right: 0.875rem;
					top: 0.875rem;
					z-index: 2;
					/* Nudge the dismiss control up a touch. The icon button sizes
					   off its own font-size (× --control-height-ratio), so bumping
					   the font scales the pill AND the icon together, keeping the
					   translucent-white-pill language intact. */
					font-size: 1.15rem;
				}
				:global(.prev),
				:global(.next) {
					top: 50%;
					transform: translateY(-50%);
					bottom: unset;
					width: 4.5rem;
					height: min(20rem, 50%);
					aspect-ratio: auto;
					box-shadow: none;
					cursor: pointer;
					z-index: 2;
					/* These stretch into full-height edge strips on desktop — hit
					   areas, not pills. Keep them invisible at rest (no white slab,
					   no blur) and brighten with only a soft white wash on hover. */
					--color-bg: transparent;
					--color-bg-active: rgb(255 255 255 / 0.08);
				}
				:global(.prev button),
				:global(.next button) {
					backdrop-filter: none;
				}
				:global(.prev button svg),
				:global(.next button svg) {
					height: 80%;
					width: 80%;
				}
				:global(.prev) {
					left: 0;
					padding-left: 0.5rem;
				}
				:global(.next) {
					right: 0;
					padding-right: 0.5rem;
				}
			}
		}
	}
	.gallery.slider.controls-inline {
		nav.pages {
			top: -4.5rem;
			bottom: unset;
		}
		.controls {
			justify-content: center;
			gap: 0;
			top: 100%;
			bottom: unset;
			@container (max-width: 500px) {
				gap: 0.5rem;
				padding: 0;
				.pagination {
					padding: 0 0.5rem;
					font-size: 1rem;
				}
			}
			.spacer {
				display: none;
				flex: 0;
			}
		}
		.controls > .pagination {
			color: var(--color-text, var(--text));
			margin: 0 1rem;
			font-weight: normal;
			font-size: 1.5rem;
		}
		.controls > :global(.play) {
			svg.progress {
				stroke: var(--color-text-muted);
				opacity: 1;
			}
		}
	}

	.gallery.slider.modal {
		position: fixed;
		z-index: var(--layer-modal, 1000);
		top: 0;
		left: 0;
		bottom: 0;
		width: 100%;
		height: 100%;
		.bg {
			background-color: rgba(0, 0, 0, 0.85);
			@supports (backdrop-filter: blur(25px)) {
				filter: blur(0px);
				backdrop-filter: blur(25px);
				background-color: rgba(0, 0, 0, 0.7);
			}
		}
		&.fullscreen {
			.bg {
				background-color: black !important;
				opacity: 1 !important;
			}
		}
		:global(.carousel) {
			aspect-ratio: var(--aspect-ratio);
			height: calc(100% - 4.5rem);
		}
		@media (min-width: 768px) {
			:global(.carousel) {
				height: 100%;
			}
		}

		.fullscreen-name {
			position: absolute;
			bottom: 0;
			left: 0;
			right: 0;
			z-index: 2;
			pointer-events: none;
			&::before {
				content: '';
				position: absolute;
				inset: 0;
				background-image: linear-gradient(to top, rgba(0, 0, 0, 0.95), rgba(0, 0, 0, 0));
				z-index: -1;
			}
			text-align: center;
			color: white;
			font-size: var(--text-base, 1rem);
			padding: 6rem 1rem 5rem;
			text-shadow:
				0 1px 2px rgba(0, 0, 0, 0.5),
				0 0 10px rgba(0, 0, 0, 0.3);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			transition: opacity 1000ms ease;
			@starting-style {
				opacity: 0;
			}
		}
		@media (min-width: 768px) {
			.fullscreen-name {
				padding: 3rem 5rem 1rem;
			}
		}

		.pagination {
			font-size: 1.3rem;
			color: white;
			text-shadow:
				1px 1px 0 rgba(0, 0, 0, 0.5),
				1px 1px 10px rgba(0, 0, 0, 0.5),
				0 0 40px black;
			font-weight: bold;
		}
	}

	.gallery.display-masonry {
		width: 100%;
		margin-inline: auto;
		display: grid;
		grid-auto-flow: dense;
		gap: var(--gallery-gap, 12px);
		padding: 0 var(--gallery-outside-gap) var(--gallery-outside-gap);
		max-width: 2160px;
		grid-auto-rows: 1fr;
		--cols: 4;
		--cols-per-image: 8;
		--cols-desktop: calc(var(--cols) * var(--cols-per-image));
		--cols-tablet: max(
			var(--cols-per-image),
			calc(
				round((var(--cols-desktop) * 0.75) / var(--cols-per-image), 1) *
					var(--cols-per-image)
			)
		);
		--cols-phone: max(
			var(--cols-per-image),
			calc(
				round((var(--cols-desktop) * 0.45) / var(--cols-per-image), 1) *
					var(--cols-per-image)
			)
		);
		grid-template-columns: repeat(var(--cols-phone), minmax(0, 1fr));
		@container (min-width: 768px) {
			grid-template-columns: repeat(var(--cols-tablet), minmax(0, 1fr));
		}
		@container (min-width: 1024px) {
			grid-template-columns: repeat(var(--cols-desktop), minmax(0, 1fr));
		}

		&.radius-0 {
			--radius-lg: 0px;
		}

		&.size-00 {
			--cols: 8;
			.name {
				font-size: 0.8rem;
			}
			&.radius-1 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.4);
			}
			&.radius-2 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.6);
			}
			&.radius-3 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.8);
			}
			&.spacing-0 {
				--gallery-gap: 0px;
			}
			&.spacing-1 {
				--gallery-gap: min(6px, 1.5cqw);
			}
			&.spacing-2 {
				--gallery-gap: min(10px, 1.5cqw);
			}
			&.spacing-3 {
				--gallery-gap: min(16px, 1.5cqw);
			}
		}
		&.size-0 {
			--cols: 6;
			.name {
				font-size: 0.9rem;
			}
			&.radius-1 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.45);
			}
			&.radius-2 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.65);
			}
			&.radius-3 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.85);
			}
			&.spacing-0 {
				--gallery-gap: 0px;
			}
			&.spacing-1 {
				--gallery-gap: min(8px, 1.5cqw);
			}
			&.spacing-2 {
				--gallery-gap: min(14px, 1.5cqw);
			}
			&.spacing-3 {
				--gallery-gap: min(20px, 1.5cqw);
			}
		}
		&.size-1 {
			--cols: 4;
			&.radius-1 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.45);
			}
			&.radius-2 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.8);
			}
			&.radius-3 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 1.1);
			}
			&.spacing-0 {
				--gallery-gap: 0px;
			}
			&.spacing-1 {
				--gallery-gap: min(10px, 3cqw);
			}
			&.spacing-2 {
				--gallery-gap: min(16px, 3cqw);
			}
			&.spacing-3 {
				--gallery-gap: min(24px, 3cqw);
			}
		}
		&.size-2 {
			--cols: 3;
			&.radius-1 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.5);
			}
			&.radius-2 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 1);
			}
			&.radius-3 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 1.4);
			}
			&.spacing-0 {
				--gallery-gap: 0px;
			}
			&.spacing-1 {
				--gallery-gap: min(12px, 5cqw);
			}
			&.spacing-2 {
				--gallery-gap: min(20px, 5cqw);
			}
			&.spacing-3 {
				--gallery-gap: min(28px, 5cqw);
			}
		}
		&.size-3 {
			--cols: 2;
			&.radius-1 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.5);
			}
			&.radius-2 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 1.1);
			}
			&.radius-3 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 1.5);
			}
			&.spacing-0 {
				--gallery-gap: 0px;
			}
			&.spacing-1 {
				--gallery-gap: min(14px, 5cqw);
			}
			&.spacing-2 {
				--gallery-gap: min(24px, 5cqw);
			}
			&.spacing-3 {
				--gallery-gap: min(34px, 5cqw);
			}
		}

		&::before {
			content: '';
			width: 0;
			padding-bottom: 100%;
			grid-row: 1 / 1;
			grid-column: 1 / 1;
			aspect-ratio: 1;
		}

		> .gallery-item {
			grid-column-end: span var(--cols-per-image);
			grid-row-end: span max(1, calc(var(--cols-per-image) * 1 / var(--ratio, 1)));
			&.favorite {
				--zero-if-one-column: min(
					round(down, calc((var(--cols-phone) / var(--cols-per-image)) - 1), 1),
					1
				);
				--favorite-cols: calc(
					var(--cols-per-image) + var(--cols-per-image) * var(--zero-if-one-column)
				);
				grid-column-end: span calc(var(--cols-per-image) * 2);
				grid-row-end: span
					max(1, round(down, calc(var(--cols-per-image) * 2 / var(--ratio, 1)), 1));
				@container (max-width: 767px) {
					grid-column-end: span var(--favorite-cols);
					grid-row-end: span
						max(1, round(down, calc(var(--favorite-cols) * 1 / var(--ratio, 1)), 1));
				}
			}
			&:first-child {
				grid-column-start: 1;
				grid-row-start: 1;
			}
		}
	}

	.gallery.display-grid {
		width: 100%;
		margin-inline: auto;
		display: grid;
		grid-auto-flow: dense;
		gap: var(--gallery-gap, 12px);
		padding: 0 var(--gallery-outside-gap) var(--gallery-outside-gap);
		max-width: 2160px;
		grid-auto-rows: 1fr;
		container: gallery-grid / inline-size;

		&.radius-0 {
			--radius-lg: 0px;
		}
		&.size-00 {
			grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
			.name {
				font-size: 0.7rem;
			}
			&.radius-1 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.3);
			}
			&.radius-2 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.45);
			}
			&.radius-3 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.6);
			}
			&.spacing-0 {
				--gallery-gap: 0px;
			}
			&.spacing-1 {
				--gallery-gap: min(6px, 1.5cqw);
			}
			&.spacing-2 {
				--gallery-gap: min(10px, 1.5cqw);
			}
			&.spacing-3 {
				--gallery-gap: min(16px, 1.5cqw);
			}
			@container (min-width: 768px) {
				grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
			}
		}
		&.size-0 {
			grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
			.name {
				font-size: 0.8rem;
			}
			&.radius-1 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.35);
			}
			&.radius-2 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.55);
			}
			&.radius-3 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.75);
			}
			&.spacing-0 {
				--gallery-gap: 0px;
			}
			&.spacing-1 {
				--gallery-gap: min(8px, 1.5cqw);
			}
			&.spacing-2 {
				--gallery-gap: min(14px, 1.5cqw);
			}
			&.spacing-3 {
				--gallery-gap: min(20px, 1.5cqw);
			}
			@container (min-width: 768px) {
				grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
			}
		}
		&.size-1 {
			grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
			&.radius-1 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.45);
			}
			&.radius-2 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.8);
			}
			&.radius-3 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 1.1);
			}
			&.spacing-0 {
				--gallery-gap: 0px;
			}
			&.spacing-1 {
				--gallery-gap: min(10px, 3cqw);
			}
			&.spacing-2 {
				--gallery-gap: min(16px, 3cqw);
			}
			&.spacing-3 {
				--gallery-gap: min(24px, 3cqw);
			}
			@container (min-width: 768px) {
				grid-template-columns: repeat(auto-fill, minmax(225px, 1fr));
			}
		}
		&.size-2 {
			grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
			&.radius-1 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.5);
			}
			&.radius-2 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 1);
			}
			&.radius-3 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 1.4);
			}
			&.spacing-0 {
				--gallery-gap: 0px;
			}
			&.spacing-1 {
				--gallery-gap: min(12px, 5cqw);
			}
			&.spacing-2 {
				--gallery-gap: min(20px, 5cqw);
			}
			&.spacing-3 {
				--gallery-gap: min(28px, 5cqw);
			}
			@container (min-width: 768px) {
				grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
			}
		}
		&.size-3 {
			grid-template-columns: repeat(auto-fill, minmax(440px, 1fr));
			&.radius-1 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.5);
			}
			&.radius-2 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 1.1);
			}
			&.radius-3 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 1.5);
			}
			&.spacing-0 {
				--gallery-gap: 0px;
			}
			&.spacing-1 {
				--gallery-gap: min(14px, 5cqw);
			}
			&.spacing-2 {
				--gallery-gap: min(24px, 5cqw);
			}
			&.spacing-3 {
				--gallery-gap: min(34px, 5cqw);
			}
			@container (min-width: 768px) {
				grid-template-columns: repeat(auto-fill, minmax(520px, 1fr));
			}
		}

		&::before {
			content: '';
			width: 0;
			padding-bottom: 100%;
			grid-row: 1 / 1;
			grid-column: 1 / 1;
			aspect-ratio: 1;
		}

		> .gallery-item {
			grid-row-end: span 1;
			grid-column-end: span 1;
			&.favorite {
				grid-column-end: span 2;
				grid-row-end: span 2;
			}
			&:first-child {
				grid-column-start: 1;
				grid-row-start: 1;
			}
		}
	}

	.gallery.display-masonry-row {
		--row-height: 250px;
		--max-row-height: 350px;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--gallery-gap, 12px);
		padding: 0 var(--gallery-outside-gap) var(--gallery-outside-gap);
		max-width: 2160px;
		margin-inline: auto;

		&.radius-0 {
			--radius-lg: 0px;
		}
		&.size-00 {
			--row-height: 45px;
			--max-row-height: 75px;
			&.radius-1 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.4);
			}
			&.radius-2 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.5);
			}
			&.radius-3 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.65);
			}
			&.spacing-0 {
				--gallery-gap: 0px;
			}
			&.spacing-1 {
				--gallery-gap: min(6px, 1.5cqw);
			}
			&.spacing-2 {
				--gallery-gap: min(10px, 1.5cqw);
			}
			&.spacing-3 {
				--gallery-gap: min(16px, 1.5cqw);
			}
			@container (min-width: 768px) {
				--row-height: 100px;
				--max-row-height: 140px;
			}
		}
		&.size-0 {
			--row-height: 70px;
			--max-row-height: 110px;
			&.radius-1 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.45);
			}
			&.radius-2 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.55);
			}
			&.radius-3 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.75);
			}
			&.spacing-0 {
				--gallery-gap: 0px;
			}
			&.spacing-1 {
				--gallery-gap: min(8px, 1.5cqw);
			}
			&.spacing-2 {
				--gallery-gap: min(14px, 1.5cqw);
			}
			&.spacing-3 {
				--gallery-gap: min(20px, 1.5cqw);
			}
			@container (min-width: 768px) {
				--row-height: 150px;
				--max-row-height: 200px;
			}
		}
		&.size-1 {
			--row-height: 100px;
			--max-row-height: 150px;
			&.radius-1 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.35);
			}
			&.radius-2 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.5);
			}
			&.radius-3 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.7);
			}

			&.spacing-0 {
				--gallery-gap: 0px;
			}
			&.spacing-1 {
				--gallery-gap: min(10px, 3cqw);
			}
			&.spacing-2 {
				--gallery-gap: min(16px, 3cqw);
			}
			&.spacing-3 {
				--gallery-gap: min(24px, 3cqw);
			}
			@container (min-width: 768px) {
				--row-height: 200px;
				--max-row-height: 300px;
				&.radius-1 {
					--radius-lg: calc(var(--gallery-gap, 12px) * 0.45);
				}
				&.radius-2 {
					--radius-lg: calc(var(--gallery-gap, 12px) * 0.8);
				}
				&.radius-3 {
					--radius-lg: calc(var(--gallery-gap, 12px) * 1.1);
				}
			}
		}
		&.size-2 {
			--row-height: 250px;
			--max-row-height: 350px;
			&.radius-1 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.5);
			}
			&.radius-2 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 1);
			}
			&.radius-3 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 1.4);
			}
			&.spacing-0 {
				--gallery-gap: 0px;
			}
			&.spacing-1 {
				--gallery-gap: min(12px, 5cqw);
			}
			&.spacing-2 {
				--gallery-gap: min(20px, 5cqw);
			}
			&.spacing-3 {
				--gallery-gap: min(28px, 5cqw);
			}
			@container (max-width: 767px) {
				--max-row-height: 700px;
			}
		}
		&.size-3 {
			--row-height: 350px;
			--max-row-height: 500px;
			&.radius-1 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 0.5);
			}
			&.radius-2 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 1.1);
			}
			&.radius-3 {
				--radius-lg: calc(var(--gallery-gap, 12px) * 1.5);
			}
			&.spacing-0 {
				--gallery-gap: 0px;
			}
			&.spacing-1 {
				--gallery-gap: min(14px, 5cqw);
			}
			&.spacing-2 {
				--gallery-gap: min(24px, 5cqw);
			}
			&.spacing-3 {
				--gallery-gap: min(34px, 5cqw);
			}
			@container (max-width: 767px) {
				--max-row-height: 850px;
			}
		}

		> .gallery-item {
			flex-basis: calc(var(--ratio, 1) * var(--row-height));
			flex-grow: calc(var(--ratio, 1) * 100);
			aspect-ratio: var(--ratio, 1);
			max-height: var(--max-row-height);
			max-width: calc(var(--ratio, 1) * var(--max-row-height) * 1.1);
		}
	}

	.gallery.display-list {
		display: flex;
		flex-direction: column;
		max-width: 600px;
		margin-inline: auto;
		/* Size-driven scale: row height, horizontal padding, body text and the
		   square thumbnail all key off these so smaller sizes feel uniformly
		   tighter and larger sizes uniformly roomier. */
		--line-height: 3.5rem;
		--list-pad: 9px;
		--list-text-size: 1rem;
		--thumb-size: calc(var(--line-height) * 0.72);

		&.radius-0 {
			--radius-lg: 0px;
			.info {
				border-radius: 0px !important;
			}
		}
		&.radius-1 {
			--radius-lg: calc(var(--line-height) * 0.1);
		}
		&.radius-2 {
			--radius-lg: calc(var(--line-height) * 0.15);
		}
		&.radius-3 {
			--radius-lg: calc(var(--line-height) * 0.2);
		}
		&.size-00 {
			--line-height: 2.25rem;
			--list-pad: 3px;
			--list-text-size: 0.78rem;
		}
		&.size-0 {
			--line-height: 2.75rem;
			--list-pad: 6px;
			--list-text-size: 0.88rem;
		}
		&.size-1 {
			--line-height: 3.5rem;
			--list-pad: 9px;
			--list-text-size: 1rem;
		}
		&.size-2 {
			--line-height: 4.5rem;
			--list-pad: 13px;
			--list-text-size: 1.15rem;
		}
		&.size-3 {
			--line-height: 5.5rem;
			--list-pad: 17px;
			--list-text-size: 1.3rem;
		}

		> .list-item {
			display: flex;
			height: var(--line-height);
			align-items: center;
			/* No padding here: the clickable .info fills the row edge-to-edge so
			   hover/press feedback can never appear on a non-clickable sliver.
			   The content inset lives on .info instead. */
			padding: 0;
			position: relative;
			z-index: 1;
			overflow: hidden;
			/* Drives the subtle 3D push of the inner row on press, matching ListItem. */
			perspective: 100px;

			/* Subtle text-tinted divider between rows, matching ListItem. */
			&::after {
				content: '';
				position: absolute;
				top: 0;
				left: var(--list-pad);
				right: var(--list-pad);
				border-top: solid 1px color-mix(in oklch, transparent, var(--color-text) 6%);
				pointer-events: none;
				z-index: 1;
			}
			&:first-child::after {
				content: none;
			}

			.info {
				display: flex;
				flex: 1;
				min-width: 0;
				cursor: pointer;
				align-items: center;
				position: relative;
				overflow: hidden;
				/* Fill the full row height + width so the whole visible area of the
				   row is the click target — feedback and clickability stay in sync. */
				align-self: stretch;
				padding: 0 calc(var(--list-pad) - 2px);
				border-radius: calc(var(--radius-lg) + var(--list-pad));
				@supports (corner-shape: squircle) {
					corner-shape: squircle;
					border-radius: calc(
						(var(--radius-lg) + var(--list-pad)) * var(--squircle-ratio, 2)
					);
				}
				/* Press effect, matching ListItem's translate-on-active. */
				transition: translate 200ms ease;

				/* Hover/active background overlay (text @ 6%), matching ListItem.
				   It lives on .info (the click target), not the row, so it only
				   ever shows where the user can actually click. */
				&::before {
					content: '';
					position: absolute;
					top: 2px;
					left: 0;
					right: 0;
					bottom: 2px;
					background-color: var(--color-text);
					opacity: 0;
					border-radius: var(--radius-lg);
					@supports (corner-shape: squircle) {
						corner-shape: squircle;
						border-radius: calc(var(--radius-lg) * var(--squircle-ratio, 2));
					}
					z-index: -1;
					transition: opacity 300ms ease;
				}
				@media (hover: hover) and (pointer: fine) {
					&:hover {
						&::before {
							opacity: 0.06;
							transition: opacity 0ms ease;
						}
						/* Image gently zooms inside its (overflow-hidden) square. */
						.thumbnail-img,
						.thumbnail-video {
							transform: scale(1.08);
						}
						.thumbnail-blur {
							transform: scale(1.32);
						}
					}
				}
				&:active {
					translate: 0px 2px clamp(-4px, calc(0.2em - 12px), -2px);
				}
				&:focus-visible {
					outline: none;
					&::after {
						content: '';
						position: absolute;
						inset: 2px 0;
						border: solid 1px var(--color-border-active);
						border-radius: var(--radius-lg);
						@supports (corner-shape: squircle) {
							corner-shape: squircle;
							border-radius: calc(var(--radius-lg) * var(--squircle-ratio, 2));
						}
						pointer-events: none;
					}
				}
				.thumbnail {
					flex-shrink: 0;
					width: var(--thumb-size);
					height: var(--thumb-size);
					position: relative;
					color: white;
					display: flex;
					align-items: center;
					justify-content: center;
					border-radius: var(--radius-lg);
					@supports (corner-shape: squircle) {
						corner-shape: squircle;
						border-radius: calc(var(--radius-lg) * var(--squircle-ratio, 2));
					}
					overflow: hidden;
					/* The square box behind contain-fit thumbnails so images of
					   any aspect ratio read as consistently sized tiles. Falls back
					   to a text-tinted fill so the square stays visible even when
					   the surface tokens aren't defined by the host theme. */
					background-color: var(
						--color-bg-muted,
						color-mix(in oklch, var(--color-text, gray) 20%, transparent)
					);
					.thumbnail-blur,
					.thumbnail-img,
					.thumbnail-placeholder {
						position: absolute;
						inset: 0;
						width: 100%;
						height: 100%;
						object-fit: contain;
						display: block;
						transition: transform 350ms cubic-bezier(0.22, 1, 0.36, 1);
					}
					.thumbnail-blur {
						z-index: 0;
						object-fit: cover;
						filter: blur(8px) saturate(1.2);
						transform: scale(1.2);
						pointer-events: none;
						user-select: none;
					}
					.thumbnail-placeholder {
						z-index: 0;
						background: light-dark(rgba(0, 0, 0, 0.06), rgba(255, 255, 255, 0.06));
					}
					.thumbnail-img {
						z-index: 1;
						opacity: 1;
						transition:
							opacity 300ms ease,
							transform 350ms cubic-bezier(0.22, 1, 0.36, 1);
						&.no-blur {
							transition:
								opacity 200ms ease,
								transform 350ms cubic-bezier(0.22, 1, 0.36, 1);
						}
						&.fading {
							opacity: 0;
							transition: none;
						}
					}
					.icon {
						position: absolute;
						width: clamp(1rem, calc(var(--line-height) * 0.42), 2rem);
						height: clamp(1rem, calc(var(--line-height) * 0.42), 2rem);
						top: 50%;
						left: 50%;
						translate: -50% -50%;
						z-index: 2;
						background-color: rgba(0, 0, 0, 0.6);
						backdrop-filter: blur(10px);
						border-radius: 100%;
						display: flex;
						align-items: center;
						justify-content: center;
						:global(svg) {
							width: 80%;
							height: 80%;
						}
					}
				}
				.name {
					flex: 1;
					min-width: 0;
					padding-left: calc(var(--list-pad) + 0.5rem);
					padding-right: var(--list-pad);
					font-size: var(--list-text-size);
					color: var(--color-text);
					text-overflow: ellipsis;
					white-space: nowrap;
					overflow: hidden;
				}
			}
			/* Action buttons sit outside the clickable .info; give them the
			   row inset that used to come from .list-item's own padding. */
			> .actions {
				flex-shrink: 0;
				margin-right: var(--list-pad);
			}
		}
	}

	/* Reduced layouts when only a few images */
	.gallery.display-grid,
	.gallery.display-masonry,
	.gallery.display-masonry-row {
		&:has(.gallery-item:first-child:nth-last-child(1)) {
			display: flex;
			flex-wrap: wrap;
			align-items: start;
			justify-content: center;
			&:before {
				display: none;
			}
			&.radius-1 {
				--radius-lg: var(--radius-md, 0.375rem);
			}
			&.radius-2 {
				--radius-lg: var(--radius-lg, 0.5rem);
			}
			&.radius-3 {
				--radius-lg: var(--_rxl);
			}
			> .gallery-item {
				flex-basis: 100%;
				flex-grow: 1;
				max-width: none;
				max-height: none;
				aspect-ratio: max(var(--ratio, 1), 0.85);
				.name {
					font-size: 1rem;
				}
			}
			@container (min-width: 768px) {
				&.radius-1 {
					--radius-lg: var(--_rxl);
				}
				&.radius-2 {
					--radius-lg: var(--_r2xl);
				}
				&.radius-3 {
					--radius-lg: var(--_r3xl);
				}
			}
		}

		&:has(.gallery-item:first-child:nth-last-child(2)) {
			display: flex;
			flex-wrap: wrap;
			align-items: start;
			justify-content: center;
			&:before {
				display: none;
			}
			&.radius-1 {
				--radius-lg: var(--radius-md, 0.375rem);
			}
			&.radius-2 {
				--radius-lg: var(--radius-lg, 0.5rem);
			}
			&.radius-3 {
				--radius-lg: var(--_rxl);
			}
			> .gallery-item {
				flex-basis: 0;
				flex-grow: 1;
				max-width: none;
				max-height: none;
				aspect-ratio: max(var(--ratio, 1), 0.75);
				.name {
					font-size: 1rem;
				}
			}
			@container (min-width: 768px) {
				&.radius-1 {
					--radius-lg: var(--radius-lg, 0.5rem);
				}
				&.radius-2 {
					--radius-lg: var(--_rxl);
				}
				&.radius-3 {
					--radius-lg: var(--_r2xl);
				}
			}
		}

		&:has(.gallery-item:first-child:nth-last-child(3)) {
			display: flex;
			flex-wrap: wrap;
			align-items: start;
			justify-content: center;
			&:before {
				display: none;
			}
			&.radius-1 {
				--radius-lg: var(--radius-sm, 0.25rem);
			}
			&.radius-2 {
				--radius-lg: var(--radius-md, 0.375rem);
			}
			&.radius-3 {
				--radius-lg: var(--radius-lg, 0.5rem);
			}
			> .gallery-item {
				flex-basis: 0;
				flex-grow: 1;
				max-width: none;
				max-height: none;
				aspect-ratio: max(var(--ratio, 1), 0.75);
				.name {
					font-size: 1rem;
				}
			}
			@container (min-width: 768px) {
				&.radius-1 {
					--radius-lg: var(--radius-md, 0.375rem);
				}
				&.radius-2 {
					--radius-lg: var(--radius-lg, 0.5rem);
				}
				&.radius-3 {
					--radius-lg: var(--_rxl);
				}
			}
			&.size-2 {
				@container (max-width: 767px) {
					> .gallery-item {
						flex-basis: 100%;
					}
				}
			}
		}

		&:has(.gallery-item:first-child:nth-last-child(4)) {
			&.size-0 {
				display: flex;
				flex-wrap: wrap;
				align-items: start;
				justify-content: center;
				&:before {
					display: none;
				}
				&.radius-1 {
					--radius-lg: var(--radius-sm, 0.25rem);
				}
				&.radius-2 {
					--radius-lg: var(--radius-md, 0.375rem);
				}
				&.radius-3 {
					--radius-lg: var(--radius-lg, 0.5rem);
				}
				> .gallery-item {
					flex-basis: 0;
					flex-grow: 1;
					max-width: none;
					max-height: none;
					aspect-ratio: max(var(--ratio, 1), 0.75);
					.name {
						font-size: 1rem;
					}
				}
				@container (min-width: 768px) {
					&.radius-1 {
						--radius-lg: var(--radius-md, 0.375rem);
					}
					&.radius-2 {
						--radius-lg: var(--radius-lg, 0.5rem);
					}
					&.radius-3 {
						--radius-lg: var(--_rxl);
					}
				}
			}
			&.size-2 {
				@container (max-width: 767px) {
					> .gallery-item {
						flex-basis: 100%;
					}
				}
			}
		}

		&:has(.gallery-item:first-child:nth-last-child(5)).size-0:not(.display-grid) {
			display: flex;
			flex-wrap: wrap;
			align-items: start;
			justify-content: center;
			&:before {
				display: none;
			}
			&.radius-1 {
				--radius-lg: var(--radius-sm, 0.25rem);
			}
			&.radius-2 {
				--radius-lg: var(--radius-md, 0.375rem);
			}
			&.radius-3 {
				--radius-lg: var(--radius-lg, 0.5rem);
			}
			> .gallery-item {
				flex-basis: 0;
				flex-grow: 1;
				max-width: none;
				max-height: none;
				aspect-ratio: max(var(--ratio, 1), 0.75);
				.name {
					font-size: 1rem;
				}
			}
			@container (min-width: 768px) {
				&.radius-1 {
					--radius-lg: var(--radius-md, 0.375rem);
				}
				&.radius-2 {
					--radius-lg: var(--radius-lg, 0.5rem);
				}
				&.radius-3 {
					--radius-lg: var(--_rxl);
				}
			}
		}
	}
</style>
