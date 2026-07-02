import type { EditorView } from 'prosemirror-view';

/**
 * FLIP animation for drop reordering: capture top-level block rects before a
 * drop transaction applies, then animate each moved block from its old
 * position to its new one. Keyed by the stable `block_id` attr.
 */

export function captureBlockRects(view: EditorView): Map<string, DOMRect> {
	const rects = new Map<string, DOMRect>();
	view.state.doc.forEach((node, offset) => {
		const id = node.attrs?.block_id;
		if (typeof id !== 'string' || !id) return;
		const dom = view.nodeDOM(offset);
		if (dom instanceof HTMLElement) rects.set(id, dom.getBoundingClientRect());
	});
	return rects;
}

export function animateBlockMoves(view: EditorView, before: Map<string, DOMRect>): void {
	if (typeof requestAnimationFrame === 'undefined') return;
	view.state.doc.forEach((node, offset) => {
		const id = node.attrs?.block_id;
		if (typeof id !== 'string' || !id) return;
		const previous = before.get(id);
		if (!previous) return;
		const dom = view.nodeDOM(offset);
		if (!(dom instanceof HTMLElement) || typeof dom.animate !== 'function') return;
		const current = dom.getBoundingClientRect();
		const dx = previous.left - current.left;
		const dy = previous.top - current.top;
		if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
		dom.animate(
			[{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
			{ duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
		);
	});
}
