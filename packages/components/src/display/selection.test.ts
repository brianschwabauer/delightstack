// @vitest-environment node
import { describe, expect, test } from 'vitest';
import {
	applySelection,
	clearSelection,
	EMPTY_SELECTION,
	extendSelection,
	fromIDs,
	gestureOf,
	selectAll,
	type SelectionState,
} from './selection.js';

/** Six rows on screen, in the order they are on screen. */
const ORDER = ['a', 'b', 'c', 'd', 'e', 'f'];

/** Start from a plain click, which is how every real sequence starts. */
function clicked(id: string, order: readonly string[] = ORDER): SelectionState {
	return applySelection(EMPTY_SELECTION, id, order, 'replace');
}

describe('gestureOf', () => {
	test('no modifiers is a replace', () => {
		expect(gestureOf({})).toBe('replace');
		expect(gestureOf(undefined)).toBe('replace');
	});

	test('ctrl and meta are both mod', () => {
		expect(gestureOf({ ctrlKey: true })).toBe('toggle');
		expect(gestureOf({ metaKey: true })).toBe('toggle');
	});

	test('shift is a range, and mod+shift adds one', () => {
		expect(gestureOf({ shiftKey: true })).toBe('range');
		expect(gestureOf({ shiftKey: true, metaKey: true })).toBe('range_add');
		expect(gestureOf({ shiftKey: true, ctrlKey: true })).toBe('range_add');
	});
});

describe('a plain click', () => {
	test('replaces the selection and takes the anchor', () => {
		const state = applySelection(clicked('b'), 'd', ORDER);
		expect(state.ids).toEqual(['d']);
		expect(state.anchor).toBe('d');
		expect(state.lead).toBe('d');
	});
});

describe('mod-click', () => {
	test('adds without disturbing the rest', () => {
		const state = applySelection(clicked('b'), 'e', ORDER, 'toggle');
		expect(state.ids).toEqual(['b', 'e']);
	});

	test('removes one that is already selected', () => {
		const two = applySelection(clicked('b'), 'e', ORDER, 'toggle');
		expect(applySelection(two, 'b', ORDER, 'toggle').ids).toEqual(['e']);
	});

	test('moves the anchor even when it deselected', () => {
		// The next shift-click is measured from the last thing pointed at, which
		// is this row whether or not it survived the click.
		const two = applySelection(clicked('b'), 'e', ORDER, 'toggle');
		const state = applySelection(two, 'e', ORDER, 'toggle');
		expect(state.ids).toEqual(['b']);
		expect(state.anchor).toBe('e');
	});

	test('the result is in screen order however it was built', () => {
		let state = clicked('e');
		state = applySelection(state, 'a', ORDER, 'toggle');
		state = applySelection(state, 'c', ORDER, 'toggle');
		expect(state.ids).toEqual(['a', 'c', 'e']);
	});
});

describe('shift-click', () => {
	test('takes everything from the anchor to here', () => {
		const state = applySelection(clicked('b'), 'e', ORDER, 'range');
		expect(state.ids).toEqual(['b', 'c', 'd', 'e']);
	});

	test('works upward as well as downward', () => {
		expect(applySelection(clicked('e'), 'b', ORDER, 'range').ids).toEqual([
			'b',
			'c',
			'd',
			'e',
		]);
	});

	test('leaves the anchor where it is, so a second one re-ranges', () => {
		const wide = applySelection(clicked('b'), 'e', ORDER, 'range');
		expect(wide.anchor).toBe('b');
		const narrow = applySelection(wide, 'c', ORDER, 'range');
		// Ratcheting — the bug this model exists to prevent — would have kept
		// d and e because they were in the array a moment ago.
		expect(narrow.ids).toEqual(['b', 'c']);
		expect(narrow.anchor).toBe('b');
	});

	test('replaces whatever was selected outside the range', () => {
		let state = clicked('a');
		state = applySelection(state, 'c', ORDER, 'toggle');
		state = applySelection(state, 'f', ORDER, 'range');
		// The anchor moved to c with the toggle, so the range is c…f and the
		// stray a is gone.
		expect(state.ids).toEqual(['c', 'd', 'e', 'f']);
	});

	test('mod+shift keeps what was already selected', () => {
		let state = clicked('a');
		state = applySelection(state, 'c', ORDER, 'toggle');
		state = applySelection(state, 'e', ORDER, 'range_add');
		expect(state.ids).toEqual(['a', 'c', 'd', 'e']);
	});

	test('with no anchor it is a plain click', () => {
		const state = applySelection(EMPTY_SELECTION, 'd', ORDER, 'range');
		expect(state.ids).toEqual(['d']);
		expect(state.anchor).toBe('d');
	});

	test('an anchor that has gone off screen falls back to a plain click', () => {
		// The anchor's row was collapsed away between the two clicks.
		const state = applySelection(
			{ ids: ['z'], anchor: 'z', lead: 'z' },
			'c',
			ORDER,
			'range',
		);
		expect(state.ids).toEqual(['c']);
		expect(state.anchor).toBe('c');
	});
});

describe('shift+arrow', () => {
	test('extends one step and keeps the anchor', () => {
		const state = extendSelection(clicked('c'), 1, ORDER);
		expect(state.ids).toEqual(['c', 'd']);
		expect(state.anchor).toBe('c');
		expect(state.lead).toBe('d');
	});

	test('a second press extends further', () => {
		let state = extendSelection(clicked('c'), 1, ORDER);
		state = extendSelection(state, 1, ORDER);
		expect(state.ids).toEqual(['c', 'd', 'e']);
	});

	test('reversing shrinks the range rather than growing it the other way', () => {
		let state = extendSelection(clicked('c'), 1, ORDER);
		state = extendSelection(state, 1, ORDER);
		state = extendSelection(state, -1, ORDER);
		expect(state.ids).toEqual(['c', 'd']);
		expect(state.lead).toBe('d');
	});

	test('crossing the anchor flips the range', () => {
		let state = extendSelection(clicked('c'), -1, ORDER);
		state = extendSelection(state, -1, ORDER);
		expect(state.ids).toEqual(['a', 'b', 'c']);
		expect(state.anchor).toBe('c');
		expect(state.lead).toBe('a');
	});

	test('at the end of the list nothing changes', () => {
		const at_end = clicked('f');
		expect(extendSelection(at_end, 1, ORDER)).toEqual(at_end);
		const at_start = clicked('a');
		expect(extendSelection(at_start, -1, ORDER)).toEqual(at_start);
	});

	test('extending from nothing starts at the end the key came from', () => {
		expect(extendSelection(EMPTY_SELECTION, 1, ORDER).ids).toEqual(['a']);
		expect(extendSelection(EMPTY_SELECTION, -1, ORDER).ids).toEqual(['f']);
	});

	test('an empty list is left alone', () => {
		expect(extendSelection(clicked('c'), 1, [])).toEqual(clicked('c'));
	});

	test('replaces items outside the range rather than merging them', () => {
		// Click a, mod-click c, shift+↓ → [c, d]. The extension is a *range*, and
		// a range is the span between two ends — `a` is outside it and goes.
		// Deliberate, and the alternative is worse: a shift+↑ back over the range
		// would then have no way to give up the strays, so the selection could
		// only ever grow, which is the ratchet in a second costume. The mod-click
		// also moved the anchor to `c`, which is what the extension measures from.
		let state = clicked('a');
		state = applySelection(state, 'c', ORDER, 'toggle');
		state = extendSelection(state, 1, ORDER);
		expect(state.ids).toEqual(['c', 'd']);
		expect(state.anchor).toBe('c');
		expect(state.lead).toBe('d');
	});

	test('picks up a shift-click’s far end rather than restarting', () => {
		const ranged = applySelection(clicked('b'), 'd', ORDER, 'range');
		const state = extendSelection(ranged, 1, ORDER);
		expect(state.ids).toEqual(['b', 'c', 'd', 'e']);
	});
});

describe('select all and clear', () => {
	test('select all takes the whole visible order', () => {
		expect(selectAll(clicked('c'), ORDER).ids).toEqual(ORDER);
	});

	test('select all keeps the anchor it was given', () => {
		expect(selectAll(clicked('c'), ORDER).anchor).toBe('c');
	});

	test('clear leaves no anchor to range from', () => {
		expect(clearSelection()).toEqual({ ids: [], anchor: null, lead: null });
	});
});

describe('ids that are not on screen', () => {
	test('a toggle keeps them, at the end', () => {
		// `z` is selected inside a subtree that has since been collapsed.
		const state = applySelection(
			{ ids: ['z'], anchor: null, lead: null },
			'b',
			ORDER,
			'toggle',
		);
		expect(state.ids).toEqual(['b', 'z']);
	});

	test('a mod+shift-click keeps them even when the anchor is one of them', () => {
		// The anchor's row was collapsed away, so there is no range to take — but
		// `mod` still means "keep what I have", and the fallback must honour it.
		const state = applySelection(
			{ ids: ['z'], anchor: 'z', lead: 'z' },
			'c',
			ORDER,
			'range_add',
		);
		expect(state.ids).toEqual(['c', 'z']);
		expect(state.anchor).toBe('c');
	});

	test('shift+arrow extends from the anchor when the far end went off screen', () => {
		// A shift-click reached into a subtree; the subtree was then collapsed.
		const state = extendSelection({ ids: ['b', 'z'], anchor: 'b', lead: 'z' }, 1, ORDER);
		expect(state.ids).toEqual(['b', 'c']);
		expect(state.anchor).toBe('b');
		expect(state.lead).toBe('c');
	});

	test('shift+arrow re-anchors rather than selecting nothing', () => {
		// Measuring to an anchor that is not on screen produces an empty span, and
		// a key that deselects everything is never what was pressed.
		const state = extendSelection({ ids: ['z', 'c'], anchor: 'z', lead: 'c' }, 1, ORDER);
		expect(state.ids).toEqual(['c', 'd']);
		expect(state.anchor).toBe('c');
	});

	test('a range does not', () => {
		const state = applySelection(
			{ ids: ['z'], anchor: 'b', lead: 'b' },
			'd',
			ORDER,
			'range',
		);
		expect(state.ids).toEqual(['b', 'c', 'd']);
	});
});

describe('fromIDs', () => {
	test('orders what it is given and anchors on the last of it', () => {
		const state = fromIDs(['e', 'b'], ORDER);
		expect(state.ids).toEqual(['b', 'e']);
		expect(state.anchor).toBe('e');
	});

	test('an empty assignment leaves no anchor', () => {
		expect(fromIDs([], ORDER)).toEqual({ ids: [], anchor: null, lead: null });
	});

	test('a shift-click after one ranges from the last id', () => {
		const state = applySelection(fromIDs(['b'], ORDER), 'd', ORDER, 'range');
		expect(state.ids).toEqual(['b', 'c', 'd']);
	});
});
