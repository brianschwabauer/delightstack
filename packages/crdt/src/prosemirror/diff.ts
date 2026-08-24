/**
 * The smallest set of ProseMirror steps that turns one document into another.
 *
 * The spike's binding replaced the whole document on every remote keystroke —
 * `tr.replace(0, size, …)`. That throws away the caret, every decoration, and
 * every node view, and its cost grows with the document rather than with the
 * edit. It is the second half of the ED-02 rewrite (the first being the live
 * cursor in `cursor.ts`).
 *
 * The recursion below is cheap because the Loro → ProseMirror projection reuses
 * the *same node objects* for untouched subtrees (see `LoroPmMapping`), so the
 * common prefix and suffix are found by reference comparison and the walk only
 * descends into what actually changed.
 */

import { Fragment, Slice, type Node as PmNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';

function nodesEqual(a: PmNode, b: PmNode): boolean {
	return a === b || a.eq(b);
}

function childrenOf(node: PmNode): PmNode[] {
	const children: PmNode[] = [];
	node.forEach((child) => children.push(child));
	return children;
}

/** Two text nodes that differ only in their characters, never their marks. */
function diffText(tr: Transaction, from: number, a: PmNode, b: PmNode): void {
	const a_text = a.text ?? '';
	const b_text = b.text ?? '';
	const limit = Math.min(a_text.length, b_text.length);
	let prefix = 0;
	while (prefix < limit && a_text[prefix] === b_text[prefix]) prefix += 1;
	let suffix = 0;
	while (
		suffix < limit - prefix &&
		a_text[a_text.length - 1 - suffix] === b_text[b_text.length - 1 - suffix]
	) {
		suffix += 1;
	}
	const start = tr.mapping.map(from + prefix);
	const end = tr.mapping.map(from + a_text.length - suffix);
	const inserted = b_text.slice(prefix, b_text.length - suffix);
	if (start === end && inserted.length === 0) return;
	tr.replaceWith(
		start,
		end,
		inserted.length > 0 ? b.type.schema.text(inserted, b.marks) : Fragment.empty,
	);
}

/**
 * Diff `old_node`'s content against `new_node`'s.
 *
 * `content_start` is the position of the first child **in the original
 * document**; every position is mapped through the transaction as it is used,
 * which is valid because the ranges are visited in document order and never
 * overlap.
 */
function diffContent(
	tr: Transaction,
	content_start: number,
	old_node: PmNode,
	new_node: PmNode,
): void {
	const old_children = childrenOf(old_node);
	const new_children = childrenOf(new_node);

	let prefix = 0;
	while (
		prefix < old_children.length &&
		prefix < new_children.length &&
		nodesEqual(old_children[prefix], new_children[prefix])
	) {
		prefix += 1;
	}
	let suffix = 0;
	while (
		suffix < old_children.length - prefix &&
		suffix < new_children.length - prefix &&
		nodesEqual(
			old_children[old_children.length - 1 - suffix],
			new_children[new_children.length - 1 - suffix],
		)
	) {
		suffix += 1;
	}

	let from = content_start;
	for (let i = 0; i < prefix; i += 1) from += old_children[i].nodeSize;
	let to = from;
	for (let i = prefix; i < old_children.length - suffix; i += 1)
		to += old_children[i].nodeSize;

	const old_middle = old_children.slice(prefix, old_children.length - suffix);
	const new_middle = new_children.slice(prefix, new_children.length - suffix);
	if (old_middle.length === 0 && new_middle.length === 0) return;

	if (old_middle.length === 1 && new_middle.length === 1) {
		const a = old_middle[0];
		const b = new_middle[0];
		if (a.isText && b.isText && sameMarks(a, b)) {
			diffText(tr, from, a, b);
			return;
		}
		if (!a.isText && !b.isText && a.type === b.type) {
			if (!a.sameMarkup(b)) {
				tr.setNodeMarkup(tr.mapping.map(from), undefined, b.attrs, b.marks);
			}
			if (!a.isLeaf || !b.isLeaf) diffContent(tr, from + 1, a, b);
			return;
		}
	}

	tr.replace(
		tr.mapping.map(from),
		tr.mapping.map(to),
		new Slice(Fragment.fromArray(new_middle), 0, 0),
	);
}

function sameMarks(a: PmNode, b: PmNode): boolean {
	return (
		a.marks.length === b.marks.length && a.marks.every((mark, i) => mark.eq(b.marks[i]))
	);
}

/**
 * Add the steps that turn `old_doc` into `new_doc` to `tr`.
 *
 * The transaction is returned for chaining; check `tr.docChanged` before
 * dispatching, because "nothing changed" is the common case for an event batch
 * that only touched containers this editor already agrees with.
 */
export function applyPmDiff(
	tr: Transaction,
	old_doc: PmNode,
	new_doc: PmNode,
): Transaction {
	if (nodesEqual(old_doc, new_doc)) return tr;
	if (old_doc.type !== new_doc.type) {
		tr.replaceWith(0, tr.doc.content.size, new_doc.content);
		return tr;
	}
	// The root node's own attrs are deliberately not diffed: ProseMirror has no
	// step that re-marks the document node, and no schema in practice puts
	// meaningful state there.
	diffContent(tr, 0, old_doc, new_doc);
	return tr;
}
