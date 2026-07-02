import { defineBlock } from '../core/block-spec.js';
import { icons } from '../core/icons.js';
import { pickFiles } from './image.js';
import VideoBlock from '../components/blocks/VideoBlock.svelte';
import AudioBlock from '../components/blocks/AudioBlock.svelte';
import FileBlock from '../components/blocks/FileBlock.svelte';
import { audioRenderer, fileRenderer, videoRenderer } from '../render/blocks.js';

/** Shared attrs for uploaded media nodes (video/audio/file). */
function mediaAttrs() {
	return {
		src: { default: '' },
		name: { default: '' },
		size: { default: null },
		mime: { default: '' },
		width_pct: { default: null },
		uploading: { default: false },
		upload_id: { default: null },
		blob_url: { default: null },
		upload_error: { default: null },
		block_id: { default: null },
	};
}

export interface MediaAttrs extends Record<string, unknown> {
	src: string;
	name: string;
	size: number | null;
	mime: string;
	width_pct: number | null;
	uploading: boolean;
	upload_id: string | null;
	blob_url: string | null;
	upload_error: string | null;
	block_id: string | null;
}

export const videoBlock = defineBlock<MediaAttrs>({
	name: 'video',
	schema: {
		group: 'block',
		atom: true,
		draggable: true,
		attrs: mediaAttrs(),
		parseDOM: [
			{
				tag: 'video[src]',
				getAttrs: (dom: HTMLElement) => ({ src: dom.getAttribute('src') ?? '' }),
			},
		],
		toDOM: (node) => ['video', { src: node.attrs.src || undefined, controls: 'true' }],
	},
	component: VideoBlock,
	interactive: { resize: { attr: 'width_pct', unit: 'percent' } },
	upload_kind: 'video',
	commands: [
		{
			name: 'video',
			label: 'Video',
			description: 'Upload and embed a video',
			icon: icons.video,
			keywords: ['movie', 'mp4', 'upload'],
			group: 'Media',
			is_enabled: (editor) => Boolean(editor.uploader),
			run: (editor) => pickFiles(editor, 'video/*'),
		},
	],
	render: videoRenderer,
	render_text: () => '',
});

export const audioBlock = defineBlock<MediaAttrs>({
	name: 'audio',
	schema: {
		group: 'block',
		atom: true,
		draggable: true,
		attrs: mediaAttrs(),
		parseDOM: [
			{
				tag: 'audio[src]',
				getAttrs: (dom: HTMLElement) => ({ src: dom.getAttribute('src') ?? '' }),
			},
		],
		toDOM: (node) => ['audio', { src: node.attrs.src || undefined, controls: 'true' }],
	},
	component: AudioBlock,
	upload_kind: 'audio',
	commands: [
		{
			name: 'audio',
			label: 'Audio',
			description: 'Upload and embed an audio file',
			icon: icons.audio,
			keywords: ['music', 'sound', 'mp3', 'podcast', 'upload'],
			group: 'Media',
			is_enabled: (editor) => Boolean(editor.uploader),
			run: (editor) => pickFiles(editor, 'audio/*'),
		},
	],
	render: audioRenderer,
	render_text: () => '',
});

export const fileBlock = defineBlock<MediaAttrs>({
	name: 'file',
	schema: {
		group: 'block',
		atom: true,
		draggable: true,
		attrs: mediaAttrs(),
		parseDOM: [
			{
				tag: 'a[data-file][href]',
				getAttrs: (dom: HTMLElement) => ({
					src: dom.getAttribute('href') ?? '',
					name: dom.textContent ?? '',
				}),
			},
		],
		toDOM: (node) => [
			'a',
			{
				href: node.attrs.src || undefined,
				'data-file': 'true',
				download: node.attrs.name,
			},
			node.attrs.name || 'Download',
		],
	},
	component: FileBlock,
	upload_kind: 'file',
	commands: [
		{
			name: 'file',
			label: 'File attachment',
			description: 'Upload any file as a download',
			icon: icons.file,
			keywords: ['attachment', 'download', 'document', 'upload'],
			group: 'Media',
			is_enabled: (editor) => Boolean(editor.uploader),
			run: (editor) => pickFiles(editor, '*/*'),
		},
	],
	render: fileRenderer,
	render_text: (node) => String(node.attrs?.name ?? ''),
});
