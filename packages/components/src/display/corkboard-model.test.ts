import { describe, expect, it } from 'vitest';
import {
	arrowTarget,
	columnCount,
	dropFromPoint,
	dropOnCard,
	insertionIndex,
	moveSlot,
	planKeyMove,
	planReorder,
} from './corkboard-model.js';

describe('columnCount', () => {
	it('reads the count off the first wrapped card', () => {
		expect(columnCount([0, 0, 0, 180, 180, 180, 360])).toBe(3);
	});

	it('answers the length when nothing wraps', () => {
		expect(columnCount([0, 0, 0, 0])).toBe(4);
	});

	it('answers 1 for a single card and for none', () => {
		expect(columnCount([0])).toBe(1);
		expect(columnCount([])).toBe(1);
	});

	it('tolerates a two-card single column', () => {
		expect(columnCount([0, 240])).toBe(1);
	});
});

describe('arrowTarget', () => {
	// A 3-wide grid of 8: rows [0 1 2] [3 4 5] [6 7].
	const at = (index: number, move: Parameters<typeof arrowTarget>[1]) =>
		arrowTarget(index, move, 3, 8);

	it('walks the reading order left and right', () => {
		expect(at(4, 'right')).toBe(5);
		expect(at(4, 'left')).toBe(3);
		// Across a row boundary: right from the row end continues.
		expect(at(2, 'right')).toBe(3);
		expect(at(3, 'left')).toBe(2);
	});

	it('clamps at both ends instead of wrapping', () => {
		expect(at(0, 'left')).toBe(0);
		expect(at(7, 'right')).toBe(7);
	});

	it('steps by a row up and down', () => {
		expect(at(1, 'down')).toBe(4);
		expect(at(4, 'up')).toBe(1);
	});

	it('stays on the top row going up and the bottom row going down', () => {
		expect(at(1, 'up')).toBe(1);
		expect(at(6, 'down')).toBe(6);
		expect(at(7, 'down')).toBe(7);
	});

	it('lands on the last card when down points past a ragged row', () => {
		// 5 has no card directly below (slot 8 does not exist); the nearest
		// thing below is the last card.
		expect(at(5, 'down')).toBe(7);
	});

	it('home and end are the two ends', () => {
		expect(at(4, 'home')).toBe(0);
		expect(at(4, 'end')).toBe(7);
	});

	it('answers -1 for an empty grid and survives a zero column count', () => {
		expect(arrowTarget(0, 'down', 3, 0)).toBe(-1);
		expect(arrowTarget(1, 'down', 0, 4)).toBe(2);
	});
});

describe('insertionIndex', () => {
	it('is the card before the midline, the next slot past it', () => {
		expect(insertionIndex(3, false)).toBe(3);
		expect(insertionIndex(3, true)).toBe(4);
	});
});

describe('planReorder', () => {
	const order = ['a', 'b', 'c', 'd', 'e'];

	it('resolves a single card moved later', () => {
		// Drop b after d: slot 4.
		expect(planReorder(order, ['b'], 4)).toEqual({
			ids: ['b'],
			index: 3,
			before: 'd',
			after: 'e',
		});
	});

	it('resolves a single card moved earlier', () => {
		// Drop d before b: slot 1.
		expect(planReorder(order, ['d'], 1)).toEqual({
			ids: ['d'],
			index: 1,
			before: 'a',
			after: 'b',
		});
	});

	it('lands at the front and the back with null neighbours', () => {
		expect(planReorder(order, ['c'], 0)).toEqual({
			ids: ['c'],
			index: 0,
			before: null,
			after: 'a',
		});
		expect(planReorder(order, ['c'], 5)).toEqual({
			ids: ['c'],
			index: 4,
			before: 'e',
			after: null,
		});
	});

	it('normalises a multi-selection to screen order and moves it as one run', () => {
		// d and b selected in that order, dropped at the front.
		expect(planReorder(order, ['d', 'b'], 0)).toEqual({
			ids: ['b', 'd'],
			index: 0,
			before: null,
			after: 'a',
		});
	});

	it('counts only kept cards when the slot is past moving ones', () => {
		// Move a and b to after d: slot 4 in the full order, but only c and d
		// actually sit before it once the run is out.
		expect(planReorder(order, ['a', 'b'], 4)).toEqual({
			ids: ['a', 'b'],
			index: 2,
			before: 'd',
			after: 'e',
		});
	});

	it('answers null for a drop that changes nothing', () => {
		// b back into its own gap — either edge of it.
		expect(planReorder(order, ['b'], 1)).toBeNull();
		expect(planReorder(order, ['b'], 2)).toBeNull();
		// A contiguous run into its own gap.
		expect(planReorder(order, ['b', 'c'], 1)).toBeNull();
		expect(planReorder(order, ['b', 'c'], 2)).toBeNull();
		expect(planReorder(order, ['b', 'c'], 3)).toBeNull();
	});

	it('answers null when nothing in the order is moving', () => {
		expect(planReorder(order, ['zz'], 0)).toBeNull();
		expect(planReorder(order, [], 3)).toBeNull();
	});

	it('clamps a slot outside the list', () => {
		expect(planReorder(order, ['a'], 99)).toEqual({
			ids: ['a'],
			index: 4,
			before: 'e',
			after: null,
		});
	});
});

describe('moveSlot', () => {
	// The same 3-wide grid of 8.
	it('one step right means after my right neighbour', () => {
		expect(moveSlot(1, 'right', 3, 8)).toBe(3);
	});

	it('one step left means before my left neighbour', () => {
		expect(moveSlot(1, 'left', 3, 8)).toBe(0);
	});

	it('a row down means after the card below', () => {
		expect(moveSlot(1, 'down', 3, 8)).toBe(5);
	});

	it('a row up means before the card above', () => {
		expect(moveSlot(4, 'up', 3, 8)).toBe(1);
	});

	it('answers -1 at an edge instead of planning a no-op', () => {
		expect(moveSlot(0, 'left', 3, 8)).toBe(-1);
		expect(moveSlot(7, 'right', 3, 8)).toBe(-1);
		expect(moveSlot(0, 'up', 3, 8)).toBe(-1);
		expect(moveSlot(7, 'down', 3, 8)).toBe(-1);
	});

	it('composes with planReorder into a swap', () => {
		const order = ['a', 'b', 'c', 'd', 'e'];
		const slot = moveSlot(1, 'right', 5, 5);
		expect(planReorder(order, ['b'], slot)).toEqual({
			ids: ['b'],
			index: 2,
			before: 'c',
			after: 'd',
		});
	});
});

describe('planKeyMove', () => {
	const order = ['a', 'b', 'c', 'd', 'e'];

	it('a single card one step right is the drag one slot over', () => {
		const keyboard = planKeyMove(order, ['b'], 'right', 5);
		// The same gesture as dragging b past c's midline: slot 3.
		const dragged = planReorder(order, ['b'], insertionIndex(2, true));
		expect(keyboard).toEqual(dragged);
		expect(keyboard).toEqual({ ids: ['b'], index: 2, before: 'c', after: 'd' });
	});

	it('a run with the cursor on its first card still moves past the run', () => {
		// The regression: measuring from the focused card planned the no-op of
		// the run hopping onto its own other half. From the edge, [a, b] one
		// step right lands past c — exactly the drag's plan.
		const keyboard = planKeyMove(order, ['a', 'b'], 'right', 5);
		const dragged = planReorder(order, ['a', 'b'], insertionIndex(2, true));
		expect(keyboard).toEqual(dragged);
		expect(keyboard).toEqual({ ids: ['a', 'b'], index: 1, before: 'c', after: 'd' });
	});

	it("moving toward the front measures from the run's first card", () => {
		expect(planKeyMove(order, ['d', 'e'], 'left', 5)).toEqual({
			ids: ['d', 'e'],
			index: 2,
			before: 'b',
			after: 'c',
		});
	});

	it('normalises the selection to screen order first', () => {
		expect(planKeyMove(order, ['c', 'b'], 'left', 5)).toEqual({
			ids: ['b', 'c'],
			index: 0,
			before: null,
			after: 'a',
		});
	});

	it('steps a whole row up and down by the column count', () => {
		// 2-wide: rows [a b] [c d] [e].
		expect(planKeyMove(order, ['a'], 'down', 2)).toEqual({
			ids: ['a'],
			index: 2,
			before: 'c',
			after: 'd',
		});
		expect(planKeyMove(order, ['c'], 'up', 2)).toEqual({
			ids: ['c'],
			index: 0,
			before: null,
			after: 'a',
		});
	});

	it('answers null at an edge — for the whole run, not just the cursor', () => {
		expect(planKeyMove(order, ['a'], 'left', 5)).toBeNull();
		expect(planKeyMove(order, ['e'], 'right', 5)).toBeNull();
		expect(planKeyMove(order, ['d', 'e'], 'right', 5)).toBeNull();
		expect(planKeyMove(order, ['a', 'b'], 'left', 5)).toBeNull();
	});

	it('answers null when nothing in the order is moving', () => {
		expect(planKeyMove(order, ['zz'], 'right', 5)).toBeNull();
		expect(planKeyMove(order, [], 'right', 5)).toBeNull();
	});

	it('home and end carry the run to the ends', () => {
		expect(planKeyMove(order, ['c', 'd'], 'home', 5)).toEqual({
			ids: ['c', 'd'],
			index: 0,
			before: null,
			after: 'a',
		});
		expect(planKeyMove(order, ['b', 'c'], 'end', 5)).toEqual({
			ids: ['b', 'c'],
			index: 3,
			before: 'e',
			after: null,
		});
	});
});

describe('drop geometry', () => {
	// A 3-wide grid of 8 cards, 100×80 each, 20px gaps:
	// rows at y 0, 100, 200; columns at x 0, 120, 240.
	const R = (left: number, top: number) => ({ left, top, width: 100, height: 80 });
	const rects = [
		R(0, 0),
		R(120, 0),
		R(240, 0),
		R(0, 100),
		R(120, 100),
		R(240, 100),
		R(0, 200),
		R(120, 200),
	];

	describe('dropOnCard', () => {
		it('anchors on the hovered card, either side of its midline', () => {
			expect(dropOnCard(4, false, rects)).toEqual({
				slot: 4,
				index: 4,
				edge: 'before',
				outer: false,
			});
			expect(dropOnCard(4, true, rects)).toEqual({
				slot: 5,
				index: 4,
				edge: 'after',
				outer: false,
			});
		});

		it('a row-end slot draws after the hovered row’s last card, marked outer', () => {
			// Past the midline of card 2 — the end of row one. The slot is 3, but
			// the bar belongs on card 2's trailing edge, not on card 3's leading
			// edge a row below.
			expect(dropOnCard(2, true, rects)).toEqual({
				slot: 3,
				index: 2,
				edge: 'after',
				outer: true,
			});
		});

		it('a row-start before is outer; the grid’s two extremes are too', () => {
			expect(dropOnCard(3, false, rects).outer).toBe(true);
			expect(dropOnCard(0, false, rects)).toEqual({
				slot: 0,
				index: 0,
				edge: 'before',
				outer: true,
			});
			expect(dropOnCard(7, true, rects)).toEqual({
				slot: 8,
				index: 7,
				edge: 'after',
				outer: true,
			});
		});
	});

	describe('dropFromPoint', () => {
		it('the gap between two cards is the slot between them', () => {
			// x 110 sits in the gap between cards 0 and 1: past 0's midpoint (50),
			// short of 1's (170).
			expect(dropFromPoint(110, 40, rects)).toEqual({
				slot: 1,
				index: 0,
				edge: 'after',
				outer: false,
			});
		});

		it('the gap between two rows goes to the nearer row', () => {
			// y 85 is 5px below row one, 15px above row two → row one.
			expect(dropFromPoint(110, 85, rects)).toEqual({
				slot: 1,
				index: 0,
				edge: 'after',
				outer: false,
			});
			// y 96 is 16px below row one, 4px above row two → row two.
			expect(dropFromPoint(110, 96, rects)).toEqual({
				slot: 4,
				index: 3,
				edge: 'after',
				outer: false,
			});
		});

		it('past a row’s last midpoint is the row’s end, anchored on its last card', () => {
			expect(dropFromPoint(330, 40, rects)).toEqual({
				slot: 3,
				index: 2,
				edge: 'after',
				outer: true,
			});
		});

		it('left of a row’s first midpoint is the row’s start', () => {
			expect(dropFromPoint(10, 140, rects)).toEqual({
				slot: 3,
				index: 3,
				edge: 'before',
				outer: true,
			});
		});

		it('the ragged tail and anywhere below land at the end of the list', () => {
			// Beside the last, ragged row — x past both midpoints.
			expect(dropFromPoint(330, 240, rects)).toEqual({
				slot: 8,
				index: 7,
				edge: 'after',
				outer: true,
			});
			// Far below everything.
			expect(dropFromPoint(200, 900, rects)).toEqual({
				slot: 8,
				index: 7,
				edge: 'after',
				outer: true,
			});
		});

		it('above everything is the first row; an empty grid is nothing', () => {
			expect(dropFromPoint(10, -50, rects)).toEqual({
				slot: 0,
				index: 0,
				edge: 'before',
				outer: true,
			});
			expect(dropFromPoint(10, 10, [])).toBeNull();
		});
	});
});
