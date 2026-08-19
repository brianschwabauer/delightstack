import { describe, expect, it } from 'vitest';
import { Fragment, Slice } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import { Editor } from '../editor.svelte.js';
import { blockIdKey } from './block-id.js';
import { duplicateBlock } from '../commands.js';

/** The clipboard props live on the plugin; a headless test has no EditorView. */
function clipboard(editor: Editor) {
	const plugin = blockIdKey.get(editor.state);
	if (!plugin) throw new Error('block-id plugin not installed');
	const props = plugin.props as {
		transformCopied: (slice: Slice) => Slice;
		transformPasted: (slice: Slice) => Slice;
	};
	return {
		copy: (slice: Slice) => props.transformCopied(slice),
		paste: (slice: Slice) => props.transformPasted(slice),
	};
}

/** A whole-block slice, the way ProseMirror serializes a block selection. */
function blockSlice(editor: Editor, index: number) {
	return new Slice(Fragment.from(editor.state.doc.child(index)), 0, 0);
}

function ids(editor: Editor) {
	return (editor.getJSON().content ?? []).map((n) => n.attrs?.block_id);
}

function texts(editor: Editor) {
	return (editor.getJSON().content ?? []).map((n) => n.content?.[0]?.text);
}

function paragraph(text: string, block_id: string) {
	return {
		type: 'paragraph',
		attrs: { block_id },
		content: [{ type: 'text', text }],
	};
}

describe('block-id plugin', () => {
	it('keeps the original id when duplicating downward', () => {
		const editor = new Editor({
			content: { type: 'doc', content: [paragraph('hello', 'original')] },
		});
		expect(duplicateBlock(1)(editor.state, editor.dispatch)).toBe(true);
		const [first, second] = editor.getJSON().content ?? [];
		expect(first?.attrs?.block_id).toBe('original');
		expect(second?.attrs?.block_id).toBeTruthy();
		expect(second?.attrs?.block_id).not.toBe('original');
	});

	it('keeps the original id when duplicating upward (copy must not steal identity)', () => {
		const editor = new Editor({
			content: { type: 'doc', content: [paragraph('hello', 'original')] },
		});
		expect(duplicateBlock(-1)(editor.state, editor.dispatch)).toBe(true);
		// The copy sits ABOVE the original — the dedupe must not just keep the
		// first occurrence in document order
		const [copy, original] = editor.getJSON().content ?? [];
		expect(original?.attrs?.block_id).toBe('original');
		expect(copy?.attrs?.block_id).toBeTruthy();
		expect(copy?.attrs?.block_id).not.toBe('original');
	});

	it('assigns fresh ids to pasted duplicates above the original', () => {
		const editor = new Editor({
			content: {
				type: 'doc',
				content: [paragraph('above', 'first'), paragraph('hello', 'original')],
			},
		});
		// Simulate pasting a copy of the second block at the very top
		const node = editor.state.doc.child(1);
		editor.dispatch(editor.state.tr.insert(0, node.copy(node.content)));
		const blocks = editor.getJSON().content ?? [];
		expect(blocks).toHaveLength(3);
		// The pre-existing block (now last) keeps its id; the paste gets a new one
		expect(blocks[2]?.attrs?.block_id).toBe('original');
		expect(blocks[0]?.attrs?.block_id).not.toBe('original');
		expect(blocks[1]?.attrs?.block_id).toBe('first');
	});

	it('leaves the id on the first half when a block is split', () => {
		const editor = new Editor({
			content: { type: 'doc', content: [paragraph('hello world', 'ORIG')] },
		});
		editor.dispatch(
			editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 6)).split(6),
		);
		expect(texts(editor)).toEqual(['hello', ' world']);
		const [first, second] = ids(editor);
		expect(first).toBe('ORIG');
		expect(second).toBeTruthy();
		expect(second).not.toBe('ORIG');
	});

	it('keeps the first block\'s id when two blocks are joined', () => {
		const editor = new Editor({
			content: { type: 'doc', content: [paragraph('aaa', 'FIRST'), paragraph('bbb', 'SECOND')] },
		});
		editor.dispatch(editor.state.tr.join(5));
		expect(texts(editor)).toEqual(['aaabbb']);
		expect(ids(editor)).toEqual(['FIRST']);
	});

	it('regenerates the id of a block pasted from another document', () => {
		const source = new Editor({
			content: { type: 'doc', content: [paragraph('borrowed', 'SHARED')] },
			doc_id: 'doc-a',
		});
		const target = new Editor({
			content: { type: 'doc', content: [paragraph('local', 'LOCAL')] },
			doc_id: 'doc-b',
		});
		const copied = clipboard(source).copy(blockSlice(source, 0));
		// The real clipboard round-trips through HTML; the two editors hold
		// separate Schema instances, so rebuild the slice in the target's.
		const carried = Slice.fromJSON(target.state.schema, copied.toJSON() as object);
		const pasted = clipboard(target).paste(carried);
		target.dispatch(target.state.tr.replaceSelection(pasted));

		expect(texts(target)).toEqual(['borrowed', 'local']);
		const [pasted_id, local_id] = ids(target);
		expect(local_id).toBe('LOCAL');
		expect(pasted_id).toBeTruthy();
		expect(pasted_id).not.toBe('SHARED');
	});

	it('keeps the id of a block moved within the same document', () => {
		const editor = new Editor({
			content: { type: 'doc', content: [paragraph('one', 'ONE'), paragraph('two', 'TWO')] },
			doc_id: 'doc-a',
		});
		const cut = clipboard(editor).copy(blockSlice(editor, 0));
		// Move: remove the source, then paste at the end
		editor.dispatch(editor.state.tr.delete(0, 5));
		const pasted = clipboard(editor).paste(cut);
		editor.dispatch(
			editor.state.tr.replaceWith(
				editor.state.doc.content.size,
				editor.state.doc.content.size,
				pasted.content,
			),
		);
		expect(texts(editor)).toEqual(['two', 'one']);
		expect(ids(editor)).toEqual(['TWO', 'ONE']);
	});

	it('regenerates ids on HTML pasted from outside any editor', () => {
		const editor = new Editor({
			content: { type: 'doc', content: [paragraph('local', 'LOCAL')] },
		});
		// A foreign app whose HTML happens to carry data-block-id: no stamp.
		const type = editor.state.schema.nodes.paragraph;
		const foreign = type.create({ block_id: 'FOREIGN' }, editor.state.schema.text('outside'));
		const pasted = clipboard(editor).paste(new Slice(Fragment.from(foreign), 0, 0));
		editor.dispatch(editor.state.tr.replaceSelection(pasted));

		expect(texts(editor)).toEqual(['outside', 'local']);
		expect(ids(editor)[0]).toBeTruthy();
		expect(ids(editor)[0]).not.toBe('FOREIGN');
	});

	it('generates creation-ordered base62 ids', () => {
		const editor = new Editor({ content: { type: 'doc', content: [paragraph('a', '')] } });
		editor.dispatch(editor.state.tr.insert(0, editor.state.schema.nodes.paragraph.create()));
		for (const id of ids(editor)) {
			expect(id).toMatch(/^[0-9A-Za-z]{12}$/);
		}
	});
});
