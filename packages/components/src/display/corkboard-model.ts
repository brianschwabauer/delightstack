/**
 * The pure model behind `Corkboard` — the grid arithmetic, kept away from the
 * component for the reason `selection.ts` and `diff-model.ts` are: these are
 * the rules a keyboard walk and a drop are *correct* by, and a test of them
 * should not have to mount a grid or fake a layout engine.
 *
 * Three questions, three families of functions:
 *
 * - **How wide is the grid?** CSS decides (`auto-fill` is the default), so the
 *   component reads it back off the layout — every card's `offsetTop` — and
 *   {@link columnCount} turns that into a number the arrows can do arithmetic
 *   with.
 * - **Where does an arrow go?** {@link arrowTarget} is 2D index geometry over a
 *   flat ordered list: `left`/`right` walk the reading order, `up`/`down` step
 *   by a column count, and nothing ever wraps — an arrow at an edge stays put,
 *   because wrapping teleports the cursor somewhere the eye was not looking.
 * - **Where does a drop land?** A pointer is over a card and before or past its
 *   midline; {@link insertionIndex} names the slot that means, and
 *   {@link planReorder} resolves the slot against what is moving — which may be
 *   a multi-selection — into the neighbours the caller's ordering scheme needs.
 */

/** What a card must carry for the model to reason about it. */
export interface CorkboardCardLike {
	/** Stable identity. Keys the grid, the selection and every callback. */
	id: string;
	/** A disabled card is skipped by nothing but takes no gesture. */
	disabled?: boolean;
	/**
	 * Whether other cards may be dropped *onto* this one — a folder among
	 * documents. The component reports such a drop as `ondropinto` rather than
	 * a reorder.
	 */
	droppable?: boolean;
}

/** The four arrows plus the two jumps, as the component's key handler names them. */
export type CorkboardMove = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';

/**
 * How many columns the laid-out grid actually has, read off the cards'
 * `offsetTop`s in DOM order.
 *
 * The first card whose top differs from the first card's is the first card of
 * the second row, and its index is the column count. All on one row — or no
 * cards at all — answers the count that makes the arrow arithmetic degenerate
 * correctly (`length || 1`), so a one-row grid treats `down` as an edge rather
 * than dividing by zero.
 */
export function columnCount(tops: readonly number[]): number {
	for (let i = 1; i < tops.length; i++) {
		if (tops[i] !== tops[0]) return i;
	}
	return tops.length || 1;
}

/**
 * Where the cursor lands when an arrow is pressed on card `index`.
 *
 * Clamped, never wrapped: `up` on the top row and `down` on the bottom row
 * answer `index` unchanged, `left` at 0 stays at 0. The one asymmetry is
 * `down` from a row whose slot below is past the end of a ragged last row —
 * the cursor goes to the **last card** rather than staying, because the eye
 * asked for "down" and the last card is the nearest thing below.
 */
export function arrowTarget(
	index: number,
	move: CorkboardMove,
	columns: number,
	count: number,
): number {
	if (count <= 0) return -1;
	const cols = Math.max(1, columns);
	const last = count - 1;
	const clamped = Math.min(Math.max(index, 0), last);
	switch (move) {
		case 'home':
			return 0;
		case 'end':
			return last;
		case 'left':
			return Math.max(0, clamped - 1);
		case 'right':
			return Math.min(last, clamped + 1);
		case 'up':
			return clamped - cols >= 0 ? clamped - cols : clamped;
		case 'down': {
			if (clamped + cols <= last) return clamped + cols;
			// Already on the bottom row: stay. On a higher row with only a ragged
			// stub below: land on the last card.
			const row = Math.floor(clamped / cols);
			const last_row = Math.floor(last / cols);
			return row < last_row ? last : clamped;
		}
	}
}

/**
 * The slot a pointer means, hovering over card `over` — before it, or after
 * it when the pointer is past the card's midline. A slot is a gap in the
 * list: `0` is before the first card, `length` is after the last.
 */
export function insertionIndex(over: number, after: boolean): number {
	return after ? over + 1 : over;
}

/** What a resolved drop or keyboard move hands the caller. */
export interface ReorderPlan {
	/** The moving ids, in the order they currently appear. */
	ids: string[];
	/** Where the run lands, as an index into the order **with the run removed**. */
	index: number;
	/** The id the run lands after, or `null` at the front. */
	before: string | null;
	/** The id the run lands before, or `null` at the end. */
	after: string | null;
}

/**
 * Resolve a slot into the neighbours a caller's ordering scheme needs —
 * fractional keys, array splices, server positions alike.
 *
 * `moving` may be a multi-selection; it is normalised to the order it appears
 * on screen, because a reorder keeps the relative order of what is moving
 * (that is what makes dragging five scenes one gesture rather than five).
 * `insertion` is a slot in the **full** order, `0`–`length`, as
 * {@link insertionIndex} produces.
 *
 * Answers `null` for a drop that changes nothing — the run put back into the
 * gap it already occupies — so a caller can skip the write instead of minting
 * new positions that mean the same thing.
 */
export function planReorder(
	order: readonly string[],
	moving: readonly string[],
	insertion: number,
): ReorderPlan | null {
	const moving_set = new Set(moving);
	const ids = order.filter((id) => moving_set.has(id));
	if (ids.length === 0) return null;

	const slot = Math.min(Math.max(insertion, 0), order.length);
	const remaining = order.filter((id) => !moving_set.has(id));
	// The slot names a gap in the full order; the landing index is that gap
	// with the moving cards no longer counted — how many *kept* ids sit before it.
	let index = 0;
	for (let i = 0; i < slot; i++) {
		if (!moving_set.has(order[i])) index++;
	}

	// A no-op: the run, removed and re-inserted at `index`, reproduces `order`.
	const next = [...remaining.slice(0, index), ...ids, ...remaining.slice(index)];
	if (next.length === order.length && next.every((id, i) => id === order[i])) {
		return null;
	}

	return {
		ids,
		index,
		before: index > 0 ? remaining[index - 1] : null,
		after: index < remaining.length ? remaining[index] : null,
	};
}

/**
 * The slot a keyboard move asks for — `mod+arrow` picking the run up and
 * setting it down one step over.
 *
 * Measured from the focused card and expressed as a slot in the full order,
 * ready for {@link planReorder}: one to the left is "before my left
 * neighbour", one to the right is "after my right neighbour", `up`/`down`
 * step a whole row. Answers `-1` at an edge, so a caller can ignore the
 * keystroke rather than plan a no-op.
 */
export function moveSlot(
	index: number,
	move: CorkboardMove,
	columns: number,
	count: number,
): number {
	const target = arrowTarget(index, move, columns, count);
	if (target === index || target === -1) return -1;
	// Landing after the target when moving toward the end, before it when
	// moving toward the front — which is what "swap with my neighbour" means
	// however far the step reached.
	return target > index ? target + 1 : target;
}

/**
 * A `mod`+arrow reorder resolved end to end: the run normalised to screen
 * order, the step measured from the run's **edge** — its last card when moving
 * toward the end, its first when moving toward the front — and the slot handed
 * to {@link planReorder}.
 *
 * Measuring from the edge rather than the focused card is what keeps a
 * multi-selection's step identical to the drag's: a run of two with the cursor
 * on its first card still moves past the neighbour *beyond* the run, instead
 * of planning the no-op of hopping onto its own other half.
 *
 * Answers `null` at an edge, and when nothing in `order` is moving.
 */
export function planKeyMove(
	order: readonly string[],
	moving: readonly string[],
	move: CorkboardMove,
	columns: number,
): ReorderPlan | null {
	const moving_set = new Set(moving);
	const indices: number[] = [];
	for (let i = 0; i < order.length; i++) {
		if (moving_set.has(order[i])) indices.push(i);
	}
	if (indices.length === 0) return null;
	const toward_end = move === 'right' || move === 'down' || move === 'end';
	const edge = toward_end ? indices[indices.length - 1] : indices[0];
	const slot = moveSlot(edge, move, columns, order.length);
	if (slot === -1) return null;
	return planReorder(order, moving, slot);
}

/** A card's box, relative to the grid — `getBoundingClientRect` minus the grid's. */
export interface CorkboardRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** Which side of its anchor card a drop indicator draws on. */
export type DropEdge = 'before' | 'after';

/**
 * Where a drop would land, said twice: `slot` is the gap for
 * {@link planReorder}, and `index`/`edge` are the card and side the indicator
 * draws on — which are not derivable from the slot alone, because a slot at a
 * row boundary is simultaneously "after the row's last card" and "before the
 * next row's first", and only the pointer knows which row it meant.
 *
 * `outer` marks a slot at the grid's own boundary — before a row's first card
 * or after its last — where there is no gap to centre an indicator in: half a
 * gap to the side would hang outside the grid, where a scrolling ancestor's
 * `overflow` clips it. An outer indicator draws flush inside the card's edge
 * instead.
 */
export interface DropIndicator {
	slot: number;
	index: number;
	edge: DropEdge;
	outer: boolean;
}

/** The rows of a laid-out grid, as index ranges over the DOM-ordered rects. */
function rowsOf(rects: readonly CorkboardRect[]): { start: number; end: number }[] {
	const rows: { start: number; end: number }[] = [];
	for (let i = 0; i < rects.length; i++) {
		if (i === 0 || rects[i].top !== rects[i - 1].top) rows.push({ start: i, end: i + 1 });
		else rows[rows.length - 1].end = i + 1;
	}
	return rows;
}

/**
 * The drop meant by a pointer hovering card `over` — before or past its
 * vertical midline. The indicator is anchored on the hovered card itself, so
 * a slot at a row boundary draws on the row the pointer is actually in,
 * never on the next row's first card.
 */
export function dropOnCard(
	over: number,
	after: boolean,
	rects: readonly CorkboardRect[],
): DropIndicator {
	const row_start = over === 0 || rects[over]?.top !== rects[over - 1]?.top;
	const row_end = over === rects.length - 1 || rects[over]?.top !== rects[over + 1]?.top;
	return {
		slot: insertionIndex(over, after),
		index: over,
		edge: after ? 'after' : 'before',
		outer: after ? row_end : row_start,
	};
}

/**
 * The nearest drop to a pointer that is over the grid but not over a card —
 * the gaps between cards, between rows, and the ragged tail past the last one.
 *
 * The row is the one whose vertical band the pointer is in, or the nearest
 * band when it is in the gap between two (ties go to the earlier row, which is
 * the one the pointer just left). Within the row, the slot falls at the
 * nearest gap: after every card whose horizontal midpoint the pointer has
 * passed. The indicator anchors inside the pointer's row — a slot at the
 * row's end draws after its last card, not before the next row's first.
 */
export function dropFromPoint(
	x: number,
	y: number,
	rects: readonly CorkboardRect[],
): DropIndicator | null {
	if (rects.length === 0) return null;
	const rows = rowsOf(rects);

	let row = rows[rows.length - 1];
	let best = Infinity;
	for (const candidate of rows) {
		const top = rects[candidate.start].top;
		let bottom = top;
		for (let i = candidate.start; i < candidate.end; i++) {
			bottom = Math.max(bottom, rects[i].top + rects[i].height);
		}
		const distance = y < top ? top - y : y > bottom ? y - bottom : 0;
		if (distance < best) {
			best = distance;
			row = candidate;
		}
	}

	let passed = 0;
	for (let i = row.start; i < row.end; i++) {
		if (rects[i].left + rects[i].width / 2 <= x) passed++;
	}
	const slot = row.start + passed;
	if (passed === 0) {
		return { slot, index: row.start, edge: 'before', outer: true };
	}
	return {
		slot,
		index: slot - 1,
		edge: 'after',
		outer: slot === row.end,
	};
}
