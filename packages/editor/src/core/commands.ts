import {
	chainCommands,
	exitCode,
	joinBackward,
	lift,
	liftEmptyBlock,
	selectNodeBackward,
	selectNodeForward,
	setBlockType,
	toggleMark,
	wrapIn,
} from 'prosemirror-commands';
import {
	liftListItem,
	sinkListItem,
	splitListItem,
	wrapInList,
} from 'prosemirror-schema-list';
import { NodeSelection, TextSelection, type Command } from 'prosemirror-state';
import type {
	Attrs,
	Node as PMNode,
	NodeType,
	ResolvedPos,
	Schema,
} from 'prosemirror-model';

/**
 * Schema-aware ProseMirror commands used by the keymap, input rules, and the
 * built-in EditorCommand registry entries. All pure `Command` functions —
 * no view or Svelte dependencies, so they're unit-testable with
 * `EditorState.apply` alone.
 */

/** Sets the selected blocks to `type`, or back to paragraph if already active. */
export function toggleBlockType(type: NodeType, attrs?: Attrs): Command {
	return (state, dispatch, view) => {
		const paragraph = state.schema.nodes.paragraph;
		if (isBlockActive(state.schema, type, attrs)(state)) {
			return setBlockType(paragraph)(state, dispatch, view);
		}
		return setBlockType(type, attrs)(state, dispatch, view);
	};
}

function isBlockActive(schema: Schema, type: NodeType, attrs?: Attrs) {
	return (state: Parameters<Command>[0]): boolean => {
		const { from, to } = state.selection;
		let active = false;
		state.doc.nodesBetween(from, to, (node) => {
			if (node.type !== type) return;
			if (
				attrs &&
				Object.entries(attrs).some(([key, value]) => node.attrs[key] !== value)
			)
				return;
			active = true;
		});
		return active;
	};
}

/** Wraps in / unwraps from a list type, converting between list types. */
export function toggleList(listType: NodeType, itemType: NodeType): Command {
	return (state, dispatch, view) => {
		const { $from, $to } = state.selection;
		const range = $from.blockRange($to);
		if (!range) return false;
		// Already in this list type → lift out
		const parentList = findParentList(state);
		if (parentList?.node.type === listType) {
			return liftListItem(itemType)(state, dispatch, view);
		}
		// In a different list type → retype the list node
		if (parentList) {
			if (dispatch) {
				const tr = state.tr.setNodeMarkup(parentList.pos, listType);
				// Retype the items too (list_item <-> todo_item)
				const list = tr.doc.nodeAt(parentList.pos);
				if (list) {
					const itemPositions: number[] = [];
					list.forEach((_, offset) => itemPositions.push(parentList.pos + 1 + offset));
					for (const pos of itemPositions) tr.setNodeMarkup(pos, itemType);
				}
				dispatch(tr.scrollIntoView());
			}
			return true;
		}
		return wrapInList(listType)(state, dispatch, view);
	};
}

function findParentList(state: Parameters<Command>[0]) {
	const { $from } = state.selection;
	for (let depth = $from.depth; depth > 0; depth--) {
		const node = $from.node(depth);
		if (
			node.type.spec.content?.includes('list_item') ||
			node.type.spec.content?.includes('todo_item')
		) {
			return { node, pos: $from.before(depth), depth };
		}
	}
	return null;
}

/** Toggles the `checked` attr of the todo_item containing the selection. */
export function toggleTodoChecked(): Command {
	return (state, dispatch) => {
		const { $from } = state.selection;
		for (let depth = $from.depth; depth > 0; depth--) {
			const node = $from.node(depth);
			if (node.type.name === 'todo_item') {
				dispatch?.(
					state.tr.setNodeMarkup($from.before(depth), null, {
						...node.attrs,
						checked: !node.attrs.checked,
					}),
				);
				return true;
			}
		}
		return false;
	};
}

/** Inserts a node (e.g. horizontal_rule, image) at the selection or `pos`. */
export function insertNode(type: NodeType, attrs?: Attrs, pos?: number): Command {
	return (state, dispatch) => {
		const node = type.createAndFill(attrs);
		if (!node) return false;
		if (!dispatch) return true;
		let tr;
		let insertedAt;
		if (pos === undefined) {
			const from = state.selection.from;
			tr = state.tr.replaceSelectionWith(node);
			insertedAt = tr.mapping.map(from, -1);
		} else {
			tr = state.tr.insert(pos, node);
			insertedAt = pos;
		}
		// Put the cursor on/inside the inserted node when we can find it
		const clamped = Math.max(0, Math.min(insertedAt, tr.doc.content.size));
		const $at = tr.doc.resolve(clamped);
		if ($at.nodeAfter?.type === type) {
			if (node.isAtom && node.type.spec.selectable !== false) {
				tr = tr.setSelection(new NodeSelection($at));
			} else if (!node.isAtom) {
				tr = tr.setSelection(TextSelection.near(tr.doc.resolve(clamped + 1)));
			}
		}
		dispatch(tr.scrollIntoView());
		return true;
	};
}

/** Enter inside a list item: split it; in a checked todo item the new item is unchecked. */
export function splitListItemCommand(itemType: NodeType): Command {
	return splitListItem(itemType, { checked: false });
}

/** Wrapper containers a lone block can be unwrapped from, one line at a time */
function isWrapper(node: { type: NodeType }): boolean {
	const content = node.type.spec.content ?? '';
	return content.includes('block') && !content.includes('item');
}

/** A leaf/atom block (image, hr, embed) — deleting one should take two steps */
function isLeafBlock(node: PMNode): boolean {
	return node.isBlock && (node.isAtom || node.type.isLeaf) && !node.isText;
}

function findCutBefore($pos: ResolvedPos): ResolvedPos | null {
	for (let depth = $pos.depth - 1; depth >= 0; depth--) {
		if ($pos.index(depth) > 0) return $pos.doc.resolve($pos.before(depth + 1));
		if ($pos.node(depth).type.spec.isolating) break;
	}
	return null;
}

function findCutAfter($pos: ResolvedPos): ResolvedPos | null {
	for (let depth = $pos.depth - 1; depth >= 0; depth--) {
		const parent = $pos.node(depth);
		if ($pos.index(depth) + 1 < parent.childCount)
			return $pos.doc.resolve($pos.after(depth + 1));
		if (parent.type.spec.isolating) break;
	}
	return null;
}

/**
 * Backspace at the start of a non-empty textblock preceded by a leaf block
 * (image, divider, embed): SELECT the leaf instead of letting `joinBackward`
 * delete it instantly. The second press deletes — nothing vanishes without a
 * visible warning. Empty textblocks are left to `joinBackward`, which
 * correctly removes the empty line rather than touching the leaf.
 */
export const selectLeafBackward: Command = (state, dispatch, view) => {
	const { $from, empty } = state.selection;
	if (!empty || $from.parentOffset > 0 || !$from.parent.isTextblock) return false;
	if ($from.parent.content.size === 0) return false;
	const cut = findCutBefore($from);
	const before = cut?.nodeBefore;
	if (!before || !isLeafBlock(before) || before.type.spec.selectable === false)
		return false;
	return selectNodeBackward(state, dispatch, view);
};

/** Forward-delete mirror of {@link selectLeafBackward}. */
export const selectLeafForward: Command = (state, dispatch, view) => {
	const { $from, empty } = state.selection;
	if (!empty || !$from.parent.isTextblock) return false;
	if ($from.parentOffset < $from.parent.content.size) return false;
	if ($from.parent.content.size === 0) return false;
	const cut = findCutAfter($from);
	const after = cut?.nodeAfter;
	if (!after || !isLeafBlock(after) || after.type.spec.selectable === false) return false;
	return selectNodeForward(state, dispatch, view);
};

/** A block that Backspace can merge a following paragraph into (its last textblock) */
function isJoinTarget(node: {
	isTextblock: boolean;
	isAtom: boolean;
	isBlock: boolean;
	childCount: number;
}): boolean {
	return node.isBlock && !node.isTextblock && !node.isAtom && node.childCount > 0;
}

/**
 * Backspace at the very start of a block. The goal is Notion-like
 * predictability — repeated presses always make progress, never oscillate:
 * 1. a non-paragraph textblock (heading/code) becomes a paragraph first
 * 2. a list item lifts out of its list
 * 3. the first line of a quote/callout unwraps out of the container
 * 4. a paragraph after a quote/callout/list merges INTO the container's
 *    last line (empty paragraphs simply disappear) — instead of ProseMirror's
 *    default "pull the whole paragraph in as a new line", which alternates
 *    with liftEmptyBlock forever
 */
export function backspaceCommand(schema: Schema): Command {
	const listLifts: Command[] = [];
	if (schema.nodes.list_item) listLifts.push(liftListItem(schema.nodes.list_item));
	if (schema.nodes.todo_item) listLifts.push(liftListItem(schema.nodes.todo_item));
	const fallback = chainCommands(
		selectLeafBackward,
		joinBackward,
		liftEmptyBlock,
		selectNodeBackward,
	);
	return (state, dispatch, view) => {
		// Only take over at the start of a textblock with an empty selection
		const { $from, empty } = state.selection;
		if (!empty || $from.parentOffset > 0) return false;
		// Gap cursor (e.g. before a leading image) — depth 0, no textblock
		// parent; the steps below would throw on `$from.before(1)`
		if ($from.depth === 0 || !$from.parent.isTextblock) {
			return fallback(state, dispatch, view);
		}
		const parent = $from.parent;
		// 1. Convert heading/code/etc. back to a paragraph in place. A
		//    multi-line code block splits into one paragraph per line — a
		//    single wholesale paragraph would mangle 40 lines of code into one.
		if (parent.isTextblock && parent.type !== schema.nodes.paragraph) {
			if (parent.type.spec.code && parent.textContent.includes('\n')) {
				if (dispatch) {
					const paragraphs = parent.textContent
						.split('\n')
						.map((line) =>
							schema.nodes.paragraph.create(null, line ? schema.text(line) : undefined),
						);
					const start = $from.before();
					let tr = state.tr.replaceWith(start, start + parent.nodeSize, paragraphs);
					tr = tr.setSelection(TextSelection.create(tr.doc, start + 1));
					dispatch(tr.scrollIntoView());
				}
				return true;
			}
			if (setBlockType(schema.nodes.paragraph)(state, dispatch, view)) return true;
		}
		// 2. Lift list items out of their list
		for (const command of listLifts) {
			if ($from.depth > 1 && command(state, dispatch, view)) return true;
		}
		if ($from.depth > 1) {
			// 3. First line of a quote/callout → unwrap it from the container
			const container = $from.node($from.depth - 1);
			if (isWrapper(container) && $from.index($from.depth - 1) === 0) {
				if (lift(state, dispatch, view)) return true;
			}
			// Inside containers, join lines before lifting empties — lifting a
			// mid-container empty paragraph would split the container
			return fallback(state, dispatch, view);
		}
		// 4. Top-level paragraph following a container: merge into its last line
		const block_start = $from.before(1);
		const prev = state.doc.resolve(block_start).nodeBefore;
		if (parent.type === schema.nodes.paragraph && prev && isJoinTarget(prev)) {
			const target = TextSelection.near(state.doc.resolve(block_start), -1);
			if (target.$head.parent.isTextblock && target.$head.pos < block_start) {
				if (dispatch) {
					const join_pos = target.$head.pos;
					let tr = state.tr;
					if (parent.content.size) tr = tr.insert(join_pos, parent.content);
					const mapped = tr.mapping.map(block_start);
					tr = tr.delete(mapped, mapped + parent.nodeSize);
					tr = tr.setSelection(TextSelection.create(tr.doc, join_pos));
					dispatch(tr.scrollIntoView());
				}
				return true;
			}
		}
		return fallback(state, dispatch, view);
	};
}

/**
 * Moves the selection's top-level block up or down one sibling. Dispatched
 * with the `drop` uiEvent meta so the view runs the same FLIP animation as
 * drag-and-drop reordering.
 */
export function moveBlock(direction: -1 | 1): Command {
	return (state, dispatch) => {
		const { selection } = state;
		const { $from } = selection;
		let block_start: number | null = null;
		if (selection instanceof NodeSelection) {
			// Move exactly the selected node among its siblings (covers the
			// gutter's Move actions on nested list items too)
			block_start = selection.from;
		} else {
			// Inside a list, move the immediate item — users expect the bullet
			// under the cursor to move, not the entire list
			for (let depth = $from.depth; depth > 0; depth--) {
				const name = $from.node(depth).type.name;
				if (name === 'list_item' || name === 'todo_item') {
					block_start = $from.before(depth);
					break;
				}
			}
			if (block_start === null) {
				block_start = $from.depth > 0 ? $from.before(1) : null;
			}
		}
		if (block_start === null) return false;
		const $block = state.doc.resolve(block_start);
		const node = $block.nodeAfter;
		if (!node) return false;
		// Where the block starts after deletion + re-insertion (sibling swap)
		let insert_pos: number;
		if (direction === -1) {
			const prev = $block.nodeBefore;
			if (!prev) return false;
			insert_pos = block_start - prev.nodeSize;
		} else {
			const next = state.doc.resolve(block_start + node.nodeSize).nodeAfter;
			if (!next) return false;
			insert_pos = block_start + next.nodeSize;
		}
		if (!dispatch) return true;
		const offset = selection.from - block_start;
		let tr = state.tr.delete(block_start, block_start + node.nodeSize);
		tr = tr.insert(insert_pos, node);
		tr =
			selection instanceof NodeSelection
				? tr.setSelection(NodeSelection.create(tr.doc, insert_pos))
				: tr.setSelection(TextSelection.create(tr.doc, insert_pos + offset));
		tr.setMeta('uiEvent', 'drop');
		dispatch(tr.scrollIntoView());
		return true;
	};
}

export {
	chainCommands,
	exitCode,
	lift,
	liftListItem,
	setBlockType,
	sinkListItem,
	toggleMark,
	wrapIn,
	wrapInList,
};
