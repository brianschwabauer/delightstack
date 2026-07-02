import { Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model';
import type { BlockSchemaSpec } from '../types/index.js';

/**
 * Isomorphic schema construction — safe to import in a Cloudflare Worker
 * (no Svelte, no DOM at module scope). Apps that want collaborative editing
 * later should define custom block schemas with `defineBlockSchema()` in a
 * file shared between client and worker, and build the schema on both sides
 * with `buildSchema()`. `schemaHash()` guards against client/server drift.
 */

/** Groups whose nodes get a stable `block_id` attr injected automatically. */
const BLOCK_ID_GROUPS = new Set(['block']);
const BLOCK_ID_NODES = new Set(['list_item', 'todo_item']);

function withBlockId(name: string, spec: NodeSpec): NodeSpec {
	const groups = spec.group?.split(' ') ?? [];
	const wants = groups.some((g) => BLOCK_ID_GROUPS.has(g)) || BLOCK_ID_NODES.has(name);
	if (!wants || name === 'text') return spec;
	if (spec.attrs?.block_id) return spec;
	return { ...spec, attrs: { ...spec.attrs, block_id: { default: null } } };
}

/** Standard attrs read/written on DOM round-trips for block-level nodes. */
function blockIdAttr(dom: HTMLElement): { block_id: string | null } {
	return { block_id: dom.getAttribute('data-block-id') };
}

function blockIdDom(attrs: Record<string, unknown>): Record<string, string> {
	return typeof attrs.block_id === 'string' ? { 'data-block-id': attrs.block_id } : {};
}

export const baseNodes: Record<string, NodeSpec> = {
	doc: { content: 'block+' },

	paragraph: {
		content: 'inline*',
		group: 'block',
		parseDOM: [{ tag: 'p', getAttrs: (dom) => blockIdAttr(dom) }],
		toDOM: (node) => ['p', blockIdDom(node.attrs), 0],
	},

	heading: {
		attrs: { level: { default: 2 } },
		content: 'inline*',
		group: 'block',
		defining: true,
		parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
			tag: `h${level}`,
			getAttrs: (dom: HTMLElement) => ({ level, ...blockIdAttr(dom) }),
		})),
		toDOM: (node) => [`h${node.attrs.level}`, blockIdDom(node.attrs), 0],
	},

	blockquote: {
		content: 'block+',
		group: 'block',
		defining: true,
		parseDOM: [{ tag: 'blockquote', getAttrs: (dom) => blockIdAttr(dom) }],
		toDOM: (node) => ['blockquote', blockIdDom(node.attrs), 0],
	},

	code_block: {
		attrs: { language: { default: '' } },
		content: 'text*',
		group: 'block',
		marks: '',
		code: true,
		defining: true,
		parseDOM: [
			{
				tag: 'pre',
				preserveWhitespace: 'full',
				getAttrs: (dom) => ({
					language:
						dom.querySelector('code')?.className.match(/language-(\S+)/)?.[1] ??
						dom.getAttribute('data-language') ??
						'',
					...blockIdAttr(dom),
				}),
			},
		],
		toDOM: (node) => [
			'pre',
			{ ...blockIdDom(node.attrs), 'data-language': node.attrs.language || undefined },
			[
				'code',
				node.attrs.language ? { class: `language-${node.attrs.language}` } : {},
				0,
			],
		],
	},

	bullet_list: {
		content: 'list_item+',
		group: 'block',
		parseDOM: [{ tag: 'ul:not([data-todo-list])', getAttrs: (dom) => blockIdAttr(dom) }],
		toDOM: (node) => ['ul', blockIdDom(node.attrs), 0],
	},

	ordered_list: {
		attrs: { start: { default: 1 } },
		content: 'list_item+',
		group: 'block',
		parseDOM: [
			{
				tag: 'ol',
				getAttrs: (dom: HTMLElement) => ({
					start: dom.hasAttribute('start') ? Number(dom.getAttribute('start')) || 1 : 1,
					...blockIdAttr(dom),
				}),
			},
		],
		toDOM: (node) => [
			'ol',
			{
				...blockIdDom(node.attrs),
				start: node.attrs.start === 1 ? undefined : node.attrs.start,
			},
			0,
		],
	},

	list_item: {
		content: 'paragraph block*',
		defining: true,
		parseDOM: [{ tag: 'li:not([data-todo])', getAttrs: (dom) => blockIdAttr(dom) }],
		toDOM: (node) => ['li', blockIdDom(node.attrs), 0],
	},

	todo_list: {
		content: 'todo_item+',
		group: 'block',
		parseDOM: [{ tag: 'ul[data-todo-list]', getAttrs: (dom) => blockIdAttr(dom) }],
		toDOM: (node) => ['ul', { ...blockIdDom(node.attrs), 'data-todo-list': 'true' }, 0],
	},

	todo_item: {
		attrs: { checked: { default: false } },
		content: 'paragraph block*',
		defining: true,
		parseDOM: [
			{
				tag: 'li[data-todo]',
				getAttrs: (dom: HTMLElement) => ({
					checked: dom.getAttribute('data-todo') === 'checked',
					...blockIdAttr(dom),
				}),
			},
		],
		toDOM: (node) => [
			'li',
			{
				...blockIdDom(node.attrs),
				'data-todo': node.attrs.checked ? 'checked' : 'unchecked',
			},
			0,
		],
	},

	horizontal_rule: {
		group: 'block',
		parseDOM: [{ tag: 'hr', getAttrs: (dom) => blockIdAttr(dom) }],
		toDOM: (node) => ['hr', blockIdDom(node.attrs)],
	},

	hard_break: {
		inline: true,
		group: 'inline',
		selectable: false,
		parseDOM: [{ tag: 'br' }],
		toDOM: () => ['br'],
	},

	text: { group: 'inline' },
};

export const baseMarks: Record<string, MarkSpec> = {
	bold: {
		parseDOM: [
			{ tag: 'strong' },
			{ tag: 'b', getAttrs: (dom) => dom.style.fontWeight !== 'normal' && null },
			{
				style: 'font-weight',
				getAttrs: (value) => /^(bold(er)?|[5-9]\d{2})$/.test(value as string) && null,
			},
		],
		toDOM: () => ['strong', 0],
	},

	italic: {
		parseDOM: [
			{ tag: 'em' },
			{ tag: 'i', getAttrs: (dom) => dom.style.fontStyle !== 'normal' && null },
			{ style: 'font-style=italic' },
		],
		toDOM: () => ['em', 0],
	},

	underline: {
		parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
		toDOM: () => ['u', 0],
	},

	strike: {
		parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
		toDOM: () => ['s', 0],
	},

	code: {
		// Code shouldn't combine with other inline styling
		excludes: '_',
		parseDOM: [{ tag: 'code' }],
		toDOM: () => ['code', 0],
	},

	link: {
		attrs: { href: {}, target: { default: null } },
		inclusive: false,
		parseDOM: [
			{
				tag: 'a[href]',
				getAttrs: (dom: HTMLElement) => ({
					href: dom.getAttribute('href'),
					target: dom.getAttribute('target'),
				}),
			},
		],
		toDOM: (mark) => [
			'a',
			{
				href: mark.attrs.href,
				target: mark.attrs.target || undefined,
				rel: 'noopener noreferrer nofollow',
			},
			0,
		],
	},
};

export interface BuildSchemaOptions {
	/** Extra mark specs (or overrides of base marks) */
	marks?: Record<string, MarkSpec>;
}

/**
 * Builds the editor schema from the base nodes/marks plus registered block
 * specs. A block spec whose name collides with a base node overrides it
 * (e.g. to replace `code_block`). Every node in the `block` group gets a
 * stable `block_id` attr injected if it doesn't declare one.
 */
export function buildSchema(
	blocks: BlockSchemaSpec[] = [],
	options: BuildSchemaOptions = {},
): Schema {
	const nodes: Record<string, NodeSpec> = { ...baseNodes };
	for (const block of blocks) nodes[block.name] = block.schema;
	for (const [name, spec] of Object.entries(nodes)) nodes[name] = withBlockId(name, spec);
	return new Schema({ nodes, marks: { ...baseMarks, ...options.marks } });
}

/**
 * Content hash of the *structural* parts of the schema (node/mark names,
 * content expressions, groups, attr names + JSON-able defaults). Functions
 * like toDOM/parseDOM don't affect step application, so they're excluded.
 * Used by the collab server to reject steps from stale clients.
 */
export function schemaHash(
	blocks: BlockSchemaSpec[] = [],
	options: BuildSchemaOptions = {},
): string {
	const schema = buildSchema(blocks, options);
	const shape: Record<string, unknown> = {};
	for (const [name, type] of Object.entries(schema.nodes)) {
		const spec = type.spec;
		shape[`node:${name}`] = structuralSpec(spec);
	}
	for (const [name, type] of Object.entries(schema.marks)) {
		const spec = type.spec;
		shape[`mark:${name}`] = structuralSpec(spec);
	}
	return fnv1a(stableStringify(shape));
}

function structuralSpec(spec: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of [
		'content',
		'group',
		'inline',
		'atom',
		'marks',
		'code',
		'defining',
		'excludes',
		'inclusive',
	]) {
		if (spec[key] !== undefined) out[key] = spec[key];
	}
	const attrs = spec.attrs as Record<string, { default?: unknown }> | undefined;
	if (attrs) {
		out.attrs = Object.fromEntries(
			Object.entries(attrs).map(([name, attr]) => [
				name,
				jsonable(attr?.default) ? { default: attr.default } : {},
			]),
		);
	}
	return out;
}

function jsonable(value: unknown): boolean {
	if (value === undefined) return false;
	const type = typeof value;
	return value === null || type === 'string' || type === 'number' || type === 'boolean';
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : 1))
		.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
	return `{${entries.join(',')}}`;
}

function fnv1a(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}
