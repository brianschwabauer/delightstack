import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';
import { tokenizeLine, type CodeToken } from '@delightstack/components/display';

/**
 * Live syntax highlighting for editable code blocks, as inline decorations
 * using the SAME tokenizer and `token-<type>` classes as the design system's
 * `Code` component — toggling a document between editable and read-only no
 * longer restyles every code block.
 *
 * Tokenization is per-line regex work; results are cached per node (nodes
 * are immutable), so a keystroke only re-tokenizes the code block it edits.
 */

export const codeHighlightKey = new PluginKey<DecorationSet>('code_highlight');

const token_cache = new WeakMap<PMNode, CodeToken[][]>();

function tokensFor(node: PMNode): CodeToken[][] {
	let tokens = token_cache.get(node);
	if (!tokens) {
		const language = typeof node.attrs.language === 'string' ? node.attrs.language : '';
		tokens = node.textContent
			.split('\n')
			.map((line) => tokenizeLine(line, language || 'plaintext'));
		token_cache.set(node, tokens);
	}
	return tokens;
}

function buildDecorations(doc: PMNode): DecorationSet {
	const decorations: Decoration[] = [];
	doc.descendants((node, pos) => {
		if (!node.type.spec.code || !node.isTextblock) return true;
		let offset = pos + 1;
		for (const line of tokensFor(node)) {
			for (const token of line) {
				if (token.type !== 'plain' && token.content) {
					decorations.push(
						Decoration.inline(offset, offset + token.content.length, {
							class: `token-${token.type}`,
						}),
					);
				}
				offset += token.content.length;
			}
			offset += 1; // the newline character
		}
		return false;
	});
	return DecorationSet.create(doc, decorations);
}

export function codeHighlight(): Plugin<DecorationSet> {
	return new Plugin<DecorationSet>({
		key: codeHighlightKey,
		state: {
			init: (_config, state) => buildDecorations(state.doc),
			apply(tr, value) {
				if (!tr.docChanged) return value;
				return buildDecorations(tr.doc);
			},
		},
		props: {
			decorations(state) {
				return codeHighlightKey.getState(state);
			},
		},
	});
}
