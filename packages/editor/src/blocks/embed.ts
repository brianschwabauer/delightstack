import { defineBlock } from '../core/block-spec.js';
import { icons } from '../core/icons.js';
import EmbedBlock from '../components/blocks/EmbedBlock.svelte';
import { embedRenderer } from '../render/blocks.js';

export interface EmbedAttrs extends Record<string, unknown> {
	src: string;
	title: string;
	aspect_ratio: number;
	/** Rendered width as a percentage of the editor column (normal mode) */
	width_pct: number | null;
	/** Breakout tier: in-column, wide (--editor-wide-width), or full-bleed */
	width_mode: 'normal' | 'wide' | 'full';
	block_id: string | null;
}

/** Turns a pasted URL into an embeddable iframe URL for known providers. */
export function matchEmbedUrl(url: URL): Partial<EmbedAttrs> | null {
	const host = url.hostname.replace(/^www\./, '');

	if (host === 'youtube.com' || host === 'm.youtube.com') {
		const id =
			url.searchParams.get('v') ??
			url.pathname.match(/\/(?:shorts|embed)\/([\w-]+)/)?.[1];
		if (id)
			return {
				src: `https://www.youtube-nocookie.com/embed/${id}`,
				title: 'YouTube video',
			};
	}
	if (host === 'youtu.be') {
		const id = url.pathname.slice(1).split('/')[0];
		if (id)
			return {
				src: `https://www.youtube-nocookie.com/embed/${id}`,
				title: 'YouTube video',
			};
	}
	if (host === 'vimeo.com') {
		const id = url.pathname.match(/\/(\d+)/)?.[1];
		if (id) return { src: `https://player.vimeo.com/video/${id}`, title: 'Vimeo video' };
	}
	if (host === 'open.spotify.com') {
		const match = url.pathname.match(/\/(track|album|playlist|episode|show)\/([\w]+)/);
		if (match) {
			return {
				src: `https://open.spotify.com/embed/${match[1]}/${match[2]}`,
				title: 'Spotify',
				aspect_ratio: 16 / 5,
			};
		}
	}
	if (host === 'codepen.io') {
		const match = url.pathname.match(/^\/([\w-]+)\/pen\/([\w-]+)/);
		if (match) {
			return {
				src: `https://codepen.io/${match[1]}/embed/${match[2]}?default-tab=result`,
				title: 'CodePen',
			};
		}
	}
	return null;
}

export const embedBlock = defineBlock<EmbedAttrs>({
	name: 'embed',
	schema: {
		group: 'block',
		atom: true,
		draggable: true,
		attrs: {
			src: { default: '' },
			title: { default: '' },
			aspect_ratio: { default: 16 / 9 },
			width_pct: { default: null },
			width_mode: { default: 'normal' },
			block_id: { default: null },
		},
		parseDOM: [
			{
				tag: 'iframe[src]',
				getAttrs: (dom: HTMLElement) => ({
					src: dom.getAttribute('src') ?? '',
					title: dom.getAttribute('title') ?? '',
				}),
			},
		],
		toDOM: (node) => [
			'iframe',
			{ src: node.attrs.src || undefined, title: node.attrs.title || undefined },
		],
	},
	component: EmbedBlock,
	interactive: {
		resize: { attr: 'width_pct', unit: 'percent', min: 240, breakout: true },
	},
	settings: [
		{ attr: 'src', label: 'URL', control: 'text' },
		{ attr: 'title', label: 'Title', control: 'text' },
	],
	paste: { match_url: matchEmbedUrl },
	commands: [
		{
			name: 'embed',
			label: 'Embed',
			description: 'YouTube, Vimeo, Spotify, CodePen, or any URL',
			icon: icons.embed,
			keywords: ['iframe', 'youtube', 'vimeo', 'spotify', 'codepen', 'link'],
			group: 'Media',
			run: (editor) => editor.insertBlock('embed'),
		},
	],
	render: embedRenderer,
	render_text: (node) => String(node.attrs?.title ?? ''),
});
