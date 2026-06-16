import type { Cursor } from '../types';

// ---------------------------------------------------------------------------
// Stage-relative cursor coordinates.
//
// Raw clientX/Y break across viewport sizes and scroll positions, so cursor
// coordinates are stored as fractions [0, 1] of a "stage" element's scrollable
// content box. The stage is the nearest ancestor marked `data-presence-stage`,
// or the document root. Two users on differently-sized screens then see each
// other's cursors over the same logical point.
// ---------------------------------------------------------------------------

/** The attribute that marks a presence stage element. */
export const STAGE_ATTR = 'data-presence-stage';

/** Geometry of a stage, in client coordinates. Pure data, for testability. */
export interface StageGeometry {
	/** Left edge of the stage content box in client coords. */
	left: number;
	/** Top edge of the stage content box in client coords. */
	top: number;
	/** Stage horizontal scroll offset. */
	scroll_x: number;
	/** Stage vertical scroll offset. */
	scroll_y: number;
	/** Total scrollable width of the stage. */
	width: number;
	/** Total scrollable height of the stage. */
	height: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Convert a client-space point into normalized `[0, 1]` stage coordinates. */
export function normalize(
	client_x: number,
	client_y: number,
	geo: StageGeometry,
): { x: number; y: number } {
	return {
		x: geo.width > 0 ? clamp01((client_x - geo.left + geo.scroll_x) / geo.width) : 0,
		y: geo.height > 0 ? clamp01((client_y - geo.top + geo.scroll_y) / geo.height) : 0,
	};
}

/** Convert normalized stage coordinates back into a client-space point. */
export function denormalize(
	cursor: { x: number; y: number },
	geo: StageGeometry,
): { x: number; y: number } {
	return {
		x: cursor.x * geo.width + geo.left - geo.scroll_x,
		y: cursor.y * geo.height + geo.top - geo.scroll_y,
	};
}

/** Read the live geometry of a stage element (document root special-cased). */
export function readStageGeometry(el: HTMLElement): StageGeometry {
	if (el === document.documentElement || el === document.body) {
		const root = document.documentElement;
		return {
			left: 0,
			top: 0,
			scroll_x: window.scrollX,
			scroll_y: window.scrollY,
			width: root.scrollWidth,
			height: root.scrollHeight,
		};
	}
	const rect = el.getBoundingClientRect();
	return {
		left: rect.left,
		top: rect.top,
		scroll_x: el.scrollLeft,
		scroll_y: el.scrollTop,
		width: el.scrollWidth,
		height: el.scrollHeight,
	};
}

/** Find the stage an event target belongs to (nearest marked ancestor, else root). */
export function findStage(target: EventTarget | null): { el: HTMLElement; id?: string } {
	let node = target instanceof Element ? target : null;
	while (node) {
		if (node instanceof HTMLElement && node.hasAttribute(STAGE_ATTR)) {
			return { el: node, id: node.getAttribute(STAGE_ATTR) || undefined };
		}
		node = node.parentElement;
	}
	return { el: document.documentElement };
}

/** Resolve a stage element by its id (the `data-presence-stage` value). */
export function getStageById(id?: string): HTMLElement | null {
	if (typeof document === 'undefined') return null;
	if (!id) return document.documentElement;
	const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
	return (
		document.querySelector<HTMLElement>(`[${STAGE_ATTR}="${escaped}"]`) ??
		document.documentElement
	);
}

/** Normalize a pointer event's client coords against its stage. */
export function normalizeCursor(
	client_x: number,
	client_y: number,
	target: EventTarget | null,
): Cursor {
	const { el, id } = findStage(target);
	const point = normalize(client_x, client_y, readStageGeometry(el));
	return id ? { ...point, stage: id } : point;
}

/** Map a normalized cursor back to a client-space point, or `null` if its stage is gone. */
export function denormalizeCursor(cursor: Cursor): { x: number; y: number } | null {
	const el = getStageById(cursor.stage);
	if (!el) return null;
	return denormalize(cursor, readStageGeometry(el));
}
