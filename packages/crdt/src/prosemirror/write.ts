/**
 * ProseMirror → Loro.
 *
 * The write direction is a **reconciliation**, never a rewrite: it walks the
 * `pm_doc` against the containers already in the Loro document and emits only
 * the operations that differ. That is not an optimisation, it is the whole
 * point — replacing a paragraph's text container because one character changed
 * would destroy every concurrent edit another peer made inside it, and would
 * write a new `block_id` container on every keystroke.
 *
 * This module is the only one in the binding that constructs Loro containers,
 * so it is the only one that names a wasm build.
 */

import type { Node as PmNode, Schema } from 'prosemirror-model';
import type { ContainerID, LoroDoc } from 'loro-crdt';
import { LoroList, LoroMap, LoroText } from '../loro.client.js';
import {
	ATTRIBUTES_KEY,
	CHILDREN_KEY,
	LoroPmMapping,
	NODE_NAME_KEY,
	ROOT_KEY,
	type PmChildItem,
} from './types.js';
import {
	attributesFromMarks,
	containerIdOf,
	kindOf,
	type LoroChildList,
	type LoroNodeMap,
} from './convert.js';

/** Docs whose text-style config has already been installed. */
const STYLED = new WeakSet<LoroDoc>();

/**
 * Teach the Loro document how each ProseMirror mark expands.
 *
 * Loro refuses `mark()` for a key it has no style config for, so this has to
 * run before the first write. `inclusive: false` marks (links, typically) stop
 * at their boundary; everything else grows with text typed at its end, which is
 * what ProseMirror's own `storedMarks` behaviour looks like.
 */
export function configureTextStyle(doc: LoroDoc, schema: Schema): void {
	if (STYLED.has(doc)) return;
	STYLED.add(doc);
	doc.configTextStyle(
		Object.fromEntries(
			Object.entries(schema.marks).map(([name, type]) => [
				name,
				{ expand: type.spec.inclusive === false ? 'none' : 'after' } as const,
			]),
		),
	);
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null)
		return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	const a_keys = Object.keys(a as Record<string, unknown>);
	const b_keys = Object.keys(b as Record<string, unknown>);
	if (a_keys.length !== b_keys.length) return false;
	for (const key of a_keys) {
		if (!(key in (b as Record<string, unknown>))) return false;
		if (
			!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
		)
			return false;
	}
	return true;
}

/** A node's children, with consecutive text nodes collected into runs. */
export function pmChildItems(pm_node: PmNode): PmChildItem[] {
	const items: PmChildItem[] = [];
	let run: PmNode[] | null = null;
	pm_node.forEach((child) => {
		if (child.isText) {
			if (!run) {
				run = [];
				items.push({ kind: 'text', nodes: run });
			}
			run.push(child);
		} else {
			run = null;
			items.push({ kind: 'node', node: child });
		}
	});
	return items;
}

function sameTextRun(a: readonly PmNode[] | undefined, b: readonly PmNode[]): boolean {
	if (!a || a.length !== b.length) return false;
	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i] && !a[i].eq(b[i])) return false;
	}
	return true;
}

/** Does this container already project to exactly this child item? */
function itemMatches(
	container: unknown,
	item: PmChildItem,
	mapping: LoroPmMapping,
): boolean {
	const kind = kindOf(container);
	const cached = mapping.by_container.get(containerIdOf(container as object));
	if (item.kind === 'text') {
		return kind === 'Text' && Array.isArray(cached) && sameTextRun(cached, item.nodes);
	}
	return kind === 'Map' && cached === item.node;
}

/** Can this container be updated in place to hold this item, or must it go? */
/**
 * One reconciliation pass.
 *
 * `deferred`, when present, turns on the split that keeps undo safe. See
 * {@link createScaffolding}.
 */
export interface WritePass {
	mapping: LoroPmMapping;
	/** Node containers whose missing scaffolding was postponed, and their target. */
	deferred?: Map<ContainerID, PmNode>;
}

/**
 * Postpone a container's scaffolding, and report that the caller must not cache
 * this node as written.
 */
function defer(container: LoroNodeMap, pm_node: PmNode, pass: WritePass): boolean {
	pass.deferred?.set(containerIdOf(container), pm_node);
	return true;
}

function itemCompatible(container: unknown, item: PmChildItem): boolean {
	const kind = kindOf(container);
	if (item.kind === 'text') return kind === 'Text';
	return (
		kind === 'Map' &&
		(container as LoroNodeMap).get(NODE_NAME_KEY) === item.node.type.name
	);
}

function syncAttributes(
	container: LoroNodeMap,
	pm_node: PmNode,
	pass: WritePass,
): boolean {
	const target = (pm_node.attrs ?? {}) as Record<string, unknown>;
	const target_keys = Object.keys(target);
	let attributes = container.get(ATTRIBUTES_KEY);
	if (kindOf(attributes) !== 'Map') {
		// Nothing to store and nothing stored — do not mint a container just to
		// leave it empty, or every text node's parent grows one.
		if (target_keys.length === 0) return false;
		if (pass.deferred) return defer(container, pm_node, pass);
		attributes = container.setContainer(ATTRIBUTES_KEY, new LoroMap());
	}
	const attrs = attributes as LoroNodeMap;
	for (const key of target_keys) {
		if (!deepEqual(attrs.get(key), target[key])) attrs.set(key, target[key]);
	}
	for (const key of attrs.keys() as string[]) {
		if (!(key in target)) attrs.delete(key);
	}
	return false;
}

/** Style values, per character, as the text container currently holds them. */
function currentStyles(text: LoroText): Array<Record<string, unknown>> {
	const styles: Array<Record<string, unknown>> = [];
	for (const run of text.toDelta() as Array<{
		insert?: string;
		attributes?: Record<string, unknown>;
	}>) {
		if (typeof run.insert !== 'string') continue;
		const attributes: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(run.attributes ?? {})) {
			if (value === null || value === undefined || value === false) continue;
			attributes[key] = value;
		}
		for (let i = 0; i < run.insert.length; i += 1) styles.push(attributes);
	}
	return styles;
}

/** Style values, per character, as the ProseMirror run wants them. */
function targetStyles(nodes: readonly PmNode[]): Array<Record<string, unknown>> {
	const styles: Array<Record<string, unknown>> = [];
	for (const node of nodes) {
		const attributes = node.marks.length > 0 ? attributesFromMarks(node.marks) : {};
		const length = node.text?.length ?? 0;
		for (let i = 0; i < length; i += 1) styles.push(attributes);
	}
	return styles;
}

/**
 * Bring the text container's marks in line with the run, one key at a time.
 *
 * Per key rather than per character range, because Loro stores each style key
 * independently: marking `[0,5)` bold and `[2,9)` italic is two operations, and
 * expressing it as three "attribute set" ranges would rewrite marks nobody
 * touched.
 */
function syncTextMarks(text: LoroText, nodes: readonly PmNode[]): void {
	const target = targetStyles(nodes);
	const current = currentStyles(text);
	const keys = new Set<string>();
	for (const styles of target) for (const key of Object.keys(styles)) keys.add(key);
	for (const styles of current) for (const key of Object.keys(styles)) keys.add(key);
	if (keys.size === 0) return;

	for (const key of keys) {
		let index = 0;
		while (index < target.length) {
			const want = target[index]?.[key];
			if (deepEqual(want, current[index]?.[key])) {
				index += 1;
				continue;
			}
			let end = index + 1;
			while (
				end < target.length &&
				deepEqual(target[end]?.[key], want) &&
				!deepEqual(target[end]?.[key], current[end]?.[key])
			) {
				end += 1;
			}
			if (want === undefined) text.unmark({ start: index, end }, key);
			else text.mark({ start: index, end }, key, want);
			index = end;
		}
	}
}

/** Reconcile one text container against a run of ProseMirror text nodes. */
function syncTextRun(
	text: LoroText,
	nodes: readonly PmNode[],
	mapping: LoroPmMapping,
): void {
	const container_id = containerIdOf(text);
	const cached = mapping.by_container.get(container_id);
	if (Array.isArray(cached) && sameTextRun(cached, nodes)) return;

	const current = text.toString();
	const wanted = nodes.map((node) => node.text ?? '').join('');
	if (current !== wanted) {
		const limit = Math.min(current.length, wanted.length);
		let prefix = 0;
		while (prefix < limit && current[prefix] === wanted[prefix]) prefix += 1;
		let suffix = 0;
		while (
			suffix < limit - prefix &&
			current[current.length - 1 - suffix] === wanted[wanted.length - 1 - suffix]
		) {
			suffix += 1;
		}
		const removed = current.length - prefix - suffix;
		if (removed > 0) text.delete(prefix, removed);
		const inserted = wanted.slice(prefix, wanted.length - suffix);
		if (inserted.length > 0) text.insert(prefix, inserted);
	}
	syncTextMarks(text, nodes);
	mapping.setRun(container_id, [...nodes]);
}

/** Returns true when the item was postponed rather than inserted. */
function insertItem(
	list: LoroChildList,
	index: number,
	item: PmChildItem,
	owner: LoroNodeMap,
	owner_node: PmNode,
	pass: WritePass,
): boolean {
	if (item.kind === 'text') {
		if (pass.deferred) return defer(owner, owner_node, pass);
		const text = list.insertContainer(index, new LoroText()) as LoroText;
		syncTextRun(text, item.nodes, pass.mapping);
		return false;
	}
	const container = list.insertContainer(index, new LoroMap()) as LoroNodeMap;
	return syncNode(container, item.node, pass);
}

function syncChildren(container: LoroNodeMap, pm_node: PmNode, pass: WritePass): boolean {
	const mapping = pass.mapping;
	const items = pmChildItems(pm_node);
	let children = container.get(CHILDREN_KEY);
	if (kindOf(children) !== 'List') {
		if (items.length === 0) return false;
		if (pass.deferred) return defer(container, pm_node, pass);
		children = container.setContainer(CHILDREN_KEY, new LoroList());
	}
	const list = children as LoroChildList;
	const existing = list.toArray();

	let prefix = 0;
	while (
		prefix < existing.length &&
		prefix < items.length &&
		itemMatches(existing[prefix], items[prefix], mapping)
	) {
		prefix += 1;
	}
	let suffix = 0;
	while (
		suffix < existing.length - prefix &&
		suffix < items.length - prefix &&
		itemMatches(
			existing[existing.length - 1 - suffix],
			items[items.length - 1 - suffix],
			mapping,
		)
	) {
		suffix += 1;
	}

	const old_middle = existing.slice(prefix, existing.length - suffix);
	const new_middle = items.slice(prefix, items.length - suffix);
	const shared = Math.min(old_middle.length, new_middle.length);

	let deferred = false;
	let index = prefix;
	for (let i = 0; i < shared; i += 1) {
		const old_item = old_middle[i];
		const new_item = new_middle[i];
		if (itemCompatible(old_item, new_item)) {
			if (new_item.kind === 'text') {
				syncTextRun(old_item as LoroText, new_item.nodes, mapping);
			} else if (syncNode(old_item as LoroNodeMap, new_item.node, pass)) {
				deferred = true;
			}
			index += 1;
		} else {
			list.delete(index, 1);
			// A postponed item is not in the list, so the cursor must not move
			// past a slot that does not exist yet.
			if (insertItem(list, index, new_item, container, pm_node, pass)) deferred = true;
			else index += 1;
		}
	}
	if (old_middle.length > shared) {
		list.delete(index, old_middle.length - shared);
	} else {
		for (let i = shared; i < new_middle.length; i += 1) {
			if (insertItem(list, index, new_middle[i], container, pm_node, pass))
				deferred = true;
			else index += 1;
		}
	}
	return deferred;
}

/**
 * Reconcile one node container against one ProseMirror node.
 *
 * Returns true when some of this node's scaffolding was postponed — in which
 * case the node is deliberately **not** cached, so the follow-up pass walks it
 * again instead of short-circuiting on a node that is only half written.
 */
export function syncNode(
	container: LoroNodeMap,
	pm_node: PmNode,
	pass: WritePass,
): boolean {
	const container_id = containerIdOf(container);
	if (pass.mapping.by_container.get(container_id) === pm_node) return false;

	if (container.get(NODE_NAME_KEY) !== pm_node.type.name) {
		container.set(NODE_NAME_KEY, pm_node.type.name);
	}
	const attrs_deferred = syncAttributes(container, pm_node, pass);
	const children_deferred = syncChildren(container, pm_node, pass);
	if (attrs_deferred || children_deferred) return true;
	pass.mapping.setNode(container_id, pm_node);
	return false;
}

/**
 * Make the Loro document hold exactly this `pm_doc`, in the fewest operations.
 *
 * This is also the answer to `restore_unreachable` in
 * `04-crdt-and-history.md`: a checkpoint that survived compaction only as a
 * snapshot cannot be reverted to, but its `pm_doc` can be read out of a fork
 * and written forward through here, which is what "restore writes forward"
 * means at the schema layer.
 *
 * Must be called inside a `transact()` — it mutates but does not commit.
 */
export function writePmDocToLoro(
	doc: LoroDoc,
	pm_doc: PmNode,
	mapping: LoroPmMapping = new LoroPmMapping(),
	deferred?: Map<ContainerID, PmNode>,
): void {
	configureTextStyle(doc, pm_doc.type.schema);
	syncNode(doc.getMap(ROOT_KEY) as LoroNodeMap, pm_doc, { mapping, deferred });
}

/**
 * Create the containers a deferred pass postponed — and nothing else.
 *
 * **Why this is a separate commit.** A `children` list and a `LoroText` run are
 * artefacts of how a `pm_doc` is encoded, not edits anybody made. If they are
 * created inside the same commit as the text that goes in them, that commit's
 * undo step deletes the container — and a container deletion takes every
 * concurrent edit inside it with it, because there is nothing left to rebase
 * onto. Measured: A types "local" into an empty paragraph, B types "R" into the
 * same paragraph, A presses undo, and B's "R" is gone. With the containers
 * created under an origin the `UndoManager` excludes, the undo step holds only
 * A's five characters, so the same flow leaves "R" standing.
 *
 * Block containers are deliberately **not** created here. Undoing "press Enter"
 * has to remove the paragraph, and a paragraph that a peer typed into is a real
 * block deletion — the user's own structural edit, not someone else's writing.
 */
export function createScaffolding(
	doc: LoroDoc,
	deferred: Map<ContainerID, PmNode>,
): void {
	for (const [container_id, pm_node] of deferred) {
		const container = doc.getContainerById(container_id);
		if (!container || kindOf(container) !== 'Map') continue;
		const node = container as LoroNodeMap;

		if (
			Object.keys(pm_node.attrs ?? {}).length > 0 &&
			kindOf(node.get(ATTRIBUTES_KEY)) !== 'Map'
		) {
			node.setContainer(ATTRIBUTES_KEY, new LoroMap());
		}

		const items = pmChildItems(pm_node);
		if (items.length === 0) continue;
		let children = node.get(CHILDREN_KEY);
		if (kindOf(children) !== 'List') {
			children = node.setContainer(CHILDREN_KEY, new LoroList());
		}
		const list = children as LoroChildList;
		let index = 0;
		for (const item of items) {
			const existing = list.toArray()[index];
			if (item.kind === 'text') {
				if (kindOf(existing) !== 'Text') list.insertContainer(index, new LoroText());
				index += 1;
			} else if (kindOf(existing) === 'Map') {
				index += 1;
			} else {
				// The list and the target have diverged structurally. Aligning that
				// is the reconciling pass's job, not this one's.
				break;
			}
		}
	}
}
