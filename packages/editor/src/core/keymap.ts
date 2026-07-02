import { keymap } from 'prosemirror-keymap';
import {
	baseKeymap,
	chainCommands,
	exitCode,
	selectParentNode,
	toggleMark,
} from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { sinkListItem } from 'prosemirror-schema-list';
import type { Command, Plugin } from 'prosemirror-state';
import type { Schema } from 'prosemirror-model';
import {
	backspaceCommand,
	liftListItem,
	moveBlock,
	splitListItemCommand,
	toggleBlockType,
} from './commands.js';

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
	blocks['Escape'] = selectParentNode;
	if (schema.nodes.hard_break) {
		const br = schema.nodes.hard_break;
		const insertBreak: Command = (state, dispatch) => {
			dispatch?.(state.tr.replaceSelectionWith(br.create()).scrollIntoView());
			return true;
		};
		blocks['Shift-Enter'] = chainCommands(exitCode, insertBreak);
		blocks['Mod-Enter'] = chainCommands(exitCode, insertBreak);
	}

	const lists: Record<string, Command> = {};
	const items = [schema.nodes.list_item, schema.nodes.todo_item].filter(Boolean);
	if (items.length) {
		lists['Enter'] = chainCommands(...items.map((item) => splitListItemCommand(item)));
		lists['Tab'] = chainCommands(...items.map((item) => sinkListItem(item)));
		lists['Shift-Tab'] = chainCommands(...items.map((item) => liftListItem(item)));
	}
	lists['Backspace'] = backspaceCommand(schema);

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
