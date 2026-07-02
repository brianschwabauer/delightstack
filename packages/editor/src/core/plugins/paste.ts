import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Fragment, Node as PMNode, Slice } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import type { Editor } from '../editor.svelte.js';
import { looksLikeMarkdown, parseMarkdown } from '../markdown.js';

export const pasteKey = new PluginKey('paste');

export interface PasteOptions {
	/** Parse plain-text markdown pastes into rich content. Default true */
	markdown?: boolean;
	/** Extra HTML transform applied before the built-in scrub */
	transform_html?: (html: string) => string;
}

const URL_PATTERN = /^https?:\/\/\S+$/i;

/**
 * Paste handling:
 * - HTML from Word/Google Docs is scrubbed before ProseMirror parses it
 * - a URL pasted over selected text becomes a link
 * - a URL pasted on an empty paragraph becomes an embed (when a block's
 *   `paste.match_url` claims it) or a link
 * - plain text that looks like markdown is parsed into rich blocks
 */
export function paste(editor: Editor, options: PasteOptions = {}): Plugin {
	return new Plugin({
		key: pasteKey,
		props: {
			transformPastedHTML(html) {
				const transformed = options.transform_html ? options.transform_html(html) : html;
				return scrubHTML(transformed);
			},
			handlePaste(view, event, slice) {
				const clipboard = event.clipboardData;
				if (!clipboard) return false;
				const text = clipboard.getData('text/plain').trim();
				const hasHTML = clipboard.types.includes('text/html');

				// --- single URL pastes ---
				if (text && URL_PATTERN.test(text) && !/\s/.test(text)) {
					const { selection, schema } = view.state;
					const link = schema.marks.link;
					// Over a text selection → make it a link
					if (!selection.empty && selection instanceof TextSelection && link) {
						view.dispatch(
							view.state.tr
								.removeMark(selection.from, selection.to, link)
								.addMark(selection.from, selection.to, link.create({ href: text })),
						);
						return true;
					}
					// On an empty paragraph → embed (if a block claims the URL)
					if (selection.empty && selection.$from.parent.content.size === 0) {
						const url = parseURL(text);
						if (url) {
							for (const block of editor.blocks.values()) {
								const attrs = block.paste?.match_url?.(url);
								if (attrs && schema.nodes[block.name]) {
									editor.insertBlock(block.name, attrs);
									return true;
								}
							}
						}
						// Fall back to a linkified paste
						if (link) {
							view.dispatch(
								view.state.tr.replaceSelectionWith(
									schema.text(text, [link.create({ href: text })]),
									false,
								),
							);
							return true;
						}
					}
					return false;
				}

				// --- markdown plain-text pastes (only when there's no HTML flavor) ---
				if (options.markdown !== false && text && !hasHTML && looksLikeMarkdown(text)) {
					const blocks = parseMarkdown(text);
					if (blocks.length) {
						const nodes = jsonToNodes(view, blocks);
						if (nodes) {
							const tr = view.state.tr.replaceSelection(sliceFromNodes(nodes));
							view.dispatch(tr.scrollIntoView());
							return true;
						}
					}
				}

				void slice;
				return false;
			},
		},
	});
}

function parseURL(text: string): URL | null {
	try {
		return new URL(text);
	} catch {
		return null;
	}
}

function jsonToNodes(view: EditorView, blocks: unknown[]): PMNode[] | null {
	try {
		return blocks.map((block) => PMNode.fromJSON(view.state.schema, block));
	} catch {
		return null; // schema mismatch (e.g. node disabled) — fall back to plain paste
	}
}

function sliceFromNodes(nodes: PMNode[]): Slice {
	// openStart/openEnd 0: paste as whole blocks
	return new Slice(Fragment.from(nodes), 0, 0);
}

/** Strips Word/Google Docs cruft so the schema parser sees clean HTML. */
export function scrubHTML(html: string): string {
	let out = html;
	// Comments (Word conditional comments included)
	out = out.replace(/<!--[\s\S]*?-->/g, '');
	// Non-content elements
	out = out.replace(/<(style|script|xml|meta|link|title)[^>]*>[\s\S]*?<\/\1>/gi, '');
	out = out.replace(/<(meta|link)[^>]*\/?>(?:<\/\1>)?/gi, '');
	// Word paragraph noise
	out = out.replace(/<\/?o:p[^>]*>/gi, '');
	out = out.replace(/<w:[^>]*>[\s\S]*?<\/w:[^>]*>/gi, '');
	// Google Docs wraps everything in <b style="font-weight:normal" id="docs-internal-guid-…">
	out = out.replace(/<b[^>]*id="docs-internal-guid[^"]*"[^>]*>([\s\S]*?)<\/b>/gi, '$1');
	// mso- inline styles confuse nothing structurally, but strip class soup
	out = out.replace(/\sclass="(Mso[^"]*|xl\d+)"/gi, '');
	return out;
}
