import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { Node as PMNode } from 'prosemirror-model';
import { buildSchema } from '../schema/index.js';
import { backspaceCommand, moveBlock } from './commands.js';
import type { JSONContent } from '../types/index.js';

const schema = buildSchema([]);

function docFrom(content: JSONContent[]): PMNode {
	return PMNode.fromJSON(schema, { type: 'doc', content });
}

function stateAt(doc: PMNode, pos: number): EditorState {
	return EditorState.create({
		doc,
		schema,
		selection: TextSelection.create(doc, pos),
	});
}

function apply(state: EditorState, command: ReturnType<typeof moveBlock>) {
	let next = state;
	const handled = command(state, (tr) => (next = state.apply(tr)));
	return { handled, state: next };
}

const paragraph = (text?: string): JSONContent => ({
	type: 'paragraph',
	content: text ? [{ type: 'text', text }] : undefined,
});
const quote = (...content: JSONContent[]): JSONContent => ({
	type: 'blockquote',
	content,
});

describe('backspaceCommand', () => {
	const backspace = backspaceCommand(schema);

	it('merges a paragraph after a blockquote into its last line', () => {
		const doc = docFrom([quote(paragraph('inside')), paragraph('after')]);
		// Start of "after": quote(1 + [1 + 6 + 1] + 1) = 10, paragraph start 10, text at 11
		const { handled, state } = apply(stateAt(doc, 11), backspace);
		expect(handled).toBe(true);
		expect(state.doc.toJSON()).toEqual(
			docFrom([quote(paragraph('insideafter'))]).toJSON(),
		);
		// Caret sits at the join point
		expect(state.doc.textBetween(0, state.selection.from)).toBe('inside');
	});

	it('deletes an empty paragraph after a blockquote (no oscillation)', () => {
		const doc = docFrom([quote(paragraph('inside')), paragraph()]);
		const first = apply(stateAt(doc, 11), backspace);
		expect(first.handled).toBe(true);
		expect(first.state.doc.toJSON()).toEqual(
			docFrom([quote(paragraph('inside'))]).toJSON(),
		);
		// The caret ends INSIDE the quote at the end of its text — the next
		// backspace deletes a character instead of re-creating the paragraph
		expect(first.state.selection.$from.parent.textContent).toBe('inside');
		const second = apply(first.state, backspace);
		// parentOffset > 0 → the command defers to the default char delete
		expect(second.handled).toBe(false);
	});

	it('unwraps the first line of a blockquote', () => {
		const doc = docFrom([quote(paragraph('one'), paragraph('two'))]);
		const { handled, state } = apply(stateAt(doc, 2), backspace);
		expect(handled).toBe(true);
		expect(state.doc.toJSON()).toEqual(
			docFrom([paragraph('one'), quote(paragraph('two'))]).toJSON(),
		);
	});

	it('removes an empty line in the middle of a blockquote without splitting it', () => {
		const doc = docFrom([quote(paragraph('one'), paragraph(), paragraph('two'))]);
		// positions: quote 0, p1 1..6, p2 6..8 (empty), start inside p2 = 7
		const { handled, state } = apply(stateAt(doc, 7), backspace);
		expect(handled).toBe(true);
		expect(state.doc.toJSON()).toEqual(
			docFrom([quote(paragraph('one'), paragraph('two'))]).toJSON(),
		);
	});

	it('converts a heading back to a paragraph before joining', () => {
		const doc = docFrom([
			paragraph('before'),
			{
				type: 'heading',
				attrs: { level: 2 },
				content: [{ type: 'text', text: 'title' }],
			},
		]);
		const { handled, state } = apply(stateAt(doc, 9), backspace);
		expect(handled).toBe(true);
		expect(state.doc.child(1).type.name).toBe('paragraph');
		expect(state.doc.child(1).textContent).toBe('title');
	});

	it('merges a paragraph after a list into the last item', () => {
		const doc = docFrom([
			{
				type: 'bullet_list',
				content: [{ type: 'list_item', content: [paragraph('item')] }],
			},
			paragraph('tail'),
		]);
		// list(1 + item(1 + [1+4+1] + 1) + 1) = 10; paragraph text starts at 11
		const { handled, state } = apply(stateAt(doc, 11), backspace);
		expect(handled).toBe(true);
		expect(state.doc.childCount).toBe(1);
		expect(state.doc.firstChild?.textContent).toBe('itemtail');
	});
});

describe('moveBlock', () => {
	it('moves a block up and keeps the caret inside it', () => {
		const doc = docFrom([paragraph('one'), paragraph('two')]);
		// caret inside "two" (starts at 5, text at 6)
		const { handled, state } = apply(stateAt(doc, 8), moveBlock(-1));
		expect(handled).toBe(true);
		expect(state.doc.child(0).textContent).toBe('two');
		expect(state.doc.child(1).textContent).toBe('one');
		expect(state.selection.$from.parent.textContent).toBe('two');
	});

	it('moves a block down past a larger sibling', () => {
		const doc = docFrom([paragraph('a'), quote(paragraph('long quote'))]);
		const { handled, state } = apply(stateAt(doc, 1), moveBlock(1));
		expect(handled).toBe(true);
		expect(state.doc.child(0).type.name).toBe('blockquote');
		expect(state.doc.child(1).textContent).toBe('a');
		expect(state.selection.$from.parent.textContent).toBe('a');
	});

	it('refuses to move the first block up', () => {
		const doc = docFrom([paragraph('only'), paragraph('two')]);
		const { handled } = apply(stateAt(doc, 1), moveBlock(-1));
		expect(handled).toBe(false);
	});
});
