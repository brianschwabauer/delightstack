import {
	chainCommands,
	exitCode,
	joinBackward,
	lift,
	liftEmptyBlock,
	selectNodeBackward,
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
import type { Attrs, NodeType, Schema } from 'prosemirror-model';

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

/** Backspace at the very start of a block: lift/join sensibly. */
export function backspaceCommand(schema: Schema): Command {
	const commands: Command[] = [];
	if (schema.nodes.list_item) commands.push(liftListItem(schema.nodes.list_item));
	if (schema.nodes.todo_item) commands.push(liftListItem(schema.nodes.todo_item));
	const liftOrJoin = chainCommands(liftEmptyBlock, joinBackward, selectNodeBackward);
	return (state, dispatch, view) => {
		// Only take over at the start of a textblock with an empty selection
		const { $from, empty } = state.selection;
		if (!empty || $from.parentOffset > 0) return false;
		// Backspace at the start of a heading/quote/code converts to paragraph first
		const parent = $from.parent;
		if (
			parent.type !== schema.nodes.paragraph &&
			parent.isTextblock &&
			$from.depth === 1 &&
			setBlockType(schema.nodes.paragraph)(state, dispatch, view)
		) {
			return true;
		}
		for (const command of commands) {
			if ($from.depth > 1 && command(state, dispatch, view)) return true;
		}
		return liftOrJoin(state, dispatch, view);
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
