import type { BlockRenderer, JSONContent, UploadedImage } from '../types/index.js';

/**
 * Server-safe renderers for the built-in blocks. Authored here (zero-dep) so
 * Workers can render documents without importing any Svelte component code;
 * the block specs reference these same functions for consistency.
 */

export const calloutRenderer: BlockRenderer = (node, ctx) =>
	`<aside class="${ctx.class_prefix}-callout" data-callout="${ctx.esc(node.attrs?.variant ?? 'info')}">${ctx.render(node.content)}</aside>`;

export const codeBlockRenderer: BlockRenderer = (node, ctx) => {
	const language = typeof node.attrs?.language === 'string' ? node.attrs.language : '';
	const cls = language ? ` class="language-${ctx.esc(language)}"` : '';
	const code = (node.content ?? []).map((child) => child.text ?? '').join('');
	return `<pre class="${ctx.class_prefix}-code"><code${cls}>${ctx.esc(code)}</code></pre>`;
};

export const imageRenderer: BlockRenderer = (node, ctx) => {
	const attrs = node.attrs ?? {};
	if (attrs.uploading || (!attrs.src && !attrs.image_id)) return '';
	const src = attrs.src ? String(attrs.src) : ctx.image_url(String(attrs.image_id));
	const width =
		typeof attrs.width_pct === 'number' ? ` style="width:${attrs.width_pct}%"` : '';
	const size =
		attrs.width && attrs.height ? ` width="${attrs.width}" height="${attrs.height}"` : '';
	const srcset = attrs.srcset ? ` srcset="${ctx.esc(attrs.srcset)}"` : '';
	const caption = attrs.caption
		? `<figcaption>${ctx.esc(attrs.caption)}</figcaption>`
		: '';
	return `<figure class="${ctx.class_prefix}-image"${width}><img src="${ctx.esc(src)}"${srcset} alt="${ctx.esc(attrs.alt ?? '')}"${size} loading="lazy">${caption}</figure>`;
};

export const videoRenderer: BlockRenderer = (node, ctx) => {
	const attrs = node.attrs ?? {};
	if (attrs.uploading || !attrs.src) return '';
	return `<figure class="${ctx.class_prefix}-video"><video src="${ctx.esc(attrs.src)}" controls preload="metadata"></video></figure>`;
};

export const audioRenderer: BlockRenderer = (node, ctx) => {
	const attrs = node.attrs ?? {};
	if (attrs.uploading || !attrs.src) return '';
	return `<figure class="${ctx.class_prefix}-audio"><audio src="${ctx.esc(attrs.src)}" controls preload="metadata"></audio></figure>`;
};

export const fileRenderer: BlockRenderer = (node, ctx) => {
	const attrs = node.attrs ?? {};
	if (attrs.uploading || !attrs.src) return '';
	return `<a class="${ctx.class_prefix}-file" href="${ctx.esc(attrs.src)}" download="${ctx.esc(attrs.name ?? '')}">${ctx.esc(attrs.name || 'Download')}</a>`;
};

export const embedRenderer: BlockRenderer = (node, ctx) => {
	const attrs = node.attrs ?? {};
	if (!attrs.src) return '';
	const ratio = typeof attrs.aspect_ratio === 'number' ? attrs.aspect_ratio : 16 / 9;
	return `<figure class="${ctx.class_prefix}-embed" style="aspect-ratio:${ratio}"><iframe src="${ctx.esc(attrs.src)}" title="${ctx.esc(attrs.title ?? '')}" loading="lazy" allowfullscreen></iframe></figure>`;
};

export const galleryRenderer: BlockRenderer = (node, ctx) => {
	const attrs = node.attrs ?? {};
	const items = Array.isArray(attrs.items) ? (attrs.items as UploadedImage[]) : [];
	if (!items.length) return '';
	const images = items
		.map((image) => {
			const src = image.src ?? (image.id ? ctx.image_url(image.id) : '');
			if (!src) return '';
			const size =
				image.width && image.height
					? ` width="${image.width}" height="${image.height}"`
					: '';
			const srcset = image.srcset ? ` srcset="${ctx.esc(image.srcset)}"` : '';
			return `<img src="${ctx.esc(src)}"${srcset} alt="${ctx.esc(image.alt ?? '')}"${size} loading="lazy">`;
		})
		.join('');
	return `<div class="${ctx.class_prefix}-gallery" data-display="${ctx.esc(attrs.display ?? 'masonry')}">${images}</div>`;
};

export const defaultBlockRenderers: Record<string, BlockRenderer> = {
	callout: calloutRenderer,
	code_block: codeBlockRenderer,
	image: imageRenderer,
	video: videoRenderer,
	audio: audioRenderer,
	file: fileRenderer,
	embed: embedRenderer,
	gallery: galleryRenderer,
};

export const defaultBlockTextRenderers: Record<string, (node: JSONContent) => string> = {
	image: (node) => String(node.attrs?.alt ?? ''),
	file: (node) => String(node.attrs?.name ?? ''),
	embed: (node) => String(node.attrs?.title ?? ''),
	video: () => '',
	audio: () => '',
	gallery: (node) => {
		const items = Array.isArray(node.attrs?.items)
			? (node.attrs.items as UploadedImage[])
			: [];
		return items
			.map((image) => image.alt ?? '')
			.filter(Boolean)
			.join('\n');
	},
	code_block: (node) => (node.content ?? []).map((child) => child.text ?? '').join(''),
};
