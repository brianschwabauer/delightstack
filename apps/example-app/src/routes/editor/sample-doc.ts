import type { JSONContent } from '@delightstack/editor';

/** Shared sample document for the editor playground + SSR-rendered demo. */
export const sampleDoc: JSONContent = {
	type: 'doc',
	content: [
		{
			type: 'heading',
			attrs: { level: 2 },
			content: [{ type: 'text', text: 'Editor playground' }],
		},
		{
			type: 'paragraph',
			content: [
				{ type: 'text', text: 'Try ' },
				{ type: 'text', text: 'marks', marks: [{ type: 'bold' }] },
				{ type: 'text', text: ', markdown shortcuts (' },
				{ type: 'text', text: '# ', marks: [{ type: 'code' }] },
				{ type: 'text', text: ', ' },
				{ type: 'text', text: '- ', marks: [{ type: 'code' }] },
				{ type: 'text', text: ', ' },
				{ type: 'text', text: '[] ', marks: [{ type: 'code' }] },
				{ type: 'text', text: ', ' },
				{ type: 'text', text: '```', marks: [{ type: 'code' }] },
				{ type: 'text', text: '), lists, quotes, and undo/redo.' },
			],
		},
		{
			type: 'callout',
			attrs: { variant: 'tip' },
			content: [
				{
					type: 'paragraph',
					content: [
						{
							type: 'text',
							text: 'This callout is a Svelte node view — click it and try the settings gear.',
						},
					],
				},
			],
		},
		{
			type: 'code_block',
			attrs: { language: 'typescript' },
			content: [
				{
					type: 'text',
					text: 'const delightful = new Editor({ blocks: defaultBlocks() });',
				},
			],
		},
		{
			type: 'todo_list',
			content: [
				{
					type: 'todo_item',
					attrs: { checked: true },
					content: [
						{
							type: 'paragraph',
							content: [{ type: 'text', text: 'Scaffold the editor' }],
						},
					],
				},
				{
					type: 'todo_item',
					content: [
						{ type: 'paragraph', content: [{ type: 'text', text: 'Delight the users' }] },
					],
				},
			],
		},
	],
};
