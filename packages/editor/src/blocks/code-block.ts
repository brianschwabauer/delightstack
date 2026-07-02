import { defineBlock } from '../core/block-spec.js';
import CodeBlock from '../components/blocks/CodeBlock.svelte';
import { baseNodes } from '../schema/index.js';
import { codeHighlight } from '../core/plugins/code-highlight.js';
import { codeBlockRenderer } from '../render/blocks.js';

export interface CodeBlockAttrs extends Record<string, unknown> {
	language: string;
	block_id: string | null;
}

/**
 * Upgrades the base `code_block` node with a Svelte view: language picker,
 * copy button, and (through the same schema name) all base keymaps and
 * markdown ``` input rules keep working.
 */
export const codeBlock = defineBlock<CodeBlockAttrs>({
	name: 'code_block',
	schema: baseNodes.code_block,
	component: CodeBlock,
	// The code text is editable content; block chrome would fight with the
	// language picker header, so the component owns its whole UI.
	interactive: { selectable: false, deletable: false },
	// Live token decorations while editing (same tokenizer as the read-only
	// Code component, so toggling editability doesn't restyle)
	plugins: () => [codeHighlight()],
	render: codeBlockRenderer,
});
