import { Plugin, PluginKey } from 'prosemirror-state';
import type { MarkdownHooks } from '../../types/index.js';

export const markdownClipboardKey = new PluginKey('markdown_clipboard');

/**
 * Writes the clipboard's `text/plain` flavour with the app's markdown
 * serializer, on copy and on cut.
 *
 * `text/html` is deliberately untouched. The two flavours are for two
 * different destinations: HTML is what a paste back into an editor reads, and
 * it carries everything the schema knows; markdown is what a paste into a
 * terminal, a chat window or an agent's prompt reads, and it carries what
 * markdown can hold. Replacing the plain-text flavour costs the first nothing
 * and gains the second everything — ProseMirror's own extraction is the
 * document's characters with every structure flattened out of them.
 *
 * The slice arrives **after** `transformCopied`, so whatever the block-id
 * plugin (or any other) stamped onto it is visible to the serializer, which is
 * the only place that stamping can be stripped back out before it leaves the
 * app.
 *
 * Returning `null` from the hook — or serializing to nothing — falls back to
 * ProseMirror's extraction rather than putting an empty clipboard in the way.
 */
export function markdownClipboard(hooks: MarkdownHooks): Plugin {
	return new Plugin({
		key: markdownClipboardKey,
		props: {
			clipboardTextSerializer(slice, view) {
				const text = hooks.serialize?.(slice, { schema: view.state.schema });
				// `someProp` takes the first *truthy* return, so an empty string is
				// how a plugin declines. That is the behaviour wanted here too: a
				// slice a dialect cannot spell is better copied as plain characters
				// than as nothing at all.
				return text ?? '';
			},
		},
	});
}
