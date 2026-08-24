/**
 * The shape a ProseMirror document takes inside a Loro document, and the
 * bookkeeping that maps one onto the other.
 *
 * Every Loro import in this file is **type-only** on purpose: these types are
 * shared by the browser binding and by anything that wants to read a `pm_doc`
 * out of a Loro document server-side, and a value import would pin one of the
 * three incompatible wasm builds into both. See `loro.server.ts` for why that
 * matters.
 */

import type { ContainerID, LoroDoc, LoroEventBatch } from 'loro-crdt';
import type { Node as PmNode } from 'prosemirror-model';
import type { Actor } from '../types.js';

/** Root container name. The whole `pm_doc` hangs off `doc.getMap(ROOT_KEY)`. */
export const ROOT_KEY = 'doc';

/** Key on a node container holding its ProseMirror node type name. */
export const NODE_NAME_KEY = 'nodeName';

/** Key on a node container holding its `LoroMap` of ProseMirror attrs. */
export const ATTRIBUTES_KEY = 'attributes';

/** Key on a node container holding its `LoroList` of child containers. */
export const CHILDREN_KEY = 'children';

/**
 * Commit origin stamped on every write the binding makes on behalf of a local
 * ProseMirror transaction.
 *
 * It is the loop-breaker. The binding cannot decide "is this event mine?" from
 * `event.by`, because `by: 'local'` also covers an undo, a restore, and any
 * write app code makes through `handle.transact()` — all of which *must* reach
 * the editor. Only the origin distinguishes "the editor already knows about
 * this" from "the editor needs to be told".
 */
export const PM_ORIGIN = 'delight:pm';

/**
 * Origin for the one write that seeds an empty CRDT from an empty editor.
 *
 * It is a `PM_ORIGIN` prefix match, so the binding still recognises it as its
 * own, but it is excluded from the undo stack: "undo" on a freshly opened
 * document must not delete the document's own root container.
 */
export const PM_INIT_ORIGIN = 'delight:pm:init';

/**
 * Origin for the commit that creates a `pm_doc`'s *scaffolding* — the `children`
 * lists, text runs and attribute maps the encoding needs, as opposed to
 * anything a person typed.
 *
 * It is a `PM_ORIGIN` prefix match, so the binding still recognises it as its
 * own, and it is excluded from the undo stack. Undoing a container's creation
 * deletes the container, and a deleted container takes every concurrent edit
 * inside it — so scaffolding must never share an undo step with content.
 */
export const PM_STRUCTURE_ORIGIN = 'delight:pm:structure';

/**
 * A `pm_doc` node stored as a `LoroMap`:
 *
 * ```
 * { nodeName: 'paragraph',
 *   attributes: LoroMap { block_id: 'x7…' },
 *   children:   LoroList [ LoroText('hello'), LoroMap{nodeName:'wikilink'}, … ] }
 * ```
 *
 * A block's inline content is one `LoroText` **run** per stretch of text
 * between inline atoms, carrying ProseMirror marks as Loro rich-text styles.
 * Character-level concurrency lives there; everything structural lives in the
 * lists. Text runs are containers in the same `children` list as block/inline
 * nodes, so a run and an atom interleave in document order.
 */
export type LoroKind = 'Map' | 'List' | 'Text';

/**
 * What one container projects to: a node, or — for a text run — the several
 * text nodes its marks split it into.
 */
export type LoroPmMappingValue = PmNode | PmNode[];

/**
 * The subset of `CrdtHandle` the binding needs.
 *
 * Structural rather than a class import, so the binding can be driven by a
 * `CrdtHandle` in the app, by a bare `LoroDoc` in a test or a Worker
 * (see `crdtBindingFromDoc`), or by anything else that can commit and be
 * subscribed to.
 */
export interface CrdtBinding {
	/** The live Loro document. */
	readonly doc: LoroDoc;
	/** Apply a local change. Must commit, and must be synchronous. */
	transact(fn: (doc: LoroDoc) => void, opts?: { actor?: Actor }): void;
	/** Subscribe to Loro events. Returns an unsubscribe function. */
	subscribe(fn: (event: LoroEventBatch) => void): () => void;
}

/**
 * Which ProseMirror node each Loro container currently projects to.
 *
 * This is what makes both directions minimal. A container whose cached node is
 * `===` the node being written is skipped outright, and a rebuild after a
 * remote event reuses the cached node objects for every untouched subtree — so
 * the ProseMirror diff can find the changed range by reference comparison
 * instead of walking the whole document.
 *
 * A `LoroText` run projects to *several* ProseMirror text nodes (one per run of
 * identical marks), which is why the value is a node **or** an array.
 */
export class LoroPmMapping {
	/** Container → the ProseMirror node(s) it currently projects to. */
	readonly by_container = new Map<ContainerID, LoroPmMappingValue>();
	/**
	 * ProseMirror node → its container. Weak: ProseMirror mints a new node
	 * object for anything that changes, so stale entries die with their nodes
	 * and there is nothing to prune.
	 */
	readonly by_node = new WeakMap<PmNode, ContainerID>();

	setNode(container_id: ContainerID, node: PmNode): void {
		this.by_container.set(container_id, node);
		this.by_node.set(node, container_id);
	}

	setRun(container_id: ContainerID, nodes: PmNode[]): void {
		this.by_container.set(container_id, nodes);
	}

	/** Forget a container and everything above it — an event's blast radius. */
	invalidate(container_id: ContainerID): void {
		this.by_container.delete(container_id);
	}

	clear(): void {
		this.by_container.clear();
	}
}

/** One entry in a node's reconciled child list. */
export type PmChildItem =
	| { kind: 'text'; nodes: PmNode[] }
	| { kind: 'node'; node: PmNode };
