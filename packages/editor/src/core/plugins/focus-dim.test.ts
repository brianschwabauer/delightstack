import { describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { Decoration } from 'prosemirror-view';
import { Editor } from '../editor.svelte.js';
import type { JSONContent } from '../../types/index.js';
import {
	FOCUS_DIM_CLASS,
	focusDim,
	focusDimDecorations,
	focusDimKey,
	focusDimStateOf,
	sentenceRangeIn,
	sentenceRangesIn,
	setFocusDim,
	type FocusUnit,
} from './focus-dim.js';

function paragraph(text: string): JSONContent {
	return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function doc(...content: JSONContent[]): JSONContent {
	return { type: 'doc', content };
}

/** An editor with the plugin installed and the caret placed at `pos`. */
function editorAt(
	content: JSONContent,
	pos: number,
	options: { enabled?: boolean; unit?: FocusUnit } = {},
): Editor {
	const editor = new Editor({
		content,
		plugins: () => [focusDim({ enabled: options.enabled ?? true, unit: options.unit })],
	});
	editor.dispatch(
		editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
	);
	return editor;
}

/** The plugin's decorations over the whole document, as plain ranges. */
function dimRanges(editor: Editor): { from: number; to: number }[] {
	const set = focusDimKey.getState(editor.state)?.decorations;
	const found = (set?.find() ?? []) as Decoration[];
	return found
		.map((decoration) => ({ from: decoration.from, to: decoration.to }))
		.sort((a, b) => a.from - b.from);
}

describe('sentenceRangesIn', () => {
	it('splits ordinary prose on sentence ends', () => {
		const text = 'One here. Two there. Three everywhere.';
		const ranges = sentenceRangesIn(text);
		expect(ranges.map((range) => text.slice(range.from, range.to).trim())).toEqual([
			'One here.',
			'Two there.',
			'Three everywhere.',
		]);
	});

	it('keeps question and exclamation ends', () => {
		const text = 'Really? Yes! Fine.';
		expect(sentenceRangesIn(text)).toHaveLength(3);
	});

	it('does not split after a common abbreviation', () => {
		const text = 'Dr. Smith arrived. He left at once.';
		const ranges = sentenceRangesIn(text);
		expect(ranges.map((range) => text.slice(range.from, range.to).trim())).toEqual([
			'Dr. Smith arrived.',
			'He left at once.',
		]);
	});

	it('does not split inside a dotted initialism', () => {
		const text = 'It happened at 3 p.m. exactly, e.g. right then. Nobody saw.';
		const ranges = sentenceRangesIn(text);
		expect(ranges.map((range) => text.slice(range.from, range.to).trim())).toEqual([
			'It happened at 3 p.m. exactly, e.g. right then.',
			'Nobody saw.',
		]);
	});

	it('covers the whole text with adjacent ranges', () => {
		const text = 'One. Two. Dr. Three.';
		const ranges = sentenceRangesIn(text);
		expect(ranges[0].from).toBe(0);
		expect(ranges.at(-1)?.to).toBe(text.length);
		for (let i = 1; i < ranges.length; i++) {
			expect(ranges[i].from).toBe(ranges[i - 1].to);
		}
	});
});

describe('sentenceRangeIn', () => {
	const text = 'First one. Second one. Third one.';

	it('finds the sentence around an interior offset', () => {
		const range = sentenceRangeIn(text, text.indexOf('Second') + 2);
		expect(text.slice(range.from, range.to).trim()).toBe('Second one.');
	});

	it('gives the caret at the very end the last sentence', () => {
		const range = sentenceRangeIn(text, text.length);
		expect(text.slice(range.from, range.to).trim()).toBe('Third one.');
	});

	it('answers an empty text without throwing', () => {
		expect(sentenceRangeIn('', 0)).toEqual({ from: 0, to: 0 });
	});
});

describe('focusDimDecorations', () => {
	const three = doc(
		paragraph('Alpha alpha.'),
		paragraph('Beta beta.'),
		paragraph('Gamma.'),
	);

	it('block unit dims every top-level sibling and nothing inside the lit block', () => {
		// Caret inside the second paragraph. Positions: p1 is [0, 14), p2 starts at 14.
		const editor = editorAt(three, 16, { unit: 'block' });
		const ranges = dimRanges(editor);
		const p1 = editor.state.doc.child(0);
		const p2 = editor.state.doc.child(1);
		expect(ranges).toEqual([
			{ from: 0, to: p1.nodeSize },
			{
				from: p1.nodeSize + p2.nodeSize,
				to: editor.state.doc.content.size,
			},
		]);
		editor.destroy();
	});

	it('paragraph unit dims siblings at every depth, not the wrapper the caret is in', () => {
		const nested = doc(
			{
				type: 'blockquote',
				content: [paragraph('Inside first.'), paragraph('Inside second.')],
			},
			paragraph('Outside.'),
		);
		// Caret in the quote's first paragraph (position 3 is inside its text).
		const editor = editorAt(nested, 3, { unit: 'paragraph' });
		const ranges = dimRanges(editor);
		const quote = editor.state.doc.child(0);
		const first_inner = quote.child(0);
		// Two dims: the quote's second paragraph, and the top-level paragraph.
		// The quote itself is never dimmed — the caret is inside it.
		expect(ranges).toEqual([
			{ from: 1 + first_inner.nodeSize, to: quote.nodeSize - 1 },
			{ from: quote.nodeSize, to: editor.state.doc.content.size },
		]);
		editor.destroy();
	});

	it('sentence unit adds inline dims inside the caret’s own block', () => {
		const text = 'First one. Second one. Third one.';
		const one = doc(paragraph(text));
		const caret = 1 + text.indexOf('Second') + 2; // +1 for the paragraph open
		const editor = editorAt(one, caret, { unit: 'sentence' });
		const ranges = dimRanges(editor);
		// The lit sentence is `Second one. ` — dims cover [start, sentence.from)
		// and [sentence.to, end).
		const from = text.indexOf('Second');
		const to = text.indexOf('Third');
		expect(ranges).toEqual([
			{ from: 1, to: 1 + from },
			{ from: 1 + to, to: 1 + text.length },
		]);
		editor.destroy();
	});

	it('a one-sentence document dims nothing', () => {
		const editor = editorAt(doc(paragraph('All alone here.')), 4, { unit: 'sentence' });
		expect(dimRanges(editor)).toEqual([]);
		editor.destroy();
	});

	it('is pure over its inputs', () => {
		const editor = editorAt(three, 16, { unit: 'block' });
		const { doc: pm_doc } = editor.state;
		const $head = editor.state.selection.$head;
		const first = focusDimDecorations(pm_doc, $head, 'block');
		const second = focusDimDecorations(pm_doc, $head, 'block');
		expect(first.map((d) => [d.from, d.to])).toEqual(second.map((d) => [d.from, d.to]));
		editor.destroy();
	});
});

describe('the plugin', () => {
	const three = doc(
		paragraph('Alpha alpha.'),
		paragraph('Beta beta.'),
		paragraph('Gamma.'),
	);

	it('is off by default and decorates nothing', () => {
		const editor = new Editor({ content: three, plugins: () => [focusDim()] });
		expect(focusDimStateOf(editor.state)).toEqual({ enabled: false, unit: 'sentence' });
		expect(dimRanges(editor)).toEqual([]);
		editor.destroy();
	});

	/**
	 * The meta transaction `setFocusDim` dispatches, without asking the test to
	 * mount a real `EditorView` — the plugin's `apply` is the code under test
	 * either way, and `setFocusDim` itself is one line over `dispatch`.
	 */
	function patch(editor: Editor, meta: Parameters<typeof setFocusDim>[1]): void {
		editor.dispatch(editor.state.tr.setMeta(focusDimKey, meta));
	}

	it('turns on and off through the meta patch without touching the document', () => {
		const editor = editorAt(three, 16, { enabled: false, unit: 'block' });
		const before = editor.state.doc;
		expect(dimRanges(editor)).toEqual([]);
		patch(editor, { enabled: true });
		expect(dimRanges(editor).length).toBeGreaterThan(0);
		patch(editor, { enabled: false });
		expect(dimRanges(editor)).toEqual([]);
		expect(editor.state.doc.eq(before)).toBe(true);
		editor.destroy();
	});

	it('changes unit through the meta patch', () => {
		const editor = editorAt(three, 16, { enabled: true, unit: 'block' });
		const block_dims = dimRanges(editor).length;
		patch(editor, { unit: 'sentence' });
		expect(focusDimStateOf(editor.state)?.unit).toBe('sentence');
		// One sentence per paragraph here, so the sentence dims equal the block
		// dims — the state change is what this asserts, not the count.
		expect(dimRanges(editor).length).toBe(block_dims);
		editor.destroy();
	});

	it('recomputes when the caret moves', () => {
		const editor = editorAt(three, 2, { unit: 'block' });
		const at_first = dimRanges(editor);
		editor.dispatch(
			editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 16)),
		);
		const at_second = dimRanges(editor);
		expect(at_second).not.toEqual(at_first);
		// The first paragraph is dimmed now, and the second is not.
		expect(at_second[0].from).toBe(0);
		editor.destroy();
	});

	it('recomputes under an edit, and the dims land where the text now is', () => {
		const editor = editorAt(three, 16, { unit: 'block' });
		// Grow the first paragraph; the dim over paragraph three must move.
		const grown = 'prefix '.length;
		const before = dimRanges(editor);
		editor.dispatch(editor.state.tr.insertText('prefix ', 1));
		const after = dimRanges(editor);
		expect(after[0].to).toBe(before[0].to + grown);
		expect(after[1].from).toBe(before[1].from + grown);
		expect(after[1].to).toBe(before[1].to + grown);
		editor.destroy();
	});

	it('maps rather than recomputes a transaction that moves nothing', () => {
		const editor = editorAt(three, 16, { unit: 'block' });
		const set_before = focusDimKey.getState(editor.state)?.decorations;
		editor.dispatch(editor.state.tr.setMeta('unrelated', true));
		const set_after = focusDimKey.getState(editor.state)?.decorations;
		// `map` over an empty mapping answers the same set object.
		expect(set_after).toBe(set_before);
		editor.destroy();
	});

	it('carries the class the host will style', () => {
		const editor = editorAt(three, 16, { unit: 'block' });
		const decorations = focusDimDecorations(
			editor.state.doc,
			editor.state.selection.$head,
			'block',
		);
		expect(decorations.length).toBeGreaterThan(0);
		for (const decoration of decorations) {
			expect(classOf(decoration)).toBe(FOCUS_DIM_CLASS);
		}
		editor.destroy();
	});

	it('honours a host-supplied class name', () => {
		const editor = editorAt(three, 16, { unit: 'block' });
		const decorations = focusDimDecorations(
			editor.state.doc,
			editor.state.selection.$head,
			'block',
			'my-dim',
		);
		for (const decoration of decorations) {
			expect(classOf(decoration)).toBe('my-dim');
		}
		editor.destroy();
	});
});

describe('boundary and structure edges', () => {
	it('a closing quote before a real sentence end still splits', () => {
		const text = 'He said." Next came fast.';
		const ranges = sentenceRangesIn(text);
		expect(ranges.map((range) => text.slice(range.from, range.to).trim())).toEqual([
			'He said."',
			'Next came fast.',
		]);
	});

	it('a sentence ending in a name or month still ends there', () => {
		// The abbreviation repair is a list of titles, not a shape rule — a
		// shape rule would merge these, and prose ends sentences on short
		// capitalized words constantly.
		for (const text of [
			'He gave it to John. She smiled.',
			'It was May. We left early.',
		]) {
			expect(sentenceRangesIn(text)).toHaveLength(2);
		}
	});

	it('a caret in the space run after a period belongs to the sentence it closed', () => {
		const text = 'First one. Second one.';
		// Offset 10 is the space after the first period — inside segment one.
		const range = sentenceRangeIn(text, 'First one.'.length);
		expect(text.slice(range.from, range.to).trim()).toBe('First one.');
	});

	it('paragraph unit in a list item lights the paragraph, dims sibling items', () => {
		const list = doc(
			{
				type: 'bullet_list',
				content: [
					{ type: 'list_item', content: [paragraph('First item.')] },
					{ type: 'list_item', content: [paragraph('Second item.')] },
				],
			},
			paragraph('After the list.'),
		);
		// Caret inside the first item's paragraph text.
		const editor = editorAt(list, 4, { unit: 'paragraph' });
		const ranges = dimRanges(editor);
		const list_node = editor.state.doc.child(0);
		const first_item = list_node.child(0);
		// Dimmed: the second list item, and the paragraph after the list. The
		// list and the first item are ancestors of the caret — never dimmed.
		expect(ranges).toEqual([
			{ from: 1 + first_item.nodeSize, to: list_node.nodeSize - 1 },
			{ from: list_node.nodeSize, to: editor.state.doc.content.size },
		]);
		editor.destroy();
	});

	it('block unit at the document edges dims everything else, once each', () => {
		const three = doc(paragraph('One.'), paragraph('Two.'), paragraph('Three.'));
		const first = editorAt(three, 2, { unit: 'block' });
		const p1 = first.state.doc.child(0);
		const p2 = first.state.doc.child(1);
		// One node decoration per dimmed sibling — never overlapping, never
		// touching the lit block.
		expect(dimRanges(first)).toEqual([
			{ from: p1.nodeSize, to: p1.nodeSize + p2.nodeSize },
			{ from: p1.nodeSize + p2.nodeSize, to: first.state.doc.content.size },
		]);
		first.destroy();
		const last = editorAt(three, three_last_pos(three), { unit: 'block' });
		const dims = dimRanges(last);
		expect(dims[0].from).toBe(0);
		expect(dims.at(-1)?.to).toBeLessThan(last.state.doc.content.size);
		last.destroy();
	});

	it('keeps sentence offsets aligned across an inline leaf (hard_break)', () => {
		// `One. Two<br>more. Three.` — the break is one position and must count
		// as one character, or every offset after it names the wrong place.
		const block: JSONContent = {
			type: 'paragraph',
			content: [
				{ type: 'text', text: 'One. Two' },
				{ type: 'hard_break' },
				{ type: 'text', text: 'more. Three.' },
			],
		};
		const text = 'One. Two￼more. Three.';
		const caret = 1 + text.indexOf('more'); // +1 paragraph open; lands mid-sentence-two
		const editor = editorAt(doc(block), caret, { unit: 'sentence' });
		const ranges = dimRanges(editor);
		// Lit: `Two￼more. ` (the segmenter does not break at the object
		// replacement character), dimmed: `One. ` before and `Three.` after.
		expect(ranges).toEqual([
			{ from: 1, to: 1 + 'One. '.length },
			{ from: 1 + text.indexOf('Three'), to: 1 + text.length },
		]);
		editor.destroy();
	});

	it('degrades sentence to paragraph without Intl.Segmenter', () => {
		const original = Intl.Segmenter;
		// @ts-expect-error — simulating an environment without the segmenter.
		Intl.Segmenter = undefined;
		try {
			const text = 'First one. Second one.';
			expect(sentenceRangesIn(text)).toEqual([{ from: 0, to: text.length }]);
			const editor = editorAt(doc(paragraph(text), paragraph('Other.')), 3, {
				unit: 'sentence',
			});
			// No inline dims inside the caret's block — the whole paragraph is
			// lit, which is exactly the paragraph unit.
			const inner = dimRanges(editor).filter(
				(r) => r.from < text.length + 1 && r.from > 0,
			);
			expect(inner).toEqual([]);
			editor.destroy();
		} finally {
			Intl.Segmenter = original;
		}
	});
});

/** The last text position in a three-paragraph doc built by `doc(...)`. */
function three_last_pos(content: JSONContent): number {
	const editor = new Editor({ content });
	const pos = editor.state.doc.content.size - 2;
	editor.destroy();
	return pos;
}

/**
 * The class a decoration will paint. `Decoration` keeps its attrs on an
 * internal `type`; reaching in is confined to this one helper so a library
 * rename breaks one line.
 */
function classOf(decoration: Decoration): string | undefined {
	return (decoration as unknown as { type?: { attrs?: { class?: string } } }).type?.attrs
		?.class;
}
