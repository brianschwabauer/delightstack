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
		appendTransaction(transactions, _oldState, newState) {
			if (!transactions.some((tr) => tr.docChanged)) return null;
			const seen = new Set<string>();
			let tr = newState.tr;
			let changed = false;
			newState.doc.descendants((node, pos) => {
				if (!('block_id' in node.attrs)) return;
				const id = node.attrs.block_id;
				if (typeof id === 'string' && id && !seen.has(id)) {
					seen.add(id);
					return;
				}
				const block_id = createBlockId();
				seen.add(block_id);
				tr = tr.setNodeMarkup(pos, null, { ...node.attrs, block_id });
				changed = true;
			});
			if (!changed) return null;
			// Id assignment is bookkeeping, not an edit
			return tr.setMeta('addToHistory', false);
		},
	});
}
