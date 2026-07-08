import { describe, expect, it } from 'vitest';
import { Editor } from '../editor.svelte.js';
import { duplicateBlock } from '../commands.js';

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
});
