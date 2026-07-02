import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

/**
 * FLIP animation for drop reordering: capture top-level block rects before a
 * drop transaction applies, then animate each moved block from its old
 * position to its new one. Keyed by the stable `block_id` attr.
 *
 * Rects are measured relative to `view.dom`, not the viewport — a drop that
 * triggers `scrollIntoView` would otherwise contaminate every delta with the
 * scroll distance and slide the whole page instead of the reordered blocks.
 */

interface BlockRect {
	left: number;
	top: number;
}

/** Nearest scrollable ancestor (used by drag + touch-reorder auto-scroll). */
export function findScroller(start: Element): Element | null {
	for (let el: Element | null = start; el; el = el.parentElement) {
		const { overflowY } = getComputedStyle(el);
		if (
			(overflowY === 'auto' || overflowY === 'scroll') &&
			el.scrollHeight > el.clientHeight
		) {
			return el;
		}
	}
	return null;
}

/**
 * Auto-scroll while dragging near the top/bottom edge of the scrollable
 * ancestor (or viewport). Browsers are inconsistent here — Safari often
 * doesn't scroll at all, which makes long-distance block drags impossible.
 */
export function dragAutoScroll(): Plugin {
	const EDGE = 48;
	const MAX_STEP = 24;
	let frame = 0;
	let velocity = 0;
	let scroller: Element | null = null;

	function stop() {
		velocity = 0;
		if (frame) cancelAnimationFrame(frame);
		frame = 0;
	}

	function tick() {
		frame = 0;
		if (!velocity) return;
		if (scroller) scroller.scrollTop += velocity;
		else window.scrollBy(0, velocity);
		frame = requestAnimationFrame(tick);
	}

	return new Plugin({
		key: new PluginKey('drag_auto_scroll'),
		props: {
			handleDOMEvents: {
				dragover(view, event) {
					scroller = findScroller(view.dom);
					const bounds = scroller
						? scroller.getBoundingClientRect()
						: new DOMRect(0, 0, window.innerWidth, window.innerHeight);
					const from_top = event.clientY - bounds.top;
					const from_bottom = bounds.bottom - event.clientY;
					if (from_top < EDGE) {
						velocity = -Math.ceil(((EDGE - from_top) / EDGE) * MAX_STEP);
					} else if (from_bottom < EDGE) {
						velocity = Math.ceil(((EDGE - from_bottom) / EDGE) * MAX_STEP);
					} else {
						velocity = 0;
					}
					if (velocity && !frame) frame = requestAnimationFrame(tick);
					return false;
				},
				drop() {
					stop();
					return false;
				},
				dragend() {
					stop();
					return false;
				},
				dragleave(view, event) {
					// Left the window entirely
					if (!event.relatedTarget) stop();
					return false;
				},
			},
		},
		view() {
			return { destroy: stop };
		},
	});
}

export function captureBlockRects(view: EditorView): Map<string, BlockRect> {
	const rects = new Map<string, BlockRect>();
	const base = view.dom.getBoundingClientRect();
	view.state.doc.forEach((node, offset) => {
		const id = node.attrs?.block_id;
		if (typeof id !== 'string' || !id) return;
		const dom = view.nodeDOM(offset);
		if (dom instanceof HTMLElement) {
			const rect = dom.getBoundingClientRect();
			rects.set(id, { left: rect.left - base.left, top: rect.top - base.top });
		}
	});
	return rects;
}

export function animateBlockMoves(
	view: EditorView,
	before: Map<string, BlockRect>,
): void {
	if (typeof requestAnimationFrame === 'undefined') return;
	if (
		typeof matchMedia === 'function' &&
		matchMedia('(prefers-reduced-motion: reduce)').matches
	) {
		return;
	}
	const base = view.dom.getBoundingClientRect();
	view.state.doc.forEach((node, offset) => {
		const id = node.attrs?.block_id;
		if (typeof id !== 'string' || !id) return;
		const previous = before.get(id);
		if (!previous) return;
		const dom = view.nodeDOM(offset);
		if (!(dom instanceof HTMLElement) || typeof dom.animate !== 'function') return;
		const rect = dom.getBoundingClientRect();
		const dx = previous.left - (rect.left - base.left);
		const dy = previous.top - (rect.top - base.top);
		if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
		dom.animate(
			[{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
			{ duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
		);
	});
}
