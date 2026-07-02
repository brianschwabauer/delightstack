import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as PMNode } from 'prosemirror-model';

export type PlaceholderOption =
	| string
	| ((node: PMNode, pos: number) => string | null | undefined);

export const placeholderKey = new PluginKey('placeholder');

/**
 * Renders placeholder hints as `data-placeholder` attributes (displayed via
 * CSS `::before`, never DOM mutation inside the editable):
 * - the configured placeholder on the first paragraph of an empty doc
 * - a "Type '/' for commands" hint on the currently-focused empty paragraph
 */
export function placeholder(option: PlaceholderOption = 'Start writing…'): Plugin {
	const resolve = (node: PMNode, pos: number): string | null => {
		if (typeof option === 'function') return option(node, pos) ?? null;
		return option;
	};

	return new Plugin({
		key: placeholderKey,
		props: {
			decorations(state) {
				const { doc, selection } = state;
				const decorations: Decoration[] = [];
				const docIsEmpty =
					doc.childCount === 1 &&
					doc.firstChild?.type.name === 'paragraph' &&
					doc.firstChild.content.size === 0;

				if (docIsEmpty) {
					const text = resolve(doc.firstChild!, 0);
					if (text) {
						decorations.push(
							Decoration.node(0, doc.firstChild!.nodeSize, {
								class: 'is-empty',
								'data-placeholder': text,
							}),
						);
					}
				} else if (selection.empty) {
					// Hint on the focused empty paragraph
					const { $from } = selection;
					const parent = $from.parent;
					if (
						parent.type.name === 'paragraph' &&
						parent.content.size === 0 &&
						$from.depth === 1
					) {
						decorations.push(
							Decoration.node($from.before(1), $from.after(1), {
								class: 'is-empty is-focused-empty',
								'data-placeholder': "Type '/' for commands",
							}),
						);
					}
				}

				return decorations.length
					? DecorationSet.create(doc, decorations)
					: DecorationSet.empty;
			},
		},
	});
}
