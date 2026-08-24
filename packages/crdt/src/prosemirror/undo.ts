/**
 * Undo, scoped to the local peer.
 *
 * `prosemirror-history` is wrong for a collaborative document and wrong in a
 * way that is easy to miss: its stack is a list of *steps applied to this
 * editor*, so a remote peer's paragraph and an agent's rewrite are both on it.
 * `Cmd+Z` then deletes someone else's work. This is the bug `06-editor.md`
 * calls out by name.
 *
 * Loro's `UndoManager` is bound to one peer id and cannot revert another peer's
 * changes — it rebases its stack over them instead. So when a CRDT is bound,
 * the editor must not install its own history plugin; `@delightstack/editor`
 * exposes the `history` option as exactly that seam.
 */

import { DelightError } from '@delightstack/utilities';
import { Plugin, PluginKey, type Command, type EditorState } from 'prosemirror-state';
import { UndoManager } from '../loro.client.js';
import { PM_INIT_ORIGIN, PM_STRUCTURE_ORIGIN } from './types.js';
import { loroSyncKey } from './sync.js';

/** Undo steps closer together than this merge into one. Loro's own default. */
export const DEFAULT_UNDO_MERGE_INTERVAL_MS = 1_000;

/** How many undo steps are retained. Loro's own default. */
export const DEFAULT_MAX_UNDO_STEPS = 100;

export interface LoroUndoOptions {
	merge_interval_ms?: number;
	max_steps?: number;
}

export interface LoroUndoState {
	manager: UndoManager;
}

export const loroUndoKey = new PluginKey<LoroUndoState>('delight_loro_undo');

/**
 * The undo plugin. Must be installed **after** {@link loroSync}, whose state it
 * reads to find the document — `loroPlugins()` does that ordering for you.
 */
export function loroUndo(options: LoroUndoOptions = {}): Plugin<LoroUndoState> {
	return new Plugin<LoroUndoState>({
		key: loroUndoKey,
		state: {
			init: (_config, state) => {
				const sync = loroSyncKey.getState(state);
				if (!sync) {
					throw new DelightError({
						message: 'Undo needs the Loro sync plugin.',
						status: 500,
						code: 'pm_sync_plugin_missing',
						detail: 'Install loroSync() before loroUndo(), or use loroPlugins().',
					});
				}
				return {
					manager: new UndoManager(sync.binding.crdt.doc, {
						mergeInterval: options.merge_interval_ms ?? DEFAULT_UNDO_MERGE_INTERVAL_MS,
						maxUndoSteps: options.max_steps ?? DEFAULT_MAX_UNDO_STEPS,
						// Neither of these is an edit anybody made, and both create
						// containers. Undoing a container's creation deletes it, and a
						// deleted container takes every concurrent edit inside it —
						// which is how a peer's paragraph disappears when you press
						// Cmd+Z. See `createScaffolding` in `write.ts`.
						excludeOriginPrefixes: [PM_INIT_ORIGIN, PM_STRUCTURE_ORIGIN],
					}),
				};
			},
			apply: (_tr, value) => value,
		},
		view: (view) => ({
			destroy: () => {
				// The manager holds a wasm object. Nothing else will drop it, and it
				// outlives the document if it is not freed here.
				loroUndoKey.getState(view.state)?.manager.free();
			},
		}),
	});
}

function step(state: EditorState, kind: 'undo' | 'redo', dispatch: boolean): boolean {
	const undo_state = loroUndoKey.getState(state);
	const sync_state = loroSyncKey.getState(state);
	if (!undo_state || !sync_state) return false;
	const available =
		kind === 'undo' ? undo_state.manager.canUndo() : undo_state.manager.canRedo();
	if (!available) return false;
	if (!dispatch) return true;
	// Through `transact()`, not straight at the document: the resulting ops have
	// to be persisted and sent like any other edit. The editor learns about them
	// the same way it learns about a remote change — through the Loro event.
	sync_state.binding.crdt.transact(() => {
		if (kind === 'undo') undo_state.manager.undo();
		else undo_state.manager.redo();
	});
	return true;
}

/** ProseMirror command: undo this peer's last edit. */
export const undo: Command = (state, dispatch) =>
	step(state, 'undo', dispatch !== undefined);

/** ProseMirror command: redo this peer's last undone edit. */
export const redo: Command = (state, dispatch) =>
	step(state, 'redo', dispatch !== undefined);

export function canUndo(state: EditorState): boolean {
	return loroUndoKey.getState(state)?.manager.canUndo() ?? false;
}

export function canRedo(state: EditorState): boolean {
	return loroUndoKey.getState(state)?.manager.canRedo() ?? false;
}

/**
 * The bindings `prosemirror-history` would have owned.
 *
 * Pass to `keymap()` from `prosemirror-keymap`; this package does not depend on
 * it, so the object is plain.
 */
export const loroUndoKeymap: Record<string, Command> = {
	'Mod-z': undo,
	'Mod-y': redo,
	'Mod-Shift-z': redo,
};
