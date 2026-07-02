import type { Schema } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import type { EditorCommand, EditorLike } from '../types/index.js';
import { toggleList, wrapIn } from './commands.js';
import { icons } from './icons.js';

/**
 * The built-in command set, registered by the Editor for every schema node
 * that exists. One definition per action powers the slash menu, plus menu,
 * toolbar, and floating menu.
 */
export function builtinCommands(schema: Schema): EditorCommand[] {
	const commands: EditorCommand[] = [];

	// ---- marks (floating menu + toolbar) ----
	const marks: [string, string, string, string][] = [
		['bold', 'Bold', 'Mod-b', icons.bold],
		['italic', 'Italic', 'Mod-i', icons.italic],
		['underline', 'Underline', 'Mod-u', icons.underline],
		['strike', 'Strikethrough', 'Mod-Shift-x', icons.strike],
		['code', 'Code', 'Mod-e', icons.code],
	];
	for (const [name, label, keyboard, icon] of marks) {
		if (!schema.marks[name]) continue;
		commands.push({
			name,
			label,
			icon,
			keyboard,
			surfaces: ['floating', 'toolbar'],
			is_active: (editor) => name in editor.active_marks,
			run: (editor) => editor.toggleMark(name),
		});
	}

	// ---- text blocks ----
	if (schema.nodes.paragraph) {
		commands.push({
			name: 'text',
			label: 'Text',
			description: 'Plain paragraph text',
			icon: icons.text,
			keywords: ['paragraph', 'plain'],
			group: 'Basic',
			keyboard: 'Mod-Alt-0',
			surfaces: ['slash', 'plus', 'toolbar'],
			is_active: (editor) => editor.active_block?.name === 'paragraph',
			run: (editor) => editor.setBlock('paragraph'),
		});
	}
	if (schema.nodes.heading) {
		const headings: [number, string][] = [
			[2, 'Section heading'],
			[3, 'Subsection heading'],
			[4, 'Small heading'],
		];
		for (const [level, description] of headings) {
			commands.push({
				name: `heading_${level}`,
				label: `Heading ${level}`,
				description,
				icon: icons[`heading_${Math.min(level, 4)}` as 'heading_2'],
				keywords: [`h${level}`, 'title', 'heading'],
				group: 'Basic',
				keyboard: `Mod-Alt-${level}`,
				surfaces: ['slash', 'plus', 'toolbar'],
				is_active: (editor) => {
					const block = editor.active_block;
					return block?.name === 'heading' && block.attrs.level === level;
				},
				run: (editor) => editor.setBlock('heading', { level }),
			});
		}
	}
	if (schema.nodes.bullet_list) {
		commands.push({
			name: 'bullet_list',
			label: 'Bullet list',
			description: 'A simple unordered list',
			icon: icons.bullet_list,
			keywords: ['ul', 'unordered', 'list'],
			group: 'Basic',
			surfaces: ['slash', 'plus', 'toolbar'],
			is_active: inList('bullet_list'),
			run: (editor) => runToggleList(editor, 'bullet_list', 'list_item'),
		});
	}
	if (schema.nodes.ordered_list) {
		commands.push({
			name: 'ordered_list',
			label: 'Numbered list',
			description: 'A list with numbering',
			icon: icons.ordered_list,
			keywords: ['ol', 'ordered', 'numbered', 'list'],
			group: 'Basic',
			surfaces: ['slash', 'plus', 'toolbar'],
			is_active: inList('ordered_list'),
			run: (editor) => runToggleList(editor, 'ordered_list', 'list_item'),
		});
	}
	if (schema.nodes.todo_list) {
		commands.push({
			name: 'todo_list',
			label: 'To-do list',
			description: 'A list with checkboxes',
			icon: icons.todo_list,
			keywords: ['todo', 'task', 'checkbox', 'checklist'],
			group: 'Basic',
			surfaces: ['slash', 'plus', 'toolbar'],
			is_active: inList('todo_list'),
			run: (editor) => runToggleList(editor, 'todo_list', 'todo_item'),
		});
	}
	if (schema.nodes.blockquote) {
		commands.push({
			name: 'blockquote',
			label: 'Quote',
			description: 'Capture a quote',
			icon: icons.blockquote,
			keywords: ['quote', 'blockquote', 'citation'],
			group: 'Basic',
			surfaces: ['slash', 'plus', 'toolbar'],
			is_active: (editor) => {
				const { state } = editor;
				const { $from: from } = state.selection;
				for (let depth = from.depth; depth > 0; depth--) {
					if (from.node(depth).type.name === 'blockquote') return true;
				}
				return false;
			},
			run: (editor) => editor.exec(wrapIn(editor.schema.nodes.blockquote)),
		});
	}
	if (schema.nodes.code_block) {
		commands.push({
			name: 'code_block',
			label: 'Code block',
			description: 'Multi-line code with syntax highlighting',
			icon: icons.code_block,
			keywords: ['code', 'codeblock', 'snippet', 'pre'],
			group: 'Basic',
			surfaces: ['slash', 'plus', 'toolbar'],
			is_active: (editor) => editor.active_block?.name === 'code_block',
			run: (editor) => editor.setBlock('code_block'),
		});
	}
	if (schema.nodes.horizontal_rule) {
		commands.push({
			name: 'divider',
			label: 'Divider',
			description: 'A horizontal rule',
			icon: icons.divider,
			keywords: ['hr', 'rule', 'line', 'separator', 'divider'],
			group: 'Basic',
			run: (editor) => editor.insertBlock('horizontal_rule'),
		});
	}

	return commands;
}

function inList(listName: string) {
	return (editor: { state: EditorState }): boolean => {
		const { $from: from } = editor.state.selection;
		for (let depth = from.depth; depth > 0; depth--) {
			if (from.node(depth).type.name === listName) return true;
		}
		return false;
	};
}

function runToggleList(editor: EditorLike, listName: string, itemName: string): boolean {
	const list = editor.schema.nodes[listName];
	const item = editor.schema.nodes[itemName];
	if (!list || !item) return false;
	return editor.exec(toggleList(list, item));
}
