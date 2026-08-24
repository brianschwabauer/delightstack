/**
 * Loro → ProseMirror.
 *
 * Read-only, and free of any `loro-crdt` value import: containers are narrowed
 * through their own `kind()` method rather than `instanceof`, so this module
 * runs unchanged in a browser, in workerd, and in a test — which is what lets
 * the projection step in a `DocDO` reuse it without deciding which wasm build a
 * browser binding wants.
 */

import type { Attrs, Mark, Node as PmNode, Schema } from 'prosemirror-model';
import { Fragment } from 'prosemirror-model';
import { DelightError } from '@delightstack/utilities';
import type { ContainerID, LoroDoc, LoroList, LoroMap, LoroText } from 'loro-crdt';
import {
	ATTRIBUTES_KEY,
	CHILDREN_KEY,
	NODE_NAME_KEY,
	ROOT_KEY,
	LoroPmMapping,
	type LoroKind,
} from './types.js';

/** A node container: `{ nodeName, attributes?, children? }`. */
export type LoroNodeMap = LoroMap<Record<string, unknown>>;
/** A node's child list — text runs and nested node containers, in order. */
export type LoroChildList = LoroList<unknown>;

/** One `{ insert, attributes }` run of a `LoroText`'s delta. */
interface TextRunDelta {
	insert?: string;
	attributes?: Record<string, unknown>;
}

/**
 * Narrow an unknown list/map value to a container kind, without importing a
 * Loro build. Every container exposes a literal-returning `kind()`; a plain
 * value does not.
 */
export function kindOf(value: unknown): LoroKind | null {
	if (typeof value !== 'object' || value === null) return null;
	const kind = (value as { kind?: unknown }).kind;
	if (typeof kind !== 'function') return null;
	const name = (kind as () => string).call(value);
	return name === 'Map' || name === 'List' || name === 'Text' ? name : null;
}

/** The container id of any container, without importing a Loro build. */
export function containerIdOf(container: object): ContainerID {
	return (container as { id: ContainerID }).id;
}

/** ProseMirror marks from one delta run's Loro styles. */
export function marksFromAttributes(
	schema: Schema,
	attributes: Record<string, unknown> | undefined,
): readonly Mark[] {
	if (!attributes) return [];
	const marks: Mark[] = [];
	for (const [name, value] of Object.entries(attributes)) {
		// `unmark()` leaves the key behind with a null value rather than
		// removing it, so a null is an absent mark, not a mark with no attrs.
		if (value === null || value === undefined || value === false) continue;
		const type = schema.marks[name];
		if (!type) continue;
		const attrs =
			typeof value === 'object' && !Array.isArray(value) ? (value as Attrs) : null;
		marks.push(type.create(attrs));
	}
	return marks;
}

/** Loro styles for one ProseMirror text node's marks. */
export function attributesFromMarks(marks: readonly Mark[]): Record<string, unknown> {
	const attributes: Record<string, unknown> = {};
	for (const mark of marks) {
		const attrs = mark.attrs ?? {};
		attributes[mark.type.name] = Object.keys(attrs).length > 0 ? { ...attrs } : true;
	}
	return attributes;
}

/** The ProseMirror text nodes one `LoroText` run projects to. */
export function pmTextsFromLoro(schema: Schema, text: LoroText): PmNode[] {
	const nodes: PmNode[] = [];
	for (const run of text.toDelta() as TextRunDelta[]) {
		if (typeof run.insert !== 'string' || run.insert.length === 0) continue;
		nodes.push(schema.text(run.insert, marksFromAttributes(schema, run.attributes)));
	}
	return nodes;
}

/**
 * Project one node container to a ProseMirror node.
 *
 * Returns the **cached** node for any container the mapping still holds, which
 * is what makes an unchanged subtree reference-equal across rebuilds. Callers
 * that want a fresh read pass a fresh mapping.
 */
export function pmNodeFromLoro(
	schema: Schema,
	container: LoroNodeMap,
	mapping: LoroPmMapping,
): PmNode {
	const container_id = containerIdOf(container);
	const cached = mapping.by_container.get(container_id);
	if (cached && !Array.isArray(cached)) return cached;

	const node_name = container.get(NODE_NAME_KEY);
	if (typeof node_name !== 'string') {
		throw new DelightError({
			message: 'This document is not a ProseMirror document.',
			status: 422,
			code: 'pm_node_name_missing',
			detail: `Container ${container_id} has no ${NODE_NAME_KEY}.`,
		});
	}
	const type = schema.nodes[node_name];
	if (!type) {
		throw new DelightError({
			message: 'This document uses a node type the editor does not know.',
			status: 422,
			code: 'pm_unknown_node_type',
			detail: `Schema has no node type "${node_name}".`,
		});
	}

	const attributes = container.get(ATTRIBUTES_KEY);
	const attrs: Attrs | null =
		kindOf(attributes) === 'Map' ? ((attributes as LoroNodeMap).toJSON() as Attrs) : null;

	const content: PmNode[] = [];
	const children = container.get(CHILDREN_KEY);
	if (kindOf(children) === 'List') {
		for (const child of (children as LoroChildList).toArray()) {
			const kind = kindOf(child);
			if (kind === 'Text') {
				const run = pmTextsFromLoro(schema, child as LoroText);
				mapping.setRun(containerIdOf(child as object), run);
				content.push(...run);
			} else if (kind === 'Map') {
				content.push(pmNodeFromLoro(schema, child as LoroNodeMap, mapping));
			}
		}
	}

	const node = type.create(attrs, Fragment.fromArray(content));
	mapping.setNode(container_id, node);
	return node;
}

/**
 * The whole `pm_doc` for a Loro document.
 *
 * An untouched Loro document projects to the schema's empty document rather
 * than throwing — that is the state a brand new node is in before the editor
 * has written anything into it.
 */
export function pmDocFromLoro(
	schema: Schema,
	doc: LoroDoc,
	mapping: LoroPmMapping = new LoroPmMapping(),
): PmNode {
	const root = doc.getMap(ROOT_KEY) as LoroNodeMap;
	if (root.keys().length === 0) {
		const empty = schema.topNodeType.createAndFill();
		if (!empty) {
			throw new DelightError({
				message: 'This schema has no valid empty document.',
				status: 500,
				code: 'pm_empty_doc_impossible',
			});
		}
		return empty;
	}
	return pmNodeFromLoro(schema, root, mapping);
}
