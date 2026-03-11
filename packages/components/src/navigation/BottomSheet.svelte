<!-- svelte-ignore state_referenced_locally -->
<script lang="ts">
	import WebsiteIcon from '~icons/tabler/world';
	import DeliveryPageIcon from '~icons/ion/ios-rocket';
	import MessengerIcon from '~icons/fa6-solid/paper-plane';
	import MediaIcon from '~icons/fa6-solid/images';
	import LoadingIcon from '~icons/eos-icons/bubble-loading';
	import InvoiceIcon from '~icons/fa6-solid/file-invoice-dollar';
	import DownloadIcon from '~icons/material-symbols/cloud-download';
	import PreviewIcon from '~icons/material-symbols/preview';
	import CloseIcon from '~icons/ion/md-close';
	import ProjectsIcon from '~icons/entypo/archive';
	import MailIcon from '~icons/material-symbols/mail';
	import SettingsIcon from '~icons/fa/cog';
	import { browser } from '$app/environment';
	import { getContext, onDestroy, tick, untrack } from 'svelte';
	import { quartOut, quadInOut, expoOut } from 'svelte/easing';
	import { getSearchParamString, ripple } from '@packages/lib';
	import { type Entities } from './../state';
	import { Image } from '../components';
	import { Button } from '../form';
	import ProfilePicture from '../components/ProfilePicture.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	let {
		/** Whether or not the bottom sheet is currently opened */
		opened = $bindable(false) as boolean,

		/** The progress percent (0-1) that the background should be faded */
		fadePercent = $bindable(0) as number,

		/** The progress percent (0-1) that the panel is morphed between the two open/closed states */
		morphPercent = $bindable(0) as number,
	} = $props();

	interface Pointer {
		id: string;
		x: number;
		y: number;
		dx: number;
		dy: number;
		dt: number;
		vx: number;
		vy: number;
		primary: boolean;
		time: number;
		startT: number;
		startX: number;
		startY: number;
	}

	/** The number of pixels from the bottom of the viewport that the morph transition should start */
	const morphStart = 108;

	/** The number of pixels from the bottom of the viewport that the morph transition should complete */
	const morphEnd = 300;

	/** The number of pixels from the bottom of the viewport that the fade transition should start */
	const fadeStart = 108;

	/** The number of pixels from the bottom of the viewport that the fade transition should be complete */
	const fadeEnd = 600;

	/** The container element (used to find the bounds of bottom sheet) */
	let viewport = $state<HTMLElement | undefined>();

	/** The width of the viewport element */
	let viewportH = $state(0);
	let viewportX = $state(0);
	let viewportY = $state(0);

	/** The element of the bottom sheet panel (used for gestures) */
	let container = $state<HTMLElement | undefined>();
	let containerH = $state(0);

	/** The number of pixels from the bottom the panel is offset (used to drag the element) */
	let offset = $state(0);
	let targetOffset = 0;
	const maxOffset = $derived(Math.min(viewportH || Infinity, containerH || Infinity));
	const maximized = $derived(offset >= maxOffset);

	/** Whether or not the container is being dragged */
	let dragging = $state(false);

	/** A record of touch/mouse event pointers that are currently active */
	let pointers: { [id: string]: Pointer } = {};

	/** The element of the panel content container (used for determining if the panel content is scrolled) */
	let panelContentContainer = $state<HTMLElement | undefined>();

	/** Whether the panel content has been scrolled down or not (disables pulling the sheet down when scrolled down) */
	let panelContentScrolled = $state(false);

	const url = $derived(page.url);
	const entities = getContext('entities') as Entities;
	const clientID = $derived(
		(url.searchParams.get('sheet') || '').match(/^\/client\/([\w-]+)/)?.[1] ||
			url.pathname.match(/\/dashboard\/client\/([\w-]+)/)?.[1],
	);
	const client = $derived(entities.get('client', clientID || ''));
	const dashboardPath = $derived(
		url.pathname.replace(/\/dashboard(\/.*)?$/, '/dashboard'),
	);
	const activePageMatches = $derived(
		url.pathname.match(/\/dashboard\/client\/[\w-]+(?:\/([\w-]+))?(?:\/([\w-]+))?/),
	);
	const activePage = $derived(
		!activePageMatches
			? undefined
			: (activePageMatches?.[1] as 'project' | 'invoice' | 'site' | 'message' | 'new') ||
					'project',
	);
	const activePageID = $derived(activePageMatches?.[2] || undefined);
	const remainOpen = $derived(!!activePage);
	if (activePage || activePageID) {
		opened = true;
		offset = morphStart;
	}
	$effect(() => {
		fadePercent = !remainOpen
			? quartOut(Math.max(0, Math.min(1, (offset - 72) / (fadeEnd - 72))))
			: quartOut(Math.max(0, Math.min(1, (offset - fadeStart) / (fadeEnd - fadeStart))));
	});
	$effect(() => {
		morphPercent = !remainOpen
			? 1
			: quadInOut(
					Math.max(0, Math.min(1, (offset - morphStart) / (morphEnd - morphStart))),
				);
	});
	$effect(() => {
		client && client.load();
	});

	export async function close() {
		await animateSheet(0);
		const newURL = new URL(url);
		if (activePage) newURL.pathname = `${dashboardPath}/client`;
		newURL.searchParams.delete('sheet');
		goto(newURL, { replaceState: !activePage, noScroll: true });
	}

	/** Called when a multi-pointer interaction starts */
	function onInteractionStart(e: PointerEvent) {
		if (!viewport || !container) return;
		if (!dragging) dragging = true;
		document.removeEventListener('pointermove', onPointerMove);
		document.removeEventListener('pointerup', onPointerUp);
		document.removeEventListener('pointercancel', onPointerUp);
		document.addEventListener('pointermove', onPointerMove, { passive: true });
		document.addEventListener('pointerup', onPointerUp, { passive: false });
		document.addEventListener('pointercancel', onPointerUp, { passive: false });
		const viewportRect = viewport.getBoundingClientRect();
		viewportY = viewportRect.top;
		viewportX = viewportRect.left;
		viewportH = viewportRect.height;
		const containerRect = container.getBoundingClientRect();
		containerH = containerRect.height;
	}

	/** Called when a multi-pointer interaction ends */
	function onInteractionEnd(e: PointerEvent) {
		if (dragging) dragging = false;
		document.removeEventListener('pointermove', onPointerMove);
		document.removeEventListener('pointerup', onPointerUp);
		document.removeEventListener('pointercancel', onPointerUp);
		const primary =
			Object.values(pointers).find((p) => p.primary) || Object.values(pointers)[0];
		const duration = primary.time - primary.startT;
		const dist = primary.y - primary.startY;
		const movedFast = Math.abs(primary.vy) > 0.2;
		const movedFar = Math.abs(dist) > 50 && Math.abs(primary.vy) > 0.05;
		const movedDown = primary.vy > 0;
		const clicked = duration < 250 && Math.abs(dist) < 10;

		if (clicked) {
			let el = e.target as HTMLElement;
			let elAction: 'link' | 'toggle' | undefined;
			while (el && !elAction) {
				if (
					el.classList.contains('spacer') ||
					el.classList.contains('profile') ||
					el.classList.contains('cover') ||
					el.tagName === 'H2'
				) {
					elAction = 'toggle';
					break;
				}
				if (el.tagName === 'A') {
					elAction = 'link';
					break;
				}
				if (el === container) break;
				el = el.parentElement as HTMLElement;
			}
			if (e.type !== 'pointercancel') {
				if (elAction === 'toggle') {
					if (offset > morphStart) {
						if (remainOpen) {
							animateSheet(morphStart);
						} else {
							close();
						}
					} else {
						animateSheet(maxOffset);
					}
				}
				if (elAction === 'link' && el) {
					const href = (el as HTMLAnchorElement).href;
					if (href) {
						e.preventDefault();
						goto(href, { replaceState: !remainOpen });
					}
				}
			}
		} else if (movedFast || movedFar) {
			if (movedDown) {
				if (remainOpen && offset > morphStart) {
					animateSheet(morphStart);
				} else {
					close();
				}
			} else {
				animateSheet(maxOffset);
			}
		} else {
			if (offset < morphStart * 0.75) {
				close();
			} else if (offset < (morphEnd - morphStart) * 0.75 + morphStart) {
				animateSheet(morphStart);
			} else {
				animateSheet(maxOffset);
			}
		}
		pointers = {};
	}

	/** Called when a pointer (touch or mouse) moves */
	function onPointerMove(e: PointerEvent) {
		if (e.button === 2) return; // Ignore right clicks
		const pointer = pointers[`${e.pointerId}`];
		if (!pointer) return;
		const x = e.clientX - viewportX;
		const y = e.clientY - viewportY;
		pointers[pointer.id] = {
			id: `${e.pointerId}`,
			x: x,
			y: y,
			dx: x - pointer.x,
			dy: y - pointer.y,
			dt: Math.max(1, e.timeStamp - pointer.time),
			vx: (x - pointer.x) / Math.max(1, e.timeStamp - pointer.time),
			vy: (y - pointer.y) / Math.max(1, e.timeStamp - pointer.time),
			primary: e.isPrimary,
			time: e.timeStamp,
			startT: pointer.startT || e.timeStamp,
			startX: pointer.startX || x,
			startY: pointer.startY || y,
		};
		const primary =
			Object.values(pointers).find((p) => p.primary) || Object.values(pointers)[0];
		offset = Math.min(viewportH, containerH, Math.max(0, offset - primary.dy));
	}

	/** Called when a pointer (touch or mouse) unpresses */
	function onPointerUp(e: PointerEvent) {
		if (e.button === 2) return; // Ignore right clicks
		if (!Object.keys(pointers).length) return;
		// Check if all the pointers have finished their interaction
		const hasOtherPointers = Object.keys(pointers).some((k) => k !== `${e.pointerId}`);
		if (hasOtherPointers) {
			delete pointers[`${e.pointerId}`];
		} else {
			pointers[`${e.pointerId}`] = {
				...pointers[`${e.pointerId}`],
				time: e.timeStamp,
			};
			onInteractionEnd(e);
		}
	}

	/** Called when a pointer (touch or mouse) presses down */
	function onPointerDown(e: PointerEvent) {
		if (e.button === 2) return; // Ignore right clicks

		// Check if the pointer is within the panel content.
		// If so, we might need to ignore the drag so scrolling can work within the panel content element
		let el = e.target as HTMLElement;
		let isPanelContent = false;
		while (el) {
			if (el.classList.contains('panel-content')) {
				isPanelContent = true;
				break;
			}
			if (el === container) break;
			el = el.parentElement as HTMLElement;
		}
		if (isPanelContent && panelContentScrolled) return;

		if (!isPanelContent) {
			// Check if the pointer is within a link element.
			// If so, we might need to allow the link to be clicked
			el = e.target as HTMLElement;
			let isLinkOrButton = false;
			while (el) {
				if (el.tagName === 'A' || el.tagName === 'BUTTON') {
					isLinkOrButton = true;
					break;
				}
				if (el === container) break;
				el = el.parentElement as HTMLElement;
			}
			if (!isLinkOrButton) {
				// This is commented out because it was in here before and I don't know why.
				// But by stoping propagation, it prevents the pointer events from becoming 'click' events
				// This makes it so the Popover component won't close when the bottom sheet is opened
				// By allowing the click events to propagate, the Popover component can close when the bottom sheet is opened
				// If this line is needed, we'll need to find a different way to fix the Popover component closing issue
				// e.preventDefault();
				// e.stopPropagation();
			}
		}

		// Check if this is the first pointer to start interacting
		if (!Object.keys(pointers).length) onInteractionStart(e);

		const x = e.clientX - viewportX;
		const y = e.clientY - viewportY;
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
			startT: e.timeStamp,
			startX: x,
			startY: y,
		};
	}

	function onPanelContentScroll(e: Event) {
		if (!panelContentContainer) return;
		const scrolled = panelContentContainer.scrollTop > 0;
		if (scrolled !== panelContentScrolled) panelContentScrolled = scrolled;
	}

	/** Initializes the event listeners when the bottom sheet is visible */
	$effect(() => {
		if (!container || !viewport) return;
		destroyEventListeners();
		container.addEventListener('pointerdown', onPointerDown, { passive: false });
		const boundingRect = viewport.getBoundingClientRect();
		viewportY = boundingRect.top;
		viewportX = boundingRect.left;
	});

	/** Destroys the event listeners when the bottom sheet is not being shown */
	function destroyEventListeners() {
		if (!browser) return;
		if (container) {
			container.removeEventListener('pointerdown', onPointerDown);
		}
	}
	onDestroy(() => destroyEventListeners());

	$effect(() => {
		document.body.style.userSelect = dragging ? 'none' : '';
		document.body.style.overflow = offset > morphStart || dragging ? 'hidden' : '';
	});

	// Initialize the initial offset
	$effect(() => {
		if (!viewport || !container) return;
		if (!clientID || viewport.clientWidth >= 1024) {
			offset = 0;
		} else if (activePageID) {
			animateSheet(morphStart);
		} else if (activePage) {
			animateSheet(morphStart);
		} else {
			animateSheet(
				Math.min(460, window.innerHeight, container.clientHeight || Infinity),
				650,
				expoOut,
			);
		}
	});
	$effect(() => {
		if (opened && offset <= 0) opened = false;
		if (!opened && offset > 0) opened = true;
	});
	$effect(() => {
		if (opened) {
			tick().then(() => {
				if (!container) return;
				containerH = container.clientHeight;
			});
		}
	});

	// Animate the bottom sheet to a target location
	let requestAnimationFrameID: number;
	let requestAnimationFrameStart: number;
	function animateSheet(
		nextOffset: number,
		duration = 350,
		easing: (t: number) => number = quartOut,
	) {
		return new Promise<void>((resolve) => {
			targetOffset = nextOffset;
			if (targetOffset === untrack(() => offset)) return resolve();
			const start = +(document.timeline.currentTime || Date.now());
			const startOffset = untrack(() => offset);
			requestAnimationFrameStart = start;
			function animate(time: number) {
				cancelAnimationFrame(requestAnimationFrameID);
				const percent = easing(Math.min(1, Math.max(0, (time - start) / duration)));
				const dist = targetOffset - startOffset;
				const nextOffset = startOffset + dist * percent;
				if (nextOffset !== untrack(() => offset)) offset = nextOffset;
				if (percent < 1 && start === requestAnimationFrameStart) {
					requestAnimationFrameID = requestAnimationFrame(animate);
				} else {
					resolve();
				}
			}
			cancelAnimationFrame(requestAnimationFrameID);
			requestAnimationFrameID = requestAnimationFrame(animate);
		});
	}
</script>

<div
	class="sheet"
	class:remain-open={remainOpen}
	class:dragging
	bind:this={viewport}
	style:--offset="{offset}px"
	style:--fade-percent={fadePercent}
	style:--morph-percent={morphPercent}
	style:--morph-start="{morphStart}px"
	style:--morph-end="{morphEnd}px">
	<div class="panel-container" bind:this={container}>
		<div class="panel">
			<div class="drag-indicator"></div>
			<div class="spacer"></div>
			<div class="profile">
				<ProfilePicture {client} />
			</div>
			<div class="cover">
				{#if client.loaded && client.logo}
					<Image checkForUploading src={client.logo} fit="contain" disablePreview />
					<div class="cover-bg">
						<Image checkForUploading src={client.logo} disablePreview />
					</div>
				{/if}
			</div>
			<h2>
				{client?.name || (!client?.initialized ? 'Loading...' : 'Unnamed Client')}
			</h2>
			{#if remainOpen}
				<div class="close">
					<Button onclick={close} icon transparent size="0">
						<CloseIcon />
					</Button>
				</div>
			{/if}
			<div class="actions">
				{#if activePage === 'site'}
					<Button
						dense
						translucent
						href={url.pathname + '/preview' + getSearchParamString(url)}>
						Preview
					</Button>
					{#if client.diff}
						<Button dense onclick={() => client.save()}>Save Changes</Button>
					{:else}
						<Button dense translucent href="?modal=/mail/new">Deliver</Button>
					{/if}
				{:else}
					<Button dense translucent href="?modal=/mail/new">
						<MailIcon />
						Message
					</Button>
					<Button dense translucent href="?modal=/client/{clientID}">
						<SettingsIcon />
						Settings
					</Button>
				{/if}
			</div>
			<div
				class="panel-content"
				onscroll={onPanelContentScroll}
				bind:this={panelContentContainer}
				style:touch-action="pan-x {!maximized
					? ''
					: panelContentScrolled
						? 'pan-y'
						: 'pan-down'}">
				<div class="info">
					{#if client.company}<p>{client.company}</p>{/if}
					{#if client.email}<p>{client.email}</p>{/if}
				</div>
				<nav data-sveltekit-keepfocus>
					<a
						href="{dashboardPath}/client/{clientID}{getSearchParamString(url)}"
						use:ripple
						class:active={activePage === 'project'}>
						<ProjectsIcon /> Projects
					</a>
					<a
						href="{dashboardPath}/client/{clientID}/invoice{getSearchParamString(url)}"
						use:ripple
						class:active={activePage === 'invoice'}>
						<InvoiceIcon /> Invoices
					</a>
					<a
						href="{dashboardPath}/client/{clientID}/message{getSearchParamString(url)}"
						use:ripple
						class:active={url.pathname === `${dashboardPath}/client/${clientID}/message`}>
						<MessengerIcon style="padding: 0 2px" /> Messages
					</a>
					<!-- <a
						href="/dashbaord/client/{clientID}/new{getSearchParamString(url)}"
						class="create"
						use:ripple
						class:active={url.pathname === `{dashboardPath}/client/${clientID}/new`}>
						Create
					</a> -->
				</nav>
			</div>
		</div>
	</div>
	<div
		class="bg"
		role={offset > morphStart ? 'button' : 'presentation'}
		tabindex="-1"
		style:pointer-events={offset > morphStart ? 'all' : 'none'}
		onpointerdown={() => (remainOpen ? animateSheet(morphStart) : close())}>
	</div>
</div>

<style lang="scss">
	:global(html) {
		--sheet-height: 108px;
		@include desktop {
			--sheet-height: 0px;
		}
	}
	.sheet {
		--profile-size-2: 120px;
		--profile-size-1: 80px;
		--profile-header-height: 125px;
		--padding-x: 1rem;
		--padding-y: 1.5rem;
		--h2-height: 2.5rem;
		position: fixed;
		bottom: 0;
		left: 0;
		width: 100%;
		height: 100%;
		display: flex;
		justify-content: center;
		pointer-events: none;
		z-index: var(--layer-4);
		@include tablet {
			z-index: var(--layer-2);
		}
		@include desktop {
			display: none;
		}
		&.dragging {
			.panel {
				cursor: grabbing;
			}
		}
	}
	.panel-container {
		background-color: var(--panel);
		border-top-left-radius: var(--radius-5);
		border-top-right-radius: var(--radius-5);
		z-index: 2;
		width: 100%;
		min-height: var(--morph-start);
		max-width: 768px;
		position: absolute;
		top: 100%;
		transform: translate3d(0px, min(0px, max(-100%, calc(-1 * var(--offset)))), 0px);
		cursor: grab;
		pointer-events: all;
		max-height: 100vh;
		max-height: 100svh;
		height: 100%;
		height: max-content;
		touch-action: pan-x pinch-zoom;
		box-shadow: 0px 0px 0px 1px color-mix(in oklch, transparent, var(--text) 12%);
		@include tablet {
			max-width: 500px;
		}
	}
	.panel {
		max-height: 100vh;
		max-height: 100svh;
		width: 100%;
		position: relative;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
	}
	.bg {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 1;
		opacity: var(--fade-percent, 0);
		&::after {
			content: '';
			background-color: black;
			position: absolute;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			opacity: 0.35;
		}
		@supports (backdrop-filter: blur(10px)) {
			backdrop-filter: blur(10px);
			&::after {
				opacity: 0.2;
			}
		}
	}
	.drag-indicator {
		position: absolute;
		top: 0.5rem;
		left: 50%;
		width: 35px;
		height: 4px;
		transform: translateX(-50%);
		background-color: var(--panel-text-low);
		border-radius: var(--radius-round);
		pointer-events: none;
	}

	.cover {
		--pos-y-1: calc(var(--padding-x) + 7rem);
		--pos-y-2: calc(var(--padding-y));
		--pos-x-1: calc(var(--padding-x));
		--pos-x-2: calc(var(--padding-x));
		background-color: rgba(var(--contrast-rgb-high) / 0.2);
		touch-action: none;
		position: absolute;
		top: calc(
			(var(--pos-y-1) * (1 - var(--morph-percent))) +
				(var(--pos-y-2) * (var(--morph-percent)))
		);
		left: calc(
			(var(--pos-x-1) * (1 - var(--morph-percent))) +
				(var(--pos-x-2) * (var(--morph-percent)))
		);
		width: calc(100% - var(--padding-x) * 2);
		height: var(--profile-header-height);
		border-radius: var(--radius-4);
		overflow: hidden;
		z-index: 3;
		padding: 1rem;
		:global(.image) {
			height: 100%;
		}
		.cover-bg {
			z-index: -1;
			position: absolute;
			top: 0;
			bottom: 0;
			left: 0;
			right: 0;
			transform: scale(1.1);
			filter: brightness(1.5) contrast(0.9) blur(30px);
		}
	}
	.profile {
		position: relative;
		--border-size: 11px;
		--pos-y-1: calc(var(--padding-y) - 0.5rem - var(--border-size));
		--pos-y-2: calc(
			var(--padding-y) + var(--profile-header-height) -
				(var(--profile-size-2) / 2) - var(--border-size)
		);
		--pos-x-1: calc(var(--padding-x) - var(--border-size));
		--pos-x-2: calc(var(--padding-x) - var(--border-size));
		--size-1: var(--profile-size-1);
		--size-2: var(--profile-size-2);
		padding: var(--border-size);
		box-sizing: content-box;
		touch-action: none;
		position: absolute;
		top: calc(
			(var(--pos-y-1) * (1 - var(--morph-percent))) +
				(var(--pos-y-2) * (var(--morph-percent)))
		);
		left: calc(
			(var(--pos-x-1) * (1 - var(--morph-percent))) +
				(var(--pos-x-2) * (var(--morph-percent)))
		);
		width: calc(
			(var(--size-1) * (1 - var(--morph-percent))) +
				(var(--size-2) * (var(--morph-percent)))
		);
		height: calc(
			(var(--size-1) * (1 - var(--morph-percent))) +
				(var(--size-2) * (var(--morph-percent)))
		);
		overflow: hidden;
		z-index: 4;
		:global(.image) {
			height: 100%;
		}

		&::before {
			content: '';
			position: absolute;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			border-radius: var(--radius-round);
			border: solid var(--border-size) var(--panel);
			background-color: var(--panel-high);
		}
	}
	h2 {
		--pos-y-1: calc(var(--padding-y) - 0.5rem);
		--pos-y-2: calc(
			var(--padding-y) + var(--profile-header-height) +
				var(--profile-size-2) - var(--h2-height) - 0.5rem
		);
		--pos-x-1: calc(var(--padding-x) + var(--profile-size-1) + 1rem);
		--pos-x-2: calc(var(--padding-x) + 0.5rem);
		--max-width-1: calc(100% - var(--pos-x-1) - var(--padding-x));
		--max-width-2: calc(100% - (var(--padding-x) * 2) - 1rem);
		z-index: 4;
		display: flex;
		align-items: center;
		position: absolute;
		text-wrap: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		line-height: var(--h2-height);
		height: var(--h2-height);
		max-width: calc(
			(var(--max-width-1) * (1 - var(--morph-percent))) +
				(var(--max-width-2) * (var(--morph-percent)))
		);
		top: calc(
			(var(--pos-y-1) * (1 - var(--morph-percent))) +
				(var(--pos-y-2) * (var(--morph-percent)))
		);
		left: calc(
			(var(--pos-x-1) * (1 - var(--morph-percent))) +
				(var(--pos-x-2) * (var(--morph-percent)))
		);
	}
	.spacer {
		height: calc(
			var(--padding-y) + (var(--profile-size-2) / 2) + var(--profile-header-height) +
				var(--h2-height)
		);
		flex-shrink: 0;
	}
	.close {
		position: absolute;
		top: 0;
		height: var(--morph-start);
		right: 0.5rem;
		display: flex;
		align-items: center;
		opacity: calc(1 - var(--morph-percent));
		transform: translate3d(0px, calc(var(--morph-percent) * 300px), 0px);
	}
	.actions {
		position: absolute;
		top: calc(var(--padding-y) + var(--h2-height) - 0.25rem);
		left: calc(var(--padding-x) + var(--profile-size-1));
		padding: 0 1rem;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		opacity: calc(1 - var(--morph-percent));
		z-index: 1;
		transform: translate3d(0px, calc(var(--morph-percent) * 300px), 0px);
	}
	.panel-content {
		overflow-y: auto;
		overflow-x: hidden;
		@media (pointer: coarse) {
			scrollbar-width: 0px;
			&::-webkit-scrollbar {
				display: none;
			}
		}
		@media (pointer: fine) {
			@include scrollbar(0.5rem, var(--panel-high), var(--panel-text-low));
		}
		.info {
			padding: 0 1.5rem;
			p {
				margin: 0.5rem 0;
			}
		}
	}

	nav {
		padding: 1rem 0.5rem 2rem;
		a {
			display: flex;
			align-items: center;
			justify-content: flex-start;
			border-radius: var(--radius-round);
			background-color: var(--panel);
			text-decoration: none;
			height: 3.75rem;
			margin: 1px 0 0;
			padding: 0.5rem 0.25rem;
			transition:
				background-color 100ms ease,
				color 100ms ease;
			font-size: var(--font-size-2);
			position: relative;
			z-index: 1;
			:global(svg) {
				color: var(--text-low);
				margin: 0 0.75rem;
				width: 1.75rem;
				height: 1.75rem;
				transition: color 100ms ease;
			}
			&.active {
				background-color: var(--panel-high);
			}
			&.active,
			&:hover,
			&:focus-visible {
				color: var(--text-high);
				:global(svg) {
					color: var(--text-high);
				}
			}
		}
	}
</style>
