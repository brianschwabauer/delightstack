import { Plugin, PluginKey } from 'prosemirror-state';

export const blockIdKey = new PluginKey('block_id');

let counter = 0;

/** Collision-safe id: time component + counter + entropy. */
export function createBlockId(): string {
	const entropy = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
	return `${Date.now().toString(36)}${(counter++ % 1296).toString(36).padStart(2, '0')}${entropy}`;
}

/**
 * Ensures every node with a `block_id` attr has a unique, stable id.
 * Runs as an appendTransaction so ids are assigned on load, typing, paste,
 * and drag-copy (duplicates get fresh ids; originals keep theirs).
 * Stable ids are the anchor for presence focus, comments fallback anchoring,
 * and FLIP drop animations.
 */
export function blockIds(): Plugin {
	return new Plugin({
		key: blockIdKey,
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
