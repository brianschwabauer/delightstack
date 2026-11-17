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
	/**
	 * Give `h1`–`h6` an `id` derived from their own text, so `#some-heading`
	 * links land somewhere. Default `true`; see {@link slugifyHeading} for the
	 * slug a consumer has to generate to match one.
	 */
	heading_ids?: boolean;
	/**
	 * Text column width in px, used to compute responsive `sizes` for images
	 * with srcsets (should match the host's --editor-measure). Default 736
	 */
	column_px?: number;
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

/**
 * The slug `renderHTML` puts in a heading's `id` — exported so a table of
 * contents, a backlink or a deep link can build the same `#fragment` from the
 * same heading text without guessing at the rules.
 *
 * Lowercased; accents folded away by decomposing to NFKD and dropping the
 * combining marks (`Café` → `cafe`, not `caf-`); every run of anything outside
 * `[a-z0-9]` collapsed to a single `-`; no leading or trailing `-`. Text with
 * nothing left after that (an emoji-only heading, say) slugs to `''`, and
 * `renderHTML` leaves such a heading without an `id` rather than emitting an
 * empty one.
 *
 * Duplicate headings are disambiguated by `renderHTML` per document, not here:
 * the second `## Notes` in a document becomes `notes-2`, the third `notes-3`.
 */
export function slugifyHeading(text: string): string {
	return String(text ?? '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

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
	const heading_ids = options.heading_ids ?? true;
	/** Ids already handed out in THIS document, so `-2`/`-3` can be appended. */
	const used_heading_ids = new Set<string>();
	const blocks = { ...defaultBlockRenderers, ...options.blocks };
	const text_renderers = { ...defaultBlockTextRenderers, ...options.text };
	const marks = { ...BASE_MARKS, ...options.marks };

	const context: ContextWithLinks = {
		class_prefix,
		column_px: options.column_px ?? 736,
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

	/**
	 * The heading's own `id`: its plain text slugged, then made unique against
	 * the headings already rendered in this document. Empty when `heading_ids`
	 * is off, or when the heading has no sluggable text.
	 */
	function headingId(node: JSONContent): string {
		if (!heading_ids) return '';
		const base = slugifyHeading(context.render_text(node.content).trim());
		if (!base) return '';
		let id = base;
		for (let n = 2; used_heading_ids.has(id); n++) id = `${base}-${n}`;
		used_heading_ids.add(id);
		return id;
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
				const id = headingId(node);
				// The slug is `[a-z0-9-]` by construction, so it never needs escaping.
				return `<h${level}${id ? ` id="${id}"` : ''}>${(node.content ?? []).map(renderInline).join('')}</h${level}>`;
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
