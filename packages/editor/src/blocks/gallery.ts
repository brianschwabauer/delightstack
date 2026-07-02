import { defineBlock } from '../core/block-spec.js';
import { icons } from '../core/icons.js';
import type { UploadedImage } from '../types/index.js';
import GalleryBlock from '../components/blocks/GalleryBlock.svelte';
import { defaultBlockTextRenderers, galleryRenderer } from '../render/blocks.js';

export interface GalleryAttrs extends Record<string, unknown> {
	/** One data shape: UploadResult['image'] objects straight from the uploader */
	items: UploadedImage[];
	display: 'grid' | 'masonry' | 'masonry-row' | 'slider' | 'slideshow' | 'list';
	size: '00' | '0' | '1' | '2' | '3';
	spacing: '0' | '1' | '2' | '3';
	radius: '0' | '1' | '2' | '3';
	block_id: string | null;
}

export const galleryBlock = defineBlock<GalleryAttrs>({
	name: 'gallery',
	schema: {
		group: 'block',
		atom: true,
		draggable: true,
		attrs: {
			items: { default: [] },
			display: { default: 'masonry' },
			size: { default: '1' },
			spacing: { default: '1' },
			radius: { default: '1' },
			block_id: { default: null },
		},
		parseDOM: [
			{
				tag: 'div[data-gallery]',
				getAttrs: (dom: HTMLElement) => {
					try {
						return { items: JSON.parse(dom.getAttribute('data-gallery') ?? '[]') };
					} catch {
						return { items: [] };
					}
				},
			},
		],
		toDOM: (node) => ['div', { 'data-gallery': JSON.stringify(node.attrs.items ?? []) }],
	},
	component: GalleryBlock,
	settings: [
		{
			attr: 'display',
			label: 'Layout',
			control: 'select',
			options: [
				{ value: 'grid', label: 'Grid' },
				{ value: 'masonry', label: 'Masonry' },
				{ value: 'masonry-row', label: 'Rows' },
				{ value: 'slider', label: 'Slider' },
				{ value: 'slideshow', label: 'Slideshow' },
				{ value: 'list', label: 'List' },
			],
		},
		{
			attr: 'size',
			label: 'Size',
			control: 'segmented',
			options: ['0', '1', '2', '3'].map((value) => ({ value, label: value })),
		},
		{
			attr: 'spacing',
			label: 'Spacing',
			control: 'segmented',
			options: ['0', '1', '2', '3'].map((value) => ({ value, label: value })),
		},
		{
			attr: 'radius',
			label: 'Corners',
			control: 'segmented',
			options: ['0', '1', '2', '3'].map((value) => ({ value, label: value })),
		},
	],
	commands: [
		{
			name: 'gallery',
			label: 'Gallery',
			description: 'A collection of images',
			icon: icons.gallery,
			keywords: ['images', 'photos', 'grid', 'masonry'],
			group: 'Media',
			is_enabled: (editor) => Boolean(editor.uploader),
			run: (editor) => editor.insertBlock('gallery'),
		},
	],
	render: galleryRenderer,
	render_text: defaultBlockTextRenderers.gallery,
});
