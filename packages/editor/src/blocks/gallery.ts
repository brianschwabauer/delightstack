import { defineBlock } from '../core/block-spec.js';
import { icons } from '../core/icons.js';
import type { UploadedImage } from '../types/index.js';
import GalleryBlock from '../components/blocks/GalleryBlock.svelte';
import GallerySettings from '../components/blocks/GallerySettings.svelte';
import { defaultBlockTextRenderers, galleryRenderer } from '../render/blocks.js';

export interface GalleryAttrs extends Record<string, unknown> {
	/** One data shape: UploadResult['image'] objects straight from the uploader */
	items: UploadedImage[];
	display: 'grid' | 'masonry' | 'masonry-row' | 'slider' | 'slideshow' | 'list';
	size: '00' | '0' | '1' | '2' | '3';
	spacing: '0' | '1' | '2' | '3';
	radius: '0' | '1' | '2' | '3';
	fit: 'contain' | 'cover';
	/** Where item captions show: over thumbnails on hover/always, or not at
	 * all. Any value but 'none' also shows captions in the lightbox. */
	captions: 'none' | 'hover' | 'always';
	/** Rendered width as a percentage of the editor column (normal mode) */
	width_pct: number | null;
	/** Breakout tier: in-column, wide (--editor-wide-width), or full-bleed */
	width_mode: 'normal' | 'wide' | 'full';
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
			fit: { default: 'contain' },
			captions: { default: 'hover' },
			width_pct: { default: null },
			width_mode: { default: 'normal' },
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
	interactive: {
		resize: { attr: 'width_pct', unit: 'percent', min: 240, breakout: true },
	},
	settings: GallerySettings,
	chrome: [
		{
			name: 'add_images',
			label: 'Add images',
			icon: icons.image,
			when: (ctx) => Boolean(ctx.editor.uploader),
			// The component registers the picker (it owns the file input);
			// running synchronously keeps the browser's user-activation for
			// opening the file dialog
			run: (ctx) => (ctx.ui.add_images as (() => void) | undefined)?.(),
		},
		{
			name: 'manage',
			label: 'Manage images',
			icon: icons.arrange,
			when: (ctx) => (ctx.attrs.items?.length ?? 0) > 0,
			is_active: (ctx) => Boolean(ctx.ui.managing),
			run: (ctx) => {
				// Select the node so leaving it (clicking another block)
				// automatically exits manage mode
				const pos = ctx.pos();
				if (pos !== undefined && !ctx.ui.managing) ctx.editor.selectNode(pos);
				ctx.ui.managing = !ctx.ui.managing;
			},
		},
	],
	chrome_modes: [
		{
			name: 'manage',
			hint: 'Drag rows to reorder',
			actions: [
				{
					name: 'add_images',
					label: 'Add images',
					icon: icons.image,
					when: (ctx) => Boolean(ctx.editor.uploader),
					run: (ctx) => (ctx.ui.add_images as (() => void) | undefined)?.(),
				},
			],
			exit: (ctx) => {
				ctx.ui.managing = false;
			},
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
