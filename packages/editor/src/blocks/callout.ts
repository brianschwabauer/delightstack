import { defineBlock } from '../core/block-spec.js';
import { calloutRenderer } from '../render/blocks.js';
import { icons } from '../core/icons.js';
import CalloutBlock from '../components/blocks/CalloutBlock.svelte';

export interface CalloutAttrs extends Record<string, unknown> {
	variant: 'info' | 'success' | 'warning' | 'error' | 'tip';
	block_id: string | null;
}

const VARIANTS: CalloutAttrs['variant'][] = [
	'info',
	'success',
	'warning',
	'error',
	'tip',
];

export const calloutBlock = defineBlock<CalloutAttrs>({
	name: 'callout',
	schema: {
		group: 'block',
		content: 'block+',
		defining: true,
		attrs: { variant: { default: 'info' }, block_id: { default: null } },
		parseDOM: [
			{
				tag: 'aside[data-callout]',
				getAttrs: (dom: HTMLElement) => ({
					variant: VARIANTS.includes(
						dom.getAttribute('data-callout') as CalloutAttrs['variant'],
					)
						? dom.getAttribute('data-callout')
						: 'info',
				}),
			},
		],
		toDOM: (node) => ['aside', { 'data-callout': node.attrs.variant }, 0],
	},
	component: CalloutBlock,
	settings: [
		{
			attr: 'variant',
			label: 'Variant',
			control: 'segmented',
			options: VARIANTS.map((variant) => ({ value: variant, label: variant })),
		},
	],
	commands: [
		{
			name: 'callout',
			label: 'Callout',
			description: 'Highlight important information',
			icon: icons.callout,
			keywords: ['info', 'note', 'warning', 'tip', 'aside', 'admonition'],
			group: 'Basic',
			run: (editor) => editor.insertBlock('callout'),
		},
	],
	render: calloutRenderer,
});
