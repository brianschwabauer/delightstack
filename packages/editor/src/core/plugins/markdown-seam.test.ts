import { describe, expect, it } from 'vitest';
import { Slice } from 'prosemirror-model';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Editor, type EditorOptions } from '../editor.svelte.js';
import { textblockTypeInputRule } from '../input-rules.js';
import type { JSONContent } from '../../types/index.js';

/**
 * The markdown seam (ED-03) and the `input_rules` extension point.
 *
 * Everything here drives the real plugin props rather than a synthesised
 * clipboard event: `handlePaste` and `clipboardTextSerializer` are what
 * ProseMirror calls, and happy-dom's `ClipboardEvent` is not.
 */

function mount(options: EditorOptions): { editor: Editor; view: EditorView } {
	const editor = new Editor(options);
	const el = document.createElement('div');
	document.body.appendChild(el);
	editor.mount(el);
	return { editor, view: editor.view! };
}

/** A clipboard with the given flavours, as `handlePaste` reads one. */
function clipboard(data: Record<string, string>): ClipboardEvent {
	return {
		clipboardData: {
			types: Object.keys(data),
			getData: (type: string) => data[type] ?? '',
		},
	} as unknown as ClipboardEvent;
}

function paste(view: EditorView, data: Record<string, string>): boolean {
	return (
		view.someProp('handlePaste', (f) => f(view, clipboard(data), Slice.empty)) ?? false
	);
}

/** What `text/plain` would carry if the selection were copied now. */
function copyText(view: EditorView): string {
	const slice = view.state.selection.content();
	const transformed = view.someProp('transformCopied', (f) => f(slice, view)) ?? slice;
	return (
		view.someProp('clipboardTextSerializer', (f) => f(transformed, view)) ??
		transformed.content.textBetween(0, transformed.content.size, '\n\n')
	);
}

/** Types `text` at the selection, through the input rules. */
function type(view: EditorView, text: string): void {
	const { from, to } = view.state.selection;
	const insert = () => view.state.tr.insertText(text, from, to);
	const handled = view.someProp('handleTextInput', (f) =>
		f(view, from, to, text, insert),
	);
	if (!handled) view.dispatch(insert());
}

const HELLO: JSONContent = {
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
};

const HELLO_WORLD: JSONContent = {
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] }],
};

describe('markdown seam — paste', () => {
	it("uses the app's parser instead of the built-in one", () => {
		const { editor, view } = mount({
			content: HELLO,
			markdown: {
				parse: () => [
					{
						type: 'heading',
						attrs: { level: 1 },
						content: [{ type: 'text', text: 'ours' }],
					},
				],
			},
		});
		view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));

		expect(paste(view, { 'text/plain': '# a heading' })).toBe(true);
		const last = editor.doc.content?.at(-1);
		expect(last?.type).toBe('heading');
		// The built-in parser maps `#` to level 2; the app's said 1, and the app
		// is the one that decides what its own markdown means
		expect(last?.attrs?.level).toBe(1);
		editor.destroy();
	});

	it('honours a custom `looks_like` and a declining `parse`', () => {
		const seen: string[] = [];
		const { editor, view } = mount({
			content: HELLO,
			markdown: {
				looks_like: (text) => {
					seen.push(text);
					return false;
				},
				parse: () => {
					throw new Error('parse must not run when looks_like says no');
				},
			},
		});
		expect(paste(view, { 'text/plain': '# a heading' })).toBe(false);
		expect(seen).toEqual(['# a heading']);
		editor.destroy();

		const declined = mount({
			content: HELLO,
			markdown: { parse: () => null },
		});
		expect(paste(declined.view, { 'text/plain': '# a heading' })).toBe(false);
		declined.editor.destroy();
	});

	it('falls back to a plain paste when the JSON does not fit the schema', () => {
		const { editor, view } = mount({
			content: HELLO,
			markdown: { parse: () => [{ type: 'no_such_node' }] },
		});
		expect(paste(view, { 'text/plain': '# a heading' })).toBe(false);
		expect(editor.doc.content?.length).toBe(1);
		editor.destroy();
	});

	it('leaves the paste alone when the clipboard also carries HTML', () => {
		const { editor, view } = mount({
			content: HELLO,
			markdown: {
				parse: () => {
					throw new Error('HTML wins — it carries more than markdown can');
				},
			},
		});
		expect(
			paste(view, { 'text/plain': '# a heading', 'text/html': '<h1>a heading</h1>' }),
		).toBe(false);
		editor.destroy();
	});

	it('merges a one-paragraph parse into the caret\u2019s textblock', () => {
		// `[text](href)` or `` `code` `` pasted mid-sentence is an *inline* paste.
		// Inserting it as a block would leave three paragraphs where the user had one.
		const { editor, view } = mount({
			content: HELLO_WORLD,
			markdown: {
				looks_like: () => true,
				parse: () => [{ type: 'paragraph', content: [{ type: 'text', text: 'INS' }] }],
			},
		});
		// caret between `hello ` and `world`
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)));

		expect(paste(view, { 'text/plain': '[a](https://example.com)' })).toBe(true);
		expect(editor.doc.content).toHaveLength(1);
		expect(view.state.doc.textContent).toBe('hello INSworld');
		editor.destroy();
	});

	it('still pastes a multi-block parse as blocks', () => {
		const { editor, view } = mount({
			content: HELLO_WORLD,
			markdown: {
				looks_like: () => true,
				parse: () => [
					{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
					{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
				],
			},
		});
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)));

		expect(paste(view, { 'text/plain': 'A\n\nB' })).toBe(true);
		expect(editor.doc.content).toHaveLength(4);
		editor.destroy();
	});

	it('pastes a single non-paragraph block as a block', () => {
		const { editor, view } = mount({
			content: HELLO_WORLD,
			markdown: {
				looks_like: () => true,
				parse: () => [
					{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H' }] },
				],
			},
		});
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)));

		expect(paste(view, { 'text/plain': '## H' })).toBe(true);
		expect(editor.doc.content?.some((node) => node.type === 'heading')).toBe(true);
		editor.destroy();
	});

	it('runs the parsed content through transformPasted, so block ids are regenerated', () => {
		const { editor, view } = mount({
			content: HELLO,
			doc_id: 'doc-a',
			markdown: {
				// Two blocks, so this pastes as blocks: a one-paragraph parse merges
				// into the caret's textblock instead, and has no block of its own to
				// carry an id.
				parse: () => [
					{
						type: 'paragraph',
						// An id off somebody else's clipboard: unstamped, so never trusted
						attrs: { block_id: 'foreign-id' },
						content: [{ type: 'text', text: 'pasted' }],
					},
					{
						type: 'paragraph',
						attrs: { block_id: 'foreign-id-2' },
						content: [{ type: 'text', text: 'more' }],
					},
				],
			},
		});
		view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
		expect(paste(view, { 'text/plain': '- pasted\n- more' })).toBe(true);

		const pasted = editor.doc.content?.find((node) =>
			node.content?.some((child) => child.text === 'pasted'),
		);
		expect(pasted).toBeTruthy();
		expect(pasted?.attrs?.block_id).toBeTruthy();
		expect(pasted?.attrs?.block_id).not.toBe('foreign-id');
		editor.destroy();
	});
});

describe('markdown seam — copy', () => {
	it("writes text/plain with the app's serializer", () => {
		const { editor, view } = mount({
			content: HELLO,
			markdown: {
				serialize: (slice) => `>>${slice.content.textBetween(0, slice.content.size)}<<`,
			},
		});
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
		expect(copyText(view)).toBe('>>hello<<');
		editor.destroy();
	});

	it('falls back to ProseMirror’s extraction when the hook declines', () => {
		const { editor, view } = mount({
			content: HELLO,
			markdown: { serialize: () => null },
		});
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
		expect(copyText(view)).toBe('hello');
		editor.destroy();
	});

	it('leaves text/html alone', () => {
		const { editor, view } = mount({
			content: HELLO,
			markdown: { serialize: () => 'markdown' },
		});
		// Nothing in the seam claims the HTML flavour: the DOM serializer is
		// still ProseMirror's own, built from the schema
		expect(view.someProp('clipboardSerializer')).toBeUndefined();
		editor.destroy();
	});

	it('sees the slice after transformCopied, stamps and all', () => {
		let stamped: string | null | undefined;
		const { editor, view } = mount({
			content: {
				type: 'doc',
				content: [
					{
						type: 'paragraph',
						attrs: { block_id: 'blk' },
						content: [{ type: 'text', text: 'hello' }],
					},
				],
			},
			doc_id: 'doc-a',
			markdown: {
				serialize: (slice) => {
					stamped = slice.content.firstChild?.attrs.block_id as string | null;
					return 'ok';
				},
			},
		});
		// A whole-block selection, so the slice carries the paragraph itself
		view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));
		copyText(view);
		expect(stamped).toBe('doc-a:blk');
		editor.destroy();
	});
});

describe('input_rules option', () => {
	it('installs the built-in rules by default', () => {
		const { editor, view } = mount({
			content: { type: 'doc', content: [{ type: 'paragraph' }] },
		});
		type(view, '#');
		type(view, ' ');
		expect(editor.doc.content?.[0].type).toBe('heading');
		editor.destroy();
	});

	it('installs none when false', () => {
		const { editor, view } = mount({
			content: { type: 'doc', content: [{ type: 'paragraph' }] },
			input_rules: false,
		});
		type(view, '#');
		type(view, ' ');
		expect(editor.doc.content?.[0].type).toBe('paragraph');
		editor.destroy();
	});

	it('hands the defaults to a factory, whose own rules shadow them', () => {
		let handed = 0;
		const { editor, view } = mount({
			content: { type: 'doc', content: [{ type: 'paragraph' }] },
			input_rules: ({ schema, defaults }) => {
				handed = defaults.length;
				return [
					// `#` means level 1 here, not the base rule's level 2
					textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, (match) => ({
						level: match[1].length,
					})),
					...defaults,
				];
			},
		});
		expect(handed).toBeGreaterThan(5);
		type(view, '#');
		type(view, ' ');
		expect(editor.doc.content?.[0].type).toBe('heading');
		expect(editor.doc.content?.[0].attrs?.level).toBe(1);
		editor.destroy();
	});
});
