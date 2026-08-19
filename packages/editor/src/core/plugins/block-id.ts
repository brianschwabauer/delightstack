import { Plugin, PluginKey } from 'prosemirror-state';
import { Fragment, Node as PMNode, Slice } from 'prosemirror-model';
import { generateTimestampID } from '@delightstack/utilities';

export const blockIdKey = new PluginKey('block_id');

/**
 * 8 base62 chars of millisecond timestamp + 4 of entropy. The timestamp
 * prefix makes ids sort by creation, which structural diff and per-block
 * restore both want for free. `generateTimestampID` bumps an internal
 * counter when called twice in the same millisecond, so a bulk paste of a
 * hundred blocks cannot collide with itself.
 */
const BLOCK_ID_LENGTH = 12;

/** Separates the source document's id from the block's own id on the clipboard. */
const DOC_SEPARATOR = ':';

export interface BlockIdOptions {
	/**
	 * Identity of the document being edited. Blocks pasted from a *different*
	 * document get fresh ids, so one block id never names two blocks. Defaults
	 * to a per-editor id, which makes every paste from elsewhere foreign.
	 */
	doc_id?: string;
}

/** Collision-safe, creation-ordered id. */
export function createBlockId(): string {
	return generateTimestampID({ length: BLOCK_ID_LENGTH });
}

/** Rewrites every `block_id` in a fragment through `next`. `null` clears it. */
function mapBlockIds(fragment: Fragment, next: (id: string) => string | null): Fragment {
	const nodes: PMNode[] = [];
	fragment.forEach((node) => {
		const content = mapBlockIds(node.content, next);
		const id = node.attrs.block_id;
		if (!('block_id' in node.attrs) || typeof id !== 'string' || !id) {
			nodes.push(node.copy(content));
			return;
		}
		nodes.push(node.type.create({ ...node.attrs, block_id: next(id) }, content, node.marks));
	});
	return Fragment.fromArray(nodes);
}

function mapSlice(slice: Slice, next: (id: string) => string | null): Slice {
	return new Slice(mapBlockIds(slice.content, next), slice.openStart, slice.openEnd);
}

/**
 * Ensures every node with a `block_id` attr has a unique, stable id.
 * Runs as an appendTransaction so ids are assigned on load, typing, paste,
 * and drag-copy (duplicates get fresh ids; originals keep theirs).
 * Stable ids are the anchor for presence focus, comments fallback anchoring,
 * and FLIP drop animations.
 *
 * Splitting a block leaves the id on the first half; joining keeps the
 * first's; deleting and retyping produces a new one. Copying stamps the
 * source document onto each id so a paste can tell "moved within this
 * document" (keep the id) from "copied out of another one" (regenerate).
 */
export function blockIds(options: BlockIdOptions = {}): Plugin {
	// Without an app-supplied identity, each editor instance is its own
	// document — the safe default, since it can only cause regeneration.
	const doc_id = options.doc_id || createBlockId();
	return new Plugin({
		key: blockIdKey,
		props: {
			transformCopied(slice) {
				return mapSlice(slice, (id) => `${doc_id}${DOC_SEPARATOR}${id}`);
			},
			transformPasted(slice) {
				return mapSlice(slice, (id) => {
					const at = id.indexOf(DOC_SEPARATOR);
					// No stamp at all — foreign HTML, or an app that writes its
					// own `data-block-id`. Never trust it.
					if (at < 0) return null;
					if (id.slice(0, at) !== doc_id) return null;
					return id.slice(at + 1) || null;
				});
			},
		},
		appendTransaction(transactions, oldState, newState) {
			if (!transactions.some((tr) => tr.docChanged)) return null;
			// Pass 1: collect every occurrence per id, plus missing/empty ids
			const occurrences = new Map<string, number[]>();
			const reassign: number[] = [];
			newState.doc.descendants((node, pos) => {
				if (!('block_id' in node.attrs)) return;
				const id = node.attrs.block_id;
				if (typeof id === 'string' && id) {
					const list = occurrences.get(id);
					if (list) list.push(pos);
					else occurrences.set(id, [pos]);
				} else {
					reassign.push(pos);
				}
			});
			// Pass 2: for duplicated ids the PRE-EXISTING node keeps its id —
			// map its old position forward so duplicating/pasting ABOVE doesn't
			// let the copy steal the original's identity (presence focus,
			// comment anchors)
			for (const [id, positions] of occurrences) {
				if (positions.length < 2) continue;
				let keep = positions[0];
				let old_pos = -1;
				oldState.doc.descendants((node, pos) => {
					if (old_pos >= 0) return false;
					if (node.attrs.block_id === id) old_pos = pos;
					return old_pos < 0;
				});
				if (old_pos >= 0) {
					let mapped = old_pos;
					for (const step of transactions) mapped = step.mapping.map(mapped, 1);
					keep = positions.reduce((best, pos) =>
						Math.abs(pos - mapped) < Math.abs(best - mapped) ? pos : best,
					);
				}
				for (const pos of positions) {
					if (pos !== keep) reassign.push(pos);
				}
			}
			if (!reassign.length) return null;
			let tr = newState.tr;
			for (const pos of reassign) {
				const node = newState.doc.nodeAt(pos);
				if (!node) continue;
				tr = tr.setNodeMarkup(pos, null, { ...node.attrs, block_id: createBlockId() });
			}
			// Id assignment is bookkeeping, not an edit
			return tr.setMeta('addToHistory', false);
		},
	});
}
