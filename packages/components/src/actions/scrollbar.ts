import type { Attachment } from 'svelte/attachments';

export interface ScrollbarOptions {
	/** Whether the scrollbar fades out when idle. Defaults to true. */
	autohide?: boolean;

	/** How long (in ms) after the last scroll/pointer activity before an autohiding scrollbar fades out. Defaults to 1000. */
	autohide_delay?: number;

	/**
	 * Inset (in px) from the container's corners at both ends of each track.
	 * Defaults to half the container's computed border-radius, so the thumb
	 * never overlaps a rounded corner.
	 */
	corner_inset?: number;

	/**
	 * Per-edge track insets (in px) that override the corner-derived defaults
	 * for the edges they specify. Pass a function to have it re-evaluated on
	 * every layout (e.g. to track a sticky header's height); return undefined
	 * for an edge to keep its default.
	 */
	track_insets?: TrackInsets | ((node: HTMLElement) => TrackInsets);
}

export interface TrackInsets {
	top?: number;
	bottom?: number;
	left?: number;
	right?: number;
}

interface Bar {
	axis: 'x' | 'y';
	track: HTMLDivElement;
	thumb: HTMLDivElement;
	/** Whether the container currently overflows on this axis */
	enabled: boolean;
	/** Length of the track along the scroll axis (px) */
	track_size: number;
	/** Length of the thumb along the scroll axis (px) */
	thumb_size: number;
	hovered: boolean;
	dragging: boolean;
}

/** Overflow values that make an element scrollable */
const SCROLLABLE = /auto|scroll|overlay/;

/** Minimum thumb length (px), so the thumb stays grabbable in huge documents */
const MIN_THUMB = 32;

let styles_injected = false;

/**
 * The shared stylesheet for every scrollbar attachment. Visual styling lives
 * here (driven by the --scrollbar-* tokens); geometry is set inline by the
 * attachment. The show transition follows the design system's hover rule:
 * snap in, ease out.
 */
function injectStyles() {
	if (styles_injected || typeof document === 'undefined') return;
	styles_injected = true;
	const style = document.createElement('style');
	style.setAttribute('data-delight-scrollbar', '');
	style.textContent = `
[data-scrollbar] { scrollbar-width: none !important; }
[data-scrollbar]::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
.delight-scrollbar {
	position: absolute;
	z-index: 10;
	opacity: 0;
	pointer-events: none;
	transition: opacity 250ms var(--ease-out, ease);
}
.delight-scrollbar[data-show] {
	opacity: 1;
	pointer-events: auto;
	transition: none;
}
.delight-scrollbar-thumb {
	position: absolute;
	border-radius: var(--radius-full, 1e5px);
	background-color: var(--scrollbar-thumb-color, rgb(128 128 128 / 0.5));
	transition:
		background-color 250ms var(--ease-out, ease),
		width 150ms var(--ease-out, ease),
		height 150ms var(--ease-out, ease);
}
.delight-scrollbar[data-axis='y'] .delight-scrollbar-thumb {
	right: var(--scrollbar-inset, 2px);
	width: calc(var(--scrollbar-size, 10px) * 0.5);
}
.delight-scrollbar[data-axis='y'][data-rtl] .delight-scrollbar-thumb {
	right: auto;
	left: var(--scrollbar-inset, 2px);
}
.delight-scrollbar[data-axis='x'] .delight-scrollbar-thumb {
	bottom: var(--scrollbar-inset, 2px);
	height: calc(var(--scrollbar-size, 10px) * 0.5);
}
.delight-scrollbar:hover .delight-scrollbar-thumb,
.delight-scrollbar[data-dragging] .delight-scrollbar-thumb {
	background-color: var(--scrollbar-thumb-color-active, rgb(128 128 128 / 0.8));
	transition:
		width 150ms var(--ease-out, ease),
		height 150ms var(--ease-out, ease);
}
.delight-scrollbar[data-axis='y']:hover .delight-scrollbar-thumb,
.delight-scrollbar[data-axis='y'][data-dragging] .delight-scrollbar-thumb {
	width: calc(var(--scrollbar-size, 10px) - var(--scrollbar-inset, 2px));
}
.delight-scrollbar[data-axis='x']:hover .delight-scrollbar-thumb,
.delight-scrollbar[data-axis='x'][data-dragging] .delight-scrollbar-thumb {
	height: calc(var(--scrollbar-size, 10px) - var(--scrollbar-inset, 2px));
}
@media (prefers-reduced-motion: reduce) {
	.delight-scrollbar,
	.delight-scrollbar-thumb { transition: none !important; }
}
`;
	document.head.appendChild(style);
}

function clamp(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max);
}

/**
 * A svelte attachment that replaces an element's native scrollbars with the
 * delightstack overlay scrollbar: a token-driven thumb that floats over the
 * content (no layout gutter), fades in while scrolling/hovering and back out
 * when idle, insets itself past the container's rounded corners, and supports
 * dragging and click-to-jump like a native bar.
 *
 * Native scrolling (wheel, keyboard, touch, momentum) is untouched — the
 * element keeps scrolling itself; only the visual scrollbar is replaced. On
 * touch-only devices the attachment does nothing and the native auto-hiding
 * indicators remain.
 *
 * The element's parent is used as the positioning context for the overlay
 * (it is given `position: relative` if static), so the element should keep
 * the same box as its parent or be positioned statically within it.
 * @example
 * ```svelte
 * <div class="content" {@attach scrollbar()}>...</div>
 * ```
 */
export function scrollbar(options: ScrollbarOptions = {}): Attachment<HTMLElement> {
	return (node) => {
		if (typeof window === 'undefined') return;
		// Touch devices keep their native auto-hiding overlay indicators
		if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
		const parent_el = node.parentElement;
		if (!parent_el) return;
		const parent = parent_el;
		injectStyles();

		const {
			autohide = true,
			autohide_delay = 1000,
			corner_inset,
			track_insets,
		} = options;

		node.setAttribute('data-scrollbar', '');

		// The tracks are positioned against the nearest containing block, which
		// must be the parent for the offset math below to hold
		let restore_position: string | undefined;
		if (getComputedStyle(parent).position === 'static') {
			restore_position = parent.style.position;
			parent.style.position = 'relative';
		}

		function createBar(axis: 'x' | 'y'): Bar {
			const track = document.createElement('div');
			track.className = 'delight-scrollbar';
			track.setAttribute('data-axis', axis);
			track.setAttribute('aria-hidden', 'true');
			const thumb = document.createElement('div');
			thumb.className = 'delight-scrollbar-thumb';
			track.appendChild(thumb);
			return {
				axis,
				track,
				thumb,
				enabled: false,
				track_size: 0,
				thumb_size: 0,
				hovered: false,
				dragging: false,
			};
		}

		const bars = [createBar('y'), createBar('x')];
		for (const bar of bars) parent.insertBefore(bar.track, node.nextSibling);

		let rtl = false;
		let shown = false;
		let hide_timer: ReturnType<typeof setTimeout> | undefined;
		let frame: number | undefined;

		function tokenPx(style: CSSStyleDeclaration, name: string, fallback: number) {
			const value = parseFloat(style.getPropertyValue(name));
			return Number.isFinite(value) ? value : fallback;
		}

		/** Repositions both tracks over the element's edges */
		function layout() {
			const style = getComputedStyle(node);
			rtl = style.direction === 'rtl';
			const size = tokenPx(style, '--scrollbar-size', 10);
			const edge = tokenPx(style, '--scrollbar-inset', 2);
			const track_width = size + edge;

			const [y, x] = bars;
			y.enabled =
				SCROLLABLE.test(style.overflowY) && node.scrollHeight - node.clientHeight > 1;
			x.enabled =
				SCROLLABLE.test(style.overflowX) && node.scrollWidth - node.clientWidth > 1;

			const top = node.offsetTop;
			const left = node.offsetLeft;
			const width = node.offsetWidth;
			const height = node.offsetHeight;

			// Rounded corners the thumb must stay clear of. The inset is HALF the
			// computed radius — the thumb hugs the edge, so the curve has receded
			// enough by then (and squircled corners double the computed radius).
			// Scrollers often fill a rounded parent that carries the visual radius
			// (modal/popover/card bodies), so when the element's own corner is
			// square but it sits close to a rounded parent corner, inherit the
			// parent's radius minus however far the element already sits from it.
			const parent_style = getComputedStyle(parent);
			const gap = {
				top,
				left,
				right: parent.clientWidth - (left + width),
				bottom: parent.clientHeight - (top + height),
			};
			function cornerRadius(
				corner: 'TopLeft' | 'TopRight' | 'BottomLeft' | 'BottomRight',
			) {
				const own =
					parseFloat(style[`border${corner}Radius` as 'borderTopLeftRadius']) || 0;
				if (own > 0) return own / 2;
				const inherited =
					parseFloat(parent_style[`border${corner}Radius` as 'borderTopLeftRadius']) || 0;
				const [vertical_gap, horizontal_gap] =
					corner === 'TopLeft'
						? [gap.top, gap.left]
						: corner === 'TopRight'
							? [gap.top, gap.right]
							: corner === 'BottomLeft'
								? [gap.bottom, gap.left]
								: [gap.bottom, gap.right];
				return Math.max(0, inherited / 2 - Math.max(vertical_gap, horizontal_gap));
			}
			const radius = {
				tl: cornerRadius('TopLeft'),
				tr: cornerRadius('TopRight'),
				bl: cornerRadius('BottomLeft'),
				br: cornerRadius('BottomRight'),
			};
			const insets =
				typeof track_insets === 'function' ? track_insets(node) : (track_insets ?? {});

			// Inset the track ends past the rounded corners (and past the other
			// track when both axes are scrollable, so they never overlap)
			const y_start = insets.top ?? corner_inset ?? (rtl ? radius.tl : radius.tr);
			const y_end =
				(insets.bottom ?? corner_inset ?? (rtl ? radius.bl : radius.br)) +
				(x.enabled ? track_width : 0);
			if (rtl) y.track.setAttribute('data-rtl', '');
			else y.track.removeAttribute('data-rtl');
			y.track.style.top = `${top + y_start}px`;
			y.track.style.height = `${Math.max(0, height - y_start - y_end)}px`;
			y.track.style.width = `${track_width}px`;
			y.track.style.left = rtl ? `${left}px` : `${left + width - track_width}px`;
			y.track_size = Math.max(0, height - y_start - y_end);

			const x_start =
				(insets.left ?? corner_inset ?? radius.bl) + (y.enabled && rtl ? track_width : 0);
			const x_end =
				(insets.right ?? corner_inset ?? radius.br) +
				(y.enabled && !rtl ? track_width : 0);
			x.track.style.left = `${left + x_start}px`;
			x.track.style.width = `${Math.max(0, width - x_start - x_end)}px`;
			x.track.style.height = `${track_width}px`;
			x.track.style.top = `${top + height - track_width}px`;
			x.track_size = Math.max(0, width - x_start - x_end);
		}

		/** Syncs a thumb's size + position to the element's scroll state */
		function updateThumb(bar: Bar) {
			if (!bar.enabled) return;
			const vertical = bar.axis === 'y';
			const scroll_size = vertical ? node.scrollHeight : node.scrollWidth;
			const client_size = vertical ? node.clientHeight : node.clientWidth;
			const max_scroll = scroll_size - client_size;
			const min = Math.min(MIN_THUMB, bar.track_size / 2);
			bar.thumb_size = clamp(
				(client_size / scroll_size) * bar.track_size,
				min,
				bar.track_size,
			);
			const range = bar.track_size - bar.thumb_size;
			const position = vertical ? node.scrollTop : node.scrollLeft;
			let progress = max_scroll > 0 ? clamp(Math.abs(position) / max_scroll, 0, 1) : 0;
			// In RTL, scrollLeft runs from 0 (content start, at the right) to
			// -max_scroll, and the thumb travels right-to-left
			if (!vertical && rtl) progress = 1 - progress;
			bar.thumb.style[vertical ? 'height' : 'width'] = `${bar.thumb_size}px`;
			bar.thumb.style.transform = vertical
				? `translateY(${progress * range}px)`
				: `translateX(${progress * range}px)`;
		}

		function syncVisibility() {
			for (const bar of bars) {
				const show = bar.enabled && (shown || !autohide);
				if (show) bar.track.setAttribute('data-show', '');
				else bar.track.removeAttribute('data-show');
			}
		}

		function refresh() {
			layout();
			for (const bar of bars) updateThumb(bar);
			syncVisibility();
		}

		/** Batches refreshes from observers/scroll into one per frame */
		function schedule() {
			if (frame !== undefined) return;
			frame = requestAnimationFrame(() => {
				frame = undefined;
				refresh();
			});
		}

		function scheduleHide() {
			clearTimeout(hide_timer);
			if (!autohide) return;
			hide_timer = setTimeout(() => {
				if (bars.some((bar) => bar.hovered || bar.dragging)) return;
				shown = false;
				syncVisibility();
			}, autohide_delay);
		}

		function show() {
			if (!shown) {
				shown = true;
				syncVisibility();
			}
			scheduleHide();
		}

		function onScroll() {
			for (const bar of bars) updateThumb(bar);
			show();
		}

		function setupBar(bar: Bar) {
			const vertical = bar.axis === 'y';

			bar.track.addEventListener('pointerenter', () => {
				bar.hovered = true;
				show();
			});
			bar.track.addEventListener('pointerleave', () => {
				bar.hovered = false;
				scheduleHide();
			});

			// The track sits over the content's edge, so forward wheel events the
			// native scrollbar would have handled
			bar.track.addEventListener(
				'wheel',
				(event) => {
					event.preventDefault();
					node.scrollTop += event.deltaY;
					node.scrollLeft += event.deltaX;
				},
				{ passive: false },
			);

			// Click on the track (not the thumb) jumps to that position
			bar.track.addEventListener('pointerdown', (event) => {
				if (event.target !== bar.track || event.button !== 0) return;
				event.preventDefault();
				const rect = bar.track.getBoundingClientRect();
				const offset = vertical ? event.clientY - rect.top : event.clientX - rect.left;
				const range = bar.track_size - bar.thumb_size;
				let progress = range > 0 ? clamp((offset - bar.thumb_size / 2) / range, 0, 1) : 0;
				if (!vertical && rtl) progress = 1 - progress;
				const scroll_size = vertical ? node.scrollHeight : node.scrollWidth;
				const client_size = vertical ? node.clientHeight : node.clientWidth;
				const target =
					progress * (scroll_size - client_size) * (!vertical && rtl ? -1 : 1);
				node.scrollTo({ [vertical ? 'top' : 'left']: target, behavior: 'smooth' });
			});

			// Drag the thumb like a native scrollbar
			bar.thumb.addEventListener('pointerdown', (event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				event.stopPropagation();
				bar.thumb.setPointerCapture(event.pointerId);
				bar.dragging = true;
				bar.track.setAttribute('data-dragging', '');
				const start_pointer = vertical ? event.clientY : event.clientX;
				const start_scroll = vertical ? node.scrollTop : node.scrollLeft;

				function onMove(move: PointerEvent) {
					const delta = (vertical ? move.clientY : move.clientX) - start_pointer;
					const range = bar.track_size - bar.thumb_size;
					if (range <= 0) return;
					const scroll_size = vertical ? node.scrollHeight : node.scrollWidth;
					const client_size = vertical ? node.clientHeight : node.clientWidth;
					const ratio = (scroll_size - client_size) / range;
					// The thumb→scroll mapping works out identically in RTL: both
					// scrollLeft and the thumb's travel direction flip sign
					const target = start_scroll + delta * ratio;
					if (vertical) node.scrollTop = target;
					else node.scrollLeft = target;
				}

				function onEnd(end: PointerEvent) {
					bar.thumb.releasePointerCapture(end.pointerId);
					bar.thumb.removeEventListener('pointermove', onMove);
					bar.thumb.removeEventListener('pointerup', onEnd);
					bar.thumb.removeEventListener('pointercancel', onEnd);
					bar.dragging = false;
					bar.track.removeAttribute('data-dragging');
					scheduleHide();
				}

				bar.thumb.addEventListener('pointermove', onMove);
				bar.thumb.addEventListener('pointerup', onEnd);
				bar.thumb.addEventListener('pointercancel', onEnd);
			});
		}

		for (const bar of bars) setupBar(bar);

		node.addEventListener('scroll', onScroll, { passive: true });
		node.addEventListener('pointerenter', show);
		node.addEventListener('pointermove', show);
		node.addEventListener('pointerleave', scheduleHide);

		const resize_observer = new ResizeObserver(schedule);
		resize_observer.observe(node);
		// Content changes (rows added, text edited, …) change scrollHeight
		// without resizing the container itself
		const mutation_observer = new MutationObserver(schedule);
		mutation_observer.observe(node, {
			childList: true,
			subtree: true,
			characterData: true,
		});

		// Initial reveal so overflowing content advertises its scrollability
		refresh();
		if (bars.some((bar) => bar.enabled)) show();

		return () => {
			clearTimeout(hide_timer);
			if (frame !== undefined) cancelAnimationFrame(frame);
			resize_observer.disconnect();
			mutation_observer.disconnect();
			node.removeEventListener('scroll', onScroll);
			node.removeEventListener('pointerenter', show);
			node.removeEventListener('pointermove', show);
			node.removeEventListener('pointerleave', scheduleHide);
			for (const bar of bars) bar.track.remove();
			node.removeAttribute('data-scrollbar');
			if (restore_position !== undefined) parent.style.position = restore_position;
		};
	};
}
