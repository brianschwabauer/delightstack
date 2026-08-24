/**
 * The binding itself: a `LoroDoc` and an `EditorState`, kept equal.
 *
 * Two directions, each with one rule that took a spike to learn.
 *
 * **ProseMirror → Loro** happens in `appendTransaction`, and is a
 * reconciliation (`write.ts`), not a rewrite. Every write is stamped with the
 * `PM_ORIGIN` commit origin, which is the only thing that distinguishes "this
 * editor already knows" from "this editor must be told" — `event.by === 'local'`
 * does not, because an undo, a restore, and any `handle.transact()` from app
 * code are all local and all have to reach the editor.
 *
 * **Loro → ProseMirror** rebuilds the projection (reusing every untouched
 * subtree by reference), diffs it into the **minimal** set of steps
 * (`diff.ts`), and restores the caret from an anchor minted *before* the
 * import (`cursor.ts`) — in the same transaction, not a `setTimeout` later.
 */

import { DelightError } from '@delightstack/utilities';
import type { Node as PmNode, Schema } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection, type EditorState } from 'prosemirror-state';
import type { Transaction } from 'prosemirror-state';
import type { ContainerID, LoroDoc, LoroEventBatch } from 'loro-crdt';
import type { Actor } from '../types.js';
import {
	LoroPmMapping,
	PM_INIT_ORIGIN,
	PM_ORIGIN,
	PM_STRUCTURE_ORIGIN,
	ROOT_KEY,
	type CrdtBinding,
} from './types.js';
import { containerIdOf, kindOf, pmDocFromLoro, type LoroNodeMap } from './convert.js';
import { configureTextStyle, createScaffolding, writePmDocToLoro } from './write.js';
import { applyPmDiff } from './diff.js';
import { caretAnchorAt, resolveCaretAnchor, type CaretAnchor } from './cursor.js';

/**
 * The editor surface the binding drives.
 *
 * An `EditorView` satisfies it as-is. It is an interface rather than the view
 * itself so the binding can be exercised — and reasoned about — without a DOM,
 * which is what the convergence tests do.
 */
export interface PmHost {
	readonly state: EditorState;
	dispatch(tr: Transaction): void;
	readonly isDestroyed?: boolean;
}

export interface LoroSyncOptions {
	/** The open document. A `CrdtHandle` from `/client` satisfies this. */
	crdt: CrdtBinding;
	/** Recorded on updates this editor produces. Defaults to the client's. */
	actor?: Actor;
}

export interface LoroSyncState {
	binding: LoroPmBinding;
}

/** Meta set on every transaction the binding dispatches for a remote change. */
export interface LoroSyncMeta {
	remote: true;
}

export const loroSyncKey = new PluginKey<LoroSyncState>('delight_loro_sync');

/**
 * Drive a `LoroDoc` from a bare document, with no client, transport or
 * persistence behind it.
 *
 * For a Durable Object deriving a `pm_doc`, and for tests. In an app, pass the
 * `CrdtHandle` — it is what makes an edit durable and sent.
 */
export function crdtBindingFromDoc(doc: LoroDoc): CrdtBinding {
	return {
		doc,
		transact(fn: (doc: LoroDoc) => void): void {
			fn(doc);
			doc.commit();
		},
		subscribe(fn: (event: LoroEventBatch) => void): () => void {
			return doc.subscribe(fn);
		},
	};
}

/**
 * Write a `pm_doc` into a document as at most three commits.
 *
 * Almost always one: the second and third only happen when a node is missing a
 * container the encoding needs, which is the first character typed into an
 * empty block and nothing else. When that does happen the containers are
 * created under {@link PM_STRUCTURE_ORIGIN}, which the undo manager excludes —
 * see `createScaffolding` for the data loss that prevents.
 */
export function commitPmDoc(
	crdt: CrdtBinding,
	pm_doc: PmNode,
	mapping: LoroPmMapping,
	opts: {
		actor?: Actor;
		/**
		 * Omit to have the binding **project the result back into the editor** —
		 * which is what a restore wants, and what any write the editor did not
		 * itself originate wants. Pass `PM_ORIGIN` for a write that came *from*
		 * the editor, so it is not echoed back.
		 */
		origin?: string;
	} = {},
): void {
	const origin = opts.origin;
	const write_opts = opts.actor === undefined ? undefined : { actor: opts.actor };
	const deferred = new Map<ContainerID, PmNode>();

	crdt.transact((doc) => {
		if (origin !== undefined) doc.setNextCommitOrigin(origin);
		writePmDocToLoro(doc, pm_doc, mapping, deferred);
	}, write_opts);
	if (deferred.size === 0) return;

	crdt.transact((doc) => {
		doc.setNextCommitOrigin(PM_STRUCTURE_ORIGIN);
		createScaffolding(doc, deferred);
	}, write_opts);
	// No deferral sink this time: the containers exist now, and anything still
	// missing is created inline rather than postponed a second time.
	crdt.transact((doc) => {
		if (origin !== undefined) doc.setNextCommitOrigin(origin);
		writePmDocToLoro(doc, pm_doc, mapping);
	}, write_opts);
}

interface CaretState {
	anchor: CaretAnchor | null;
	head: CaretAnchor | null;
	collapsed: boolean;
}

export class LoroPmBinding {
	readonly crdt: CrdtBinding;
	readonly schema: Schema;
	readonly mapping = new LoroPmMapping();

	#actor?: Actor;
	#host: PmHost | null = null;
	#unsubscribe: (() => void) | null = null;
	#writing = false;
	#caret: CaretState = { anchor: null, head: null, collapsed: true };

	constructor(options: { crdt: CrdtBinding; schema: Schema; actor?: Actor }) {
		this.crdt = options.crdt;
		this.schema = options.schema;
		this.#actor = options.actor;
	}

	get attached(): boolean {
		return this.#host !== null;
	}

	/**
	 * True while the Loro document is checked out to an old version.
	 *
	 * Time travel is a read: nothing may be typed into a detached document,
	 * because the ops would be written at a point history has already moved past.
	 * Getting back is `checkoutToLatest()`, and getting the old version *back*
	 * into the document is a restore, which writes forward.
	 */
	get detached(): boolean {
		return this.crdt.doc.isDetached();
	}

	/**
	 * Take over a host, seeding whichever side is empty.
	 *
	 * **Await `handle.ready()` first.** `transact()` throws `bootstrap_pending`
	 * while a document is still opening, and seeding an empty CRDT from an empty
	 * editor before the first sync is exactly the failure the bootstrap gate
	 * exists to prevent.
	 */
	attach(host: PmHost): () => void {
		if (this.#host)
			throw new DelightError({
				message: 'This document is already bound to an editor.',
				status: 409,
				code: 'pm_already_attached',
			});
		this.#host = host;
		configureTextStyle(this.crdt.doc, this.schema);
		this.#unsubscribe = this.crdt.subscribe((event) => this.#onLoroEvent(event));

		const root = this.crdt.doc.getMap(ROOT_KEY) as LoroNodeMap;
		if (root.keys().length === 0) this.writeFromPm(host.state.doc, PM_INIT_ORIGIN);
		else this.projectToPm();
		this.captureCaret(host.state);

		return () => this.detach();
	}

	detach(): void {
		this.#unsubscribe?.();
		this.#unsubscribe = null;
		this.#host = null;
	}

	/** Reconcile the CRDT with a locally-edited `pm_doc`. */
	writeFromPm(pm_doc: PmNode, origin: string = PM_ORIGIN): void {
		if (this.#writing) return;
		this.#writing = true;
		try {
			commitPmDoc(this.crdt, pm_doc, this.mapping, { actor: this.#actor, origin });
		} finally {
			this.#writing = false;
		}
	}

	/**
	 * Mint the caret anchors for the current selection.
	 *
	 * Called on every transaction. That cadence is the point: the anchor must
	 * always be older than the next remote import, and the editor is
	 * single-threaded, so "taken while handling a transaction" guarantees it.
	 */
	captureCaret(state: EditorState): void {
		const { anchor, head } = state.selection;
		const anchor_ref = caretAnchorAt(this.crdt.doc, state.doc, anchor, this.mapping);
		this.#caret = {
			anchor: anchor_ref,
			head:
				head === anchor
					? anchor_ref
					: caretAnchorAt(this.crdt.doc, state.doc, head, this.mapping),
			collapsed: head === anchor,
		};
	}

	/** Project the current CRDT state into the host, minimally. */
	projectToPm(): void {
		const host = this.#host;
		if (!host || host.isDestroyed) return;
		const next = pmDocFromLoro(this.schema, this.crdt.doc, this.mapping);
		const tr = host.state.tr;
		applyPmDiff(tr, host.state.doc, next);
		if (!tr.docChanged) return;
		tr.setMeta(loroSyncKey, { remote: true } satisfies LoroSyncMeta);
		tr.setMeta('addToHistory', false);
		this.#restoreCaret(tr, next);
		host.dispatch(tr);
	}

	/**
	 * `projected` is the document `pmDocFromLoro` just built, not `tr.doc`.
	 *
	 * They are equal in content — that is what the diff guarantees — but only the
	 * projected one holds the *same node objects* the mapping points at.
	 * ProseMirror mints a fresh parent for every node a step touches, so looking
	 * the caret's block up in `tr.doc` by identity fails for exactly the commonest
	 * case: a peer typing inside the paragraph the caret is in.
	 */
	#restoreCaret(tr: Transaction, projected: PmNode): void {
		const { anchor, head, collapsed } = this.#caret;
		if (!anchor) return;
		const resolved_anchor = resolveCaretAnchor(
			this.crdt.doc,
			projected,
			anchor,
			this.mapping,
		);
		if (!resolved_anchor) return;
		const resolved_head = collapsed
			? resolved_anchor
			: head && resolveCaretAnchor(this.crdt.doc, projected, head, this.mapping);

		// Loro hands back a rebased cursor when the character an anchor named was
		// deleted. Keeping it is what stops the caret drifting a second time.
		if (resolved_anchor.cursor) anchor.cursor = resolved_anchor.cursor;
		if (!collapsed && head && resolved_head && resolved_head.cursor) {
			head.cursor = resolved_head.cursor;
		}

		const size = tr.doc.content.size;
		const anchor_pos = Math.min(Math.max(resolved_anchor.position, 0), size);
		const head_pos = Math.min(
			Math.max(resolved_head ? resolved_head.position : anchor_pos, 0),
			size,
		);
		try {
			tr.setSelection(
				TextSelection.between(tr.doc.resolve(anchor_pos), tr.doc.resolve(head_pos)),
			);
		} catch {
			// The block the caret was in no longer exists. ProseMirror's own step
			// mapping already moved the selection somewhere valid; leave it there.
		}
	}

	#onLoroEvent(event: LoroEventBatch): void {
		if (event.by === 'local' && event.origin?.startsWith(PM_ORIGIN)) return;
		for (const inner of event.events) this.#invalidate(inner.target);
		this.projectToPm();
	}

	/** Forget the changed container and every ancestor that contains it. */
	#invalidate(container_id: ContainerID): void {
		this.mapping.invalidate(container_id);
		let container = this.crdt.doc.getContainerById(container_id);
		while (container) {
			const parent: unknown = container.parent();
			if (!parent || kindOf(parent) === null) break;
			this.mapping.invalidate(containerIdOf(parent as object));
			container = parent as typeof container;
		}
	}
}

/**
 * The sync plugin.
 *
 * Install it **before** {@link loroUndo}, which reads this plugin's state to
 * find the document. `loroPlugins()` does that for you.
 */
export function loroSync(options: LoroSyncOptions): Plugin<LoroSyncState> {
	return new Plugin<LoroSyncState>({
		key: loroSyncKey,
		state: {
			init: (_config, state) => ({
				binding: new LoroPmBinding({
					crdt: options.crdt,
					schema: state.schema,
					actor: options.actor,
				}),
			}),
			apply: (_tr, value) => value,
		},
		props: {
			editable: (state) => !loroSyncKey.getState(state)?.binding.detached,
		},
		appendTransaction: (transactions, _old_state, new_state) => {
			const binding = loroSyncKey.getState(new_state)?.binding;
			if (!binding?.attached) return null;
			// A batch is "local" unless every document change in it came from the
			// binding itself. An id-stamping or normalising plugin that appends to
			// a remote transaction is a local change and must be written through.
			const local = transactions.some((tr) => tr.docChanged && !tr.getMeta(loroSyncKey));
			if (local) binding.writeFromPm(new_state.doc);
			binding.captureCaret(new_state);
			return null;
		},
		view: (view) => {
			const binding = loroSyncKey.getState(view.state)?.binding;
			if (!binding) return {};
			const detach = binding.attach(view);
			return { destroy: detach };
		},
	});
}
