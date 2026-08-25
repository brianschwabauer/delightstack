/**
 * The selection model behind multi-select in `Tree`, `List` and `Table`.
 *
 * Every list-shaped component wants the same four gestures — click to replace,
 * `mod`-click to toggle, `shift`-click for a range, `shift+↑/↓` to extend — and
 * every one of them gets the same detail wrong: the **anchor**. A range is not
 * measured from "the last id in the array"; it is measured from the item the
 * user last committed to, which stays put while shift-clicks re-range around
 * it. Getting that right is the whole reason this is a shared model rather than
 * ten lines copied into three components.
 *
 * It is deliberately **pure**: no runes, no DOM, no component. A caller passes
 * the state it holds, the ids currently on screen in the order they are on
 * screen, and the gesture; it gets a new state back. That makes the rules
 * testable without mounting anything, and it is what lets `Tree` keep its
 * selection in a `$bindable` array while `Table` keeps its own somewhere else.
 *
 * ```ts
 * let state = $state(EMPTY_SELECTION);
 * function onclick(id: string, event: MouseEvent) {
 *   state = applySelection(state, id, order(), gestureOf(event));
 * }
 * ```
 */

/** What the user asked for by the modifiers they were holding. */
export type SelectionGesture =
	/** Plain click — this one item, nothing else. */
	| 'replace'
	/** `mod`-click — add or remove this one, leave the rest. */
	| 'toggle'
	/** `shift`-click — everything from the anchor to here, replacing the rest. */
	| 'range'
	/** `mod+shift`-click — everything from the anchor to here, kept alongside the rest. */
	| 'range_add';

export interface SelectionState {
	/**
	 * The selected ids, ordered the way they appear on screen. Ids that are not
	 * currently on screen — a collapsed subtree, a filtered-out row — keep their
	 * relative order at the end rather than being dropped: they are still
	 * selected, they are just not visible.
	 */
	ids: string[];
	/**
	 * Where a range is measured **from**. Set by every gesture that commits to a
	 * single item (a plain click, a toggle), and deliberately *not* moved by a
	 * shift-click or a shift-arrow — that is what lets a second shift-click
	 * re-range instead of ratcheting outward.
	 */
	anchor: string | null;
	/** The far end of the current range — where `shift+↑/↓` extends from. */
	lead: string | null;
}

/** Nothing selected. */
export const EMPTY_SELECTION: SelectionState = Object.freeze({
	ids: [],
	anchor: null,
	lead: null,
}) as SelectionState;

/** The modifier flags any pointer or keyboard event carries. */
export interface SelectionModifiers {
	shiftKey?: boolean;
	ctrlKey?: boolean;
	metaKey?: boolean;
}

/**
 * Which gesture an event is asking for.
 *
 * `ctrl` and `meta` are both "mod" — the platform decides which one the user
 * actually pressed, and a component that checked only one would be broken on
 * half of them.
 */
export function gestureOf(event: SelectionModifiers | undefined): SelectionGesture {
	if (!event) return 'replace';
	const mod = Boolean(event.ctrlKey || event.metaKey);
	if (event.shiftKey) return mod ? 'range_add' : 'range';
	return mod ? 'toggle' : 'replace';
}

/**
 * Selected ids in screen order, with anything off screen kept at the end.
 *
 * Every gesture funnels through here so the array a consumer binds to is
 * ordered the same way whatever produced it — a `shift`-click and a
 * `mod`-click that reach the same set produce the same array, which is what
 * makes "the selection" a value rather than a history.
 */
function ordered(ids: Iterable<string>, order: readonly string[]): string[] {
	const wanted = ids instanceof Set ? ids : new Set(ids);
	const seen = new Set<string>();
	const visible: string[] = [];
	for (const id of order) {
		if (wanted.has(id) && !seen.has(id)) {
			seen.add(id);
			visible.push(id);
		}
	}
	const offscreen: string[] = [];
	for (const id of wanted) {
		if (!seen.has(id)) offscreen.push(id);
	}
	return [...visible, ...offscreen];
}

/** Every id between two, inclusive, in screen order. Empty if either is absent. */
function span(from: string, to: string, order: readonly string[]): string[] {
	const a = order.indexOf(from);
	const b = order.indexOf(to);
	if (a === -1 || b === -1) return [];
	return order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/**
 * Apply a click on `id`.
 *
 * `order` is the ids currently on screen, in the order they are on screen —
 * a tree's expanded rows, a table's current page, a list after its filter. A
 * range only ever spans what is on screen, because a range is a description of
 * something the user pointed at.
 */
export function applySelection(
	state: SelectionState,
	id: string,
	order: readonly string[],
	gesture: SelectionGesture = 'replace',
): SelectionState {
	if (gesture === 'toggle') {
		const next = new Set(state.ids);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		// The anchor follows the toggle even when the toggle *removed* the item:
		// the next shift-click is measured from the last thing the user pointed
		// at, which is this, whether or not it ended up selected.
		return { ids: ordered(next, order), anchor: id, lead: id };
	}

	if (gesture === 'range' || gesture === 'range_add') {
		// A range with nothing to measure from is a plain click that happened to
		// be holding shift — the alternative, selecting from the top of the list,
		// is a selection the user did not ask for and cannot see the start of.
		const anchor = state.anchor ?? id;
		const range = span(anchor, id, order);
		if (range.length === 0) {
			// The anchor has gone off screen, so there is no range to take. A
			// `range` falls back to a plain click, but a `range_add` was an explicit
			// "keep what I have" — dropping the rest of the selection because the
			// row a previous click landed on has been collapsed away is the one
			// thing the modifier promised would not happen.
			const kept = gesture === 'range_add' ? [...state.ids, id] : [id];
			return { ids: ordered(kept, order), anchor: id, lead: id };
		}
		const ids = gesture === 'range_add' ? [...state.ids, ...range] : range;
		return { ids: ordered(ids, order), anchor, lead: id };
	}

	return { ids: [id], anchor: id, lead: id };
}

/**
 * `shift+↑` / `shift+↓` — move the far end of the range one step and take
 * everything between it and the anchor.
 *
 * At either end of the list the selection is left exactly as it is rather than
 * wrapping: wrapping a range around the end of a list selects the whole list,
 * which is never what the key that was pressed meant.
 */
export function extendSelection(
	state: SelectionState,
	step: -1 | 1,
	order: readonly string[],
): SelectionState {
	if (order.length === 0) return state;

	// The far end first, then the anchor: a lead that has been collapsed away
	// still leaves a range to extend, and restarting from the top of the list
	// because one of the two ends is off screen throws away a selection the user
	// can still see.
	let index = state.lead === null ? -1 : order.indexOf(state.lead);
	if (index === -1 && state.anchor !== null) index = order.indexOf(state.anchor);
	if (index === -1) {
		// Extending from nowhere starts at the end the key is coming from.
		const id = step === 1 ? order[0] : order[order.length - 1];
		return { ids: [id], anchor: id, lead: id };
	}

	const next = index + step;
	if (next < 0 || next >= order.length) return state;

	// An anchor that is off screen cannot be measured to, and measuring to it
	// anyway produces an empty span — a keystroke that *deselects everything*.
	// The row the extension started from becomes the anchor instead.
	const anchor =
		state.anchor !== null && order.includes(state.anchor) ? state.anchor : order[index];
	const lead = order[next];
	return { ids: span(anchor, lead, order), anchor, lead };
}

/** Everything on screen. The anchor stays where it was so a following shift-click still means something. */
export function selectAll(
	state: SelectionState,
	order: readonly string[],
): SelectionState {
	if (order.length === 0) return state;
	return {
		ids: [...order],
		anchor: state.anchor ?? order[0],
		lead: order[order.length - 1],
	};
}

/** `escape` — nothing selected, and no anchor left behind to range from. */
export function clearSelection(): SelectionState {
	return { ids: [], anchor: null, lead: null };
}

/**
 * Rebuild a state around a selection that was set from outside.
 *
 * A consumer that binds `selected` can assign it — a "select all in folder"
 * button, a restored session — and the model has to be told, or the next
 * shift-click ranges from an anchor nobody can see any more.
 */
export function fromIDs(
	ids: readonly string[],
	order: readonly string[],
): SelectionState {
	const list = ordered(ids, order);
	const last = list.length > 0 ? list[list.length - 1] : null;
	return { ids: list, anchor: last, lead: last };
}
