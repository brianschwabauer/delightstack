import type {
	BlockRenderer,
	JSONContent,
	MarkRenderer,
	RenderContext,
} from '../types/index.js';
import { defaultBlockRenderers, defaultBlockTextRenderers } from './blocks.js';

/**
 * Zero-dependency ProseMirror-JSON → HTML renderer, safe for SvelteKit
 * server routes and Cloudflare Workers (no svelte, no prosemirror, no DOM).
 * Public pages that don't need editing should use this instead of shipping
 * the editor.
 */

export interface RenderOptions {
	/** Renderers for custom blocks (merged over the built-ins) */
	blocks?: Record<string, BlockRenderer>;
	/** Mark renderers (merged over the built-ins) */
	marks?: Record<string, MarkRenderer>;
	/** Plaintext extractors per block (merged over the built-ins) */
	text?: Record<string, (node: JSONContent) => string>;
	/** Resolves an image id to a URL (e.g. @delightstack/images' imageURL) */
	image_url?: (id: string, variant?: string) => string;
	/** Attribute policy for links. Default adds rel="noopener noreferrer" */
	link_attrs?: (href: string) => Record<string, string | undefined>;
	/** CSS class prefix for wrapper elements. Default 'ds-doc' */
	class_prefix?: string;
}

export function renderHTML(doc: JSONContent, options: RenderOptions = {}): string {
	const context = createContext(options);
	return context.render(doc.type === 'doc' ? doc.content : [doc]);
}

/** Plaintext extraction (search indexing, AI context). */
export function renderText(doc: JSONContent, options: RenderOptions = {}): string {
	const context = createContext(options);
	return context.render_text(doc.type === 'doc' ? doc.content : [doc]).trim();
}

export { defaultBlockRenderers, defaultBlockTextRenderers } from './blocks.js';

export function esc(value: unknown): string {
	return String(value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

const BASE_MARKS: Record<string, MarkRenderer> = {
	bold: (_mark, inner) => `<strong>${inner}</strong>`,
	italic: (_mark, inner) => `<em>${inner}</em>`,
	underline: (_mark, inner) => `<u>${inner}</u>`,
	strike: (_mark, inner) => `<s>${inner}</s>`,
	code: (_mark, inner) => `<code>${inner}</code>`,
	link: (mark, inner, ctx) => {
		const href = String(mark.attrs?.href ?? '');
		const attrs = (ctx as ContextWithLinks).link_attrs(href);
		const extra = Object.entries(attrs)
			.filter(([, value]) => value !== undefined)
			.map(([key, value]) => ` ${key}="${esc(value)}"`)
			.join('');
		return `<a href="${esc(href)}"${extra}>${inner}</a>`;
	},
};

interface ContextWithLinks extends RenderContext {
	link_attrs: (href: string) => Record<string, string | undefined>;
}

function createContext(options: RenderOptions): ContextWithLinks {
	const class_prefix = options.class_prefix ?? 'ds-doc';
	const blocks = { ...defaultBlockRenderers, ...options.blocks };
	const text_renderers = { ...defaultBlockTextRenderers, ...options.text };
	const marks = { ...BASE_MARKS, ...options.marks };

	const context: ContextWithLinks = {
		class_prefix,
		esc,
		image_url:
			options.image_url ?? ((id, variant = 'default') => `/cdn/image/${id}/${variant}`),
		link_attrs:
			options.link_attrs ??
			((href) => ({
				rel: 'noopener noreferrer nofollow',
				target: /^https?:\/\//.test(href) ? '_blank' : undefined,
			})),
		render: (nodes) => (nodes ?? []).map((node) => renderNode(node)).join(''),
		render_text: (nodes) => (nodes ?? []).map((node) => textNode(node)).join(''),
	};

	function renderInline(node: JSONContent): string {
		if (node.type === 'hard_break') return '<br>';
		if (node.type !== 'text') {
			const renderer = blocks[node.type];
			return renderer ? renderer(node, context) : '';
		}
		let html = esc(node.text ?? '');
		for (const mark of node.marks ?? []) {
			const renderer = marks[mark.type];
			if (renderer) html = renderer(mark, html, context);
		}
		return html;
	}

	function renderNode(node: JSONContent): string {
		if (node.attrs?.uploading === true) return '';
		switch (node.type) {
			case 'text':
			case 'hard_break':
				return renderInline(node);
			case 'paragraph':
				return `<p>${(node.content ?? []).map(renderInline).join('')}</p>`;
			case 'heading': {
				const level = Math.min(Math.max(Number(node.attrs?.level) || 2, 1), 6);
				return `<h${level}>${(node.content ?? []).map(renderInline).join('')}</h${level}>`;
			}
			case 'blockquote':
				return `<blockquote>${context.render(node.content)}</blockquote>`;
			case 'bullet_list':
				return `<ul>${context.render(node.content)}</ul>`;
			case 'ordered_list': {
				const start = Number(node.attrs?.start) || 1;
				return `<ol${start === 1 ? '' : ` start="${start}"`}>${context.render(node.content)}</ol>`;
			}
			case 'list_item':
				return `<li>${context.render(node.content)}</li>`;
			case 'todo_list':
				return `<ul class="${class_prefix}-todos" data-todo-list>${context.render(node.content)}</ul>`;
			case 'todo_item': {
				const checked = node.attrs?.checked === true;
				return `<li data-todo="${checked ? 'checked' : 'unchecked'}">${context.render(node.content)}</li>`;
			}
			case 'horizontal_rule':
				return '<hr>';
			default: {
				const renderer = blocks[node.type];
				return renderer ? renderer(node, context) : '';
			}
		}
	}

	function textNode(node: JSONContent): string {
		if (node.attrs?.uploading === true) return '';
		if (node.type === 'text') return node.text ?? '';
		if (node.type === 'hard_break') return '\n';
		const custom = text_renderers[node.type];
		if (custom) {
			const text = custom(node);
			return text ? `${text}\n\n` : '';
		}
		if (node.content?.length) {
			const inline = node.content.every(
				(child) => child.type === 'text' || child.type === 'hard_break',
			);
			const inner = context.render_text(node.content);
			return inline ? `${inner}\n\n` : inner;
		}
		return '';
	}

	return context;
}
