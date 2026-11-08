import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from 'prosemirror-model';
import { Editor } from './editor.svelte.js';
import { joinDocuments, splitAt } from './document.js';
import type { JSONContent } from '../types/index.js';

/** A document built through a real `Editor`, so the schema is the shipped one. */
function docOf(content: JSONContent[]): PMNode {
	const editor = new Editor({ content: { type: 'doc', content } });
	return editor.state.doc;
}

function paragraph(text: string, block_id?: string): JSONContent {
	return {
		type: 'paragraph',
		...(block_id ? { attrs: { block_id } } : {}),
		content: [{ type: 'text', text }],
	};
}

function heading(text: string, block_id?: string): JSONContent {
	return {
		type: 'heading',
		attrs: { level: 2, ...(block_id ? { block_id } : {}) },
		content: [{ type: 'text', text }],
	};
}

/** The text of each top-level block, so a structural assertion reads as prose. */
function blocks(node: PMNode): string[] {
	const out: string[] = [];
	node.content.forEach((child) => out.push(child.textContent));
	return out;
}

/** Every `block_id` in a document, at any depth, in document order. */
function ids(node: PMNode): string[] {
	const out: string[] = [];
	node.descendants((child) => {
		const id = child.attrs.block_id;
		if (typeof id === 'string' && id.length > 0) out.push(id);
		return true;
	});
	return out;
}

/** The position immediately before the top-level block at `index`. */
function beforeBlock(doc: PMNode, index: number): number {
	let pos = 0;
	for (let at = 0; at < index; at += 1) pos += doc.child(at).nodeSize;
	return pos;
}

describe('splitAt', () => {
	it('cuts at a block boundary without touching either half', () => {
		const doc = docOf([
			paragraph('one', 'a'),
			paragraph('two', 'b'),
			paragraph('three', 'c'),
		]);
		const { head, tail } = splitAt(doc, beforeBlock(doc, 1));

		expect(blocks(head)).toEqual(['one']);
		expect(blocks(tail)).toEqual(['two', 'three']);
		expect(ids(head)).toEqual(['a']);
		expect(ids(tail)).toEqual(['b', 'c']);
	});

	it('cuts at the very start: an empty head, the whole document as the tail', () => {
		const doc = docOf([paragraph('one', 'a'), paragraph('two', 'b')]);
		const { head, tail } = splitAt(doc, 0);

		expect(head.content.size).toBe(0);
		expect(blocks(tail)).toEqual(['one', 'two']);
		expect(ids(tail)).toEqual(['a', 'b']);
	});

	it('cuts at the very end: the whole document as the head, an empty tail', () => {
		const doc = docOf([paragraph('one', 'a'), paragraph('two', 'b')]);
		const { head, tail } = splitAt(doc, doc.content.size);

		expect(blocks(head)).toEqual(['one', 'two']);
		expect(tail.content.size).toBe(0);
		expect(ids(head)).toEqual(['a', 'b']);
	});

	it('splits the block the cut runs through, leaving the id on the first half', () => {
		const doc = docOf([paragraph('onetwo', 'a'), paragraph('three', 'b')]);
		// Three characters into the first paragraph.
		const { head, tail } = splitAt(doc, 4);

		expect(blocks(head)).toEqual(['one']);
		expect(blocks(tail)).toEqual(['two', 'three']);
		expect(ids(head)).toEqual(['a']);
		// The head kept `a`, so the tail's opening block had to be reassigned.
		expect(ids(tail)[0]).not.toBe('a');
		expect(ids(tail)[1]).toBe('b');
	});

	it('keeps the surrounding list when the cut lands inside one', () => {
		const doc = docOf([
			{
				type: 'bullet_list',
				attrs: { block_id: 'list' },
				content: [
					{
						type: 'list_item',
						attrs: { block_id: 'i1' },
						content: [paragraph('one', 'p1')],
					},
					{
						type: 'list_item',
						attrs: { block_id: 'i2' },
						content: [paragraph('two', 'p2')],
					},
				],
			},
		]);
		// Between the two items.
		const first = doc.child(0).child(0);
		const { head, tail } = splitAt(doc, 1 + first.nodeSize);

		expect(head.child(0).type.name).toBe('bullet_list');
		expect(tail.child(0).type.name).toBe('bullet_list');
		expect(head.textContent).toBe('one');
		expect(tail.textContent).toBe('two');
	});

	it('keeps the surrounding quote when the cut lands inside one', () => {
		const doc = docOf([
			{
				type: 'blockquote',
				attrs: { block_id: 'q' },
				content: [paragraph('one', 'p1'), paragraph('two', 'p2')],
			},
		]);
		const { head, tail } = splitAt(doc, 1 + doc.child(0).child(0).nodeSize);

		expect(head.child(0).type.name).toBe('blockquote');
		expect(tail.child(0).type.name).toBe('blockquote');
		expect(head.textContent).toBe('one');
		expect(tail.textContent).toBe('two');
		// The quote itself appears in both halves, so only one of them may keep
		// its id.
		expect(ids(head)).toContain('q');
		expect(ids(tail)).not.toContain('q');
	});

	it('never lets one id name a block in both halves', () => {
		const doc = docOf([
			heading('Two', 'h'),
			paragraph('onetwo', 'a'),
			paragraph('x', 'b'),
		]);
		for (let pos = 0; pos <= doc.content.size; pos += 1) {
			const { head, tail } = splitAt(doc, pos);
			const head_ids = new Set(ids(head));
			const both = ids(tail).filter((id) => head_ids.has(id));
			expect(both, `position ${pos}`).toEqual([]);
			// And no half repeats an id within itself.
			expect(new Set(ids(tail)).size).toBe(ids(tail).length);
			expect(head_ids.size).toBe(ids(head).length);
		}
	});

	it('gives two schema-valid halves at every position, losing no text', () => {
		// A structure with something to cut through at every depth: a list, a
		// quote, an atom with no content of its own, and a heading.
		const doc = docOf([
			heading('Two', 'h'),
			{
				type: 'bullet_list',
				attrs: { block_id: 'list' },
				content: [
					{
						type: 'list_item',
						attrs: { block_id: 'i1' },
						content: [paragraph('one', 'p1')],
					},
					{
						type: 'list_item',
						attrs: { block_id: 'i2' },
						content: [paragraph('two', 'p2')],
					},
				],
			},
			{ type: 'horizontal_rule', attrs: { block_id: 'hr' } },
			{
				type: 'blockquote',
				attrs: { block_id: 'q' },
				content: [paragraph('three', 'p3')],
			},
			paragraph('four', 'p4'),
		]);

		for (let pos = 0; pos <= doc.content.size; pos += 1) {
			const { head, tail } = splitAt(doc, pos);
			// `check()` throws on a node whose content does not satisfy its own
			// schema — an empty list item, a table with half a row. A half that
			// fails it cannot be written into a document or serialized, so a
			// caller that only reads the ids would never find out.
			//
			// The empty half a cut at either end produces is the documented
			// exception: `doc` is `block+`, so a document with nothing in it is
			// not valid *and* not an error — whether an empty half means the
			// gesture should be refused is the host's to decide, and the host is
			// what fills it with a paragraph if it goes ahead.
			if (head.content.size > 0) {
				expect(() => head.check(), `head at ${pos}`).not.toThrow();
			}
			if (tail.content.size > 0) {
				expect(() => tail.check(), `tail at ${pos}`).not.toThrow();
			}
			// Nothing falls between the two halves.
			expect(head.textContent + tail.textContent, `text at ${pos}`).toBe(
				doc.textContent,
			);
		}
	});

	it('refuses a position outside the document', () => {
		const doc = docOf([paragraph('one', 'a')]);
		expect(() => splitAt(doc, -1)).toThrow(RangeError);
		expect(() => splitAt(doc, doc.content.size + 1)).toThrow(RangeError);
	});
});

describe('joinDocuments', () => {
	it('appends the second document after the first', () => {
		const a = docOf([paragraph('one', 'a')]);
		const b = docOf([paragraph('two', 'b'), paragraph('three', 'c')]);

		expect(blocks(joinDocuments(a, b))).toEqual(['one', 'two', 'three']);
		expect(ids(joinDocuments(a, b))).toEqual(['a', 'b', 'c']);
	});

	it('drops the trailing empty paragraph the caret was sitting in', () => {
		const a = docOf([
			paragraph('one', 'a'),
			{ type: 'paragraph', attrs: { block_id: 'z' } },
		]);
		const b = docOf([paragraph('two', 'b')]);

		expect(blocks(joinDocuments(a, b))).toEqual(['one', 'two']);
		expect(blocks(joinDocuments(a, b, { trim_trailing_empty: false }))).toEqual([
			'one',
			'',
			'two',
		]);
	});

	it('puts a separator between the two', () => {
		const a = docOf([paragraph('one', 'a')]);
		const b = docOf([paragraph('two', 'b')]);
		const rule = a.type.schema.nodes.horizontal_rule.create();

		const joined = joinDocuments(a, b, { separator: rule });
		expect(joined.child(1).type.name).toBe('horizontal_rule');
		expect(blocks(joined)).toEqual(['one', '', 'two']);
	});

	it('regenerates only the ids the first document already uses', () => {
		const a = docOf([paragraph('one', 'shared'), paragraph('two', 'a')]);
		const b = docOf([paragraph('three', 'shared'), paragraph('four', 'b')]);

		const joined = ids(joinDocuments(a, b));
		expect(joined.slice(0, 2)).toEqual(['shared', 'a']);
		expect(joined[2]).not.toBe('shared');
		expect(joined[3]).toBe('b');
		expect(new Set(joined).size).toBe(joined.length);
	});

	it('is the inverse of a split at a block boundary', () => {
		const doc = docOf([
			paragraph('one', 'a'),
			paragraph('two', 'b'),
			paragraph('three', 'c'),
		]);
		const { head, tail } = splitAt(doc, beforeBlock(doc, 1));

		const rejoined = joinDocuments(head, tail);
		expect(blocks(rejoined)).toEqual(blocks(doc));
		expect(ids(rejoined)).toEqual(ids(doc));
	});

	it('takes the first document’s attrs, not the second’s', () => {
		const a = docOf([paragraph('one', 'a')]);
		const b = docOf([paragraph('two', 'b')]);
		expect(joinDocuments(a, b).type).toBe(a.type);
	});
});
