export {
	Editor,
	type ActiveBlockInfo,
	type EditorEvent,
	type EditorOptions,
	type SelectionInfo,
} from './editor.svelte.js';
export { CommandRegistry } from './registry.svelte.js';
export { defineBlock, defineBlockSchema } from './block-spec.js';
export {
	backspaceCommand,
	insertNode,
	toggleBlockType,
	toggleList,
	toggleMark,
	toggleTodoChecked,
} from './commands.js';
export { buildKeymaps, type KeymapOptions } from './keymap.js';
export { buildInputRules, markInputRule } from './input-rules.js';
export {
	placeholder,
	placeholderKey,
	type PlaceholderOption,
} from './plugins/placeholder.js';
export { blockIds, createBlockId } from './plugins/block-id.js';
export { suggestion, type SuggestionOptions } from './plugins/suggestion.js';
export { builtinCommands } from './builtin-commands.js';
export { icons, type IconName } from './icons.js';
