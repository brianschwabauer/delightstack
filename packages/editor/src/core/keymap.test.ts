import { describe, expect, it } from 'vitest';
import type { EditorView } from 'prosemirror-view';
import { Editor } from './editor.svelte.js';
import { toggleBlockType } from './commands.js';
import type { JSONContent } from '../types/index.js';

function textDoc(text: string): JSONContent {
	return {
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
	};
}

/**
 * A keystroke, run through the plugins the way `EditorView` runs them: in
 * order, stopping at the first `handleKeyDown` that claims it. That order is
 * the whole subject of these tests, so the test cannot take a shortcut past it.
 */
function press(editor: Editor, event: Partial<KeyboardEvent>): boolean {
	const view = {
		state: editor.state,
		dispatch: (tr: Parameters<Editor['dispatch']>[0]) => editor.dispatch(tr),
	} as unknown as EditorView;
	for (const plugin of editor.state.plugins) {
		const handler = plugin.props?.handleKeyDown;
		if (handler?.call(plugin, view, event as KeyboardEvent)) return true;
	}
	return false;
}

/** `Ctrl-Alt-1` — jsdom is not a Mac, so `Mod` is Control here. */
const MOD_ALT_1: Partial<KeyboardEvent> = {
	key: '1',
	keyCode: 49,
	ctrlKey: true,
	altKey: true,
	shiftKey: false,
	metaKey: false,
};

describe('the `keymap` option', () => {
	it('ships `Mod-Alt-1` as a level-2 heading without one', () => {
		const editor = new Editor({ content: textDoc('title') });
		expect(press(editor, MOD_ALT_1)).toBe(true);
		expect(editor.doc.content?.[0].attrs?.level).toBe(2);
		editor.destroy();
	});

	it('lets an app replace a shipped binding', () => {
		const editor = new Editor({
			content: textDoc('title'),
			keymap: ({ schema }) => ({
				'Mod-Alt-1': toggleBlockType(schema.nodes.heading, { level: 1 }),
			}),
		});
		expect(press(editor, MOD_ALT_1)).toBe(true);
		expect(editor.doc.content?.[0].attrs?.level).toBe(1);
		editor.destroy();
	});

	it('leaves every binding it does not name alone', () => {
		const editor = new Editor({
			content: textDoc('title'),
			keymap: ({ schema }) => ({
				'Mod-Alt-1': toggleBlockType(schema.nodes.heading, { level: 1 }),
			}),
		});
		// `Mod-b`, which the app said nothing about
		expect(
			press(editor, {
				key: 'b',
				keyCode: 66,
				ctrlKey: true,
				altKey: false,
				shiftKey: false,
				metaKey: false,
			}),
		).toBe(true);
		expect(editor.state.storedMarks?.some((mark) => mark.type.name === 'bold')).toBe(
			true,
		);
		editor.destroy();
	});

	/**
	 * The other half of the seam. A binding an app replaces is only half the
	 * story: the app's palette has to be able to *run* what the shipped key
	 * runs, and `toggleBlockType` cannot be a blockquote's toggle because
	 * `setBlockType` throws on a node that is not a textblock. Named one by one
	 * so that dropping one from the barrel is a failing test rather than a
	 * host's build error.
	 */
	it('exports the commands a host palette has to reach', async () => {
		const api = await import('./index.js');
		for (const name of [
			'moveBlock',
			'duplicateBlock',
			'insertLine',
			'deleteLine',
			'wrapIn',
			'lift',
		] as const) {
			expect(api[name], name).toBeTypeOf('function');
		}
	});
});
