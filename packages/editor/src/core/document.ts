import { Fragment, Node as PMNode } from 'prosemirror-model';
import { createBlockId } from './plugins/block-id.js';

/**
 * Document surgery: cutting one document in two, and joining two into one.
 *
 * This is the half of split & merge that is about *documents* rather than about
 * blocks. `backspaceCommand` already joins two blocks and the block-id plugin
 * already splits one; what an app building a Scrivener-style "split this scene
 * here" gesture has to do instead is take the trailing half of a document away
 * and make it a second document — and later put it back.
 *
 * Both functions are **pure**: node in, node out. No `EditorState`, no
 * transaction, no view. That is deliberate, because the two halves of a split
 * do not live in the same editor: the head stays where it is and the tail is
 * written into a document that has no editor open on it at all. A `Command`
 * could only ever have expressed the first of those.
 *
 * ## Block ids
 *
 * The package's rule is that a block id names one block, and that survives here
 * in both directions:
 *
 * - {@link splitAt} leaves every id in the **head** untouched. Any id that
 *   would appear in both halves — the block the cut ran through — is
 *   regenerated in the tail, which is the same "first half keeps it" rule
 *   splitting a paragraph already follows.
 * - {@link joinDocuments} leaves every id in **`a`** untouched and regenerates
 *   only those of `b`'s that `a` already uses.
 *
 * So an id is stable across the operation wherever it can be, and unique
 * afterwards without exception.
 */

/** The two halves {@link splitAt} answers with. */
export interface SplitDocument {
	/** Everything before the cut. Keeps the document's attrs and every block id. */
	head: PMNode;
	/** Everything from the cut on, with colliding block ids regenerated. */
	tail: PMNode;
}

/** What {@link joinDocuments} may put between the two documents. */
export interface JoinDocumentsOptions {
	/**
	 * Blocks placed between `a`'s content and `b`'s.
	 *
	 * Nothing by default, because in a block document the blocks are already
	 * separate — a "blank line" separator is what the absence of a separator
	 * looks like once the markdown is written out. A host that wants a
	 * horizontal rule, a scene break or a heading between the two builds the
	 * node itself: what those mean is the host's dialect, not this package's.
	 */
	separator?: PMNode | readonly PMNode[] | null;
	/**
	 * Drop trailing empty paragraphs from `a` before joining. Default `true`.
	 *
	 * A document being typed into ends in an empty paragraph almost all of the
	 * time — it is where the caret is — and appending after it puts a blank
	 * block in the middle of the joined document at exactly the seam the reader
	 * is looking at.
	 */
	trim_trailing_empty?: boolean;
}

/** The children of a node, as an array. */
function childrenOf(node: PMNode): PMNode[] {
	const children: PMNode[] = [];
	node.content.forEach((child) => children.push(child));
	return children;
}

/** Whether a block is a paragraph with nothing in it. */
function isEmptyParagraph(node: PMNode): boolean {
	return node.type.name === 'paragraph' && node.content.size === 0;
}

/** Every `block_id` in a fragment, at any depth. */
function collectBlockIds(fragment: Fragment, into: Set<string>): Set<string> {
	fragment.forEach((node) => {
		const id = node.attrs.block_id;
		if (typeof id === 'string' && id.length > 0) into.add(id);
		collectBlockIds(node.content, into);
	});
	return into;
}

/**
 * Rewrite every `block_id` in `fragment` that `taken` already holds, adding
 * each id it keeps or mints to `taken` as it goes.
 *
 * The `taken` set doubles as the within-fragment uniqueness check: a fragment
 * that somehow arrived holding one id twice comes out holding two.
 */
function reassignCollisions(fragment: Fragment, taken: Set<string>): Fragment {
	const nodes: PMNode[] = [];
	fragment.forEach((node) => {
		const id = node.attrs.block_id;
		if (typeof id !== 'string' || id.length === 0) {
			nodes.push(node.copy(reassignCollisions(node.content, taken)));
			return;
		}
		const next = taken.has(id) ? createBlockId() : id;
		taken.add(next);
		nodes.push(
			node.type.create(
				{ ...node.attrs, block_id: next },
				reassignCollisions(node.content, taken),
				node.marks,
			),
		);
	});
	return Fragment.fromArray(nodes);
}

/**
 * Drop the nodes a cut emptied that are not allowed to be empty.
 *
 * A cut at a position *inside* a wrapper but before any of its content — the
 * gap between a list's opening and its first item is one, and every nesting
 * level has one — leaves that wrapper behind on the other side of the seam with
 * nothing in it. `bullet_list` is `list_item+` and `list_item` is `block+`, so
 * the half holding the husk is a document ProseMirror will refuse: it cannot be
 * `check()`ed, put in a `Transform`, or reliably serialized.
 *
 * The test is the node's own content expression rather than a list of type
 * names, so a host's dialect gets the same treatment as the package's schema:
 * an empty `paragraph` is `inline*` and stays, an empty `horizontal_rule` has
 * no content to lack and stays, an empty `list_item` cannot exist and goes.
 * Bottom-up, because emptying the last child is what empties its parent.
 */
function pruneEmpty(fragment: Fragment): Fragment {
	const nodes: PMNode[] = [];
	fragment.forEach((node) => {
		if (node.isLeaf || node.isText) {
			nodes.push(node);
			return;
		}
		const content = pruneEmpty(node.content);
		if (content.size === 0 && !node.type.validContent(Fragment.empty)) return;
		nodes.push(node.copy(content));
	});
	return Fragment.fromArray(nodes);
}

/**
 * Cut a document in two at `pos`.
 *
 * `pos` is a position in `doc`, and both halves are documents of the same type
 * with the same attrs — not slices. A cut that lands *inside* a textblock
 * splits it, and the two resulting blocks are both complete: the head's keeps
 * the original id and the tail's is minted, which is the rule splitting a
 * paragraph with `Enter` already follows.
 *
 * A cut at position `0` gives an empty head and the whole document as the tail;
 * a cut at `doc.content.size` gives the reverse. Neither is an error — deciding
 * that an empty half means the gesture should be refused is the host's, because
 * only the host knows whether it was a keystroke or a menu.
 *
 * @throws RangeError if `pos` is outside the document.
 */
export function splitAt(doc: PMNode, pos: number): SplitDocument {
	if (pos < 0 || pos > doc.content.size) {
		throw new RangeError(`splitAt: ${pos} is outside a document of ${doc.content.size}`);
	}
	// `cut` keeps the surrounding structure of a position inside a list or a
	// quote, which `slice` deliberately does not — the tail of a cut through a
	// list has to be a list, not three loose items.
	// A cut in the gap before a wrapper's first child leaves the wrapper behind
	// on the other side with nothing in it, and that half is then a document the
	// schema refuses. Pruned on both halves, and on the head *before* its ids are
	// counted, so a husk the head just dropped does not make the tail regenerate
	// the id it is the only one holding.
	const head = doc.type.create(doc.attrs, pruneEmpty(doc.cut(0, pos).content), doc.marks);
	const cut_tail = pruneEmpty(doc.cut(pos).content);
	// Every id the head kept is spoken for. The tail regenerates only what it
	// would otherwise duplicate, which for a cut at a block boundary is nothing
	// at all.
	const taken = collectBlockIds(head.content, new Set());
	return {
		head,
		tail: doc.type.create(doc.attrs, reassignCollisions(cut_tail, taken), doc.marks),
	};
}

/**
 * Join two documents into one: `a`'s content, then the separator, then `b`'s.
 *
 * The result takes **`a`'s** type and attrs — a merge appends *into* a document
 * rather than producing a third one, and whatever `b`'s doc node was carrying
 * described a document that is about to stop existing.
 */
export function joinDocuments(
	a: PMNode,
	b: PMNode,
	options: JoinDocumentsOptions = {},
): PMNode {
	const kept = childrenOf(a);
	if (options.trim_trailing_empty !== false) {
		while (kept.length > 0 && isEmptyParagraph(kept[kept.length - 1])) kept.pop();
	}
	const separator =
		options.separator == null
			? []
			: Array.isArray(options.separator)
				? [...(options.separator as readonly PMNode[])]
				: [options.separator as PMNode];

	// `a`'s ids — the separator's too, if the host built one carrying an id —
	// are what `b` has to avoid.
	const taken = collectBlockIds(Fragment.fromArray([...kept, ...separator]), new Set());
	const appended: PMNode[] = [];
	reassignCollisions(b.content, taken).forEach((child) => appended.push(child));
	return a.type.create(
		a.attrs,
		Fragment.fromArray([...kept, ...separator, ...appended]),
		a.marks,
	);
}
