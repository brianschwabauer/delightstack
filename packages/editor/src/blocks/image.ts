import { defineBlock } from '../core/block-spec.js';
import { icons } from '../core/icons.js';
import ImageBlock from '../components/blocks/ImageBlock.svelte';
import { imageRenderer } from '../render/blocks.js';

export interface ImageAttrs extends Record<string, unknown> {
	src: string;
	srcset: string | null;
	image_id: string | null;
	alt: string;
	caption: string;
	width: number | null;
	height: number | null;
	aspect_ratio: number | null;
	thumbhash: string | null;
	background_color: string | null;
	/** Rendered width as a percentage of the editor column (normal mode) */
	width_pct: number | null;
	/** Breakout tier: in-column, wide (--editor-wide-width), or full-bleed */
	width_mode: 'normal' | 'wide' | 'full';
	uploading: boolean;
	upload_id: string | null;
	blob_url: string | null;
	upload_error: string | null;
	block_id: string | null;
}

export const imageBlock = defineBlock<ImageAttrs>({
	name: 'image',
	schema: {
		group: 'block',
		atom: true,
		draggable: true,
		attrs: {
			src: { default: '' },
			srcset: { default: null },
			image_id: { default: null },
			alt: { default: '' },
			caption: { default: '' },
			width: { default: null },
			height: { default: null },
			aspect_ratio: { default: null },
			thumbhash: { default: null },
			background_color: { default: null },
			width_pct: { default: null },
			width_mode: { default: 'normal' },
			uploading: { default: false },
			upload_id: { default: null },
			blob_url: { default: null },
			upload_error: { default: null },
			block_id: { default: null },
		},
		parseDOM: [
			{
				tag: 'img[src]',
				getAttrs: (dom: HTMLElement) => {
					const src = dom.getAttribute('src') ?? '';
					if (src.startsWith('blob:')) return false;
					return {
						src,
						srcset: dom.getAttribute('srcset'),
						alt: dom.getAttribute('alt') ?? '',
						width: Number(dom.getAttribute('width')) || null,
						height: Number(dom.getAttribute('height')) || null,
					};
				},
			},
		],
		toDOM: (node) => [
			'img',
			{
				src: node.attrs.src || undefined,
				srcset: node.attrs.srcset || undefined,
				alt: node.attrs.alt || '',
				width: node.attrs.width || undefined,
				height: node.attrs.height || undefined,
			},
		],
	},
	component: ImageBlock,
	interactive: {
		resize: { attr: 'width_pct', unit: 'percent', min: 120, breakout: true },
	},
	upload_kind: 'image',
	settings: [
		{ attr: 'alt', label: 'Alt text', control: 'text' },
		{ attr: 'caption', label: 'Caption', control: 'text' },
	],
	commands: [
		{
			name: 'image',
			label: 'Image',
			description: 'Upload and embed an image',
			icon: icons.image,
			keywords: ['photo', 'picture', 'img', 'upload'],
			group: 'Media',
			is_enabled: (editor) => Boolean(editor.uploader),
			run: (editor) => pickFiles(editor, 'image/*', true),
		},
	],
	render: imageRenderer,
	render_text: (node) => String(node.attrs?.alt ?? ''),
});

/** Opens a native file picker and hands the files to the editor's uploader. */
export function pickFiles(
	editor: { uploadFiles(files: File[] | FileList, pos?: number): void },
	accept: string,
	multiple = false,
): boolean {
	if (typeof document === 'undefined') return false;
	const input = document.createElement('input');
	input.type = 'file';
	input.accept = accept;
	input.multiple = multiple;
	input.onchange = () => {
		if (input.files?.length) editor.uploadFiles(input.files);
	};
	input.click();
	return true;
}
