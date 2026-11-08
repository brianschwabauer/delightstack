import { describe, expect, it, vi } from 'vitest';
import { Editor } from '../editor.svelte.js';
import type { JSONContent } from '../../types/index.js';
import {
	resolveSuggestions,
	suggestionCommands,
	suggestionDecorations,
	suggestionDecorationsKey,
	suggestionsInDocument,
	type SuggestionEdit,
} from './tracked-changes.js';

/**
 * ED-08. Tracked-changes decorations for suggestions the host owns.
 *
 * Everything here drives the real plugin through a real `Editor` — the
 * decorations are read out of `props.decorations` the way ProseMirror reads
 * them, not out of a builder called by the test, because a decoration the view
 * never asked for is not evidence that anything renders.
 */

/** `paragraphs('a', 'b')` → a two-paragraph document. */
function paragraphs(...texts: string[]): JSONContent {
	return {
		type: 'doc',
		content: texts.map((text) => ({
			type: 'paragraph',
			content: text ? [{ type: 'text', text }] : undefined,
		})),
	};
}

function editorWith(text: string, options: Parameters<typeof suggestionDecorations>[0]) {
	const editor = new Editor({ content: paragraphs(text) });
	const element = document.createElement('div');
	document.body.append(element);
	editor.mount(element);
	editor.registerPlugins([suggestionDecorations(options)]);
	return editor;
}

/** The decorations the plugin currently contributes, in document order. */
function decorationsOf(editor: Editor) {
	const state = suggestionDecorationsKey.getState(editor.state);
	return state ? state.decorations.find() : [];
}

const SENTENCE = 'He slowly began to walk toward the lighthouse.';

function edit(overrides: Partial<SuggestionEdit> = {}): SuggestionEdit {
	return {
		id: 's1',
		find: 'He slowly began to walk toward',
		replace: 'He walked toward',
		...overrides,
	};
}


/*
 * The ambiguous case, which is the one the review argued about.
 *
 * `edit_document` already refuses a `find` that matches twice, and refuses it
 * loudly, with the candidates listed — because guessing which one was meant is
 * how prose gets quietly mangled. A suggestion is the same sentence proposed
 * through a slower door, so it gets the same answer rather than a softer one:
 * resolving to the first hit would strike through a sentence in document order
 * and call that a decision.
 *
 * The difference from `edit_document` is only in *when* it is said. A tool call
 * fails at the call; a suggestion has no caller left to fail at by the time the
 * editor opens, so the refusal is a state — `ambiguous` — and it shows up in
 * the panel beside the missing ones.
 */
describe('a suggestion nothing distinguishes', () => {
	it('goes stale rather than picking the first of two identical matches', () => {
		const editor = new Editor({
			content: paragraphs('He walked toward the door. He walked toward the sea.'),
		});
		const { resolved, stale, stale_details } = resolveSuggestions(editor.state.doc, [
			edit({ find: 'He walked toward', replace: 'He went toward' }),
		]);
		expect(resolved).toEqual([]);
		expect(stale).toHaveLength(1);
		expect(stale_details[0].reason).toBe('ambiguous');
	});

	it('is a different answer from the text having gone', () => {
		const editor = new Editor({ content: paragraphs('Nothing like it here.') });
		const { stale_details } = resolveSuggestions(editor.state.doc, [edit()]);
		expect(stale_details[0].reason).toBe('missing');
	});

	it('resolves once a suffix tells the copies apart', () => {
		const editor = new Editor({
			content: paragraphs('He walked toward the door. He walked toward the sea.'),
		});
		const { resolved, stale } = resolveSuggestions(editor.state.doc, [
			edit({
				find: 'He walked toward',
				replace: 'He went toward',
				suffix: ' the sea.',
			}),
		]);
		expect(stale).toEqual([]);
		expect(resolved).toHaveLength(1);
		expect(resolved[0].from).toBe(1 + 'He walked toward the door. '.length);
	});

	it('two copies in different blocks are no less ambiguous than two in one', () => {
		const editor = new Editor({
			content: paragraphs('He walked toward.', 'He walked toward.'),
		});
		const { resolved, stale_details } = resolveSuggestions(editor.state.doc, [
			edit({ find: 'He walked toward', replace: 'He went' }),
		]);
		expect(resolved).toEqual([]);
		expect(stale_details[0].reason).toBe('ambiguous');
	});

	it('a recorded block picks its own copy out of the document', () => {
		// `block_id` is worth ten and context is worth two, so naming the block
		// is the disambiguation the tool tells an agent to reach for — and the
		// search stops there, so the identical copy elsewhere is never a tie.
		const editor = new Editor({
			content: {
				type: 'doc',
				content: ['He walked toward.', 'He walked toward.'].map((text, index) => ({
					type: 'paragraph',
					attrs: { block_id: `b${index}` },
					content: [{ type: 'text', text }],
				})),
			},
		});
		const { resolved, stale_details } = resolveSuggestions(editor.state.doc, [
			edit({ find: 'He walked toward', replace: 'He went', block_id: 'b1' }),
		]);
		expect(stale_details).toEqual([]);
		expect(resolved).toHaveLength(1);
		expect(resolved[0].from).toBeGreaterThan('He walked toward.'.length);
	});

	it('tells the host which way each one went', () => {
		const on_stale = vi.fn();
		const editor = editorWith('one two three', {
			source: () => [
				edit({ id: 'gone', find: 'nowhere', replace: 'x' }),
				edit({ id: 'twice', find: 'e', replace: 'E' }),
			],
			onStale: on_stale,
		});
		const [, details] = on_stale.mock.calls.at(-1)!;
		expect(details.map((entry: { suggestion: { id: string }; reason: string }) => [
			entry.suggestion.id,
			entry.reason,
		])).toEqual([
			['gone', 'missing'],
			['twice', 'ambiguous'],
		]);
		editor.destroy();
	});
});

describe('resolving a suggestion against the document', () => {
	it('finds the range the proposal is about', () => {
		const editor = new Editor({ content: paragraphs(SENTENCE) });
		const { resolved, stale } = resolveSuggestions(editor.state.doc, [edit()]);
		expect(stale).toEqual([]);
		expect(resolved).toHaveLength(1);
		// `<p>` opens at 0, so the first character of the sentence is at 1.
		expect(resolved[0].from).toBe(1);
		expect(resolved[0].to).toBe(1 + 'He slowly began to walk toward'.length);
		expect(editor.state.doc.textBetween(resolved[0].from, resolved[0].to)).toBe(
			'He slowly began to walk toward',
		);
	});

	it('classifies the three kinds', () => {
		const editor = new Editor({ content: paragraphs('one two three') });
		const { resolved } = resolveSuggestions(editor.state.doc, [
			edit({ id: 'r', find: 'two', replace: 'TWO' }),
			edit({ id: 'd', find: 'three', replace: '' }),
			edit({ id: 'i', find: '', replace: ' four', prefix: 'three' }),
		]);
		const kinds = Object.fromEntries(resolved.map((r) => [r.suggestion.id, r.kind]));
		expect(kinds).toEqual({ r: 'replace', d: 'delete', i: 'insert' });
	});

	it('uses the prefix to pick between identical occurrences', () => {
		const editor = new Editor({ content: paragraphs('the cat sat, the cat ran') });
		const { resolved } = resolveSuggestions(editor.state.doc, [
			edit({ find: 'the cat', replace: 'a dog', prefix: 'sat, ' }),
		]);
		// The second occurrence, not the first: the prefix says so.
		expect(resolved[0].from).toBe(1 + 'the cat sat, '.length);
	});

	it('anchors a pure insertion after its prefix', () => {
		const editor = new Editor({ content: paragraphs('one three') });
		const { resolved } = resolveSuggestions(editor.state.doc, [
			edit({ find: '', replace: ' two', prefix: 'one' }),
		]);
		expect(resolved[0].from).toBe(resolved[0].to);
		expect(resolved[0].from).toBe(1 + 'one'.length);
	});

	it('prefers the recorded block over a better-scoring hit elsewhere', () => {
		// The ids are declared rather than left to the `blockIds` plugin, because
		// what is under test is the resolver's use of them, not their assignment.
		const editor = new Editor({
			content: {
				type: 'doc',
				content: ['first', 'second'].map((block_id) => ({
					type: 'paragraph',
					attrs: { block_id },
					content: [{ type: 'text', text: 'the cat sat' }],
				})),
			},
		});
		const { resolved } = resolveSuggestions(editor.state.doc, [
			edit({ find: 'cat', replace: 'dog', block_id: 'second' }),
		]);
		// The *second* paragraph's `cat`, not the first's, even though both match
		// the text and the context equally well. `the cat sat` is 11 characters
		// and the second paragraph opens after it.
		expect(resolved[0].from).toBeGreaterThan(1 + 'the cat sat'.length);
		expect(editor.state.doc.resolve(resolved[0].from).parent.attrs.block_id).toBe('second');
	});

	it('reports a suggestion whose text is gone as stale rather than dropping it', () => {
		const editor = new Editor({ content: paragraphs('nothing like it here') });
		const { resolved, stale } = resolveSuggestions(editor.state.doc, [edit()]);
		expect(resolved).toEqual([]);
		expect(stale.map((s) => s.id)).toEqual(['s1']);
	});
});

describe('the decorations the plugin draws', () => {
	it('strikes the found range and adds a widget for text that is not there', () => {
		const editor = editorWith(SENTENCE, { source: () => [edit()] });
		const found = decorationsOf(editor);
		// One inline for the deletion, one widget for the insertion, one chip.
		expect(found).toHaveLength(3);
		const inline = found[0];
		expect(inline.from).toBe(1);
		expect(inline.to).toBe(1 + 'He slowly began to walk toward'.length);
		// The proposed text is nowhere in the document — that is the point.
		expect(editor.state.doc.textContent).not.toContain('He walked toward');
		editor.destroy();
	});

	it('draws no insertion widget for a pure deletion', () => {
		const editor = editorWith('one two three', {
			source: () => [edit({ find: ' two', replace: '' })],
			chips: false,
		});
		expect(decorationsOf(editor)).toHaveLength(1);
		editor.destroy();
	});

	it('follows the sentence when the text around it is edited', () => {
		const editor = editorWith(SENTENCE, { source: () => [edit()], chips: false });
		// The strike over `find`, and the widget carrying `replace`.
		expect(decorationsOf(editor)).toHaveLength(2);
		expect(decorationsOf(editor)[0].from).toBe(1);
		// Type a word in front of it. The anchor is content, not a position, so
		// the decoration re-resolves to the same text further along.
		editor.view!.dispatch(editor.state.tr.insertText('Meanwhile. ', 1));
		const moved = decorationsOf(editor);
		expect(moved).toHaveLength(2);
		expect(moved[0].from).toBe(1 + 'Meanwhile. '.length);
		expect(editor.state.doc.textBetween(moved[0].from, moved[0].to)).toBe(
			'He slowly began to walk toward',
		);
		editor.destroy();
	});

	it('drops the decoration and reports the suggestion when its range is deleted', () => {
		const onStale = vi.fn();
		const editor = editorWith(SENTENCE, {
			source: () => [edit()],
			onStale,
			chips: false,
		});
		expect(decorationsOf(editor)).toHaveLength(2);
		// Delete the sentence the suggestion was about.
		editor.view!.dispatch(
			editor.state.tr.delete(1, 1 + 'He slowly began to walk toward'.length),
		);
		expect(decorationsOf(editor)).toHaveLength(0);
		expect(onStale).toHaveBeenCalled();
		expect(onStale.mock.calls.at(-1)![0].map((s: SuggestionEdit) => s.id)).toEqual([
			's1',
		]);
		editor.destroy();
	});

	it('reports a stale list once, not once per keystroke', () => {
		const onStale = vi.fn();
		const editor = editorWith('unrelated text', {
			source: () => [edit()],
			onStale,
			chips: false,
		});
		const after_init = onStale.mock.calls.length;
		editor.view!.dispatch(editor.state.tr.insertText('a', 1));
		editor.view!.dispatch(editor.state.tr.insertText('b', 1));
		// Still stale, still the same one — the host is not told twice more.
		expect(onStale.mock.calls.length).toBe(after_init);
		editor.destroy();
	});
});

describe('accept and reject', () => {
	it('the chip buttons call back with the resolved range', () => {
		const onAccept = vi.fn();
		const onReject = vi.fn();
		const editor = editorWith(SENTENCE, { source: () => [edit()], onAccept, onReject });
		const chip = editor.view!.dom.querySelector('.ds-suggestion-chip');
		expect(chip).not.toBeNull();
		const accept = chip!.querySelector('.ds-suggestion-accept') as HTMLButtonElement;
		const reject = chip!.querySelector('.ds-suggestion-reject') as HTMLButtonElement;

		accept.click();
		expect(onAccept).toHaveBeenCalledTimes(1);
		expect(onAccept.mock.calls[0][0].id).toBe('s1');
		expect(onAccept.mock.calls[0][1].from).toBe(1);
		expect(onAccept.mock.calls[0][1].to).toBe(
			1 + 'He slowly began to walk toward'.length,
		);

		reject.click();
		expect(onReject).toHaveBeenCalledTimes(1);
		editor.destroy();
	});

	it('the chip is a pair of real buttons, so the keyboard already works', () => {
		const editor = editorWith(SENTENCE, { source: () => [edit()] });
		const buttons = Array.from(
			editor.view!.dom.querySelectorAll<HTMLButtonElement>('.ds-suggestion-chip button'),
		);
		expect(buttons).toHaveLength(2);
		for (const button of buttons) {
			expect(button.tagName).toBe('BUTTON');
			expect(button.type).toBe('button');
			expect(button.getAttribute('aria-label')).toBeTruthy();
		}
		expect(
			editor.view!.dom.querySelector('.ds-suggestion-chip')!.getAttribute('role'),
		).toBe('group');
		editor.destroy();
	});

	it('accepting nothing is a command that reports it did nothing', () => {
		const options = { source: () => [] as SuggestionEdit[] };
		const editor = editorWith(SENTENCE, options);
		const commands = suggestionCommands(options);
		expect(commands.acceptSuggestion(editor.state, undefined, editor.view!)).toBe(false);
		expect(commands.nextSuggestion(editor.state, undefined, editor.view!)).toBe(false);
		editor.destroy();
	});

	it('accept-all runs back to front, because each edit moves the next', () => {
		const onAccept = vi.fn();
		const list = [
			edit({ id: 'a', find: 'one', replace: '1' }),
			edit({ id: 'b', find: 'three', replace: '3' }),
		];
		const options = { source: () => list, onAccept };
		const editor = editorWith('one two three', options);
		const commands = suggestionCommands(options);
		expect(commands.acceptAllSuggestions(editor.state, undefined, editor.view!)).toBe(
			true,
		);
		expect(onAccept.mock.calls.map((call) => call[0].id)).toEqual(['b', 'a']);
		editor.destroy();
	});

	it('next and previous walk the suggestions in document order', () => {
		const list = [
			edit({ id: 'a', find: 'one', replace: '1' }),
			edit({ id: 'b', find: 'three', replace: '3' }),
		];
		const options = { source: () => list };
		const editor = editorWith('one two three', options);
		expect(suggestionsInDocument(editor.state).map((r) => r.suggestion.id)).toEqual([
			'a',
			'b',
		]);
		const commands = suggestionCommands(options);
		commands.nextSuggestion(
			editor.state,
			editor.view!.dispatch.bind(editor.view!),
			editor.view!,
		);
		const focused = suggestionDecorationsKey.getState(editor.state)?.focused;
		expect(focused).toBeTruthy();
		editor.destroy();
	});
});

describe('the source seam', () => {
	it('a subscribing source repaints without a document change', () => {
		let list: SuggestionEdit[] = [];
		let notify: (() => void) | null = null;
		const editor = editorWith(SENTENCE, {
			chips: false,
			source: {
				get: () => list,
				subscribe(on_change) {
					notify = on_change;
					return () => {
						notify = null;
					};
				},
			},
		});
		expect(decorationsOf(editor)).toHaveLength(0);
		list = [edit()];
		expect(notify).not.toBeNull();
		notify!();
		expect(decorationsOf(editor)).toHaveLength(2);
		editor.destroy();
	});
});

/**
 * The cases a review found, each of which was a real failure before the fix.
 * They are here rather than folded into the suites above because what they
 * pin down is *why* the code is shaped the way it is, and a regression in any
 * of them reads as a plausible simplification otherwise.
 */
describe('anchoring the awkward cases', () => {
	it('finds a decomposed proposal in a precomposed document', () => {
		// Explicit escapes, because the two spellings are indistinguishable in a
		// source file and the whole test is about telling them apart.
		const PRECOMPOSED = 'a caf\u00e9 in Vienna'; // é as one code point
		const DECOMPOSED = 'caf\u0065\u0301'; // e + combining acute
		const editor = new Editor({ content: paragraphs(PRECOMPOSED) });
		const { resolved, stale } = resolveSuggestions(editor.state.doc, [
			edit({ find: DECOMPOSED, replace: 'bar' }),
		]);
		expect(stale).toEqual([]);
		// The range is the *document's* four characters, not the needle's five —
		// which is why the match reports its own length instead of `find.length`.
		expect(resolved[0].to - resolved[0].from).toBe(4);
		expect(editor.state.doc.textBetween(resolved[0].from, resolved[0].to)).toBe(
			'caf\u00e9',
		);
	});

	it('finds a precomposed proposal in a decomposed document', () => {
		const editor = new Editor({ content: paragraphs('a caf\u0065\u0301 in Vienna') });
		const { resolved, stale } = resolveSuggestions(editor.state.doc, [
			edit({ find: 'caf\u00e9', replace: 'bar' }),
		]);
		expect(stale).toEqual([]);
		// Five characters in this document: the base letter and its accent.
		expect(resolved[0].to - resolved[0].from).toBe(5);
	});

	it('anchors an insertion at the start of a block from its suffix', () => {
		// Nothing to find and no prefix, because there is no text before it.
		const editor = new Editor({ content: paragraphs('hello world') });
		const { resolved, stale } = resolveSuggestions(editor.state.doc, [
			edit({ find: '', replace: 'Oh, ', prefix: '', suffix: 'hello' }),
		]);
		expect(stale).toEqual([]);
		expect(resolved[0].from).toBe(1);
		expect(resolved[0].to).toBe(1);
		expect(resolved[0].kind).toBe('insert');
	});

	it('anchors a contextless insertion to the block the host named', () => {
		const editor = new Editor({
			content: {
				type: 'doc',
				content: [
					{ type: 'paragraph', attrs: { block_id: 'a' }, content: [{ type: 'text', text: 'first' }] },
					{ type: 'paragraph', attrs: { block_id: 'b' }, content: [{ type: 'text', text: 'second' }] },
				],
			} as JSONContent,
		});
		const { resolved, stale } = resolveSuggestions(editor.state.doc, [
			edit({ find: '', replace: 'x', prefix: '', suffix: '', block_id: 'b' }),
		]);
		expect(stale).toEqual([]);
		// `<p>first</p>` spans 0–7, so the second block's text opens at 8.
		expect(resolved[0].from).toBe(8);
	});

	it('never matches across a block boundary', () => {
		const editor = new Editor({ content: paragraphs('alpha', 'beta') });
		const { resolved, stale } = resolveSuggestions(editor.state.doc, [
			edit({ find: 'alphabeta', replace: 'z' }),
		]);
		expect(resolved).toEqual([]);
		expect(stale).toHaveLength(1);
	});

	it('finds text that spans a mark boundary', () => {
		const editor = new Editor({
			content: {
				type: 'doc',
				content: [
					{
						type: 'paragraph',
						content: [
							{ type: 'text', text: 'a very ' },
							{ type: 'text', marks: [{ type: 'bold' }], text: 'bold' },
							{ type: 'text', text: ' claim' },
						],
					},
				],
			} as JSONContent,
		});
		const { resolved } = resolveSuggestions(editor.state.doc, [
			edit({ find: 'very bold claim', replace: 'wild claim' }),
		]);
		expect(resolved).toHaveLength(1);
		expect(editor.state.doc.textBetween(resolved[0].from, resolved[0].to)).toBe(
			'very bold claim',
		);
	});

	it('follows the block it was recorded against when the block moves', () => {
		const block = (id: string, text: string) => ({
			type: 'paragraph',
			attrs: { block_id: id },
			content: [{ type: 'text', text }],
		});
		const proposal = edit({ find: 'cat', replace: 'dog', block_id: 'b' });
		const before = new Editor({
			content: { type: 'doc', content: [block('a', 'first cat'), block('b', 'second cat')] } as JSONContent,
		});
		const after = new Editor({
			content: { type: 'doc', content: [block('b', 'second cat'), block('a', 'first cat')] } as JSONContent,
		});
		const from_before = resolveSuggestions(before.state.doc, [proposal]).resolved[0];
		const from_after = resolveSuggestions(after.state.doc, [proposal]).resolved[0];
		expect(from_before.from).not.toBe(from_after.from);
		// Both land in `b`, which is the whole point of addressing by block.
		for (const [doc, found] of [
			[before.state.doc, from_before],
			[after.state.doc, from_after],
		] as const) {
			expect(doc.textBetween(found.from - 7, found.to)).toBe('second cat');
		}
	});

	it('stops looking once the recorded block answers', () => {
		// 400 blocks, 60 suggestions, all of them at home. A resolve that
		// scanned the whole document per suggestion did 24,000 block scans;
		// this does 60. The assertion is on the budget rather than the count
		// because the point is that typing stays cheap.
		const content = Array.from({ length: 400 }, (_, i) => ({
			type: 'paragraph',
			attrs: { block_id: `b${i}` },
			content: [{ type: 'text', text: `Block ${i}: ${'lorem ipsum dolor sit amet '.repeat(8)}` }],
		}));
		const editor = new Editor({ content: { type: 'doc', content } as JSONContent });
		const edits = Array.from({ length: 60 }, (_, i) =>
			edit({ id: `s${i}`, block_id: `b${i * 6}`, find: `Block ${i * 6}:`, replace: `Blk:` }),
		);
		expect(resolveSuggestions(editor.state.doc, edits).stale).toEqual([]);
		const started = performance.now();
		for (let round = 0; round < 50; round++) resolveSuggestions(editor.state.doc, edits);
		const per_resolve = (performance.now() - started) / 50;
		// ~1 ms locally, just over 4 on a shared CI runner; the whole-document
		// scan this guards against is hundreds of times slower, so a loose
		// budget still catches it without flaking.
		expect(per_resolve).toBeLessThan(20);
	});
});

describe('the chip is outside the text, not in it', () => {
	it('a keystroke aimed at the accept button never reaches the document', () => {
		// Without `stopEvent` the chip's DOM is inside the contenteditable, so
		// pressing Enter on the button ran the keymap and split the paragraph —
		// the one thing the plugin promises it never does.
		const editor = editorWith(SENTENCE, { source: () => [edit()] });
		const button = document.querySelector<HTMLButtonElement>('.ds-suggestion-accept');
		expect(button).not.toBeNull();
		const before = editor.state.doc.toJSON();
		for (const key of ['Enter', 'Backspace', 'a']) {
			button!.dispatchEvent(
				new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
			);
		}
		expect(editor.state.doc.toJSON()).toEqual(before);
		editor.destroy();
	});

	it('the widgets say they are not a place a selection can be', () => {
		const editor = editorWith(SENTENCE, { source: () => [edit()] });
		const widgets = decorationsOf(editor).filter(
			(decoration) => decoration.from === decoration.to,
		);
		expect(widgets.length).toBeGreaterThan(0);
		for (const widget of widgets) {
			const spec = (widget as unknown as { type: { spec: Record<string, unknown> } }).type
				.spec;
			expect(spec.ignoreSelection).toBe(true);
			expect(typeof spec.stopEvent).toBe('function');
		}
		editor.destroy();
	});

	it('shows a markdown proposal as the literal text it is', () => {
		// Parsing it is the host's job at accept time; the chip is not a
		// renderer and must not quietly turn `**bold**` into bold text.
		const editor = editorWith('a plain word here', {
			source: () => [edit({ find: 'plain', replace: '**bold**' })],
		});
		const ins = document.querySelector('ins.ds-suggestion-ins');
		expect(ins?.textContent).toBe('**bold**');
		expect(ins?.querySelector('strong')).toBeNull();
		editor.destroy();
	});
});

describe('commands with nothing bound behind them', () => {
	it('report that they did nothing instead of swallowing the key', () => {
		// `true` tells a keymap the key was handled. With no callback the key
		// should fall through to whatever is bound after it.
		const options = { source: () => [edit()] };
		const editor = editorWith(SENTENCE, options);
		const commands = suggestionCommands(options);
		expect(commands.acceptSuggestion(editor.state, undefined, editor.view!)).toBe(false);
		expect(commands.rejectSuggestion(editor.state, undefined, editor.view!)).toBe(false);
		expect(commands.acceptAllSuggestions(editor.state, undefined, editor.view!)).toBe(false);
		editor.destroy();
	});

	it('still report success when the host is listening', () => {
		const options = { source: () => [edit()], onAccept: vi.fn() };
		const editor = editorWith(SENTENCE, options);
		expect(suggestionCommands(options).acceptSuggestion(
			editor.state,
			undefined,
			editor.view!,
		)).toBe(true);
		expect(options.onAccept).toHaveBeenCalledTimes(1);
		editor.destroy();
	});
});

describe('what a screen reader gets', () => {
	it('marks the struck range as a deletion, not just a coloured line', () => {
		const editor = editorWith(SENTENCE, { source: () => [edit()], chips: false });
		const inline = decorationsOf(editor).find((d) => d.from !== d.to);
		const attrs = (inline as unknown as { type: { attrs: Record<string, string> } }).type
			.attrs;
		expect(attrs.role).toBe('deletion');
		// The insertion is a real `<ins>`, which already carries the semantic.
		expect(document.querySelector('ins.ds-suggestion-ins')).not.toBeNull();
		editor.destroy();
	});

	it('describes the change by its text rather than by its machinery', () => {
		const editor = editorWith('one two three', {
			source: () => [edit({ find: 'two', replace: 'TWO', actor: 'agent:claude' })],
		});
		const chip = document.querySelector('.ds-suggestion-chip')!;
		expect(chip.getAttribute('role')).toBe('group');
		const described = chip.getAttribute('aria-label')!;
		expect(described).toContain('agent:claude');
		expect(described).toContain('two');
		expect(described).toContain('TWO');
		// Not the old `${actor}: ${kind}`, which named neither.
		expect(described).not.toBe('agent:claude: replace');
		for (const [selector, verb] of [
			['.ds-suggestion-accept', 'Accept'],
			['.ds-suggestion-reject', 'Reject'],
		] as const) {
			const label = document.querySelector(selector)!.getAttribute('aria-label')!;
			expect(label.startsWith(`${verb}: `)).toBe(true);
			expect(label).toContain('TWO');
		}
		editor.destroy();
	});

	it('carries the note on the chip and never in the text', () => {
		const editor = editorWith('one two three', {
			source: () => [edit({ find: 'two', replace: 'TWO', note: 'Tighter.' })],
		});
		const chip = document.querySelector('.ds-suggestion-chip')!;
		expect(chip.getAttribute('title')).toBe('Tighter.');
		expect(chip.getAttribute('aria-label')).toContain('Tighter.');
		expect(editor.state.doc.textContent).toBe('one two three');
		editor.destroy();
	});

	it('shortens a long quotation instead of reading out a paragraph', () => {
		const long = 'w'.repeat(200);
		const editor = editorWith(`start ${long} end`, {
			source: () => [edit({ find: long, replace: 'short' })],
		});
		const label = document.querySelector('.ds-suggestion-chip')!.getAttribute('aria-label')!;
		expect(label.length).toBeLessThan(140);
		expect(label).toContain('…');
		editor.destroy();
	});

	it('lets a host replace the description wholesale', () => {
		const editor = editorWith('one two three', {
			source: () => [edit({ find: 'two', replace: 'TWO' })],
			labels: { accept: 'Apply', describe: () => 'Ruth’s copy edit' },
		});
		expect(
			document.querySelector('.ds-suggestion-accept')!.getAttribute('aria-label'),
		).toBe('Apply: Ruth’s copy edit');
		editor.destroy();
	});
});
