import { describe, expect, it, vi } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { Editor } from '../editor.svelte.js';
import type { JSONContent } from '../../types/index.js';
import {
	annotationAnchorAt,
	annotationCommands,
	annotationDecorations,
	annotationDecorationsKey,
	annotationsInDocument,
	focusedAnnotation,
	resolveAnnotations,
	type Annotation,
	type AnnotationDecorationsOptions,
} from './annotations.js';

/**
 * ED-06. Annotation decorations for highlights and notes the host owns.
 *
 * Everything here drives the real plugin through a real `Editor` — the
 * decorations are read out of the plugin's own state the way ProseMirror reads
 * them, not out of a builder the test called, because a decoration the view
 * never asked for is not evidence that anything renders.
 *
 * The re-anchoring itself is `anchors.test.ts`'s. What this file is about is the
 * half that is ED-06's own: what gets drawn, what a click reaches, what an empty
 * quote does, and the fact that none of it touches the document.
 */

function paragraphs(
	...blocks: Array<string | { id: string; text: string }>
): JSONContent {
	return {
		type: 'doc',
		content: blocks.map((block) => {
			const text = typeof block === 'string' ? block : block.text;
			return {
				type: 'paragraph',
				attrs: typeof block === 'string' ? undefined : { block_id: block.id },
				content: text ? [{ type: 'text', text }] : undefined,
			};
		}),
	};
}

function editorWith(
	blocks: Array<string | { id: string; text: string }>,
	options: AnnotationDecorationsOptions,
) {
	const editor = new Editor({ content: paragraphs(...blocks) });
	const element = document.createElement('div');
	document.body.append(element);
	editor.mount(element);
	editor.registerPlugins([annotationDecorations(options)]);
	return editor;
}

/** The decorations the plugin currently contributes, in document order. */
function decorationsOf(editor: Editor) {
	const state = annotationDecorationsKey.getState(editor.state);
	return state ? state.decorations.find() : [];
}

/** The class list an inline decoration carries, as a set. */
function classesOf(decoration: ReturnType<typeof decorationsOf>[number]): Set<string> {
	const spec = (decoration as unknown as { type: { attrs?: Record<string, string> } })
		.type;
	return new Set((spec.attrs?.class ?? '').split(' ').filter(Boolean));
}

const SENTENCE = 'He walked toward the lighthouse, slowly.';

function annotation(overrides: Partial<Annotation> = {}): Annotation {
	return { id: 'a1', quote: 'walked toward the lighthouse', ...overrides };
}

describe('annotationDecorations', () => {
	it('draws an inline decoration over the quote, and nothing else', () => {
		const editor = editorWith([SENTENCE], { source: () => [annotation()] });
		const found = decorationsOf(editor);
		expect(found).toHaveLength(1);
		expect(editor.state.doc.textBetween(found[0].from, found[0].to)).toBe(
			'walked toward the lighthouse',
		);
		expect(classesOf(found[0]).has('ds-annotation')).toBe(true);
	});

	it('puts the colour on the decoration as a class, not as a style', () => {
		// The palette is the host's stylesheet. A plugin that emitted a colour
		// value would be a plugin with an opinion about somebody's theme.
		const editor = editorWith([SENTENCE], {
			source: () => [annotation({ color: 'green' })],
		});
		expect(classesOf(decorationsOf(editor)[0]).has('ds-annotation-green')).toBe(true);
	});

	it('refuses a colour that is not a name, rather than building a class out of it', () => {
		const editor = editorWith([SENTENCE], {
			source: () => [annotation({ color: 'red" onload="x' })],
		});
		const classes = [...classesOf(decorationsOf(editor)[0])];
		expect(classes).toEqual(['ds-annotation']);
	});

	it('marks the decoration `role="mark"`, because colour reaches nobody listening', () => {
		const editor = editorWith([SENTENCE], { source: () => [annotation()] });
		const spec = (
			decorationsOf(editor)[0] as unknown as { type: { attrs: Record<string, string> } }
		).type;
		expect(spec.attrs.role).toBe('mark');
		expect(spec.attrs['data-annotation-id']).toBe('a1');
	});

	it('adds the note glyph only when there is a note', () => {
		const without = editorWith([SENTENCE], { source: () => [annotation()] });
		expect(decorationsOf(without)).toHaveLength(1);

		const with_note = editorWith([SENTENCE], {
			source: () => [annotation({ note: 'the turn of the chapter' })],
		});
		const found = decorationsOf(with_note);
		expect(found).toHaveLength(2);
		expect(classesOf(found[0]).has('ds-annotation-has-note')).toBe(true);
	});

	it('isolates the note glyph from the editor’s own key handling', () => {
		// ED-08's review found this the hard way: a widget's DOM is inside the
		// contenteditable, so Enter on its button also reached the keymap and split
		// the paragraph — from a plugin whose whole premise is that it never writes.
		const editor = editorWith([SENTENCE], {
			source: () => [annotation({ note: 'a note' })],
		});
		const widget = decorationsOf(editor).find(
			(entry) => (entry as unknown as { type: { toDOM?: unknown } }).type.toDOM,
		);
		const spec = (widget as unknown as { type: { spec: Record<string, unknown> } }).type
			.spec;
		expect((spec.stopEvent as () => boolean)()).toBe(true);
		expect(spec.ignoreSelection).toBe(true);
	});

	it('opens the note glyph’s editor without touching the document', () => {
		const onEdit = vi.fn();
		const editor = editorWith([SENTENCE], {
			source: () => [annotation({ note: 'a note' })],
			onEdit,
		});
		const before = editor.state.doc.toJSON();
		const widget = decorationsOf(editor).find(
			(entry) => (entry as unknown as { type: { toDOM?: unknown } }).type.toDOM,
		) as unknown as { type: { toDOM: (view: unknown) => HTMLElement } };
		const button = widget.type.toDOM(editor.view);
		button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(onEdit).toHaveBeenCalledTimes(1);
		expect(onEdit.mock.calls[0][0].id).toBe('a1');
		expect(editor.state.doc.toJSON()).toEqual(before);
	});

	it('reaches onSelect from a click in the highlighted text', () => {
		const onSelect = vi.fn();
		const editor = editorWith([SENTENCE], { source: () => [annotation()], onSelect });
		const { from, to } = decorationsOf(editor)[0];
		const view = editor.view;
		if (!view) throw new Error('no view');
		const handled = view.someProp('handleClick', (fn) =>
			fn(view, Math.floor((from + to) / 2), new MouseEvent('click')),
		);
		// `false`: selecting a highlight is not handling the click. The caret still
		// goes where the reader put it.
		expect(handled).toBeFalsy();
		expect(onSelect).toHaveBeenCalledTimes(1);
		expect(onSelect.mock.calls[0][0].id).toBe('a1');
	});

	it('a click outside every highlight reaches nothing', () => {
		const onSelect = vi.fn();
		const editor = editorWith([SENTENCE], { source: () => [annotation()], onSelect });
		const view = editor.view;
		if (!view) throw new Error('no view');
		view.someProp('handleClick', (fn) => fn(view, 1, new MouseEvent('click')));
		expect(onSelect).not.toHaveBeenCalled();
	});

	it('a click in overlapping highlights reaches the innermost one', () => {
		const onSelect = vi.fn();
		const editor = editorWith([SENTENCE], {
			source: () => [
				annotation({ id: 'outer', quote: 'walked toward the lighthouse' }),
				annotation({ id: 'inner', quote: 'lighthouse' }),
			],
			onSelect,
		});
		const inner = annotationsInDocument(editor.state).find(
			(item) => item.annotation.id === 'inner',
		);
		if (!inner) throw new Error('inner not resolved');
		const view = editor.view;
		if (!view) throw new Error('no view');
		view.someProp('handleClick', (fn) =>
			fn(view, Math.floor((inner.from + inner.to) / 2), new MouseEvent('click')),
		);
		expect(onSelect.mock.calls[0][0].id).toBe('inner');
	});

	it('re-anchors as the paragraph around it is edited', () => {
		const editor = editorWith([SENTENCE], { source: () => [annotation()] });
		const before = decorationsOf(editor)[0].from;
		editor.view?.dispatch(editor.state.tr.insertText('Yesterday, ', 1));
		const after = decorationsOf(editor)[0];
		expect(after.from).toBe(before + 'Yesterday, '.length);
		expect(editor.state.doc.textBetween(after.from, after.to)).toBe(
			'walked toward the lighthouse',
		);
	});

	it('goes stale when the passage is gone, and says which way', () => {
		const onStale = vi.fn();
		const editor = editorWith([SENTENCE], { source: () => [annotation()], onStale });
		onStale.mockClear();
		editor.view?.dispatch(editor.state.tr.delete(1, editor.state.doc.content.size - 1));
		expect(decorationsOf(editor)).toHaveLength(0);
		expect(onStale).toHaveBeenCalled();
		const [list, details] = onStale.mock.calls.at(-1) ?? [];
		expect(list[0].id).toBe('a1');
		expect(details[0].reason).toBe('missing');
	});

	it('reports staleness on change rather than on every keystroke', () => {
		const onStale = vi.fn();
		const editor = editorWith([SENTENCE], {
			source: () => [annotation({ quote: 'not in the document' })],
			onStale,
		});
		const calls = onStale.mock.calls.length;
		editor.view?.dispatch(editor.state.tr.insertText('a', 1));
		editor.view?.dispatch(editor.state.tr.insertText('b', 1));
		expect(onStale.mock.calls.length).toBe(calls);
	});

	it('calls an empty quote stale rather than drawing a highlight over nothing', () => {
		// A pure insertion is a real suggestion. A highlight over nothing is a row
		// that should not exist — drawn at the front of its block it would be a
		// zero-width mark nobody can see, click, or get rid of.
		const onStale = vi.fn();
		const editor = editorWith([{ id: 'b1', text: SENTENCE }], {
			source: () => [annotation({ quote: '', block_id: 'b1' })],
			onStale,
		});
		expect(decorationsOf(editor)).toHaveLength(0);
		expect(onStale.mock.calls.at(-1)?.[1][0].reason).toBe('missing');
	});

	it('never writes to the document, whatever it is handed', () => {
		const editor = editorWith([SENTENCE], {
			source: () => [annotation({ note: 'n', color: 'pink' })],
		});
		const before = editor.state.doc.toJSON();
		editor.view?.dispatch(editor.state.tr.setMeta(annotationDecorationsKey, {}));
		expect(editor.state.doc.toJSON()).toEqual(before);
	});

	it('redraws when a subscribed source says the list moved', () => {
		let list: Annotation[] = [];
		let notify = () => {};
		const editor = editorWith([SENTENCE], {
			source: {
				get: () => list,
				subscribe: (on_change) => {
					notify = on_change;
					return () => {};
				},
			},
		});
		expect(decorationsOf(editor)).toHaveLength(0);
		list = [annotation()];
		notify();
		expect(decorationsOf(editor)).toHaveLength(1);
	});
});

describe('focus and commands', () => {
	function focusable() {
		const source = () => [
			annotation({ id: 'a1', quote: 'first' }),
			annotation({ id: 'a2', quote: 'second' }),
		];
		return editorWith(['first and then second, in that order'], { source });
	}

	it('moves to the next annotation and wraps', () => {
		const editor = focusable();
		const commands = annotationCommands({ source: () => [] });
		const view = editor.view;
		if (!view) throw new Error('no view');
		commands.nextAnnotation(view.state, view.dispatch, view);
		expect(focusedAnnotation(view.state)?.annotation.id).toBe('a1');
		commands.nextAnnotation(view.state, view.dispatch, view);
		expect(focusedAnnotation(view.state)?.annotation.id).toBe('a2');
		commands.nextAnnotation(view.state, view.dispatch, view);
		expect(focusedAnnotation(view.state)?.annotation.id).toBe('a1');
	});

	it('lands on the highlight the caret is at rather than skipping it', () => {
		// The first press moves *to* one. Stepping only starts once something is
		// explicitly focused — a reader pressing a key to reach the highlight they
		// can see must not sail past it.
		const editor = focusable();
		const commands = annotationCommands({ source: () => [] });
		const view = editor.view;
		if (!view) throw new Error('no view');
		commands.previousAnnotation(view.state, view.dispatch, view);
		expect(focusedAnnotation(view.state)?.annotation.id).toBe('a1');
	});

	it('moves backwards and wraps', () => {
		const editor = focusable();
		const commands = annotationCommands({ source: () => [] });
		const view = editor.view;
		if (!view) throw new Error('no view');
		commands.nextAnnotation(view.state, view.dispatch, view);
		commands.previousAnnotation(view.state, view.dispatch, view);
		expect(focusedAnnotation(view.state)?.annotation.id).toBe('a2');
	});

	it('prefers the annotation the caret is standing in', () => {
		const editor = focusable();
		const view = editor.view;
		if (!view) throw new Error('no view');
		const second = annotationsInDocument(view.state).find(
			(item) => item.annotation.id === 'a2',
		);
		if (!second) throw new Error('a2 not resolved');
		view.dispatch(
			view.state.tr.setSelection(TextSelection.create(view.state.doc, second.from + 1)),
		);
		expect(focusedAnnotation(view.state)?.annotation.id).toBe('a2');
	});

	it('declines rather than swallowing the key when nothing is bound', () => {
		const editor = focusable();
		const view = editor.view;
		if (!view) throw new Error('no view');
		const commands = annotationCommands({ source: () => [] });
		expect(commands.editAnnotation(view.state, view.dispatch, view)).toBe(false);
	});

	it('reaches the host’s editor for the focused annotation', () => {
		const onEdit = vi.fn();
		const editor = focusable();
		const view = editor.view;
		if (!view) throw new Error('no view');
		const commands = annotationCommands({ source: () => [], onEdit });
		expect(commands.editAnnotation(view.state, view.dispatch, view)).toBe(true);
		expect(onEdit).toHaveBeenCalledTimes(1);
	});

	it('declines when there is nothing to move to', () => {
		const editor = editorWith(['nothing marked here'], { source: () => [] });
		const view = editor.view;
		if (!view) throw new Error('no view');
		const commands = annotationCommands({ source: () => [] });
		expect(commands.nextAnnotation(view.state, view.dispatch, view)).toBe(false);
	});
});

describe('annotationAnchorAt', () => {
	it('records the quote with the context that will tell its copies apart', () => {
		const editor = editorWith([{ id: 'b1', text: SENTENCE }], { source: () => [] });
		const view = editor.view;
		if (!view) throw new Error('no view');
		const start = 1 + SENTENCE.indexOf('lighthouse');
		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, start, start + 'lighthouse'.length),
			),
		);
		const anchor = annotationAnchorAt(view.state);
		expect(anchor).toEqual({
			block_id: 'b1',
			quote: 'lighthouse',
			prefix: 'He walked toward the ',
			suffix: ', slowly.',
			truncated: false,
		});
	});

	it('bounds the context, so a paragraph does not become its own anchor', () => {
		const long = `${'x'.repeat(400)}QUOTE${'y'.repeat(400)}`;
		const editor = editorWith([long], { source: () => [] });
		const view = editor.view;
		if (!view) throw new Error('no view');
		const start = 1 + long.indexOf('QUOTE');
		view.dispatch(
			view.state.tr.setSelection(TextSelection.create(view.state.doc, start, start + 5)),
		);
		const anchor = annotationAnchorAt(view.state, { context: 120 });
		expect(anchor?.prefix).toHaveLength(120);
		expect(anchor?.suffix).toHaveLength(120);
	});

	it('takes the context from the block, not from the document', () => {
		// A prefix that ran off the front of a paragraph into the previous one
		// would stop matching the moment either paragraph moved — precisely the
		// edit the context exists to survive.
		const editor = editorWith(['before', 'QUOTE after'], { source: () => [] });
		const view = editor.view;
		if (!view) throw new Error('no view');
		const start = view.state.doc.resolve(view.state.doc.content.size - 1).start();
		view.dispatch(
			view.state.tr.setSelection(TextSelection.create(view.state.doc, start, start + 5)),
		);
		const anchor = annotationAnchorAt(view.state);
		expect(anchor?.quote).toBe('QUOTE');
		expect(anchor?.prefix).toBe('');
	});

	it('answers null for an empty selection, which is not an annotation', () => {
		const editor = editorWith([SENTENCE], { source: () => [] });
		const view = editor.view;
		if (!view) throw new Error('no view');
		view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
		expect(annotationAnchorAt(view.state)).toBeNull();
	});

	it('round-trips: what it records is what the resolver finds', () => {
		const editor = editorWith([{ id: 'b1', text: SENTENCE }], { source: () => [] });
		const view = editor.view;
		if (!view) throw new Error('no view');
		const start = 1 + SENTENCE.indexOf('lighthouse');
		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, start, start + 'lighthouse'.length),
			),
		);
		const anchor = annotationAnchorAt(view.state);
		if (!anchor) throw new Error('no anchor');
		const { resolved } = resolveAnnotations(view.state.doc, [{ id: 'a1', ...anchor }]);
		expect(resolved).toHaveLength(1);
		expect(resolved[0].from).toBe(start);
		expect(resolved[0].to).toBe(start + 'lighthouse'.length);
	});
});

describe('a selection that runs past its block', () => {
	/*
	 * An annotation is anchored inside one block, because that is what makes it
	 * re-findable. Dragging across two paragraphs is nonetheless an ordinary
	 * thing to do, so the selection is clamped — and the clamp is *reported*,
	 * because silently highlighting a third of what somebody dragged over is the
	 * kind of thing they discover later and cannot explain.
	 */
	function selectAcross() {
		const editor = editorWith(['first paragraph', 'second paragraph'], {
			source: () => [],
		});
		const view = editor.view;
		if (!view) throw new Error('no view');
		const start = 1 + 'first '.length;
		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, start, view.state.doc.content.size - 1),
			),
		);
		return view;
	}

	it('clamps to the block rather than refusing', () => {
		const view = selectAcross();
		const anchor = annotationAnchorAt(view.state);
		expect(anchor?.quote).toBe('paragraph');
		expect(anchor?.block_id).toBeUndefined();
	});

	it('and says that it clamped', () => {
		expect(annotationAnchorAt(selectAcross().state)?.truncated).toBe(true);
	});

	it('a selection inside one block is not truncated', () => {
		const editor = editorWith([SENTENCE], { source: () => [] });
		const view = editor.view;
		if (!view) throw new Error('no view');
		view.dispatch(
			view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)),
		);
		expect(annotationAnchorAt(view.state)?.truncated).toBe(false);
	});

	it('a selection ending exactly at the block end is not truncated', () => {
		// The boundary the clamp is measured against, so an off-by-one here would
		// toast on every highlight that runs to the end of a paragraph.
		const editor = editorWith([SENTENCE], { source: () => [] });
		const view = editor.view;
		if (!view) throw new Error('no view');
		view.dispatch(
			view.state.tr.setSelection(
				TextSelection.create(view.state.doc, 1, 1 + SENTENCE.length),
			),
		);
		const anchor = annotationAnchorAt(view.state);
		expect(anchor?.quote).toBe(SENTENCE);
		expect(anchor?.truncated).toBe(false);
	});

	it('what the clamp records still round-trips through the resolver', () => {
		const view = selectAcross();
		const anchor = annotationAnchorAt(view.state);
		if (!anchor) throw new Error('no anchor');
		const { resolved } = resolveAnnotations(view.state.doc, [{ id: 'a1', ...anchor }]);
		expect(resolved).toHaveLength(1);
	});
});
