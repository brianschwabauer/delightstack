<!-- svelte-ignore state_referenced_locally -->
<script lang="ts" module>
	export type {
		CarouselItem,
		CarouselItemType,
		GalleryGesture,
	} from './carousel';
</script>

<script lang="ts">
	import { backOut, circOut, circInOut, circIn } from 'svelte/easing';
	import { onDestroy, tick, untrack, type Snippet } from 'svelte';
	import {
		addLoadedResolution,
		animateElement,
		calcBounds,
		calcTransform,
		type CarouselItem,
		center,
		clampMatrix,
		createMatrix,
		decodeThumbHash,
		type ElementAnimationOptions,
		extractMatrixTransform,
		type GalleryGesture,
		getLoadedResolutions,
		isScalable,
		isSwipeable,
		normalizeCarouselItem,
		normalizeWheel,
		pickLargestSrc,
		type Point,
		type Pointer,
		type Transform,
	} from './carousel';
	import Video from './Video.svelte';

	const browser = typeof window !== 'undefined';

	let {
		/** The currently displayed item index. Changing this will change/animate the slide */
		slide = $bindable(0) as number,

		/** The currently displayed page (a vertical carousel within the current slide - used for pdf pages) */
		page = $bindable(0) as number,

		/** The amount of pages available in the current slide (applies to PDFs) */
		numPages = $bindable(0) as number,

		/** The percent (0-1) of how 'closed' the gallery is - while swiping/dismissing the gallery away */
		dismissing = $bindable(0) as number,

		/** Whether the carousel can be "dismissed" by swiping down/up */
		dismissable = true as boolean,

		/** The object-fit attribute for all items in the gallery */
		fit = 'contain' as 'cover' | 'contain',

		/** The list of items to display. Strings are treated as image URLs. */
		items = [] as Array<string | Partial<CarouselItem>>,

		/** Whether the carousel is 'inline' in the page - not a modal. This disables vertical gestures & mouse wheel */
		inline = false,

		/** The element that the carousel item will be animated from */
		animationTarget = undefined as HTMLElement | undefined,

		/** Whether the animation for the entry/exit of the carousel (defaults to zooming) should be disabled */
		disableEntryExitAnimation = false,

		/** The transition type to use when navigating between slides */
		transition = 'none' as 'none' | 'slide' | 'fade',

		/** How the items should be slowly animated. 'zoom' will slowly zoom into the center of the image */
		animation = 'none' as 'none' | 'zoom',

		/** The css style string added to the component from the parent */
		style = '',

		/** Specifies a custom class name for the container element */
		class: className = '',

		/**
		 * Snippet used to render a PDF item. Receives the source URL, a list of
		 * { width, height } per page that the renderer should target, a flag for
		 * whether rendering should pause (during transitions/drags), and an `onload`
		 * callback that must be invoked once the PDF has loaded so the carousel
		 * knows how many pages it contains.
		 */
		pdf = undefined as
			| Snippet<
					[
						{
							src: string;
							pageBounds: Array<{ width: number; height: number }>;
							disableRender: boolean;
							onload: (detail: { numPages: number }) => void;
						},
					]
			  >
			| undefined,

		/**
		 * Snippet used to render a panorama (360°) image. Receives the source URL,
		 * an `inline` flag for whether the carousel is inline, and an `onload`
		 * callback that should be invoked once the panorama is ready.
		 */
		panorama = undefined as
			| Snippet<[{ src: string; inline: boolean; onload: () => void }]>
			| undefined,

		/** Called when the user interacts with the carousel */
		oninteraction = undefined as (() => void) | undefined,

		/** Called when the carousel is closed. Return false to prevent closing */
		onclose = undefined as (() => boolean | undefined | void) | undefined,
	} = $props();

	const CLAMP_PADDING = 100; // the number of pixels to pad the image when it is zoomed in & panned around
	const DRAG_THRESHOLD = 10; // how far the user must drag before we consider it a gesture
	const DISMISS_THRESHOLD = 300; // the number of pixels the user must drag to dismiss the gallery

	interface DecodedCarouselItem {
		/** The ID of the media item */
		id: string;

		/** The key to use for the each block (a media item with the same id can appear in the carousel multiple times) */
		key: string;

		/** The type of media */
		type: NonNullable<CarouselItem['type']>;

		/** The natural width of the image in pixels */
		width: number;

		/** The natural height of the image in pixels */
		height: number;

		/** The aspect ratio of the image (width / height) */
		ratio: number;

		/** Short display label (used as fallback alt text) */
		name: string;

		/** Longer descriptive caption — shown in the carousel's fullscreen overlay */
		caption: string;

		/** Explicit alt text override */
		alt: string;

		/** Whether the media item should be treated as a panorama */
		panorama: boolean;

		/** A base64 ThumbHash used to render a tiny blurred preview before the full image loads */
		thumbhash: string;

		/** The source for the media — URL or srcset (images), single URL otherwise */
		src: string;

		/** Whether this item should load eagerly with high fetch priority */
		priority: boolean;

		/** Whether the item is in view and should be loaded */
		shouldLoad: boolean;

		/** Whether the item should start playing (only applies to embeds/videos) */
		shouldPlay: boolean;

		/** Whether the item has finished loading */
		loaded: boolean;

		/** How the item container should be transformed (used to show different pages) */
		transform: string | undefined;

		/** The amount that the container has been offset in the y direction (used when swiping between pages) */
		offsetY: number;

		/** The current 'page' to show - like a pdf that has multiple pages that can be vertically swiped through */
		page: number;

		/** The resolution that the item should start at (because it was already loaded elsewhere in the app) */
		initialResolution?: number;

		/** The list of pages for the item (only one page for images. PDFs can have multiple) */
		pages: Array<{
			x: number;
			y: number;
			z: number;
			scale: number;
			resolutionW: number;
			resolutionH: number;
			matrix: DOMMatrix;
			panX?: number;
			panY?: number;
			offsetX: number;
			offsetY: number;
			offsetWidth: number;
			offsetHeight: number;
		}>;
	}

	// The sanitized/formatted list of items to display in the carousel
	let list = $state<Array<DecodedCarouselItem>>([]);

	/** The container element (used to find the bounds of carousel) */
	let viewport = $state<HTMLElement | undefined>();

	/** The carousel slider items container element (contains carousel items as children) */
	let container = $state<HTMLElement | undefined>();

	/** The offset that defines which the grid cells gallery items should be in */
	const offset = $derived(Math.floor(list.length / 2));

	/** The current gesture being performed by the user */
	let gesture: GalleryGesture | undefined;

	/** A record of touch/mouse event pointers that are currently active */
	let pointers: { [id: string]: Pointer } = {};

	/** The midpoint of the current pointers */
	let midpoint: Point | undefined;

	/** The transform the pointers create based on their relationship to each other */
	let transform: Transform | undefined;

	/** Whether the current gesture has been emitted */
	let gestureEmitted = false;

	/** The current offset (in pixels) that the container should be transformed to */
	let containerX = $state(0);
	let containerTransform = $state(`translate3d(calc(${offset * -100}% + 0px), 0px, 0px)`);

	/** The width of the viewport element */
	let viewportW = $state(0);
	let viewportH = $state(0);
	let viewportX = $state(0);
	let viewportY = $state(0);

	/** The event timestamp when the last wheel event occurred */
	let lastWheelEvent = 0;

	/** The event timestamp when the user last tapped the carousel */
	let lastTapEvent = 0;

	/** The timestamp when the gesture/touch first started (on pointer down) */
	let gestureStart = 0;

	/** Handles canceling an animation on the container element (in Safari only) */
	let destroySafariAnimation = () => {};

	// The local instance of the index - used to compare against the exported slide index
	let index = $state(slide);

	// The local instance of the page - used to compare against the exported page
	let _page = page;

	/** Whether or not the container is transitioning/animating */
	let transitioning = $state(false);

	/** Whether or not the container is being dragged */
	let dragging = $state(false);

	/** Whether or not the container is being swiped */
	let swiping = $state(false);

	/** Whether the carousel is being opened in a modal or not */
	let opening = $state(!inline);

	$effect(() => {
		const trackedItems = items;
		untrack(() => initItems(trackedItems));
	});
	$effect(() => {
		if (slide === index || slide < 0) return;
		untrack(() => goToSlide(slide));
	});
	$effect(() => {
		if (_page === page) return;
		untrack(() => goToPage(index, page));
	});
	$effect(() => {
		if (animation === 'none') return;
		untrack(() => startItemAnimation());
	});
	$effect(() => {
		if (animation !== 'none') return;
		untrack(() => stopItemAnimation());
	});

	/** Loads the number of given items on each side of the current item */
	function loadItems(additionalItems = 0) {
		list.forEach((item, i) => {
			const normalDistance = Math.abs(i - index);
			const distance = Math.min(normalDistance, list.length - normalDistance);
			const shouldLoad = item.shouldLoad || distance <= additionalItems;
			if (shouldLoad !== item.shouldLoad) list[i].shouldLoad = shouldLoad;
		});
	}

	async function initItems(rawItems: Array<string | Partial<CarouselItem>>) {
		numPages = 1;
		const newList: DecodedCarouselItem[] = [];
		for (const raw of rawItems) {
			const item = normalizeCarouselItem(raw);
			if (!item) continue;
			const id = item.id || item.src;
			if (!id) continue;
			const prevItem = list.find((v) => v.id === id);
			const normalDistance = Math.abs(newList.length - index);
			const distance = Math.min(normalDistance, rawItems.length - normalDistance);
			const shouldLoad = distance <= 0;
			const initialResolution = Math.max(0, ...getLoadedResolutions(id));
			const type = (item.type || 'image') as DecodedCarouselItem['type'];
			const computedRatio =
				item.width && item.height ? item.width / item.height : 0;
			newList.push({
				id,
				type,
				src: item.src,
				key: id + (newList.some((v) => v.id === id) ? newList.length : ''),
				name: item.name || '',
				caption: item.caption || '',
				alt: item.alt ?? item.name ?? '',
				width: prevItem?.width || item.width || 0,
				height: prevItem?.height || item.height || 0,
				ratio: prevItem?.ratio || computedRatio || 1,
				panorama: item.panorama ?? false,
				thumbhash: item.thumbhash || '',
				priority: item.priority ?? false,
				shouldLoad: prevItem?.loaded || shouldLoad,
				shouldPlay: false,
				loaded: prevItem?.loaded ?? false,
				offsetY: 0,
				transform: undefined,
				page: 0,
				initialResolution,
				pages: [
					{
						scale: 1,
						x: 0,
						y: 0,
						z: 0,
						offsetX: 0,
						offsetY: 0,
						offsetHeight: viewportH || viewport?.clientHeight || 0,
						offsetWidth: viewportW || viewport?.clientWidth || 0,
						resolutionW: Math.max(
							initialResolution,
							Math.min(2048, viewportW || viewport?.clientWidth || 0),
						),
						resolutionH: Math.max(
							initialResolution,
							Math.min(2048, viewportH || viewport?.clientHeight || 0),
						),
						matrix: browser ? createMatrix() : (undefined as unknown as DOMMatrix),
					},
				],
			});
		}
		list = newList;
		containerTransform = `translate3d(calc(${offset * -100}% + 0px), 0px, 0px)`;
		if (!opening) {
			loadItems(3);
			await tick();
			startItemAnimation();
			return;
		}

		// Animate the main active item on from the animation target
		await tick();
		const el = getElementAtIndex(index, 0);
		if (!el || inline || disableEntryExitAnimation) return (opening = false);
		el.style.opacity = `0`;
		const target = animationTarget?.getBoundingClientRect() || {
			top: window.innerHeight / 2 - 50,
			left: window.innerWidth / 2 - 50,
			width: 100,
			height: 100,
		};
		const MIN_SCALE = 0.25;
		const current = el.getBoundingClientRect();
		const scaleX = target.width / current.width;
		const scaleY = target.height / current.height;
		const scale = Math.max(MIN_SCALE, Math.min(scaleX, scaleY));
		const newW = current.width * scale;
		const newH = current.height * scale;
		const diffW = newW - target.width;
		const diffH = newH - target.height;
		const maxX = current.width - current.width * scale;
		const maxY = current.height - current.height * scale;
		const dx = Math.max(0, Math.min(maxX, target.left - current.left - diffW / 2));
		const dy = Math.max(0, Math.min(maxY, target.top - current.top - diffH / 2));
		const matrix = createMatrix().translate(dx, dy).scale(scale, scale);
		el.style.transform = matrix.toString();
		await animateElement(el, {
			duration: 450,
			easing: 'back-out',
			opacity: 1,
			transform: createMatrix(),
		});
		el.style.removeProperty('opacity');
		opening = false;
		startItemAnimation();
		setTimeout(() => {
			// Load the next items now that the animation has completed
			loadItems(3);
		}, 100);
	}

	/** Navigates/animates to the item in the carousel at the given index */
	export async function goToSlide(
		i: number,
		direction?: 'forwards' | 'backwards',
		source: 'gesture' | 'keyboard' | 'button' = 'button',
	) {
		if (!container) return;
		const next = Math.floor(i + list.length) % list.length;
		if (next === index || !list.length) return;
		const numChildren = list.length;
		const prevIndex = index;
		_page = list[next]?.page || 0;
		page = _page;
		numPages = list[next]?.pages?.length || 1;
		slide = next;
		index = next;
		loadItems(); // load only the next item before animating

		// Determine the direction of the navigation
		let dir = direction === 'backwards' ? -1 : direction === 'forwards' ? 1 : 0;
		if (!direction) {
			const normalDistance = Math.abs(index - prevIndex);
			const backwardDistance = numChildren - normalDistance;
			const distance =
				normalDistance <= backwardDistance ? index - prevIndex : prevIndex - index;
			dir = Math.sign(distance);
		}

		// Mark the correct page as active
		list[index].pages.forEach((_, j) => {
			const pageContainer = getElementAtIndex(i, j);
			if (!pageContainer) return;
			if (page === j) pageContainer.classList.add('active');
			else pageContainer.classList.remove('active');
		});

		// Reset the position of each item in the carousel & animate to the default position/scale
		list.forEach((item, i) => {
			item.shouldPlay = false;
			const el = getElementAtIndex(index);
			if (!el) return;
			el.getAnimations().forEach((animation) => {
				try {
					animation.commitStyles();
					animation.cancel();
				} catch {
					// ignore
				}
			});
			updateItemMatrix(i);
			item.pages.forEach(({ matrix }, j) => {
				if (!matrix.isIdentity) {
					if (transition === 'slide' || source === 'gesture') {
						animatePage(i, j, { transform: createMatrix() });
					} else {
						updatePageMatrix(i, j, createMatrix());
					}
				}
			});
		});

		// Reset the transform of the container
		container.getAnimations().forEach((animation) => {
			try {
				animation.commitStyles();
				animation.cancel();
			} catch {
				// ignore
			}
		});

		// Animate the current item slowly
		startItemAnimation();

		// Transition the two items in the carousel
		if (transition === 'slide' || source === 'gesture') {
			const currentTransform = getComputedStyle(container).transform;
			const currentMatrix = createMatrix(currentTransform);
			const offsetX = currentMatrix.m41;
			const distance =
				dir > 0
					? (index + numChildren - prevIndex) % numChildren
					: index > prevIndex
						? -(prevIndex + numChildren - index)
						: index - prevIndex;
			const currX = offsetX + distance * viewportW;
			const diffOffset = Math.ceil(currX / viewportW) * 100;
			const diffX = currX % viewportW;
			containerTransform = `translate3d(calc(${diffOffset}% + ${diffX}px), 0px, 0px)`;
			await animateContainer('slide', source === 'button' ? 2000 : undefined);
		} else if (transition === 'fade') {
			const prevEl = getElementAtIndex(prevIndex);
			const nextEl = getElementAtIndex(index);
			if (prevEl && nextEl) {
				if (index > prevIndex) {
					prevEl.style.transform = `translate3d(100%, 0, 0)`;
				} else if (index < prevIndex) {
					prevEl.style.transform = `translate3d(-100%, 0, 0)`;
				}
				prevEl.style.zIndex = `2`;
				nextEl.style.opacity = `0`;
				prevEl.style.opacity = `1`;
				prevEl.style.filter = `blur(0px)`;
				nextEl
					.animate([{ opacity: 1 }], { duration: 650 })
					.finished.catch(() => undefined)
					.then((animation) => {
						try {
							animation?.cancel();
						} catch {
							// ignore
						}
						nextEl.style.removeProperty('opacity');
					});
				prevEl
					.animate([{ opacity: 0, filter: 'blur(10px)' }], { duration: 650 })
					.finished.catch(() => undefined)
					.then((animation) => {
						try {
							animation?.cancel();
						} catch {
							// ignore
						}
						prevEl.style.removeProperty('opacity');
						prevEl.style.removeProperty('transform');
						prevEl.style.removeProperty('filter');
					});
			}
			containerTransform = `translate3d(${offset * -100}%, 0px, 0px)`;
		} else {
			containerTransform = `translate3d(${offset * -100}%, 0px, 0px)`;
		}
		// Load the next items now that the animation has completed
		loadItems(3);

		// Remove all animations from the previous page
		if (animation === 'zoom') {
			list[prevIndex].pages.forEach((_, j) => {
				const pageEl = getElementAtIndex(prevIndex, j);
				if (!pageEl) return;
				pageEl.getAnimations().forEach((animation) => {
					try {
						animation.commitStyles();
						animation.cancel();
					} catch {
						// ignore
					}
				});
			});
		}

		// Update the image's resolution based on the new viewport size (in case the viewport has changed)
		if (list[index]) {
			list[index].pages.forEach((page) => {
				const resolutionW = Math.max(
					page.resolutionW,
					Math.ceil(viewportW * (page.scale || 1)),
				);
				const resolutionH = Math.max(
					page.resolutionH,
					Math.ceil(viewportH * (page.scale || 1)),
				);
				if (resolutionW !== page.resolutionW || resolutionH !== page.resolutionH) {
					page.resolutionW = resolutionW;
					page.resolutionH = resolutionH;
				}
			});
		}
	}

	/** Navigates/animates to the page of the current slide */
	export function goToPage(itemIndex: number, pageIndex: number) {
		if (!container) return;
		const item = list[itemIndex];
		if (!item?.pages?.length) return;
		const next = Math.floor(pageIndex + item.pages.length) % item.pages.length;
		if (next === item.page || !item.pages?.[next]) return;
		_page = next;
		page = next;
		const pageContainer = getElementAtIndex(itemIndex);
		if (!pageContainer) return;
		const children = Array.from(pageContainer.querySelectorAll('*:not(.preview)'));

		// Reset the position of each page for this slide & animate to the default position/scale
		children.forEach((el, i) => {
			el.getAnimations().forEach((animation) => {
				try {
					animation.commitStyles();
					animation.cancel();
				} catch {
					// ignore
				}
			});
			updatePageMatrix(next, i);
			if (i === page) el.classList.add('active');
			else el.classList.remove('active');
			const matrix = item.pages[i].matrix;
			if (!matrix.isIdentity) animatePage(itemIndex, i, { transform: createMatrix() });
		});

		// Reset the transform of the slide element (page parent)
		pageContainer.getAnimations().forEach((animation) => {
			try {
				animation.commitStyles();
				animation.cancel();
			} catch {
				// ignore
			}
		});
		animatePageContainer(itemIndex, next, 'slide');
	}

	/** Navigates/animates to the next item. If `amount` if provided, it will jump that amount of slides */
	export function nextSlide(
		amount = 1,
		source: 'gesture' | 'keyboard' | 'button' = 'button',
	) {
		const next = Math.floor(index + (amount || 1)) % list.length;
		goToSlide(next, 'forwards', source);
	}

	/** Navigates/animates to the previous item. If `amount` if provided, it will jump that amount of slides */
	export function prevSlide(
		amount = 1,
		source: 'gesture' | 'keyboard' | 'button' = 'button',
	) {
		const next = Math.floor(index - (amount || 1) + list.length) % list.length;
		goToSlide(next, 'backwards', source);
	}

	/** Navigates/animates to the next page. If `amount` if provided, it will jump that amount of pages */
	export function nextPage(amount = 1) {
		const item = list[index];
		if (!item?.pages?.length || !item.pages[item.page + amount]) return;
		goToPage(index, item.page + amount);
	}

	/** Navigates/animates to the previous page. If `amount` if provided, it will jump that amount of pages */
	export function prevPage(amount = 1) {
		const item = list[index];
		if (!item?.pages?.length || !item.pages[item.page - amount]) return;
		goToPage(index, item.page - amount);
	}

	/** Handles an "up" action - like a swipe up, arrow key up, or a button press that has an up arrow */
	export function up() {
		const item = list[index];
		if (!item) return;
		const pageData = list[index]?.pages?.[item.page];
		if (!pageData) return;
		oninteraction?.();
		const bounds = calcBounds({
			viewportW,
			viewportH,
			ratio: item.ratio,
			padding: CLAMP_PADDING,
			scale: pageData.scale,
		});
		const threshold = 10;
		const nearTopEdge = pageData.y + threshold >= bounds.maxY;
		if (nearTopEdge && item.page > 0) return prevPage();
		if (pageData.scale > 1) {
			const size = viewportW * pageData.scale;
			const distance = Math.max(100, size * 0.01);
			return pan(0, distance);
		}
	}

	/** Handles a "down" action - like a swipe down, arrow key down, or a button press that has a down arrow */
	export function down() {
		const item = list[index];
		if (!item) return;
		const pageData = list[index]?.pages?.[item.page];
		if (!pageData) return;
		oninteraction?.();
		const bounds = calcBounds({
			viewportW,
			viewportH,
			ratio: item.ratio,
			padding: CLAMP_PADDING,
			scale: pageData.scale,
		});
		const threshold = 10;
		const nearBottomEdge = pageData.y - threshold <= bounds.minY;
		if (nearBottomEdge && item.page < item.pages.length - 1) return nextPage();
		if (pageData.scale > 1) {
			const size = viewportW * pageData.scale;
			const distance = Math.max(100, size * 0.01);
			return pan(0, -distance);
		}
	}

	/** Handles a "left" action - like a swipe left, arrow key left, or a button press that has a left arrow */
	export function left() {
		const item = list[index];
		if (!item) return;
		const pageData = list[index]?.pages?.[item.page];
		if (!pageData) return;
		oninteraction?.();
		if (pageData.scale > 1) {
			const size = viewportW * pageData.scale;
			const distance = Math.max(100, size * 0.01);
			return pan(distance, 0);
		}
		return prevSlide();
	}

	/** Handles a "right" action - like a swipe right, arrow key right, or a button press that has a right arrow */
	export function right() {
		const item = list[index];
		if (!item) return;
		const pageData = list[index]?.pages?.[item.page];
		if (!pageData) return;
		oninteraction?.();
		if (pageData.scale > 1) {
			const size = viewportW * pageData.scale;
			const distance = Math.max(100, size * 0.01);
			return pan(-distance, 0);
		}
		return nextSlide();
	}

	/** Resets the zoom & positioning of every slide */
	export function reset() {
		if (!container) return;
		dismissing = 0;

		list.forEach((item, i) => {
			const el = getElementAtIndex(index);
			if (!el) return;
			el.getAnimations().forEach((animation) => {
				try {
					animation.commitStyles();
					animation.cancel();
				} catch {
					// ignore
				}
			});
			updateItemMatrix(i);
			item.pages.forEach(({ matrix }, j) => {
				if (!matrix.isIdentity) {
					updatePageMatrix(i, j, createMatrix());
				}
			});
		});

		container.getAnimations().forEach((animation) => {
			try {
				animation.commitStyles();
				animation.cancel();
			} catch {
				// ignore
			}
		});
		containerTransform = `translate3d(${offset * -100}%, 0px, 0px)`;
	}

	function close() {
		const success = onclose ? (onclose() ?? true) : true;
		if (!success) {
			animateItem(index, { easing: 'back-out' });
			dismissing = 0;
		} else {
			setTimeout(() => {
				dismissing = 0;
			}, 100);
		}
	}

	/** Animates the current item if the animation prop is set */
	async function startItemAnimation() {
		if (animation === 'zoom') {
			const pageEl = getElementAtIndex(index, page);
			if (pageEl) {
				await animateElement(pageEl, {
					transform: `translate3d(0px, 0px, 30px)`,
					duration: 30000,
					easing: 'linear',
				});
			}
		}
	}

	/** Stops the item's animation (happens when the carousel is paused) */
	function stopItemAnimation() {
		const pageEl = getElementAtIndex(index, page);
		if (pageEl) {
			pageEl.getAnimations().forEach((animation) => {
				try {
					animation.commitStyles();
					animation.cancel();
				} catch {
					// ignore
				}
			});
		}
	}

	/** Returns the target element of the item at the given index */
	function getElementAtIndex(itemIndex: number, pageIndex?: number) {
		if (!list[itemIndex] || !container) return;
		const parent = container.querySelector(`[data-index="${itemIndex}"]`) as HTMLElement;
		if (!parent) return;
		if (pageIndex === undefined) return parent as HTMLElement;
		const children = parent.querySelectorAll('*:not(.preview)');
		return (
			(children[pageIndex ?? list[itemIndex].page] as HTMLElement) ||
			(children[0] as HTMLElement) ||
			parent
		);
	}

	/** Updates the page's metadata to the latest matrix/transform state */
	async function updatePageMatrix(
		itemIndex: number,
		pageIndex: number,
		matrix?: DOMMatrix,
	) {
		const item = list[itemIndex];
		const el = getElementAtIndex(itemIndex, pageIndex);
		if (!item || !el || !item.pages[pageIndex]) return;
		const pageData = item.pages[pageIndex];
		const targetMatrix = matrix || createMatrix(el.style.transform);
		const { scale, x, y } = extractMatrixTransform(targetMatrix);
		const hasChanges =
			pageData.matrix.toString() !== targetMatrix.toString() ||
			pageData.scale !== scale ||
			pageData.x !== x ||
			pageData.y !== y ||
			pageData.offsetX !== el.offsetLeft ||
			pageData.offsetY !== el.offsetTop;
		if (hasChanges) {
			el.style.transform = targetMatrix.toString();
			list[itemIndex].pages[pageIndex] = {
				...list[itemIndex].pages[pageIndex],
				matrix: targetMatrix,
				resolutionW: Math.max(pageData.resolutionW, Math.ceil(viewportW * (scale || 1))),
				resolutionH: Math.max(pageData.resolutionH, Math.ceil(viewportH * (scale || 1))),
				scale,
				x,
				y,
				offsetX: el.offsetLeft,
				offsetY: el.offsetTop,
				offsetWidth: el.offsetWidth,
				offsetHeight: el.offsetHeight,
			};
		}
	}

	/** Updates the item's metadata to the latest matrix/transform state */
	async function updateItemMatrix(itemIndex: number, matrix?: DOMMatrix) {
		const item = list[itemIndex];
		if (!item) return;
		updatePageMatrix(itemIndex, list[itemIndex].page, matrix);
	}

	/** Animates the item at the given index to the given matrix/transform */
	async function animateItem(
		itemIndex: number,
		options: KeyframeAnimationOptions & ElementAnimationOptions,
	) {
		await animatePage(itemIndex, undefined, options);
	}

	/** Animates the given page of the given item */
	async function animatePage(
		itemIndex: number,
		pageIndex: number | undefined,
		options: KeyframeAnimationOptions & ElementAnimationOptions,
	) {
		const item = list[itemIndex];
		const page = pageIndex ?? item?.page;
		const el = getElementAtIndex(itemIndex, page);
		if (!item || !el) return;
		const matrix =
			typeof options?.transform === 'string'
				? createMatrix(options.transform)
				: options.transform || createMatrix();
		await animateElement(el, { ...options, transform: matrix });
		updatePageMatrix(itemIndex, page);
	}

	/** Zooms into the current item by the given scale, centered on targetX/targetY */
	export function zoomIn(targetScale = 3, targetX?: number, targetY?: number) {
		const item = list[index];
		if (!item) return;
		const page = item.pages[item.page];
		if (!page) return;
		const currentScale = page.scale;
		if (!isScalable(item) || currentScale === targetScale) return;
		oninteraction?.();
		const viewportX = targetX ?? viewportW / 2;
		const viewportY = targetY ?? viewportH / 2;
		const x = viewportX - (page.offsetX || 0);
		const y = viewportY - (page.offsetY || 0);

		animatePage(index, item.page, {
			duration: 200,
			transform: clampMatrix(
				createMatrix()
					.translate(x, y)
					.scale(targetScale / (currentScale || 1))
					.translate(-x, -y),
				{
					viewportW: page.offsetWidth || viewportW,
					viewportH: page.offsetHeight || viewportH,
					ratio: item.ratio,
					padding: CLAMP_PADDING,
				},
			),
		});
	}

	/** Zooms out to the given scale on the current item */
	export function zoomOut(targetScale = 1) {
		const item = list[index];
		if (!item) return;
		const page = item.pages[item.page];
		if (!page) return;
		const currentScale = page.scale;
		if (!isScalable(item) || currentScale === targetScale) return;
		oninteraction?.();
		if (targetScale <= 1) {
			const matrix = list[index].pages[item.page].matrix;
			if (!matrix.isIdentity) animateItem(index, { duration: 200 });
		} else {
			const x = viewportW / 2;
			const y = viewportH / 2;
			animateItem(index, {
				duration: 200,
				transform: clampMatrix(
					createMatrix()
						.translate(x, y)
						.scale(targetScale / (currentScale || 1))
						.translate(-x, -y),
					{
						viewportW: page.offsetWidth || viewportW,
						viewportH: page.offsetHeight || viewportH,
						ratio: item.ratio,
						padding: CLAMP_PADDING,
					},
				),
			});
		}
	}

	/** Animates the current item by the given x, y (only if zoomed in already) */
	export async function pan(dx: number, dy: number) {
		const item = list[index];
		if (!item) return;
		const page = list[index].pages[item.page];
		if (page.scale <= 1.01) return;
		const original = extractMatrixTransform(page.matrix);
		const el = getElementAtIndex(index, item.page);
		if (!el) return;
		oninteraction?.();
		el.getAnimations().forEach((animation) => {
			try {
				animation.commitStyles();
			} catch {
				// ignore
			}
		});
		let matrix = createMatrix(el.style.transform);
		const current = extractMatrixTransform(matrix);
		const progressX = (current.x - original.x) / page.scale;
		const progressY = (current.y - original.y) / page.scale;
		let diffX = dx;
		let diffY = dy;
		if (Math.abs(progressX) > 1) diffX += (page?.panX || 0) - progressX;
		if (Math.abs(progressY) > 1) diffY += (page?.panY || 0) - progressY;
		matrix = clampMatrix(matrix.translate(diffX, diffY), {
			viewportW: page.offsetWidth || el.offsetWidth || viewportW,
			viewportH: page.offsetHeight || el.offsetHeight || viewportH,
			ratio: item.ratio,
			padding: CLAMP_PADDING,
		});
		page.panX = diffX;
		page.panY = diffY;
		await animateItem(index, {
			duration: 600,
			easing: `cubic-bezier(0.22, 1, 0.36, 1)`,
			transform: matrix,
		});
		if (!el.getAnimations().length) {
			page.panX = 0;
			page.panY = 0;
		}
	}

	/** Animates the carousel container's x dimension */
	async function animateContainer(type: 'reset' | 'slide' = 'reset', duration?: number) {
		if (!container) return;
		duration =
			duration ||
			(type === 'reset' ? 300 : Math.max(250, Math.min(600, viewportW * 0.35)));
		containerX = 0;

		// Check if we're on a sane browser that doesn't have a mission to ruin the web
		if (!navigator.vendor.match(/apple/i)) {
			updateGalleryContainerClass();
			await animateElement(container, {
				transform: `translate3d(${offset * -100}%, 0px, 0px)`,
				easing: type === 'reset' ? 'back-out' : 'cubic-bezier(0.22, 1, 0.36, 1)',
				duration,
				id: `${type}_${Date.now()}`,
			});
			containerTransform = container?.style?.transform || '';
		} else {
			await tick();
			// HACK for Safari - we can't use the animation api because Safari
			// keeps removing hardware acceleration. Many hours of debugging later,
			// we're left with this hacky solution.
			let start = Date.now();
			const rawTransform = window.getComputedStyle(container).transform;
			const fromMatrix = createMatrix(rawTransform);
			const fromX = fromMatrix.e;
			const toX = offset * -viewportW;
			let destroyed = false;
			destroySafariAnimation();
			destroySafariAnimation = () => (destroyed = true);
			if (!transitioning) transitioning = true;
			function nextFrame() {
				if (destroyed) return;
				const progress = Math.min(1, (Date.now() - start) / duration!);
				const easingProgress = type === 'reset' ? backOut(progress) : circOut(progress);
				const x = fromX + (toX - fromX) * easingProgress;
				if (progress < 1) {
					containerTransform = `translate3d(${x}px, 0px, 0px)`;
					requestAnimationFrame(nextFrame);
				} else {
					containerTransform = `translate3d(${offset * -100}%, 0px, 0px)`;
					if (transitioning) transitioning = false;
				}
			}
			requestAnimationFrame(nextFrame);
		}
	}

	/** Animates the carousel page container's y dimension */
	async function animatePageContainer(
		itemIndex: number,
		pageIndex: number,
		type: 'reset' | 'slide' = 'reset',
	) {
		if (!container) return;
		const item = list[itemIndex];
		if (!item?.pages?.length || !item.pages[pageIndex]) return;
		const pageContainer = getElementAtIndex(itemIndex);
		if (!pageContainer) return;
		const duration =
			type === 'reset' ? 300 : Math.max(200, Math.min(600, viewportH * 0.35));
		list[itemIndex] = { ...list[itemIndex], offsetY: 0, page: pageIndex };

		if (!navigator.vendor.match(/apple/i)) {
			await animateElement(pageContainer, {
				transform: `translate3d(0px, ${pageIndex * -100}%, 0px)`,
				easing: type === 'reset' ? 'back-out' : 'cubic-bezier(0.22, 1, 0.36, 1)',
				duration,
				id: `${type}_${Date.now()}`,
			});
			list[itemIndex].transform = pageContainer.style.transform;
		} else {
			let start = Date.now();
			const rawTransform = window.getComputedStyle(pageContainer).transform;
			const fromMatrix = createMatrix(rawTransform);
			const fromY = fromMatrix.f;
			const toY = pageIndex * -viewportH;
			let destroyed = false;
			destroySafariAnimation();
			destroySafariAnimation = () => (destroyed = true);
			function nextFrame() {
				if (destroyed) return;
				const progress = Math.min(1, (Date.now() - start) / duration);
				const easingProgress = type === 'reset' ? backOut(progress) : circOut(progress);
				const y = fromY + (toY - fromY) * easingProgress;
				if (progress < 1) {
					list[itemIndex].transform = `translate3d(0px, ${y}px, 0px)`;
					requestAnimationFrame(nextFrame);
				} else {
					list[itemIndex].transform = `translate3d(0px, ${pageIndex * -100}%, 0px)`;
				}
			}
			requestAnimationFrame(nextFrame);
		}
	}

	/** Called when a multi-pointer interaction starts */
	function onInteractionStart(e: PointerEvent) {
		if (!viewport) return;
		destroySafariAnimation();
		gestureStart = e.timeStamp;
		gestureEmitted = false;
		if (!dragging) dragging = true;
		document.removeEventListener('pointermove', onPointerMove);
		document.removeEventListener('pointerup', onPointerUp);
		document.removeEventListener('pointercancel', onPointerUp);
		document.addEventListener('pointermove', onPointerMove, { passive: true });
		document.addEventListener('pointerup', onPointerUp, { passive: true });
		document.addEventListener('pointercancel', onPointerUp, { passive: true });
		const boundingRect = viewport.getBoundingClientRect();
		viewportY = boundingRect.top;
		viewportX = boundingRect.left;
		const el = getElementAtIndex(index, page);
		if (!el) return;
		el.getAnimations().forEach((animation) => {
			try {
				animation.commitStyles();
				animation.cancel();
			} catch {
				// ignore
			}
		});
		updateItemMatrix(index);
	}

	/** Called when a multi-pointer interaction ends */
	function onInteractionEnd(e: PointerEvent) {
		if (!container) return;
		if (dragging) dragging = false;
		if (swiping) swiping = false;
		const pointerList = Object.values(pointers);
		const vx =
			pointerList.reduce((sum, pointer) => sum + pointer.vx, 0) /
			(pointerList.length || 1);
		const vy =
			pointerList.reduce((sum, pointer) => sum + pointer.vy, 0) /
			(pointerList.length || 1);
		const item = list[index];
		const pageData = list[index]?.pages?.[item?.page];
		const scale = pageData.scale || 1;
		if (pageData.scale > 1.05 || !inline) {
			if (container.style.touchAction !== 'none') container.style.touchAction = 'none';
		} else if (inline) {
			if (container.style.touchAction !== 'pan-y') container.style.touchAction = 'pan-y';
		}

		// Check for tap/double tap
		const isTap =
			e.timeStamp - gestureStart < 150 &&
			Math.abs(vx) < 0.5 &&
			Math.abs(vy) < 0.5 &&
			['none', 'indeterminate', 'pinch-zoom'].includes(gesture || 'none');
		const isDoubleTap = e.timeStamp - lastTapEvent < 300 && isTap;
		if (isTap) lastTapEvent = e.timeStamp;
		if (isTap) gesture = undefined;

		// Add inertia to the pan after the user lifts their finger
		if (gesture === 'pinch-zoom') {
			if (scale <= 1.01) {
				animateItem(index, { easing: 'back-out' });
			} else {
				const dx = (Math.min(3000, Math.abs(vx * 300)) * Math.sign(vx)) / scale;
				const dy = (Math.min(3000, Math.abs(vy * 300)) * Math.sign(vy)) / scale;
				pan(dx, dy);
			}
		}

		// Handle switching to the next/previous element when the user pans quickly
		if (gesture === 'pan-x') {
			let velocity = Math.abs(vx);
			let distance = Math.abs(containerX);
			if (scale > 1.05) {
				velocity = velocity * 0.5;
				distance = distance * 0.25;
			}
			const movedFast = velocity > 0.5;
			const movedFar = distance > 150 && velocity > 0.05;
			if (list.length > 1 && (movedFar || movedFast)) {
				const speedFactor = e.pointerType === 'touch' ? 0.35 : 0.15;
				const amount = Math.min(
					8,
					Math.floor(list.length / 2) - 1,
					Math.ceil(velocity * speedFactor),
					scale > 1.05 ? 1 : Infinity,
				);
				if (vx > 0) prevSlide(amount, 'gesture');
				else nextSlide(amount, 'gesture');
			} else {
				animateContainer('reset');
			}
		}

		// Handle switching to the next/previous page when the user pans vertically
		if (gesture === 'pan-y-page') {
			let velocity = Math.abs(vy);
			let distance = Math.abs(item.offsetY);
			if (scale > 1.05) {
				velocity = velocity * 0.5;
				distance = distance * 0.25;
			}
			const movedFast = velocity > 0.5;
			const movedFar = distance > 150 && velocity > 0.05;
			if (movedFar || movedFast) {
				const speedFactor = e.pointerType === 'touch' ? 0.35 : 0.15;
				const amount = Math.min(
					8,
					Math.floor(list.length / 2) - 1,
					Math.ceil(velocity * speedFactor),
					scale > 1.05 ? 1 : Infinity,
				);
				if (item.offsetY > 0) prevPage(amount);
				else nextPage(amount);
			} else {
				animatePageContainer(index, item.page, 'reset');
			}
		}

		// Handle dismissing the carousel (or snapping back to the initial state)
		if (gesture === 'pan-y-dismiss') {
			if (Math.abs(vy) > 2 || Math.abs(pageData?.y || 0) > 60) {
				close();
			} else {
				animateItem(index, { easing: 'back-out' });
				dismissing = 0;
			}
		}

		// Snap back to the center of the element when the user lifts their finger
		if (gesture === 'indeterminate' || gesture === 'none') {
			item.pages.forEach((val, i) => {
				if (val?.x || val?.y || val.scale !== 1) {
					animateItem(index, { id: `reset-item-page_${index}_${i}_${Date.now()}` });
				}
			});
		}

		// Check if the user double tapped - and zoom in/out of the image
		if (isDoubleTap && isScalable(item)) {
			if (Math.abs(scale - 1) <= 0.01) {
				zoomIn(3, e.clientX - viewportX, e.clientY - viewportY);
				if (container.style.touchAction !== 'none') container.style.touchAction = 'none';
			} else {
				zoomOut();
			}
		}

		// Close the carousel if the user taps on the background
		if (isTap && e.target) {
			if ((e.target as HTMLElement).classList.contains('item')) {
				if (!inline) {
					setTimeout(() => {
						close();
					}, 0);
				}
			}
		}

		if (isTap || isDoubleTap) animateContainer('reset');
		document.removeEventListener('pointermove', onPointerMove);
		document.removeEventListener('pointerup', onPointerUp);
		document.removeEventListener('pointercancel', onPointerUp);
		transform = undefined;
		gesture = undefined;
		midpoint = undefined;
		gestureStart = 0;
		pointers = {};
	}

	/** Called when a pointer is updated */
	function onPointerEvent(pointer: Pointer) {
		const prevPointers = { ...pointers };
		const prevMidpoint = !midpoint ? undefined : { ...midpoint };
		pointers[pointer.id] = pointer;
		midpoint = center(...Object.values(pointers));
		transform = calcTransform(pointer, pointers, midpoint, prevPointers, prevMidpoint);
		const item = list[index];
		const pageData = item?.pages?.[item?.page];
		if (!item || !pageData) return;
		let matrix = pageData.matrix;
		const fit = {
			viewportW: pageData.offsetWidth,
			viewportH: pageData.offsetHeight,
			ratio: item.ratio,
			padding: CLAMP_PADDING,
			scale: pageData.scale,
		};
		if (container) {
			if (pageData.scale > 1.01 || !inline) {
				if (container.style.touchAction !== 'none') container.style.touchAction = 'none';
			} else if (inline) {
				if (container.style.touchAction !== 'pan-y')
					container.style.touchAction = 'pan-y';
			}
		}

		// Determine the current gesture based on the current transform
		if (transitioning && isSwipeable(item)) {
			gesture = 'pan-x';
		} else if (!isScalable(item) && !isSwipeable(item)) {
			gesture = 'none';
		} else if (!transform) {
			gesture = 'indeterminate';
		} else if (
			isScalable(item) &&
			(gesture === 'pinch-zoom' || Math.abs(1 - transform.scale) > 0.001)
		) {
			gesture = 'pinch-zoom';
		} else if (!isSwipeable(item)) {
			gesture = 'none';
		} else if (
			pageData.scale > 1.01 &&
			gesture !== 'pan-y-dismiss' &&
			gesture !== 'pan-y-page'
		) {
			const bounds = calcBounds(fit);
			const threshold = 10;
			const horizontal = Math.abs(transform.translateX) >= Math.abs(transform.translateY);
			const nearLeftEdge = pageData.x + threshold >= bounds.maxX;
			const nearRightEdge = pageData.x - threshold <= bounds.minX;
			const nearBottomEdge = pageData.y - threshold <= bounds.minY;
			const nearTopEdge = pageData.y + threshold >= bounds.maxY;
			const movedRight = (transform.translateX > 0 && horizontal) || containerX > 0;
			const movedLeft = (transform.translateX < 0 && horizontal) || containerX < 0;
			const movedUp = transform.translateY < 0 && !horizontal;
			const movedDown = transform.translateY > 0 && !horizontal;
			if (nearLeftEdge && movedRight) {
				gesture = 'pan-x';
			} else if (nearRightEdge && movedLeft) {
				gesture = 'pan-x';
			} else if (gesture !== 'pinch-zoom' && nearTopEdge && movedDown) {
				if (item.pages?.[item.page - 1]) {
					gesture = 'pan-y-page';
				} else if (dismissable) {
					gesture = 'pan-y-dismiss';
				}
			} else if (gesture !== 'pinch-zoom' && nearBottomEdge && movedUp) {
				if (item.pages?.[item.page + 1]) {
					gesture = 'pan-y-page';
				} else if (dismissable) {
					gesture = 'pan-y-dismiss';
				}
			} else if (Math.abs(transform.translateX) || Math.abs(transform.translateY)) {
				gesture = 'pinch-zoom';
			}
		} else if (gesture === 'pan-x' || inline) {
			gesture = 'pan-x';
		} else if (gesture !== 'pan-y-dismiss' && gesture !== 'pan-y-page') {
			const panning =
				Math.abs(pageData.x) > DRAG_THRESHOLD || Math.abs(pageData.y) > DRAG_THRESHOLD;
			const horizontal = Math.abs(pageData.x) > Math.abs(pageData.y);
			if (panning && horizontal) gesture = 'pan-x';
			if (panning && !horizontal) {
				const i = item.page + (pageData.y > 0 ? -1 : 1);
				if (item.pages?.[i]) {
					gesture = 'pan-y-page';
				} else if (dismissable) {
					gesture = 'pan-y-dismiss';
				}
			}
		}
		if (!gesture) gesture = !isSwipeable(item) && item.loaded ? 'none' : 'indeterminate';

		// Emit the gesture/interaction if necessary
		if (gesture && gesture !== 'none' && gesture !== 'indeterminate' && !gestureEmitted) {
			oninteraction?.();
			gestureEmitted = true;
		}

		// Update the matrix based on the current gesture
		const scale = pageData.scale;
		if (gesture === 'pan-y-dismiss') {
			if (scale > 1.01) {
				const targetScale = Math.max(1, scale - Math.abs(transform.translateY) * 0.1);
				matrix = clampMatrix(matrix.scale(targetScale / scale, targetScale / scale), fit);
			} else {
				const x = matrix.e / scale;
				const y = matrix.f / scale;
				const z = (matrix.m43 || 0) / scale;
				const max = DISMISS_THRESHOLD;
				const progress = Math.max(
					0,
					Math.min(1, Math.abs(y + transform.translateY) / max),
				);
				const targetZ = circInOut(progress) * -200;
				matrix = matrix.translate(-x, transform.translateY, targetZ - z);
				dismissing = Math.max(0, Math.min(1, 1 - (300 - Math.abs(pageData.y)) / 300));
			}
		} else if (gesture === 'pan-y-page') {
			item.offsetY += transform.translateY;
			const transformY = `calc(${item.page * -100}% + ${item.offsetY}px)`;
			item.transform = `translate3d(0px, ${transformY}, 0px)`;
			if (scale > 1.01) {
				matrix = clampMatrix(matrix.translate(transform.translateX / scale, 0), fit);
			} else {
				if (pageData.y) {
					matrix = matrix.translate(0, -pageData.y);
					updateItemMatrix(index, matrix);
				}

				if (!matrix.isIdentity) {
					matrix = createMatrix();
					const id = `pan-y-reset`;
					const element = getElementAtIndex(index);
					const alreadyAnimating = element
						?.getAnimations()
						?.some(
							(animation) => animation.id === id && animation.playState === 'running',
						);
					if (!alreadyAnimating) {
						animateItem(index, { transform: matrix, id, duration: 200 });
					}
				}
			}
		} else if (gesture === 'pan-x') {
			if (scale > 1.01) {
				matrix = matrix.translate(0, transform.translateY);
				containerX += transform.translateX;
				const transformX = `calc(${offset * -100}% + ${containerX}px)`;
				containerTransform = `translate3d(${transformX}, 0, 0)`;
			} else {
				containerX += transform.translateX + pageData.x;
				const transformX = `calc(${offset * -100}% + ${containerX}px)`;
				containerTransform = `translate3d(${transformX}, 0, 0)`;
				if (pageData.x) {
					matrix = matrix.translate(-pageData.x, 0);
					updateItemMatrix(index, matrix);
				}

				if (!matrix.isIdentity) {
					matrix = createMatrix();
					const id = `pan-x-reset`;
					const element = getElementAtIndex(index);
					const alreadyAnimating = element
						?.getAnimations()
						?.some(
							(animation) => animation.id === id && animation.playState === 'running',
						);
					if (!alreadyAnimating) {
						animateItem(index, { transform: matrix, id, duration: 200 });
					}
				}
			}
		} else if (gesture === 'pinch-zoom' || gesture === 'indeterminate') {
			let targetScale = Math.min(6, scale * transform.scale);
			if (transform.scale < 1 && scale <= 1) {
				targetScale =
					scale * (transform.scale + circIn(1 - scale) * (1 - transform.scale));
			}
			targetScale = Math.max(0.5, targetScale);
			const translateY =
				gesture === 'indeterminate' && !dismissable ? 0 : transform.translateY / scale;
			matrix = matrix
				.translate(transform.originX, transform.originY)
				.translate(transform.translateX / scale, translateY)
				.scale(targetScale / scale)
				.translate(-transform.originX, -transform.originY);
			if (gesture === 'pinch-zoom' && targetScale > 1) matrix = clampMatrix(matrix, fit);
		}

		if (gesture !== 'pan-y-dismiss' && dismissing > 0) dismissing = 0;

		if (gesture !== 'pan-x' || scale > 1.01) updateItemMatrix(index, matrix);

		if (gesture === 'pan-x' || gesture === 'pan-y-dismiss' || gesture === 'pan-y-page') {
			untrack(() => {
				if (!swiping) swiping = true;
			});
		}
	}

	/** Called when a pointer (touch or mouse) moves */
	function onPointerMove(e: PointerEvent) {
		if (e.button === 2) return; // Ignore right clicks
		const pointer = pointers[`${e.pointerId}`];
		if (!pointer) return;
		const offsetX = list[index]?.pages?.[list[index]?.page]?.offsetX || 0;
		const offsetY = list[index]?.pages?.[list[index]?.page]?.offsetY || 0;
		const x = e.clientX - viewportX - offsetX;
		const y = e.clientY - viewportY - offsetY;
		onPointerEvent({
			id: `${e.pointerId}`,
			x,
			y,
			dx: x - pointer.x,
			dy: y - pointer.y,
			dt: Math.max(1, e.timeStamp - pointer.time),
			vx: (x - pointer.x) / Math.max(1, e.timeStamp - pointer.time),
			vy: (y - pointer.y) / Math.max(1, e.timeStamp - pointer.time),
			primary: e.isPrimary,
			time: e.timeStamp,
		});
	}

	/** Called when a pointer (touch or mouse) unpresses */
	function onPointerUp(e: PointerEvent) {
		if (e.button === 2) return;
		if (!Object.keys(pointers).length) return;
		const hasOtherPointers = Object.keys(pointers).some(
			(k) => k !== `${e.pointerId}` && k !== `ctrl_${e.pointerId}`,
		);
		if (hasOtherPointers) {
			delete pointers[`${e.pointerId}`];
			delete pointers[`ctrl_${e.pointerId}`];
		}
		if (!hasOtherPointers) onInteractionEnd(e);
	}

	/** Called when a pointer (touch or mouse) presses down */
	function onPointerDown(e: PointerEvent) {
		if (e.button === 2) return;
		if (opening) return;

		// Ignore clicks on the media controls (for the video elements)
		let target = e.target as HTMLElement;
		let ignore = false;
		while (target && !ignore) {
			ignore = target.tagName === 'MEDIA-CONTROLS';
			target = target.parentElement as HTMLElement;
		}
		if (ignore) return;

		e.preventDefault();
		e.stopPropagation();

		if (!Object.keys(pointers).length) onInteractionStart(e);

		// Handle if the pointer should be treated as two pointers (to simulate pinch to zoom on desktop)
		if (e.ctrlKey) {
			pointers[`ctrl_${e.pointerId}`] = {
				id: `ctrl_${e.pointerId}`,
				x: window.innerWidth / 2,
				y: window.innerHeight / 2,
				dx: 0,
				dy: 0,
				dt: 0,
				vx: 0,
				vy: 0,
				primary: false,
				time: e.timeStamp,
			};
		}
		const offsetX = list[index]?.pages?.[list[index]?.page]?.offsetX || 0;
		const offsetY = list[index]?.pages?.[list[index]?.page]?.offsetY || 0;
		const x = e.clientX - viewportX - offsetX;
		const y = e.clientY - viewportY - offsetY;
		pointers[`${e.pointerId}`] = {
			id: `${e.pointerId}`,
			x,
			y,
			dx: 0,
			dy: 0,
			dt: 0,
			vx: 0,
			vy: 0,
			primary: e.isPrimary,
			time: e.timeStamp,
		};
		midpoint = center(...Object.values(pointers));
	}

	/** Called when the scroll wheel changes */
	function onWheelEvent(e: WheelEvent) {
		if (!viewport) return;
		lastWheelEvent = e.timeStamp;
		updateItemMatrix(index);
		const item = list[index];
		if (!item || !isScalable(item)) return;
		oninteraction?.();
		const pageData = item.pages[item.page];
		e.preventDefault();
		const [, dy] = normalizeWheel(e);
		const boundingRect = viewport.getBoundingClientRect();
		viewportX = boundingRect.left;
		viewportY = boundingRect.top;
		const scale = pageData.scale;
		const originX = e.clientX - viewportX - pageData.offsetX;
		const originY = e.clientY - viewportY - pageData.offsetY;
		const scrollScale = 1 - dy * 0.03;
		let targetScale = Math.min(6, scale * scrollScale);
		if (scrollScale < 1 && scale <= 1) {
			targetScale = scale * (scrollScale + circIn(1 - scale) * (1 - scrollScale));
		}
		targetScale = Math.max(0.5, targetScale);
		let matrix = createMatrix(pageData.matrix)
			.translate(originX, originY)
			.scale(targetScale / scale)
			.translate(-originX, -originY);
		matrix = clampMatrix(matrix, {
			viewportW: pageData.offsetWidth || viewportW,
			viewportH: pageData.offsetHeight || viewportH,
			ratio: item.ratio,
			padding: CLAMP_PADDING,
		});
		animateItem(index, { transform: matrix, duration: 300 }).then(() => {
			if (lastWheelEvent !== e.timeStamp) return;
			const { scale } = extractMatrixTransform(matrix);
			if (scale < 1) {
				matrix = createMatrix();
				animateItem(index, {
					transform: matrix,
					easing: 'back-out',
					duration: 400,
				});
			}
		});
	}

	/** Called when the carousel container is resized */
	let resizeDebounceTimer: ReturnType<typeof setTimeout> | undefined;
	function onViewportResizeEvent() {
		if (!viewport) return;
		viewportW = viewport.clientWidth || window.innerWidth;
		viewportH = viewport.clientHeight || window.innerHeight;

		const item = list[index];
		if (!item) return;
		const currentPage = item.pages[item.page];
		if (!currentPage) return;
		if (!currentPage.matrix.isIdentity) {
			const el = getElementAtIndex(index, item.page);
			let scale = 1;
			if (el && currentPage.offsetHeight && el.offsetHeight) {
				scale = currentPage.offsetHeight / el.offsetHeight;
			}
			const lastX = currentPage.offsetX || 0;
			const currX = el?.offsetLeft || 0;
			const lastY = currentPage.offsetY || 0;
			const currY = el?.offsetTop || 0;
			const dx = lastX - currX;
			const dy = lastY - currY;
			const originX = viewportW / 2 - (currentPage.offsetWidth * currentPage.scale) / 2;
			const originY = 0;
			updateItemMatrix(
				index,
				clampMatrix(
					currentPage.matrix
						.translate(originX, originY)
						.scale(scale, scale)
						.translate(dx, dy)
						.translate(-originX, -originY),
					{
						viewportW: currentPage.offsetWidth || viewportW,
						viewportH: currentPage.offsetHeight || viewportH,
						ratio: item.ratio,
						padding: CLAMP_PADDING,
					},
				),
			);
		}
		clearTimeout(resizeDebounceTimer);
		resizeDebounceTimer = setTimeout(() => {
			if (!list[index]) return;
			list[index].pages.forEach((page) => {
				const resolutionW = Math.max(
					page.resolutionW,
					Math.ceil(Math.min(2048, viewportW) * (page.scale || 1)),
				);
				const resolutionH = Math.max(
					page.resolutionH,
					Math.ceil(Math.min(2048, viewportH) * (page.scale || 1)),
				);
				if (resolutionW !== page.resolutionW || resolutionH !== page.resolutionH) {
					page.resolutionW = resolutionW;
					page.resolutionH = resolutionH;
				}
			});
		}, 100);
	}

	$effect(() => {
		if (!viewport) return;
		const observer = new ResizeObserver(() => untrack(() => onViewportResizeEvent()));
		observer.observe(viewport);
		return () => observer.disconnect();
	});

	/** Handles all key events when the carousel is active in modal mode */
	function onKeyDownEvent(e: KeyboardEvent) {
		const keys = [' ', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', '=', '-'];
		if (!keys.includes(e.key)) return;
		e.preventDefault();
		e.stopPropagation();
		if (list[index]?.type === 'video' && e.key === ' ') {
			list[index].shouldPlay = !list[index].shouldPlay;
			return;
		}
		if (e.key === ' ' && e.shiftKey) return prevSlide(1, 'keyboard');
		if (e.key === ' ') return nextSlide(1, 'keyboard');
		if (e.key === '=') return zoomIn();
		if (e.key === '-') return zoomOut();
		if (e.key === 'ArrowUp' && e.ctrlKey) return zoomIn();
		if (e.key === 'ArrowDown' && e.ctrlKey) return zoomOut();
		if (e.key === 'ArrowRight') return right();
		if (e.key === 'ArrowLeft') return left();
		if (e.key === 'ArrowUp') return up();
		if (e.key === 'ArrowDown') return down();
	}

	/** Handles when a full-res image is loaded */
	function onImageLoadEvent(i: number, e: Event) {
		const item = list[i];
		if (!item) return;
		const img = e.target as HTMLImageElement;
		item.width = img.naturalWidth;
		item.height = img.naturalHeight;
		item.ratio = (item.width || 1) / (item.height || 1);
		item.loaded = true;
		if (item.id && item.width) addLoadedResolution(item.id, item.width);

		// When the current image is loaded, we can now allow it to fetch the full-res image
		if (i === index && item.pages?.length) {
			item.pages.forEach((page) => {
				const resolutionW = Math.max(
					page.resolutionW,
					Math.ceil(viewportW * (page.scale || 1)),
				);
				const resolutionH = Math.max(
					page.resolutionH,
					Math.ceil(viewportH * (page.scale || 1)),
				);
				if (resolutionW !== page.resolutionW || resolutionH !== page.resolutionH) {
					page.resolutionW = resolutionW;
					page.resolutionH = resolutionH;
				}
			});
		}
	}

	/** Handles when a pdf is loaded */
	function onPdfLoadEvent(i: number, numLoadedPages: number) {
		const item = list[i];
		if (!item) return;
		item.loaded = true;
		list[i] = {
			...item,
			loaded: true,
			pages: Array.from({ length: numLoadedPages }, () => ({
				x: 0,
				y: 0,
				z: 0,
				scale: 1,
				offsetX: 0,
				offsetY: 0,
				offsetHeight: viewportH,
				offsetWidth: viewportW,
				resolutionW: viewportW || viewport?.clientWidth || 0,
				resolutionH: viewportH || viewport?.clientHeight || 0,
				matrix: createMatrix(),
			})),
		};
		numPages = list[index]?.pages?.length || 1;
	}

	/** Adds/removes the 'transitioning' class to the carousel container */
	async function updateGalleryContainerClass(): Promise<void> {
		if (!container) return;
		const isActive = (animation: Animation) =>
			animation.id.startsWith('slide') && animation.playState === 'running';
		const animations = container.getAnimations().filter(isActive);
		if (animations.length && !transitioning) transitioning = true;
		await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
		if (!container) return;
		const stillHasAnimations = container.getAnimations().some(isActive);
		if (stillHasAnimations) return updateGalleryContainerClass();
		if (transitioning) transitioning = false;
	}

	/** Initializes the event listeners when the carousel is shown */
	$effect(() => {
		if (!container || !viewport) return;
		destroyEventListeners();
		if (!inline) container.addEventListener('wheel', onWheelEvent, { passive: false });
		container.addEventListener('pointerdown', onPointerDown, { passive: false });
		if (!inline) document.addEventListener('keydown', onKeyDownEvent);
		const boundingRect = viewport.getBoundingClientRect();
		viewportY = boundingRect.top;
		viewportX = boundingRect.left;
		viewportW = viewport.clientWidth || window.innerWidth;
		viewportH = viewport.clientHeight || window.innerHeight;
	});

	/** Destroys the event listeners when the carousel is not being shown */
	function destroyEventListeners() {
		if (!browser) return;
		if (container) {
			container.removeEventListener('wheel', onWheelEvent);
			container.removeEventListener('pointerdown', onPointerDown);
		}
		document.removeEventListener('keydown', onKeyDownEvent);
	}
	onDestroy(() => destroyEventListeners());

	$effect(() => {
		document.body.style.userSelect = dragging ? 'none' : '';
	});
</script>

<div class="carousel" class:inline bind:this={viewport}>
	<ul
		class={['items', className].filter(Boolean).join(' ')}
		role="group"
		bind:this={container}
		class:opening
		class:zoomed={list[index]?.pages?.[list[index]?.page]?.scale > 1}
		class:dragging
		class:swiping
		class:transitioning
		class:animating={animation && animation !== 'none'}
		style:transform={containerTransform}
		{style}>
		{#each list as item, i (item.key)}
			{@const normalDistance = Math.abs(i - index)}
			{@const distance = Math.min(normalDistance, list.length - normalDistance)}
			{#if distance === 0 || (!opening && distance <= 5) || (item.shouldLoad && distance <= 20)}
				<li
					class="item"
					class:active={i === index}
					data-index={i}
					aria-label="{i + 1} of {list.length}"
					inert={i !== index || (!item.loaded && item.type !== 'image') || null}
					class:pdf={item.type === 'pdf'}
					style:transform={item.transform}
					style:perspective-origin={item.pages?.length > 1
						? `50% ${50 + item.page * 100}%`
						: null}
					style:grid-column-start={((list.length + i - index + offset) % list.length) + 1}>
					{#if item.shouldLoad}
						{#if !item.loaded && item.thumbhash && !opening}
							<img
								src={decodeThumbHash(item.thumbhash)}
								class:explicit-size={fit === 'contain'}
								style:opacity={(1 - dismissing) ** 4}
								style:--ratio={item.ratio || '1'}
								style:object-fit={fit || 'contain'}
								alt=""
								aria-hidden="true"
								class="preview" />
						{/if}
						{#if item.src}
							{#if item.type === 'image'}
								{#if !item.panorama}
									<img
										src={pickLargestSrc(item.src)}
										srcset={item.src}
										class:explicit-size={fit === 'contain' && item.loaded}
										style:object-fit={fit || 'contain'}
										style:--ratio={item.ratio || '1'}
										alt={item.alt || item.name || ''}
										sizes="100vw"
										loading={item.priority ? 'eager' : 'lazy'}
										fetchpriority={item.priority ? 'high' : undefined}
										onload={(e) => onImageLoadEvent(i, e)} />
								{:else if panorama}
									{@render panorama({
										src: pickLargestSrc(item.src),
										inline,
										onload: () => item.loaded || (list[index].loaded = true),
									})}
								{/if}
							{:else if item.type === 'pdf' && pdf}
								{@render pdf({
									src: pickLargestSrc(item.src),
									pageBounds: item.pages.map((_, j) => ({
										width: item.pages[j].resolutionW,
										height: item.pages[j].resolutionH,
									})),
									disableRender: dragging || transitioning,
									onload: (e) => onPdfLoadEvent(i, e.numPages),
								})}
							{:else if item.type === 'video'}
								{@const videoSrc = pickLargestSrc(item.src)}
								<Video
									poster={item.thumbhash ? decodeThumbHash(item.thumbhash) : undefined}
									src={videoSrc}
									autoplay={i === index ? !!item.shouldPlay : false}
									onready={() => item.loaded || (list[i].loaded = true)} />
							{:else if item.type === 'embed'}
								{@const embedSrc = pickLargestSrc(item.src)}
								<iframe
									class="embed"
									class:video={embedSrc.match(/^(https?:\/\/)?(www\.)?(youtu.?be|vimeo)/)}
									title={item.name}
									src={embedSrc}
									class:show={item.loaded}
									allowfullscreen
									allow="fullscreen; accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; magnetometer; xr-spatial-tracking;"
									onload={() => item.loaded || (list[index].loaded = true)}>
								</iframe>
							{/if}
						{/if}
					{/if}
				</li>
			{/if}
		{/each}
	</ul>
	<div class="visuallyhidden" aria-live="polite" aria-atomic="true" inert>
		Media Item {!list.length ? 0 : index + 1} of {list.length}
	</div>
</div>

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

	.carousel {
		user-select: none;
		-webkit-user-select: none;
		-webkit-tap-highlight-color: transparent;
		transform: translateZ(0px);
		overflow: hidden;
		height: 100%;

		&.inline {
			.item {
				cursor: grab;
				> :global(*) {
					height: 100%;
				}
				:global(.video) {
					max-height: 100%;
					margin-top: 0;
					margin-bottom: 0;
				}
			}
		}
		&:not(.inline) {
			.item {
				cursor: pointer;
			}
		}

		.items {
			position: relative;
			display: grid;
			grid-auto-columns: 100%;
			grid-template-rows: 100%;
			grid-auto-flow: column;
			height: 100%;
			list-style-type: none;
			transform-style: preserve-3d;
			margin: 0;
			padding: 0;
			touch-action: none;
			will-change: transform;
			backface-visibility: hidden;
			-webkit-backface-visibility: hidden;

			&.zoomed {
				cursor: move;
				.item > img {
					cursor: move;
				}
			}
			&.opening {
				.item > :global(*) {
					opacity: 0;
				}
			}
			&.dragging:not(.zoomed) {
				cursor: grabbing;
				.item > img {
					cursor: grabbing;
				}
			}
			&.swiping {
				:global(.item *) {
					pointer-events: none !important;
				}
			}
			&.transitioning .item {
				pointer-events: none;
				:global(.item > *) {
					pointer-events: none;
				}
			}
			&:not(.animating) {
				.item.pdf {
					overflow: visible;
				}
			}
			&::after {
				content: '';
				position: relative;
				grid-row: 1;
				grid-column-start: 1;
				grid-column-end: span 999;
				z-index: -1;
			}
		}
	}

	.item {
		grid-column: var(--col);
		grid-row: 1;
		display: grid;
		grid-auto-flow: row;
		grid-auto-rows: 100%;
		grid-template-columns: 100%;
		align-items: center;
		justify-content: center;
		justify-items: center;
		perspective: 100px;
		perspective-origin: center center;
		will-change: transform;
		backface-visibility: hidden;
		-webkit-backface-visibility: hidden;
		z-index: 1;
		overflow: hidden;
		> .preview {
			grid-row: 1;
			grid-column: 1;
			filter: blur(calc(10px + 1vw + 1vh)) contrast(1.3) saturate(1.2);
			@supports (filter: url('#sharpBlur') contrast(1.05) saturate(1.1)) {
				filter: url('#sharpBlur') contrast(1.05) saturate(1.1);
			}
			+ :global(*) {
				grid-row: 1;
				grid-column: 1;
			}
			&.explicit-size {
				width: calc(100cqh * var(--ratio, 1)) !important;
			}
		}
		> :global(iframe) {
			border: none;
			outline: none;
			cursor: pointer;
		}
		> :global(canvas) {
			object-fit: cover;
		}
		> :global(*) {
			width: 100%;
			height: calc(
				100% - var(--carousel-padding-top, 0px) - var(--carousel-padding-bottom, 0px)
			);
			will-change: transform;
			transform-origin: 0px 0px;
			backface-visibility: hidden;
			-webkit-backface-visibility: hidden;
			cursor: grab;
			pointer-events: all;
		}
		> img {
			object-fit: contain;
			max-width: none;
			max-height: none;
			&.explicit-size {
				width: auto;
				height: 100%;
				max-height: calc(
					(100cqw * (1 / var(--ratio, 1))) - var(--carousel-padding-top, 0px) -
						var(--carousel-padding-bottom, 0px)
				);
			}
		}
		:global(.video) {
			aspect-ratio: 16 / 9;
			width: 100%;
			max-height: calc(
				100% - var(--carousel-padding-top, 0px) - var(--carousel-padding-bottom, 0px)
			);
			height: unset;
			align-self: center;
			margin-top: var(--carousel-padding-top, 0px);
			margin-bottom: var(--carousel-padding-bottom, 0px);
			cursor: pointer;
		}
	}
</style>
