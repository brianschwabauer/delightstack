import { describe, expect, it, vi } from 'vitest';
import { Editor } from '../editor.svelte.js';
import type { JSONContent } from '../../types/index.js';
import {
	TERM_ALWAYS_CLASS,
	TERM_CLASS,
	termBlockText,
	termDecorations,
	termDecorationsKey,
	termDecorationsStateOf,
	termsInDocument,
	setTermDecorations,
	type TermDecorationsOptions,
	type TermMatch,
} from './term-decorations.js';

function paragraph(text: string): JSONContent {
	return { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] };
}

function doc(...content: JSONContent[]): JSONContent {
	return { type: 'doc', content };
}

/**
 * A literal whole-word matcher over a fixed term list — the kind of `match` a
 * glossary host would write. Case-sensitive, no possessives: those rules are
 * the host's business, which is the narrowing under test.
 */
function literalMatcher(terms: Record<string, string>): (text: string) => TermMatch[] {
	return (text) => {
		const found: TermMatch[] = [];
		for (const [term_id, term] of Object.entries(terms)) {
			let at = text.indexOf(term);
			while (at !== -1) {
				const before = text[at - 1] ?? ' ';
				const after = text[at + term.length] ?? ' ';
				if (!/[\p{L}\p{N}_]/u.test(before) && !/[\p{L}\p{N}_]/u.test(after)) {
					found.push({ term_id, from: at, to: at + term.length });
				}
				at = text.indexOf(term, at + 1);
			}
		}
		return found.sort((a, b) => a.from - b.from);
	};
}

function editorWith(content: JSONContent, options: TermDecorationsOptions): Editor {
	return new Editor({ content, plugins: () => [termDecorations(options)] });
}

/** The decorated ranges as the text they cover, for legible assertions. */
function decoratedText(editor: Editor): string[] {
	return termsInDocument(editor.state).map((term) =>
		editor.state.doc.textBetween(term.from, term.to),
	);
}

describe('termBlockText', () => {
	it('is exactly the block content size, placeholders included', () => {
		const editor = editorWith(
			doc({
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'before' },
					{ type: 'hard_break' },
					{ type: 'text', text: 'after' },
				],
			}),
			{ match: () => [] },
		);
		const block = editor.state.doc.child(0);
		const text = termBlockText(block);
		expect(text).toBe('before￼after');
		expect(text.length).toBe(block.content.size);
	});

	it('masks skip-marked text to spaces of the same length', () => {
		const editor = editorWith(
			doc({
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'call ' },
					{ type: 'text', text: 'Mira()', marks: [{ type: 'code' }] },
				],
			}),
			{ match: () => [] },
		);
		expect(termBlockText(editor.state.doc.child(0))).toBe('call       ');
	});
});

describe('termDecorations', () => {
	it('decorates matches at the positions the offsets name', () => {
		const editor = editorWith(
			doc(paragraph('Mira spoke to Elias.'), paragraph('Elias listened.')),
			{ match: literalMatcher({ e1: 'Mira', e2: 'Elias' }) },
		);
		const terms = termsInDocument(editor.state);
		expect(decoratedText(editor)).toEqual(['Mira', 'Elias', 'Elias']);
		expect(terms.map((term) => term.term_id)).toEqual(['e1', 'e2', 'e2']);
		// Paragraph 1 opens at 0, text starts at 1: `Mira` is [1, 5).
		expect(terms[0]).toMatchObject({ from: 1, to: 5 });
	});

	it('hands the matcher placeholder-aligned text so atoms stay boundaries', () => {
		const handed: string[] = [];
		const editor = editorWith(
			doc({
				type: 'paragraph',
				content: [
					{ type: 'text', text: 'Mira' },
					{ type: 'hard_break' },
					{ type: 'text', text: 'Mira' },
				],
			}),
			{
				match: (text) => {
					handed.push(text);
					return literalMatcher({ e1: 'Mira' })(text);
				},
			},
		);
		expect(handed).toEqual(['Mira￼Mira']);
		expect(decoratedText(editor)).toEqual(['Mira', 'Mira']);
	});

	it('skips code blocks and code-marked text', () => {
		const editor = editorWith(
			doc(
				paragraph('Mira outside.'),
				{ type: 'code_block', content: [{ type: 'text', text: 'Mira inside' }] },
				{
					type: 'paragraph',
					content: [{ type: 'text', text: 'Mira', marks: [{ type: 'code' }] }],
				},
			),
			{ match: literalMatcher({ e1: 'Mira' }) },
		);
		expect(decoratedText(editor)).toEqual(['Mira']);
	});

	it('drops matches with out-of-range or inverted offsets', () => {
		const editor = editorWith(doc(paragraph('short')), {
			match: () => [
				{ term_id: 'bad1', from: -1, to: 3 },
				{ term_id: 'bad2', from: 2, to: 99 },
				{ term_id: 'bad3', from: 3, to: 3 },
				{ term_id: 'good', from: 0, to: 5 },
			],
		});
		expect(termsInDocument(editor.state).map((term) => term.term_id)).toEqual(['good']);
	});

	it('recomputes only the edited block, and maps the rest', () => {
		const calls: string[] = [];
		const match = (text: string) => {
			calls.push(text);
			return literalMatcher({ e1: 'Mira' })(text);
		};
		const editor = editorWith(doc(paragraph('Mira one.'), paragraph('Mira two.')), {
			match,
		});
		// The first edit also carries `blockIds`' appended attr assignment, which
		// legitimately touches every block once; the steady state is what the
		// claim is about, so measure the second edit.
		editor.dispatch(editor.state.tr.insertText('X', 20));
		calls.length = 0;
		// Insert inside the second paragraph, clear of the match itself.
		editor.dispatch(editor.state.tr.insertText('Y', 20));
		expect(calls).toEqual(['Mira twoYX.']);
		expect(decoratedText(editor)).toEqual(['Mira', 'Mira']);
	});

	it('reaches the same decorations whatever path the edits took', () => {
		const options = { match: literalMatcher({ e1: 'Mira Storm' }) };
		// Path A: the name typed in one go.
		const one_go = editorWith(doc(paragraph('Enter Mira Storm now.')), options);
		// Path B: typed around, split across transactions.
		const stepwise = editorWith(doc(paragraph('Enter  now.')), options);
		stepwise.dispatch(stepwise.state.tr.insertText('Mira', 7));
		stepwise.dispatch(stepwise.state.tr.insertText(' Storm', 11));
		expect(termsInDocument(stepwise.state)).toEqual(termsInDocument(one_go.state));
	});

	it('drops a decoration when its text is marked as code, and restores it back', () => {
		// Mark steps have empty step maps; a range walk over the maps alone
		// would leave a stale, clickable decoration on masked text.
		const editor = editorWith(doc(paragraph('so Mira left.')), {
			match: literalMatcher({ e1: 'Mira' }),
		});
		expect(decoratedText(editor)).toEqual(['Mira']);
		const code = editor.state.schema.marks.code.create();
		editor.dispatch(editor.state.tr.addMark(4, 8, code));
		expect(decoratedText(editor)).toEqual([]);
		editor.dispatch(editor.state.tr.removeMark(4, 8, code.type));
		expect(decoratedText(editor)).toEqual(['Mira']);
	});

	it('re-matches a block touched by an attr-only step', () => {
		const calls: string[] = [];
		// Ids pre-assigned so `blockIds` appends nothing and the steady state
		// is what gets measured.
		const editor = editorWith(
			doc(
				{
					type: 'paragraph',
					attrs: { block_id: 'a' },
					content: [{ type: 'text', text: 'Mira one.' }],
				},
				{
					type: 'paragraph',
					attrs: { block_id: 'b' },
					content: [{ type: 'text', text: 'two.' }],
				},
			),
			{
				match: (text) => {
					calls.push(text);
					return literalMatcher({ e1: 'Mira' })(text);
				},
			},
		);
		calls.length = 0;
		// `setNodeAttribute` is an `AttrStep` — empty map, a bare `pos`.
		editor.dispatch(editor.state.tr.setNodeAttribute(0, 'block_id', 'pinned'));
		expect(calls).toEqual(['Mira one.']);
		expect(decoratedText(editor)).toEqual(['Mira']);
	});

	it('drops a decoration when its text stops matching', () => {
		const editor = editorWith(doc(paragraph('Mira left.')), {
			match: literalMatcher({ e1: 'Mira' }),
		});
		expect(decoratedText(editor)).toEqual(['Mira']);
		editor.dispatch(editor.state.tr.insertText('nda', 5));
		expect(decoratedText(editor)).toEqual([]);
	});

	it('re-matches the whole document on a refresh meta', () => {
		const terms: Record<string, string> = {};
		const editor = editorWith(doc(paragraph('Mira and Elias.')), {
			match: (text) => literalMatcher(terms)(text),
		});
		expect(decoratedText(editor)).toEqual([]);
		terms.e2 = 'Elias';
		editor.dispatch(editor.state.tr.setMeta(termDecorationsKey, { refresh: true }));
		expect(decoratedText(editor)).toEqual(['Elias']);
	});

	it('keeps decorations invisible by contract: only a class and the term id', () => {
		const editor = editorWith(doc(paragraph('Mira.')), {
			match: literalMatcher({ e1: 'Mira' }),
		});
		const decoration = termDecorationsStateOf(editor.state)?.decorations.find()[0];
		const spec = decoration?.spec as { term_id?: string };
		expect(spec.term_id).toBe('e1');
	});

	it('tracks always_on through the meta', () => {
		const editor = editorWith(doc(paragraph('Mira.')), {
			match: () => [],
			always_on: false,
		});
		expect(termDecorationsStateOf(editor.state)?.always_on).toBe(false);
		editor.dispatch(editor.state.tr.setMeta(termDecorationsKey, { always_on: true }));
		expect(termDecorationsStateOf(editor.state)?.always_on).toBe(true);
	});

	it('uses the host class name when given one', () => {
		const editor = editorWith(doc(paragraph('Mira.')), {
			match: literalMatcher({ e1: 'Mira' }),
			class_name: 'glossary-term',
		});
		const decoration = termDecorationsStateOf(editor.state)?.decorations.find()[0];
		// The rendered attrs live on the decoration's private type; go through
		// the DOM-facing shape instead of reaching into internals.
		expect(JSON.stringify(decoration)).toContain('glossary-term');
	});

	it('activates the narrowest overlapping term on a modifier click', () => {
		const on_activate = vi.fn((_term_id: string) => true);
		const editor = editorWith(doc(paragraph('Elias Warwick spoke.')), {
			match: () => [
				{ term_id: 'pair', from: 0, to: 13 },
				{ term_id: 'single', from: 0, to: 5 },
			],
			onActivate: on_activate,
		});
		editor.mount(document.createElement('div'));
		const view = editor.view;
		if (!view) throw new Error('no view after mount');
		const event = new MouseEvent('click', { metaKey: true, ctrlKey: true });
		// Drive the installed plugin's own prop through the view's plugin list.
		const plugin = view.state.plugins.find(
			(candidate) => candidate.spec.key === termDecorationsKey,
		);
		if (!plugin) throw new Error('plugin not installed');
		const click = plugin.props.handleClick;
		expect(click).toBeTypeOf('function');
		const consumed = click?.call(plugin, view, 3, event);
		expect(consumed).toBe(true);
		expect(on_activate).toHaveBeenCalledTimes(1);
		expect(on_activate.mock.calls[0][0]).toBe('single');
		editor.destroy();
	});

	it('ignores a plain click', () => {
		const on_activate = vi.fn();
		const editor = editorWith(doc(paragraph('Elias spoke.')), {
			match: literalMatcher({ e1: 'Elias' }),
			onActivate: on_activate,
		});
		editor.mount(document.createElement('div'));
		const view = editor.view;
		if (!view) throw new Error('no view after mount');
		const plugin = view.state.plugins.find(
			(candidate) => candidate.spec.key === termDecorationsKey,
		);
		const event = new MouseEvent('click');
		const consumed = plugin?.props.handleClick?.call(plugin, view, 3, event);
		expect(consumed).toBe(false);
		expect(on_activate).not.toHaveBeenCalled();
		editor.destroy();
	});

	it('applies and clears the always class on the mounted root', () => {
		const editor = editorWith(doc(paragraph('Mira.')), {
			match: () => [],
			always_on: true,
		});
		editor.mount(document.createElement('div'));
		const view = editor.view;
		if (!view) throw new Error('no view after mount');
		expect(view.dom.classList.contains(TERM_ALWAYS_CLASS)).toBe(true);
		setTermDecorations(view, { always_on: false });
		expect(view.dom.classList.contains(TERM_ALWAYS_CLASS)).toBe(false);
		editor.destroy();
	});

	it('carries the default class every decoration is styled by', () => {
		const editor = editorWith(doc(paragraph('Mira.')), {
			match: literalMatcher({ e1: 'Mira' }),
		});
		const decoration = termDecorationsStateOf(editor.state)?.decorations.find()[0];
		expect(JSON.stringify(decoration)).toContain(TERM_CLASS);
	});
});
