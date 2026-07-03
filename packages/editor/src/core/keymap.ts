import { keymap } from 'prosemirror-keymap';
import {
	baseKeymap,
	chainCommands,
	exitCode,
	selectParentNode,
	toggleMark,
} from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { undoInputRule } from 'prosemirror-inputrules';
import { sinkListItem } from 'prosemirror-schema-list';
import type { Command, Plugin } from 'prosemirror-state';
import type { Schema } from 'prosemirror-model';
import {
	backspaceCommand,
	deleteLine,
	duplicateBlock,
	insertLine,
	jumpCaret,
	liftListItem,
	moveBlock,
	pageJump,
	selectLeafForward,
	splitListItemCommand,
	toggleBlockType,
	toggleTodoChecked,
} from './commands.js';

/** Insert literal text when the cursor is inside a code block */
function insertInCode(text: string): Command {
	return (state, dispatch) => {
		const { $from } = state.selection;
		if (!$from.parent.type.spec.code) return false;
		dispatch?.(state.tr.insertText(text).scrollIntoView());
		return true;
	};
}

export interface KeymapOptions {
	/** Include undo/redo bindings (omit when the history plugin is disabled) */
	history?: boolean;
	/** Extra bindings appended with highest priority */
	extra?: Record<string, Command>;
}

/**
 * Assembles the base keymaps for the editor: mark toggles, block movement,
 * list handling, undo/redo, then ProseMirror's baseKeymap as the fallback.
 */
export function buildKeymaps(schema: Schema, options: KeymapOptions = {}): Plugin[] {
	const marks: Record<string, Command> = {};
	if (schema.marks.bold) marks['Mod-b'] = toggleMark(schema.marks.bold);
	if (schema.marks.italic) marks['Mod-i'] = toggleMark(schema.marks.italic);
	if (schema.marks.underline) marks['Mod-u'] = toggleMark(schema.marks.underline);
	if (schema.marks.strike) marks['Mod-Shift-x'] = toggleMark(schema.marks.strike);
	if (schema.marks.code) marks['Mod-e'] = toggleMark(schema.marks.code);

	const blocks: Record<string, Command> = {};
	if (schema.nodes.heading) {
		// User-facing heading numbers start at 1; document levels start at 2
		// (h1 is reserved for the page title)
		for (const ui_level of [1, 2, 3, 4, 5]) {
			blocks[`Mod-Alt-${ui_level}`] = toggleBlockType(schema.nodes.heading, {
				level: ui_level + 1,
			});
		}
	}
	if (schema.nodes.paragraph)
		blocks['Mod-Alt-0'] = toggleBlockType(schema.nodes.paragraph);
	// Move the current block among its siblings (with the drop FLIP animation)
	blocks['Alt-ArrowUp'] = moveBlock(-1);
	blocks['Alt-ArrowDown'] = moveBlock(1);
	// Duplicate the current line/block above/below (VS Code muscle memory)
	blocks['Shift-Alt-ArrowUp'] = duplicateBlock(-1);
	blocks['Shift-Alt-ArrowDown'] = duplicateBlock(1);
	// Open a line above without splitting the current one
	blocks['Mod-Shift-Enter'] = insertLine(-1);
	// Delete the current line/block
	blocks['Shift-Delete'] = deleteLine();
	// Fast vertical caret jumps: 10 lines, or a viewport for Page keys.
	// Ctrl explicitly (not Mod) — Cmd-Arrow is doc start/end on macOS.
	blocks['Ctrl-ArrowUp'] = jumpCaret(-1, 10);
	blocks['Ctrl-ArrowDown'] = jumpCaret(1, 10);
	blocks['PageUp'] = pageJump(-1);
	blocks['PageDown'] = pageJump(1);
	blocks['Escape'] = selectParentNode;
	// Exit hatches are bound whether or not hard_break exists — without them
	// there is no way out of a code block at the end of the document
	{
		const br = schema.nodes.hard_break;
		const breaks: Command[] = br
			? [
					(state, dispatch) => {
						dispatch?.(state.tr.replaceSelectionWith(br.create()).scrollIntoView());
						return true;
					},
				]
			: [];
		// Shift-Enter inside code inserts a newline (muscle memory from every
		// other editor)
		blocks['Shift-Enter'] = chainCommands(insertInCode('\n'), exitCode, ...breaks);
		// Mod-Enter: toggle the todo under the cursor, else open a line below
		// (which doubles as the exit hatch after a code block)
		blocks['Mod-Enter'] = chainCommands(toggleTodoChecked(), insertLine(1));
	}
	// A caret at the end of a block before an image/divider/embed: forward
	// delete selects the leaf first, the second press deletes it
	blocks['Delete'] = selectLeafForward;

	const lists: Record<string, Command> = {};
	const items = [schema.nodes.list_item, schema.nodes.todo_item].filter(Boolean);
	if (items.length) {
		lists['Enter'] = chainCommands(...items.map((item) => splitListItemCommand(item)));
		// Tab indents list items; inside a code block it inserts a tab
		// character instead of blurring the editor
		lists['Tab'] = chainCommands(
			insertInCode('\t'),
			...items.map((item) => sinkListItem(item)),
		);
		lists['Shift-Tab'] = chainCommands(...items.map((item) => liftListItem(item)));
	} else {
		lists['Tab'] = insertInCode('\t');
	}
	// Backspace right after an autoformat (e.g. `- ` became a bullet) reverts
	// the autoformat instead of acting on the new structure
	lists['Backspace'] = chainCommands(undoInputRule, backspaceCommand(schema));

	const history: Record<string, Command> = {};
	if (options.history !== false) {
		history['Mod-z'] = undo;
		history['Mod-y'] = redo;
		history['Mod-Shift-z'] = redo;
	}

	const plugins: Plugin[] = [];
	if (options.extra) plugins.push(keymap(options.extra));
	plugins.push(keymap({ ...marks, ...blocks, ...lists, ...history }), keymap(baseKeymap));
	return plugins;
}
