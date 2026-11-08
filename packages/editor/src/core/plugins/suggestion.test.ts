import { describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { Editor } from '../editor.svelte.js';
import type { SuggestionContext, SuggestionHandler } from '../../types/index.js';

/**
 * The trigger plugin, with a trigger longer than one character (ED-04).
 *
 * A `[[` wikilink menu is the case the original single-character reading could
 * not express: the second `[` is preceded by the first, so the word-start rule
 * refused it, and the query and the trigger position were both computed as if
 * the trigger were one character wide — which put the replace range one
 * character into the trigger and left a stray `[` behind on every insert.
 *
 * Everything here drives the real plugin: `handleTextInput` for typing and the
 * plugin's own `view` hook for the open/update/close notifications, because a
 * handler that is only called by the test is not evidence of anything.
 */

function mount(): { editor: Editor; view: EditorView } {
	const editor = new Editor({});
	const element = document.createElement('div');
	document.body.appendChild(element);
	editor.mount(element);
	return { editor, view: editor.view! };
}

/** Types `text` at the selection, one character at a time, as a user does. */
function type(view: EditorView, text: string): void {
	for (const character of text) {
		const { from, to } = view.state.selection;
		const insert = () => view.state.tr.insertText(character, from, to);
		const handled = view.someProp('handleTextInput', (f) =>
			f(view, from, to, character, insert),
		);
		if (!handled) view.dispatch(insert());
	}
}

interface Recorder {
	handler: SuggestionHandler;
	events: string[];
	last: SuggestionContext | null;
	keys: KeyboardEvent[];
}

function recorder(): Recorder {
	const state: Recorder = {
		events: [],
		last: null,
		keys: [],
		handler: {
			open(ctx) {
				state.events.push('open');
				state.last = ctx;
			},
			update(ctx) {
				state.events.push('update');
				state.last = ctx;
			},
			close() {
				state.events.push('close');
				state.last = null;
			},
			keydown(event) {
				state.keys.push(event);
				return true;
			},
		},
	};
	return state;
}

describe('a multi-character trigger', () => {
	it('opens on the whole trigger and not before it', () => {
		const { editor, view } = mount();
		const seen = recorder();
		editor.suggest('[[', () => seen.handler, { word_start: false });

		type(view, '[');
		expect(seen.events).toEqual([]);
		type(view, '[');
		expect(seen.events).toEqual(['open']);
		expect(seen.last?.query).toBe('');
	});

	it('takes the query from after the trigger, not from inside it', () => {
		const { editor, view } = mount();
		const seen = recorder();
		editor.suggest('[[', () => seen.handler, { word_start: false });

		type(view, '[[Light');
		expect(seen.last?.query).toBe('Light');
	});

	it('covers the whole trigger with the replace range', () => {
		const { editor, view } = mount();
		const seen = recorder();
		editor.suggest('[[', () => seen.handler, { word_start: false });

		type(view, 'see [[Light');
		const range = seen.last!.range;
		// The range has to start at the first `[`, or accepting a suggestion
		// leaves the other one in the paragraph.
		expect(view.state.doc.textBetween(range.from, range.to)).toBe('[[Light');
	});

	it('still opens mid-word when the word-start rule is off', () => {
		const { editor, view } = mount();
		const seen = recorder();
		editor.suggest('[[', () => seen.handler, { word_start: false });

		type(view, '(see [[Light');
		expect(seen.events[0]).toBe('open');
		expect(seen.last?.query).toBe('Light');
	});

	it('keeps the word-start rule when it is not turned off', () => {
		const { editor, view } = mount();
		const seen = recorder();
		editor.suggest('[[', () => seen.handler);

		type(view, 'a[[Light');
		expect(seen.events).toEqual([]);
	});

	it('routes keys to the handler while it is open', () => {
		const { editor, view } = mount();
		const seen = recorder();
		editor.suggest('[[', () => seen.handler, { word_start: false });

		type(view, '[[Light');
		const event = new KeyboardEvent('keydown', { key: 'ArrowDown' });
		const handled = view.someProp('handleKeyDown', (f) => f(view, event));
		expect(handled).toBe(true);
		expect(seen.keys.map((key) => key.key)).toEqual(['ArrowDown']);
	});

	it('closes when the trigger is taken apart', () => {
		const { editor, view } = mount();
		const seen = recorder();
		editor.suggest('[[', () => seen.handler, { word_start: false });

		type(view, '[[Light');
		const end = view.state.selection.from;
		// Delete back through the `Light` and one of the brackets.
		view.dispatch(view.state.tr.delete(end - 6, end));
		expect(seen.events.at(-1)).toBe('close');
	});
});

describe('code is not prose', () => {
	it('stays shut inside an inline code span', () => {
		const { editor, view } = mount();
		const seen = recorder();
		editor.suggest('[[', () => seen.handler, { word_start: false });

		view.dispatch(view.state.tr.addStoredMark(editor.schema.marks.code!.create()));
		type(view, '[[Light');
		// The menu inserts a node on accept. Opening here would replace the code
		// span's own text with one, which is the code the user was quoting, gone.
		expect(seen.events).toEqual([]);
		expect(view.state.doc.textContent).toBe('[[Light');
	});

	it('stays shut inside a code span for a single-character trigger too', () => {
		const { editor, view } = mount();
		const seen = recorder();
		editor.suggest('/', () => seen.handler);

		view.dispatch(view.state.tr.addStoredMark(editor.schema.marks.code!.create()));
		type(view, '/head');
		expect(seen.events).toEqual([]);
	});

	it('opens again once the code mark is off', () => {
		const { editor, view } = mount();
		const seen = recorder();
		editor.suggest('[[', () => seen.handler, { word_start: false });

		view.dispatch(view.state.tr.addStoredMark(editor.schema.marks.code!.create()));
		type(view, 'x ');
		view.dispatch(view.state.tr.removeStoredMark(editor.schema.marks.code!));
		type(view, '[[Light');
		expect(seen.events[0]).toBe('open');
		expect(seen.last?.query).toBe('Light');
	});
});

describe('the trigger the user backed out of', () => {
	it('leaves the literal text behind on Escape and does not come back', () => {
		const { editor, view } = mount();
		const seen = recorder();
		editor.suggest('[[', () => seen.handler, { word_start: false });

		type(view, '[[Light');
		const escape = new KeyboardEvent('keydown', { key: 'Escape' });
		expect(view.someProp('handleKeyDown', (f) => f(view, escape))).toBe(true);
		expect(seen.events.at(-1)).toBe('close');
		// Escape is a dismissal, not an undo: what was typed is still typed.
		expect(view.state.doc.textContent).toBe('[[Light');

		type(view, 'h');
		expect(seen.events.at(-1)).toBe('close');
	});

	it('never sees Escape itself — the plugin owns it', () => {
		const { editor, view } = mount();
		const seen = recorder();
		editor.suggest('[[', () => seen.handler, { word_start: false });

		type(view, '[[Light');
		view.someProp('handleKeyDown', (f) =>
			f(view, new KeyboardEvent('keydown', { key: 'Escape' })),
		);
		expect(seen.keys.map((key) => key.key)).toEqual([]);
	});
});

describe('the query the user closed by hand', () => {
	it('carries the closing brackets rather than closing the menu', () => {
		const { editor, view } = mount();
		const seen = recorder();
		editor.suggest('[[', () => seen.handler, { word_start: false });

		type(view, '[[Light]]');
		// The owning component is what decides `]]` means "insert now"; the
		// plugin's job is only to keep reporting what was typed after the
		// trigger, brackets included.
		expect(seen.last?.query).toBe('Light]]');
		const range = seen.last!.range;
		expect(view.state.doc.textBetween(range.from, range.to)).toBe('[[Light]]');
	});
});

describe('code is not prose', () => {
	/** Types `text` with the `code` mark applied. */
	function typeCode(view: EditorView, text: string): void {
		const code = view.state.schema.marks.code;
		const { from } = view.state.selection;
		view.dispatch(view.state.tr.insertText(text, from).addMark(from, from + text.length, code.create()));
		// Land the caret at the end, inside the mark.
		const at = from + text.length;
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
	}

	it('stays shut inside an inline code span', () => {
		const { editor, view } = mount();
		const seen = recorder();
		editor.suggest('[[', () => seen.handler, { word_start: false });

		typeCode(view, 'const a = [[x');
		// A menu that opened here would, on accept, replace the code the writer
		// was quoting with a wikilink node.
		expect(seen.events).toEqual([]);
	});

	it('stays shut for the slash menu inside code too', () => {
		const { editor, view } = mount();
		const seen = recorder();
		editor.suggest('/', () => seen.handler);

		typeCode(view, '/usr');
		expect(seen.events).toEqual([]);
	});

	it('opens again once the caret is out of the mark', () => {
		const { editor, view } = mount();
		const seen = recorder();
		editor.suggest('[[', () => seen.handler, { word_start: false });

		typeCode(view, 'code');
		// What pressing the right-arrow out of a code span does: text typed
		// straight after one inherits the mark until the stored marks are
		// cleared, and the guard reads `storedMarks` before `$from.marks()`
		// precisely so it follows that intent rather than the character behind.
		view.dispatch(view.state.tr.setStoredMarks([]));
		type(view, ' [[Light');
		expect(seen.events[0]).toBe('open');
		expect(seen.last?.query).toBe('Light');
	});
});

describe('a single-character trigger is unchanged', () => {
	it('opens at a word start and carries its query', () => {
		const { editor, view } = mount();
		const seen = recorder();
		editor.suggest('/', () => seen.handler);

		type(view, '/head');
		expect(seen.events[0]).toBe('open');
		expect(seen.last?.query).toBe('head');
		const range = seen.last!.range;
		expect(view.state.doc.textBetween(range.from, range.to)).toBe('/head');
	});

	it('stays shut in the middle of a word', () => {
		const { editor, view } = mount();
		const seen = recorder();
		editor.suggest('/', () => seen.handler);

		type(view, 'and/or');
		expect(seen.events).toEqual([]);
	});
});
