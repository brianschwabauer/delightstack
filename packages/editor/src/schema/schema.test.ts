import { describe, expect, it } from 'vitest';
import { buildSchema, schemaHash } from './index.js';
import {
	DOMParser as PMDOMParser,
	DOMSerializer,
	Node as PMNode,
} from 'prosemirror-model';

describe('buildSchema', () => {
	it('creates the base schema with expected nodes and marks', () => {
		const schema = buildSchema();
		for (const node of [
			'doc',
			'paragraph',
			'heading',
			'blockquote',
			'code_block',
			'bullet_list',
			'ordered_list',
			'list_item',
			'todo_list',
			'todo_item',
			'horizontal_rule',
			'hard_break',
			'text',
		]) {
			expect(schema.nodes[node], node).toBeDefined();
		}
		for (const mark of ['bold', 'italic', 'underline', 'strike', 'code', 'link']) {
			expect(schema.marks[mark], mark).toBeDefined();
		}
	});

	it('injects block_id attrs on block nodes', () => {
		const schema = buildSchema();
		expect(schema.nodes.paragraph.spec.attrs?.block_id).toBeDefined();
		expect(schema.nodes.heading.spec.attrs?.block_id).toBeDefined();
		expect(schema.nodes.list_item.spec.attrs?.block_id).toBeDefined();
		expect(schema.nodes.text.spec.attrs?.block_id).toBeUndefined();
		expect(schema.nodes.hard_break.spec.attrs?.block_id).toBeUndefined();
	});

	it('registers custom blocks and lets them override base nodes', () => {
		const schema = buildSchema([
			{
				name: 'widget',
				schema: { group: 'block', atom: true, attrs: { kind: { default: 'a' } } },
			},
			{ name: 'code_block', schema: { group: 'block', content: 'text*', code: true } },
		]);
		expect(schema.nodes.widget).toBeDefined();
		expect(schema.nodes.widget.spec.attrs?.block_id).toBeDefined();
		expect(schema.nodes.code_block.spec.attrs?.language).toBeUndefined();
	});

	it('round-trips a document through JSON', () => {
		const schema = buildSchema();
		const doc = {
			type: 'doc',
			content: [
				{
					type: 'heading',
					attrs: { level: 3, block_id: 'h1' },
					content: [{ type: 'text', text: 'Title' }],
				},
				{
					type: 'paragraph',
					attrs: { block_id: 'p1' },
					content: [
						{ type: 'text', text: 'Hello ' },
						{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
						{
							type: 'text',
							text: ' link',
							marks: [{ type: 'link', attrs: { href: 'https://x.co', target: null } }],
						},
					],
				},
				{
					type: 'todo_list',
					attrs: { block_id: 't0' },
					content: [
						{
							type: 'todo_item',
							attrs: { checked: true, block_id: 't1' },
							content: [
								{
									type: 'paragraph',
									attrs: { block_id: 'p2' },
									content: [{ type: 'text', text: 'done' }],
								},
							],
						},
					],
				},
			],
		};
		const node = PMNode.fromJSON(schema, doc);
		expect(node.toJSON()).toEqual(doc);
	});

	it('round-trips through DOM serialization', () => {
		const schema = buildSchema();
		const original = PMNode.fromJSON(schema, {
			type: 'doc',
			content: [
				{
					type: 'todo_list',
					content: [
						{
							type: 'todo_item',
							attrs: { checked: true },
							content: [
								{ type: 'paragraph', content: [{ type: 'text', text: 'check' }] },
							],
						},
					],
				},
				{
					type: 'code_block',
					attrs: { language: 'ts' },
					content: [{ type: 'text', text: 'const x = 1;' }],
				},
			],
		});
		const div = document.createElement('div');
		div.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(original.content));
		const reparsed = PMDOMParser.fromSchema(schema).parse(div);
		expect(reparsed.firstChild?.type.name).toBe('todo_list');
		expect(reparsed.firstChild?.firstChild?.attrs.checked).toBe(true);
		expect(reparsed.lastChild?.type.name).toBe('code_block');
		expect(reparsed.lastChild?.attrs.language).toBe('ts');
	});
});

describe('schemaHash', () => {
	it('is stable for the same inputs', () => {
		expect(schemaHash()).toBe(schemaHash());
		const blocks = [{ name: 'w', schema: { group: 'block', atom: true } }];
		expect(schemaHash(blocks)).toBe(schemaHash(blocks));
	});

	it('changes when structure changes and ignores toDOM', () => {
		const base = schemaHash();
		expect(schemaHash([{ name: 'w', schema: { group: 'block', atom: true } }])).not.toBe(
			base,
		);
		const withToDom = schemaHash([
			{ name: 'w', schema: { group: 'block', atom: true, toDOM: () => ['div'] } },
		]);
		expect(withToDom).toBe(
			schemaHash([{ name: 'w', schema: { group: 'block', atom: true } }]),
		);
	});

	it('changes when attr defaults change', () => {
		const a = schemaHash([
			{
				name: 'w',
				schema: { group: 'block', atom: true, attrs: { size: { default: 1 } } },
			},
		]);
		const b = schemaHash([
			{
				name: 'w',
				schema: { group: 'block', atom: true, attrs: { size: { default: 2 } } },
			},
		]);
		expect(a).not.toBe(b);
	});
});
