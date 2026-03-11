<script lang="ts" module>
	import { decodeMedia, focusTrap, intersect, ripple } from '@packages/lib';

	export interface GalleryItemAction {
		/** The icon to show for the action*/
		icon?: Component;

		/** The main action text to display - like 'Download' or 'Pay now' */
		name?: string;

		/** A short descriptor of the action - like the name of the download or file size */
		tooltip?: string;

		/** The link that the button should go to */
		href?: string;

		/** The function that should be called when the button is clicked. */
		click?: (event: Event) => any;

		/** The href target for the link element (if it's a link) */
		target?: '_blank' | '_self';

		/** The list of subactions (usually shown in a context menu) */
		actions?: GalleryItemAction[];
	}
</script>

<script lang="ts">
	import { type TransitionConfig, fade, scale } from 'svelte/transition';
	import PlayIcon from '~icons/material-symbols/play-arrow-rounded';
	import PauseIcon from '~icons/material-symbols/pause-rounded';
	import PanoramaIcon from '~icons/material-symbols/panorama-photosphere';
	import EmbedIcon from '~icons/iconoir/3d-select-solid';
	import DocumentIcon from '~icons/teenyicons/text-document-alt-solid';
	import ChevronLeft from '~icons/mdi/chevron-left';
	import ChevronRight from '~icons/mdi/chevron-right';
	import FullScreenIcon from '~icons/mdi/fullscreen';
	import FullScreenExitIcon from '~icons/mdi/fullscreen-exit';
	import DownloadIcon from '~icons/material-symbols/cloud-download';
	import OutlinedDownloadIcon from '~icons/material-symbols/download';
	import CloseIcon from '~icons/ion/md-close';
	import type { FocusTrap } from 'focus-trap';
	import Carousel from './Carousel.svelte';
	import { onDestroy, onMount, untrack, type Component } from 'svelte';
	import Image from './Image.svelte';
	import { backOut, circInOut } from 'svelte/easing';
	import {
		ApiMetadata,
		Media,
		SiteGalleryDesign,
		type SiteDesignBorderRadius,
	} from '@packages/api';
	import Button from '$lib/form/Button.svelte';
	import { List, ListItem } from '$lib/form';
	import Portal from './Portal.svelte';
	import { contextMenu } from './ContextMenu.svelte';

	let {
		/** How the gallery should be displayed - whether a grid, slideshow, etc */
		display = 'masonry' as NonNullable<SiteGalleryDesign['display']>,

		/** The size of the thumbnails in the gallery */
		sizing = 'default' as NonNullable<SiteGalleryDesign['sizing']>,

		/** The size of the spacing between the thumbnails in the gallery */
		spacing = 'default' as NonNullable<SiteGalleryDesign['spacing']>,

		/** The border radius of the gallery items */
		radius = 'small' as SiteDesignBorderRadius,

		/** The currently displayed item index. Changing this will change/animate the slide */
		slide = (display !== 'slider' ? -1 : 0) as number,

		/** The object-fit attribute for all items in the gallery */
		fit = 'contain' as 'cover' | 'contain',

		/** The list of items to display in the grid */
		items = [] as Partial<Media & ApiMetadata>[] | string[],

		/** The duration (in ms) when the slides should change */
		duration = 8000,

		/** Whether the gallery should auto transition between the slides (every 'duration' ms) */
		autoplay = false,

		/** The css aspect ratio the gallery should be forced into (only when not a modal) */
		aspectRatio = undefined as string | undefined,

		/** Whether the full screen button should be disabled */
		disableFullscreen = false,

		/**
		 * Whether the gallery is 'inline' in the page - not a modal or fullscreen.
		 * This is essentially saying "there is nothing above/below the gallery on the page".
		 * If it is 'inline', it disables vertical gestures & mouse wheel
		 * This @defaults to true when display is 'slider' and not in fullscreen
		 */
		inline = undefined as boolean | undefined,

		/**
		 * How the slider controls should be displayed (when display is 'slider' and the carousel is inline in the page)
		 *  - inline: the controls are below the slideshow element
		 *  - overlay: the controls are overlaid on top of the slideshow element
		 *  - disable: the controls are not shown at all
		 *  - default: the controls are shown 'inline' when the gallery is in carouselt mode (like inline slide or modal mode)
		 */
		controls = 'default' as 'default' | 'inline' | 'overlay' | 'disable',

		/** The currently displayed page (a vertical carousel within the current slide - used for pdf pages) */
		page = $bindable(0) as number,

		/** The amount of pages available in the current slide (applies to PDFs) */
		numPages = $bindable(1) as number,

		/** The display style of the metadata (name, description, etc) for each item */
		metaDisplay = 'hover' as NonNullable<SiteGalleryDesign['metaDisplay']>,

		/** How file names should be displayed in the fullscreen/carousel view */
		metaDisplayFullscreen = 'none' as NonNullable<
			SiteGalleryDesign['metaDisplayFullscreen']
		>,

		/** The display style of the actions (download buttons, etc) for each item */
		actionDisplay = 'hover' as NonNullable<SiteGalleryDesign['actionDisplay']>,

		/**
		 * The list of potential actions a user can take on each gallery item.
		 * An action can be a link or a function. If a link is provided, the button will be a link. If a function is provided, the button will be a normal button.
		 * Each gallery item can have multiple actions
		 */
		actions = [] as GalleryItemAction[][],

		/**
		 * A callback function called when an item's thumbnail/text (either grid or list) is clicked
		 * If the function returns false, the default behavior of opening the modal/slider will be prevented
		 */
		onclick = undefined as
			| undefined
			| ((event: MouseEvent | KeyboardEvent, index: number) => void | false),

		/** The css style string added to the component from the parent */
		style = '',
	} = $props();

	/** The percent (0-1) of how 'closed' the gallery is - while swiping/dimissing the gallery away */
	let dismissing = $state(0);

	/** The instance of the focus trap class - used to programmically deactivate the focus trap */
	let focusTrapInstance: FocusTrap | undefined;

	/** The element that the carousel item will be animated from */
	let animationTarget = $state<HTMLElement | undefined>(undefined);

	/** The instance of the carousel (can be used to control it) */
	let carousel = $state<Carousel | undefined>(undefined);

	/** Whether or not the gallery is being viewed in fullscreen */
	let fullscreenActive = $state(false);

	/** Whether the slider element is currently visible on screen */
	let intersected = $state(false);

	// The sanitized/formatted list of items to display in the gallery
	const list: Partial<Media & ApiMetadata>[] = $derived(
		items
			.map((v) => (typeof v === 'string' ? (decodeMedia(v) as any) : v))
			.filter(Boolean),
	);

	const sliderActive = $derived(display === 'slider' || slide >= 0);
	const isModal = $derived(fullscreenActive || (display !== 'slider' && slide >= 0));
	$effect(() => {
		if (typeof window !== 'undefined') {
			if (isModal) {
				window.document.body.style.overflow = 'hidden';
			} else {
				window.document.body.style.overflow = '';
			}
		}
	});
	let sliderAnimatedOn = false;
	$effect(() => {
		sliderAnimatedOn = !sliderActive ? false : sliderAnimatedOn;
	});

	// Prevent the modal from automatically being active when switching between display modes
	// This happens because the current slide index is used to determine if the gallery is a modal or not
	// By default, the slider should start at slide index 0 when not a modal
	// The index should be reset to -1 when switching back to a non-slider display
	let previousDisplay = undefined as typeof display | undefined;
	$effect.pre(() => {
		if (previousDisplay === 'slider') {
			if (display !== 'slider') slide = -1;
		} else {
			if (display === 'slider') slide = 0;
		}
		if (previousDisplay) untrack(() => pause());
		previousDisplay = display;
	});

	/** Handle the autoplay functionality */
	let autoplayPaused = $state(false);
	let autoplayTransitionInterval = $state(300); // number of ms to update the transition progress
	let autoplayTransitionStart = $state<number | undefined>(undefined);
	let autoplayTransitionProgress = $state<number | undefined>(undefined);
	let autoplayTransitionTimer = $state<ReturnType<typeof setInterval> | undefined>(
		undefined,
	);
	$effect.pre(() => {
		if (autoplay && intersected && !autoplayTransitionTimer && !autoplayPaused) play();
	});
	onDestroy(() => pause());

	/** Closes the gallery modal */
	export function close() {
		if (fullscreenActive) return closeFullscreen();
		if (!sliderActive) return;
		if (display === 'slider' && isModal) return closeFullscreen();
		if (focusTrapInstance?.active) {
			focusTrapInstance.deactivate();
		} else {
			slide = -1;
		}
	}

	/** Navigates/animates to the item in the gallery modal/slider at the given index. This can also be simply controlled by changing index */
	export function goto(i: number) {
		if (!sliderActive || !list[i]) return;
		pause();
		slide = i;
	}

	/** Navigates/animates to the next item. If `amount` if provided, it will jump that amount of slides */
	export function next(amount = 1) {
		if (!sliderActive) return;
		pause();
		const next = Math.floor(slide + amount) % list.length;
		slide = next;
	}

	/** Navigates/animates to the previous item. If `amount` if provided, it will jump that amount of slides */
	export function prev(amount = 1) {
		if (!sliderActive) return;
		pause();
		const next = Math.floor(slide - amount + list.length) % list.length;
		slide = next;
	}

	/** Starts a slideshow and autotransitions the slides based on the 'duration' */
	export function play() {
		if (!sliderActive || autoplayTransitionTimer) return;
		const intervalMs = 300;
		autoplayTransitionStart = Date.now();
		autoplayTransitionTimer = setInterval(() => {
			if (!autoplayTransitionStart) return clearInterval(autoplayTransitionTimer);
			const now = Date.now();
			if (!intersected) {
				autoplayTransitionStart = Math.min(
					now,
					Math.floor(now - duration * (autoplayTransitionProgress || 0) + intervalMs),
				);
				return;
			}
			autoplayTransitionProgress = (now - autoplayTransitionStart) / duration;
			if (autoplayTransitionProgress >= 1) {
				autoplayTransitionStart = now;
				setTimeout(() => (autoplayTransitionProgress = 0), 10);
				const next = Math.floor(slide + 1) % list.length;
				slide = next;
			}
		}, intervalMs);
	}

	/** Pauses the slideshow (if playing) */
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

	/** Sets the focus trap return focus to the gallery grid item that was last active */
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

	/** Toggles the fullscreen mode off/on */
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
				return { duration: 150, css: (t, u) => `opacity: ${parentOpacity - u}` };
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
				tick: (t, u) => {
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
</script>

{#snippet galleryItemAction(index: number, style: 'overlay' | 'transparent' = 'overlay')}
	{@const itemActions = actions?.[index]}
	{#if itemActions?.length}
		<div class="actions" class:hover-only={actionDisplay === 'hover'}>
			{#each itemActions as action (action)}
				{#if action?.actions?.length}
					<Button
						icon
						overlay={style === 'overlay'}
						transparent={style === 'transparent'}
						dense
						size="00"
						tooltip={action.tooltip || action.name}>
						{#if action.icon}
							<action.icon></action.icon>
						{:else}
							<OutlinedDownloadIcon />
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
										<span
											style="display:inline-flex; align-items: center; padding-right: 0.5rem; font-size: 1.1rem;">
											{#if subAction.icon}
												<action.icon></action.icon>
											{:else}
												<OutlinedDownloadIcon />
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
						size="00"
						tooltip={action.tooltip || action.name}
						href={action.href}
						target={action.target}
						onclick={(e) => {
							if (action.click) action.click(e);
						}}>
						{#if action.icon}
							<action.icon></action.icon>
						{:else}
							<OutlinedDownloadIcon />
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
		use:ripple={{ zIndex: 1, opacity: 0.2, color: 'white' }}
		class:favorite={item.favorite}
		style:--ratio={display === 'masonry-row' || display === 'masonry'
			? item.ratio
			: undefined}
		{@attach contextMenu({
			actions: actions?.[index]?.flatMap((parentAction) =>
				[parentAction, ...(parentAction.actions || [])]
					.filter((action) => !!action?.name)
					.map((action) => ({
						label: action.name,
						icon: action.icon || parentAction.icon,
						href: action.href,
						target: action.target,
						onclick: action.click,
					})),
			),
		})}
		onclick={(e) => onItemClick(index, e)}
		onkeydown={(e) => e.key !== 'Enter' || onItemClick(index, e)}>
		<Image src={item} />
		{#if item.type !== 'image' || item.panoramaEnabled}
			<div class="icon">
				{#if item.type === 'video'}
					<PlayIcon />
				{:else if item.type === 'pdf'}
					<DocumentIcon />
				{:else if item.type === 'embed'}
					<EmbedIcon />
				{:else if item.panoramaEnabled}
					<PanoramaIcon />
				{/if}
			</div>
		{/if}
		{#if metaDisplay === 'always' || metaDisplay === 'hover'}
			<div class="name" class:hover-only={metaDisplay === 'hover'}>{item.name}</div>
		{/if}
		{#if actionDisplay === 'always' || actionDisplay === 'hover'}
			{@render galleryItemAction(index, 'overlay')}
		{/if}
	</div>
{/snippet}

{#if display === 'grid' || display === 'masonry' || display === 'masonry-row'}
	<div
		class="gallery display-{display} sizing-{sizing} spacing-{spacing} radius-{radius}"
		role="group"
		{style}>
		{#each list as item, i (item)}
			{@render galleryItem(item, i)}
		{/each}
	</div>
{/if}

{#if display === 'list'}
	<div
		class="gallery display-list sizing-{sizing} spacing-{spacing} radius-{radius}"
		role="group"
		{style}>
		{#each list as item, index (item)}
			<div class="list-item">
				<div
					class="info"
					role="button"
					tabindex="0"
					use:ripple={{ zIndex: 1, opacity: 0.2, color: 'var(--text)' }}
					onclick={(e) => onItemClick(index, e)}
					onkeydown={(e) => e.key !== 'Enter' || onItemClick(index, e)}
					{@attach contextMenu({
						actions: actions?.[index]?.flatMap((parentAction) =>
							[parentAction, ...(parentAction.actions || [])]
								.filter((action) => !!action?.name)
								.map((action) => ({
									label: action.name,
									icon: action.icon || parentAction.icon,
									href: action.href,
									target: action.target,
									onclick: action.click,
								})),
						),
					})}>
					<div class="thumbnail">
						<Image src={item} fit="contain" />
						{#if item.type !== 'image' || item.panoramaEnabled}
							<div class="icon">
								{#if item.type === 'video'}
									<PlayIcon />
								{:else if item.type === 'pdf'}
									<DocumentIcon />
								{:else if item.type === 'embed'}
									<EmbedIcon />
								{:else if item.panoramaEnabled}
									<PanoramaIcon />
								{/if}
							</div>
						{/if}
					</div>
					<div class="name">{item.name}</div>
				</div>
				{#if actionDisplay === 'always' || actionDisplay === 'hover'}
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
		{#if numPages > 1}
			{@const maxDisplayPages = 5}
			{@const numDisplayPages = Math.min(numPages, maxDisplayPages)}
			{@const offset = Math.max(0, Math.min(numPages - numDisplayPages, page - 2))}
			<nav class="pages" transition:scale|global={{ duration: 300, easing: backOut }}>
				{#if numPages > maxDisplayPages && offset >= 1}
					<Button
						icon
						transparent
						dense
						size="0"
						onclick={() => (page = 0)}
						tooltip="First Page">
						<span class="visuallyhidden">First Page</span>
						{offset <= 1 ? 1 : '...'}
					</Button>
				{/if}
				{#each Array(numDisplayPages) as _, i (i)}
					<Button
						icon
						transparent
						dense
						size="0"
						active={i + offset === page}
						onclick={() => (page = i + offset)}
						tooltip={`Page ${i + offset + 1}`}>
						<span class="visuallyhidden">{`Page ${i + offset + 1}`}</span>
						{i + offset + 1}
					</Button>
				{/each}
				{#if numPages > maxDisplayPages && offset + numDisplayPages <= numPages - 1}
					<Button
						icon
						transparent
						dense
						size="0"
						onclick={() => (page = numPages - 1)}
						tooltip="Last Page">
						<span class="visuallyhidden">Last Page</span>
						{offset + numDisplayPages >= numPages - 1 ? numPages : '...'}
					</Button>
				{/if}
			</nav>
		{/if}
		{#if isModal}
			<Button icon transparent dense size="0" class="close" onclick={() => close()}>
				<span class="visuallyhidden">Close</span>
				<CloseIcon />
			</Button>
			{#if actions?.length}
				{@render galleryItemAction(slide, 'transparent')}
			{/if}
		{:else}
			{#if disableFullscreen === false}
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
						<FullScreenExitIcon />
					{:else}
						<FullScreenIcon style="padding: .1em" />
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
						<PauseIcon style="padding: .15em" />
					{:else}
						<PlayIcon />
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
				size="0"
				class="prev"
				onclick={() => prev()}
				tooltip="Previous Item">
				<span class="visuallyhidden">Previous Item</span>
				<ChevronLeft />
			</Button>
			<Button
				icon
				transparent
				dense
				size="0"
				class="next"
				onclick={() => next()}
				tooltip="Next Item">
				<span class="visuallyhidden">Next Item</span>
				<ChevronRight />
			</Button>
		{/if}
	</div>
{/snippet}

{#snippet slider()}
	{#if sliderActive}
		<div
			class="gallery slider sizing-{sizing} radius-{radius}"
			class:modal={isModal}
			class:controls-inline={controls === 'inline' ||
				(controls === 'default' && !isModal)}
			class:controls-overlay={controls === 'overlay' ||
				(controls === 'default' && isModal)}
			class:fullscreen={fullscreenActive}
			style={!isModal && (display === 'slider' || display === 'slideshow') ? style : null}
			style:--aspect-ratio={isModal || !aspectRatio ? null : aspectRatio}
			aria-label="Media Gallery Carousel"
			out:carouselCloseTransition
			use:intersect={{
				enabled: true,
				onintersectchange: (event) => (intersected = event.isIntersecting),
			}}
			use:focusTrap={{
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
			}}
			{@attach contextMenu({
				actions: actions?.[slide]?.flatMap((parentAction) =>
					[parentAction, ...(parentAction.actions || [])]
						.filter((action) => !!action?.name)
						.map((action) => ({
							label: action.name,
							icon: action.icon || parentAction.icon,
							href: action.href,
							target: action.target,
							onclick: action.click,
						})),
				),
			})}>
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
				bind:numPages
				animation={display === 'slider' && autoplayTransitionTimer && list.length > 1
					? 'zoom'
					: 'none'}
				transition={display === 'slider' && autoplayTransitionTimer ? 'fade' : 'none'}
				inline={inline ?? (display === 'slider' && !fullscreenActive)}
				dismissable={isModal}
				disableEntryExitAnimation={display === 'slider' || display === 'slideshow'}
				{animationTarget}
				{fit}
				oninteraction={() => pause()}
				onclose={() => {
					if (fullscreenActive) return closeFullscreen();
					slide = -1;
				}} />
			{#if metaDisplayFullscreen === 'always' && isModal && list[slide]?.name}
				<div class="fullscreen-name" style:opacity={1 - dismissing}>
					{list[slide].name}
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

<style lang="scss">
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

	.gallery-item {
		position: relative;
		display: grid;
		grid-template-rows: 1fr;
		grid-template-columns: 1fr;
		cursor: pointer;
		border-radius: var(--radius);
		isolation: isolate; // hack for Safari border radius on hover bug
		overflow: hidden;
		transition:
			box-shadow 150ms ease,
			scale 150ms ease;
		box-shadow: var(--shadow-1);
		background-color: var(--bg-high);

		:global(> .image) {
			transition: transform 150ms ease;
			transform: scale(1);
			will-change: transform;
			position: absolute;
			top: 0;
			bottom: 0;
			left: 0;
			right: 0;
		}

		&:active {
			scale: 0.98;
		}
		&:hover {
			box-shadow: var(--shadow-2);
			:global(> .image) {
				opacity: 0.97;
				transform: scale(1.018);
			}
		}
		&:focus {
			outline: solid 4px var(--text);
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
			padding: max(0.5rem, calc(var(--radius, 0px) / 2)) max(1rem, var(--radius, 0px));
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
			top: max(4px, min(16px, var(--radius, 0px)));
			right: max(4px, min(16px, var(--radius, 0px)));
			z-index: 2;
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
			color: var(--text);
			background-color: var(--bg);
			border-radius: var(--radius-round);
			box-shadow: var(--shadow-2);
			border: none;
			outline: none;
			font-weight: bold;
		}

		.pagination {
			z-index: 1;
		}

		:global(.play svg.progress) {
			$radius: 26;
			$stroke: 3;
			stroke-width: $stroke;
			stroke-dasharray: $radius * 6.285;
			stroke-dashoffset: calc(
				#{$radius * 6.285} - (#{$radius * 6.285} * var(--progress, 0))
			);
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
			background-color: var(--bg-high);
		}
		&.sizing-small {
			--aspect-ratio: 1 / 1;
			height: auto;
			&.radius-small {
				.bg,
				:global(.carousel) {
					@container (min-width: 80ch) {
						border-radius: var(--radius-3);
					}
				}
			}
			&.radius-large {
				.bg,
				:global(.carousel) {
					@container (min-width: 80ch) {
						border-radius: var(--radius-4);
					}
				}
			}
		}
		&.sizing-default {
			&.radius-small {
				.bg,
				:global(.carousel) {
					@container (min-width: 1200px) {
						border-radius: var(--radius-4);
					}
				}
			}
			&.radius-large {
				.bg,
				:global(.carousel) {
					@container (min-width: 1200px) {
						border-radius: var(--radius-5);
					}
				}
			}
		}
	}

	.gallery.slider:not(.modal).controls-overlay {
		&.radius-small {
			.controls {
				border-top-left-radius: var(--radius-4);
				border-top-right-radius: var(--radius-4);
			}
		}
		&.radius-large {
			.controls {
				border-top-left-radius: var(--radius-5);
				border-top-right-radius: var(--radius-5);
				border-bottom-left-radius: var(--radius-5);
				border-bottom-right-radius: var(--radius-5);
			}
		}
		.controls {
			z-index: 2;
			justify-content: center;
			> .spacer {
				display: none;
			}
			background-color: color-mix(in oklch, var(--bg-high), transparent 30%);
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
			:global(> .button) {
				--text: #eeeeee;
				--text-high: #ffffff;
				--bg-high: rgba(0, 0, 0, 0.2);
			}
			:global(> .button:hover button) {
				backdrop-filter: blur(3px);
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
				--font-size-00: var(--font-size-0);
				:global(> .button:hover button) {
					backdrop-filter: blur(3px);
				}
				:global(> .button) {
					--text: #eeeeee;
					--text-high: #ffffff;
					--bg-high: rgba(0, 0, 0, 0.2);
				}
				:global(> .button button svg) {
					filter: drop-shadow(0px 0px 1px rgba(0, 0, 0, 0.95))
						drop-shadow(0px 0px 3px rgba(0, 0, 0, 0.25))
						drop-shadow(0px 0px 10px rgba(0, 0, 0, 0.5));
				}
			}

			@include desktop {
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
					top: 4rem;
					right: 0.5rem;
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
					top: 0.5rem;
					right: 3.75rem;
					height: 3rem;
					margin: 0;
					display: flex;
					align-items: center;
					text-align: right;
					z-index: 2;
					backdrop-filter: blur(5px);
					padding: 0 1rem;
					border-radius: var(--radius-round);
				}
				:global(.play) {
					z-index: 2;
				}
				:global(.close) {
					right: 0.5rem;
					top: 0.5rem;
					z-index: 2;
				}
				:global(.prev),
				:global(.next) {
					top: 50%;
					transform: translateY(-50%);
					bottom: unset;
					width: 4.5rem;
					height: min(20rem, 50%);
					box-shadow: none;
					cursor: pointer;
					z-index: 2;
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
			color: var(--text);
			margin: 0 1rem;
			font-weight: normal;
			font-size: 1.5rem;
		}
		.controls > .play {
			svg.progress {
				stroke: var(--text-low);
				opacity: 1;
			}
		}
	}

	.gallery.slider.modal {
		position: fixed;
		z-index: var(--layer-5);
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
		@include desktop {
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
				@include fadeGradient(to top, 2, 0.95);
				z-index: -1;
			}
			text-align: center;
			color: white;
			font-size: var(--font-size-1);
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
		@include desktop {
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
		padding: 0 var(--gallery-gap, 12px) var(--gallery-gap, 12px);
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

		&.radius-none {
			--radius: 0px;
		}

		&.sizing-small {
			--cols: 6;
			.name {
				font-size: 0.9rem;
			}
			&.radius-small {
				--radius: calc(var(--gallery-gap, 12px) * 0.45);
			}
			&.radius-large {
				--radius: calc(var(--gallery-gap, 12px) * 0.65);
			}
			&.spacing-none {
				--gallery-gap: 0px;
			}
			&.spacing-default {
				--gallery-gap: min(8px, 1.5cqw);
			}
			&.spacing-large {
				--gallery-gap: min(14px, 1.5cqw);
			}
		}
		&.sizing-default {
			--cols: 4;
			&.radius-small {
				--radius: calc(var(--gallery-gap, 12px) * 0.45);
			}
			&.radius-large {
				--radius: calc(var(--gallery-gap, 12px) * 0.8);
			}
			&.spacing-none {
				--gallery-gap: 0px;
			}
			&.spacing-default {
				--gallery-gap: min(10px, 3cqw);
			}
			&.spacing-large {
				--gallery-gap: min(16px, 3cqw);
			}
		}
		&.sizing-large {
			--cols: 3;
			&.radius-small {
				--radius: calc(var(--gallery-gap, 12px) * 0.5);
			}
			&.radius-large {
				--radius: calc(var(--gallery-gap, 12px) * 1);
			}
			&.spacing-none {
				--gallery-gap: 0px;
			}
			&.spacing-default {
				--gallery-gap: min(12px, 5cqw);
			}
			&.spacing-large {
				--gallery-gap: min(20px, 5cqw);
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
				grid-column-end: span calc(var(--cols-per-image) * 2);
				grid-row-end: span
					max(1, round(down, calc(var(--cols-per-image) * 2 / var(--ratio, 1)), 1));
				@container (max-width: 767px) {
					$zero-if-one-column: min(
						round(down, calc((var(--cols-phone) / var(--cols-per-image)) - 1), 1),
						1
					);
					$rows: calc(
						var(--cols-per-image) + var(--cols-per-image) * #{$zero-if-one-column}
					);
					grid-column-end: span
						calc(var(--cols-per-image) + var(--cols-per-image) * #{$zero-if-one-column});
					grid-row-end: span
						max(1, round(down, calc((#{$rows}) * 1 / var(--ratio, 1)), 1));
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
		padding: 0 var(--gallery-gap, 12px) var(--gallery-gap, 12px);
		max-width: 2160px;
		grid-auto-rows: 1fr;
		container: gallery-grid / inline-size;

		&.radius-none {
			--radius: 0px;
		}
		&.sizing-small {
			grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
			.name {
				font-size: 0.8rem;
			}
			&.radius-small {
				--radius: calc(var(--gallery-gap, 12px) * 0.35);
			}
			&.radius-large {
				--radius: calc(var(--gallery-gap, 12px) * 0.55);
			}
			&.spacing-none {
				--gallery-gap: 0px;
			}
			&.spacing-default {
				--gallery-gap: min(8px, 1.5cqw);
			}
			&.spacing-large {
				--gallery-gap: min(14px, 1.5cqw);
			}
			@container (min-width: 768px) {
				grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
			}
		}
		&.sizing-default {
			grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
			&.radius-small {
				--radius: calc(var(--gallery-gap, 12px) * 0.45);
			}
			&.radius-large {
				--radius: calc(var(--gallery-gap, 12px) * 0.8);
			}
			&.spacing-none {
				--gallery-gap: 0px;
			}
			&.spacing-default {
				--gallery-gap: min(10px, 3cqw);
			}
			&.spacing-large {
				--gallery-gap: min(16px, 3cqw);
			}
			@container (min-width: 768px) {
				grid-template-columns: repeat(auto-fill, minmax(225px, 1fr));
			}
		}
		&.sizing-large {
			grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
			&.radius-small {
				--radius: calc(var(--gallery-gap, 12px) * 0.5);
			}
			&.radius-large {
				--radius: calc(var(--gallery-gap, 12px) * 1);
			}
			&.spacing-none {
				--gallery-gap: 0px;
			}
			&.spacing-default {
				--gallery-gap: min(12px, 5cqw);
			}
			&.spacing-large {
				--gallery-gap: min(20px, 5cqw);
			}
			@container (min-width: 768px) {
				grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
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
		padding: 0 var(--gallery-gap, 12px) var(--gallery-gap, 12px);
		max-width: 2160px;
		margin-inline: auto;

		&.radius-none {
			--radius: 0px;
		}
		&.sizing-small {
			--row-height: 70px;
			--max-row-height: 110px;
			&.radius-small {
				--radius: calc(var(--gallery-gap, 12px) * 0.45);
			}
			&.radius-large {
				--radius: calc(var(--gallery-gap, 12px) * 0.55);
			}
			&.spacing-none {
				--gallery-gap: 0px;
			}
			&.spacing-default {
				--gallery-gap: min(8px, 1.5cqw);
			}
			&.spacing-large {
				--gallery-gap: min(14px, 1.5cqw);
			}
			@container (min-width: 768px) {
				--row-height: 150px;
				--max-row-height: 200px;
			}
		}
		&.sizing-default {
			--row-height: 100px;
			--max-row-height: 150px;
			&.radius-small {
				--radius: calc(var(--gallery-gap, 12px) * 0.35);
			}
			&.radius-large {
				--radius: calc(var(--gallery-gap, 12px) * 0.5);
			}

			&.spacing-none {
				--gallery-gap: 0px;
			}
			&.spacing-default {
				--gallery-gap: min(10px, 3cqw);
			}
			&.spacing-large {
				--gallery-gap: min(16px, 3cqw);
			}
			@container (min-width: 768px) {
				--row-height: 200px;
				--max-row-height: 300px;
				&.radius-small {
					--radius: calc(var(--gallery-gap, 12px) * 0.45);
				}
				&.radius-large {
					--radius: calc(var(--gallery-gap, 12px) * 0.8);
				}
			}
		}
		&.sizing-large {
			--row-height: 250px;
			--max-row-height: 350px;
			&.radius-small {
				--radius: calc(var(--gallery-gap, 12px) * 0.5);
			}
			&.radius-large {
				--radius: calc(var(--gallery-gap, 12px) * 1);
			}
			&.spacing-none {
				--gallery-gap: 0px;
			}
			&.spacing-default {
				--gallery-gap: min(12px, 5cqw);
			}
			&.spacing-large {
				--gallery-gap: min(20px, 5cqw);
			}
			@container (max-width: 767px) {
				--max-row-height: 700px;
			}
		}

		> .gallery-item {
			flex-basis: calc(var(--ratio, 1) * var(--row-height));
			flex-grow: calc(var(--ratio, 1) * 100);
			aspect-ratio: var(--ratio, 1);
			max-height: var(--max-row-height);
			max-width: calc(var(--ratio, 1) * var(--max-row-height) * 1.1);
		}
		// &::after {
		// 	content: '';
		// 	flex-grow: 10000000;
		// 	flex-basis: var(--row-height);
		// }
	}

	.gallery.display-list {
		display: flex;
		flex-direction: column;
		max-width: 600px;
		margin-inline: auto;
		--line-height: 4rem;

		&.radius-none {
			--radius: 0px;
		}
		&.radius-small {
			--radius: 4px;
		}
		&.radius-large {
			--radius: 10px;
		}
		&.sizing-small {
			--line-height: 2.75rem;
			> .list-item {
				padding: 0 0.35rem;
			}
		}
		&.sizing-default {
			--line-height: 3.5rem;
		}
		&.sizing-large {
			--line-height: 4.5rem;
		}

		> .list-item {
			display: flex;
			height: var(--line-height);
			align-items: center;
			padding: 0 0.5rem;
			border-bottom: solid 1px var(--outline);
			position: relative;
			z-index: 1;
			&:last-child {
				border-bottom: none;
			}
			&:before {
				content: '';
				position: absolute;
				top: 2px;
				left: 0px;
				right: 0px;
				bottom: 2px;
				background-color: var(--bg-high);
				opacity: 0;
				border-radius: var(--radius);
				z-index: -1;
				transition: opacity 150ms ease;
			}
			@media (hover: hover) and (pointer: fine) {
				&:hover {
					&:before {
						opacity: 1;
					}
				}
			}
			.info {
				display: flex;
				flex: 1;
				cursor: pointer;
				align-items: center;
				.thumbnail {
					width: var(--line-height);
					height: var(--line-height);
					position: relative;
					color: white;
					display: flex;
					align-items: center;
					justify-content: center;
					border-radius: calc(var(--radius) - 0.5rem);
					overflow: hidden;
					:global(.image) {
						max-height: calc(100% - 4px);
						border-radius: calc(var(--radius) - 0.35rem);
					}
					.icon {
						position: absolute;
						width: 1.5rem;
						height: 1.5rem;
						top: calc(50% - 0.75rem);
						left: calc(50% - 0.75rem);
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
					padding: 0 1rem;
					text-overflow: ellipsis;
					white-space: nowrap;
					overflow: hidden;
				}
			}
		}
	}

	.gallery.display-grid,
	.gallery.display-masonry,
	.gallery.display-masonry-row {
		// There is only one image element
		&:has(.gallery-item:first-child:nth-last-child(1)) {
			display: flex;
			flex-wrap: wrap;
			align-items: start;
			justify-content: center;
			&:before {
				display: none;
			}
			&.radius-small {
				--radius: var(--radius-2);
			}
			&.radius-large {
				--radius: var(--radius-3);
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
				&.radius-small {
					--radius: var(--radius-4);
				}
				&.radius-large {
					--radius: var(--radius-5);
				}
			}
		}

		// There are 2 image elements
		&:has(.gallery-item:first-child:nth-last-child(2)) {
			display: flex;
			flex-wrap: wrap;
			align-items: start;
			justify-content: center;
			&:before {
				display: none;
			}
			&.radius-small {
				--radius: var(--radius-2);
			}
			&.radius-large {
				--radius: var(--radius-3);
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
				&.radius-small {
					--radius: var(--radius-3);
				}
				&.radius-large {
					--radius: var(--radius-4);
				}
			}
		}

		// There are 3 image elements
		&:has(.gallery-item:first-child:nth-last-child(3)) {
			display: flex;
			flex-wrap: wrap;
			align-items: start;
			justify-content: center;
			&:before {
				display: none;
			}
			&.radius-small {
				--radius: var(--radius-1);
			}
			&.radius-large {
				--radius: var(--radius-2);
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
				&.radius-small {
					--radius: var(--radius-2);
				}
				&.radius-large {
					--radius: var(--radius-3);
				}
			}
			&.sizing-large {
				@container (max-width: 767px) {
					> .gallery-item {
						flex-basis: 100%;
					}
				}
			}
		}

		// There are 4 image elements
		&:has(.gallery-item:first-child:nth-last-child(4)) {
			&.sizing-small {
				display: flex;
				flex-wrap: wrap;
				align-items: start;
				justify-content: center;
				&:before {
					display: none;
				}
				&.radius-small {
					--radius: var(--radius-1);
				}
				&.radius-large {
					--radius: var(--radius-2);
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
					&.radius-small {
						--radius: var(--radius-2);
					}
					&.radius-large {
						--radius: var(--radius-3);
					}
				}
			}
			&.sizing-large {
				@container (max-width: 767px) {
					> .gallery-item {
						flex-basis: 100%;
					}
				}
			}
		}

		// There are 5 image elements
		&:has(.gallery-item:first-child:nth-last-child(5)).sizing-small:not(.display-grid) {
			display: flex;
			flex-wrap: wrap;
			align-items: start;
			justify-content: center;
			&:before {
				display: none;
			}
			&.radius-small {
				--radius: var(--radius-1);
			}
			&.radius-large {
				--radius: var(--radius-2);
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
				&.radius-small {
					--radius: var(--radius-2);
				}
				&.radius-large {
					--radius: var(--radius-3);
				}
			}
		}
	}
</style>
