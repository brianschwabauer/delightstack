/**
 * `@delightstack/crdt/prosemirror` — the Loro ⇄ ProseMirror binding (ED-02).
 *
 * Lives here rather than in `@delightstack/editor` so the editor never takes a
 * wasm dependency, and so the one package that is allowed to import
 * `loro-crdt` stays the one package that does.
 *
 * ```ts
 * import { EditorState } from 'prosemirror-state';
 * import { EditorView } from 'prosemirror-view';
 * import { keymap } from 'prosemirror-keymap';
 * import { loroPlugins, loroUndoKeymap } from '@delightstack/crdt/prosemirror';
 *
 * const handle = await crdt.open(node_id);
 * await handle.ready();                       // ← never mount before this
 *
 * const state = EditorState.create({
 *   schema,
 *   plugins: [keymap(loroUndoKeymap), ...loroPlugins({ crdt: handle })],
 * });
 * const view = new EditorView(element, { state });
 * ```
 *
 * Two rules the editor has to keep:
 *
 * 1. **Mount after `handle.ready()`.** `transact()` throws `bootstrap_pending`
 *    until the bootstrap gate clears, and an editor's first transaction writes
 *    an empty document into the CRDT — which is exactly what makes a device
 *    unbootstrappable from a compacted server.
 * 2. **No `prosemirror-history`.** Undo is Loro's, scoped to this peer;
 *    ProseMirror's stack would happily undo a collaborator's or an agent's
 *    edit. In `@delightstack/editor`, pass the `history` option a factory (or
 *    `false`) — see its README.
 */

import type { Node as PmNode, Schema } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';
import type { LoroDoc } from 'loro-crdt';
import { DelightError } from '@delightstack/utilities';
import type { Actor, Frontier } from '../types.js';
import { decodeFrontier } from '../client/frontier.js';
import { LoroPmBinding, commitPmDoc, loroSync, type LoroSyncOptions } from './sync.js';
import { loroUndo, type LoroUndoOptions } from './undo.js';
import { LoroPmMapping } from './types.js';
import { pmDocFromLoro } from './convert.js';
import type { CrdtBinding } from './types.js';

export {
	ATTRIBUTES_KEY,
	CHILDREN_KEY,
	LoroPmMapping,
	NODE_NAME_KEY,
	PM_INIT_ORIGIN,
	PM_ORIGIN,
	PM_STRUCTURE_ORIGIN,
	ROOT_KEY,
	type CrdtBinding,
	type LoroKind,
	type LoroPmMappingValue,
	type PmChildItem,
} from './types.js';

export {
	attributesFromMarks,
	containerIdOf,
	kindOf,
	marksFromAttributes,
	pmDocFromLoro,
	pmNodeFromLoro,
	pmTextsFromLoro,
	type LoroChildList,
	type LoroNodeMap,
} from './convert.js';

export {
	configureTextStyle,
	createScaffolding,
	pmChildItems,
	syncNode,
	writePmDocToLoro,
	type WritePass,
} from './write.js';

export { applyPmDiff } from './diff.js';

export { caretAnchorAt, resolveCaretAnchor, type CaretAnchor } from './cursor.js';

export {
	LoroPmBinding,
	commitPmDoc,
	crdtBindingFromDoc,
	loroSync,
	loroSyncKey,
	type LoroSyncMeta,
	type LoroSyncOptions,
	type LoroSyncState,
	type PmHost,
} from './sync.js';

export {
	DEFAULT_MAX_UNDO_STEPS,
	DEFAULT_UNDO_MERGE_INTERVAL_MS,
	canRedo,
	canUndo,
	loroUndo,
	loroUndoKey,
	loroUndoKeymap,
	redo,
	undo,
	type LoroUndoOptions,
	type LoroUndoState,
} from './undo.js';

/**
 * The binding's plugins, in the order they must be installed.
 *
 * `loroUndo` reads `loroSync`'s state to find the document, so the order is not
 * cosmetic; this exists so nobody has to remember that.
 */
export function loroPlugins(options: LoroSyncOptions & LoroUndoOptions): Plugin[] {
	return [
		loroSync({ crdt: options.crdt, actor: options.actor }),
		loroUndo({
			merge_interval_ms: options.merge_interval_ms,
			max_steps: options.max_steps,
		}),
	];
}

/**
 * Make the document equal `pm_doc` by writing forward.
 *
 * The schema-aware half of restore. `@delightstack/crdt`'s own `restore()` uses
 * Loro's `revertTo`, which needs the target version still in the op log — so a
 * checkpoint that survived compaction only as a snapshot can be read but not
 * reverted to, and throws `restore_unreachable`. Read that version's `pm_doc`
 * out of a fork with {@link pmDocAtFrontier} and pass it here instead: the
 * result is the same document, reached by new operations, which is what
 * "restore writes forward" means.
 *
 * Pass the live {@link LoroPmBinding} when there is one — it reuses the
 * editor's mapping, so untouched blocks are skipped outright rather than
 * re-walked.
 */
export function restorePmDoc(
	target: LoroPmBinding | CrdtBinding,
	pm_doc: PmNode,
	opts?: { actor?: Actor },
): void {
	const binding = target instanceof LoroPmBinding ? target : null;
	const crdt = binding ? binding.crdt : (target as CrdtBinding);
	if (crdt.doc.isDetached()) {
		throw new DelightError({
			message: 'This document is showing an old version.',
			status: 409,
			code: 'pm_detached',
			detail:
				'Call checkoutToLatest() before restoring — operations written while ' +
				'detached are written at a point history has already moved past.',
		});
	}
	commitPmDoc(crdt, pm_doc, binding?.mapping ?? new LoroPmMapping(), {
		actor: opts?.actor,
	});
}

/**
 * The `pm_doc` this document had at an old version.
 *
 * Reads from a fork, so the live document is never detached and the editor
 * keeps working while a history panel renders the old version beside it.
 */
export function pmDocAtFrontier(
	schema: Schema,
	doc: LoroDoc,
	frontier: Frontier,
): PmNode {
	const fork = doc.fork();
	fork.checkout(decodeFrontier(frontier));
	return pmDocFromLoro(schema, fork);
}
