/**
 * The caret, expressed as something a remote edit cannot move out from under.
 *
 * A ProseMirror selection is a pair of absolute integers. A remote insert of
 * five characters before the caret makes both of them wrong, and the spike
 * proved that recovering afterwards does not work: `loro-prosemirror` built its
 * Loro `Cursor` from the absolute position **after** importing the remote
 * update, so it anchored to whichever character had slid into that offset.
 * Measured there: caret at 11, peer inserts `BBBBB` at 0, caret still reads 11
 * and the next keystroke lands in the middle of the user's own word.
 *
 * So the anchor is minted **before** any import can happen — refreshed on every
 * local transaction — and resolved after, in the same ProseMirror transaction
 * that applies the remote change. A Loro `Cursor` is a stable reference to a
 * character, so resolving it later answers "where did that character go?",
 * which is the question the caret actually asks.
 */

import type { Node as PmNode } from 'prosemirror-model';
import type { ContainerID, Cursor, LoroDoc, LoroText } from 'loro-crdt';
import { CHILDREN_KEY, LoroPmMapping, type LoroPmMappingValue } from './types.js';
import {
	containerIdOf,
	kindOf,
	type LoroChildList,
	type LoroNodeMap,
} from './convert.js';

/**
 * Where the caret sits, in terms Loro can rebase.
 *
 * `cursor` is the real answer. `block`/`offset` is the fallback for the one
 * case a text cursor cannot express — an empty textblock, which has no
 * character to anchor to — and for a cursor whose character has been deleted.
 */
export interface CaretAnchor {
	cursor?: Cursor;
	block?: ContainerID;
	offset: number;
}

/** The block container a ProseMirror position sits inside, and its offset. */
function blockAt(
	pm_doc: PmNode,
	position: number,
	mapping: LoroPmMapping,
): { container_id: ContainerID; offset: number } | null {
	let resolved;
	try {
		resolved = pm_doc.resolve(position);
	} catch {
		return null;
	}
	for (let depth = resolved.depth; depth >= 0; depth -= 1) {
		const node = resolved.node(depth);
		const container_id = mapping.by_node.get(node);
		if (container_id) {
			return {
				container_id,
				offset: depth === resolved.depth ? resolved.parentOffset : 0,
			};
		}
	}
	return null;
}

/** A block container's children list, if it has one. */
function childListOf(container: LoroNodeMap): LoroChildList | null {
	const children = container.get(CHILDREN_KEY);
	return kindOf(children) === 'List' ? (children as LoroChildList) : null;
}

/**
 * Size, in ProseMirror positions, of one child container of a block.
 *
 * `null` means "not projected, so its width is unknown". Guessing 1 would be
 * right for an inline atom and silently wrong for anything with content — and a
 * wrong width here does not fail, it puts the caret on the wrong character.
 * Callers bail to a block-level anchor instead.
 */
function childSize(child: unknown, mapping: LoroPmMapping): number | null {
	if (kindOf(child) === 'Text') return (child as LoroText).length;
	const mapped: LoroPmMappingValue | undefined = mapping.by_container.get(
		containerIdOf(child as object),
	);
	if (mapped === undefined) return null;
	if (Array.isArray(mapped)) return mapped.reduce((sum, node) => sum + node.nodeSize, 0);
	return mapped.nodeSize;
}

/**
 * Mint an anchor for one ProseMirror position.
 *
 * Called on every local transaction, which is what makes it *pre-import*: the
 * editor is single-threaded, so an anchor taken while handling a transaction is
 * necessarily older than the next remote event.
 */
export function caretAnchorAt(
	loro_doc: LoroDoc,
	pm_doc: PmNode,
	position: number,
	mapping: LoroPmMapping,
): CaretAnchor | null {
	const block = blockAt(pm_doc, position, mapping);
	if (!block) return null;
	const container = loro_doc.getContainerById(block.container_id);
	if (!container || kindOf(container) !== 'Map') return null;
	const list = childListOf(container as LoroNodeMap);
	if (!list) return { block: block.container_id, offset: block.offset };

	let remaining = block.offset;
	for (const child of list.toArray()) {
		const size = childSize(child, mapping);
		if (size === null) break;
		if (kindOf(child) === 'Text' && remaining <= size) {
			const cursor = (child as LoroText).getCursor(remaining);
			if (cursor) return { cursor, block: block.container_id, offset: block.offset };
			break;
		}
		remaining -= size;
		if (remaining < 0) break;
	}
	return { block: block.container_id, offset: block.offset };
}

/** Absolute position of a node in a document, by identity. */
function positionOfNode(pm_doc: PmNode, node: PmNode): number | null {
	if (node === pm_doc) return 0;
	let found: number | null = null;
	pm_doc.descendants((child, pos) => {
		if (found !== null) return false;
		if (child === node) {
			found = pos;
			return false;
		}
		return true;
	});
	return found;
}

/** The node container that owns a text run container. */
function blockOfText(loro_doc: LoroDoc, text_id: ContainerID): LoroNodeMap | null {
	const text = loro_doc.getContainerById(text_id);
	if (!text) return null;
	const list = (text as LoroText).parent();
	if (!list || kindOf(list) !== 'List') return null;
	const block = (list as LoroChildList).parent();
	return block && kindOf(block) === 'Map' ? (block as LoroNodeMap) : null;
}

/**
 * Resolve an anchor against the freshly projected document.
 *
 * Returns `null` when the block it named is gone — in which case the caller
 * should leave ProseMirror's own step mapping to it, which is right for a
 * deletion and only slightly wrong for anything else.
 */
export function resolveCaretAnchor(
	loro_doc: LoroDoc,
	pm_doc: PmNode,
	anchor: CaretAnchor,
	mapping: LoroPmMapping,
): { position: number; cursor?: Cursor } | null {
	let block_id = anchor.block;
	let inline_offset = anchor.offset;
	let updated: Cursor | undefined;

	if (anchor.cursor) {
		const text_id = anchor.cursor.containerId();
		const position = loro_doc.getCursorPos(anchor.cursor);
		if (position) {
			updated = position.update;
			const block = blockOfText(loro_doc, text_id);
			if (block) {
				block_id = containerIdOf(block);
				const list = childListOf(block);
				let offset: number | null = 0;
				if (list) {
					for (const child of list.toArray()) {
						if (kindOf(child) === 'Text' && containerIdOf(child as object) === text_id)
							break;
						const size = childSize(child, mapping);
						if (size === null) {
							offset = null;
							break;
						}
						offset += size;
					}
				}
				if (offset === null) return null;
				inline_offset = offset + position.offset;
			}
		}
	}

	if (!block_id) return null;
	const node = mapping.by_container.get(block_id);
	if (!node || Array.isArray(node)) return null;
	const block_position = positionOfNode(pm_doc, node);
	if (block_position === null) return null;

	// `+ 1` steps inside the block; the document node is the one case with no
	// opening token to step over.
	const start = node === pm_doc ? 0 : block_position + 1;
	const limit = start + node.content.size;
	return { position: Math.min(start + inline_offset, limit), cursor: updated };
}
