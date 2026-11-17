import { describe, expect, it } from 'vitest';
import { renderHTML, renderText, slugifyHeading } from './index.js';
import type { JSONContent } from '../types/index.js';

const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

const heading = (text: string, level = 2): JSONContent => ({
	type: 'heading',
	attrs: { level },
	content: [{ type: 'text', text }],
});

const ids = (html: string) => [...html.matchAll(/<h\d id="([^"]*)"/g)].map((m) => m[1]);

describe('renderHTML', () => {
	it('renders base nodes and marks', () => {
		const html = renderHTML(
			doc(
				{
					type: 'heading',
					attrs: { level: 2 },
					content: [{ type: 'text', text: 'Title' }],
				},
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'a ' },
						{ type: 'text', text: 'b', marks: [{ type: 'bold' }, { type: 'italic' }] },
						{ type: 'hard_break' },
						{ type: 'text', text: 'c', marks: [{ type: 'code' }] },
					],
				},
				{ type: 'horizontal_rule' },
			),
		);
		expect(html).toBe(
			'<h2 id="title">Title</h2><p>a <em><strong>b</strong></em><br><code>c</code></p><hr>',
		);
	});

	it('renders lists, todos, and quotes', () => {
		const html = renderHTML(
			doc(
				{
					type: 'ordered_list',
					attrs: { start: 3 },
					content: [
						{
							type: 'list_item',
							content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
						},
					],
				},
				{
					type: 'todo_list',
					content: [
						{
							type: 'todo_item',
							attrs: { checked: true },
							content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }],
						},
					],
				},
				{
					type: 'blockquote',
					content: [{ type: 'paragraph', content: [{ type: 'text', text: 'q' }] }],
				},
			),
		);
		expect(html).toContain('<ol start="3"><li><p>x</p></li></ol>');
		expect(html).toContain('data-todo="checked"');
		expect(html).toContain('<blockquote><p>q</p></blockquote>');
	});

	it('escapes text content and attributes', () => {
		const html = renderHTML(
			doc({
				type: 'paragraph',
				content: [
					{
						type: 'text',
						text: '<script>alert("x")</script>',
						marks: [{ type: 'link', attrs: { href: 'https://x.co/?a="b"' } }],
					},
				],
			}),
		);
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('href="https://x.co/?a=&quot;b&quot;"');
		expect(html).toContain('rel="noopener noreferrer nofollow"');
	});

	it('renders built-in blocks (callout, code, image) and skips uploading nodes', () => {
		const html = renderHTML(
			doc(
				{
					type: 'callout',
					attrs: { variant: 'warning' },
					content: [{ type: 'paragraph', content: [{ type: 'text', text: 'heads up' }] }],
				},
				{
					type: 'code_block',
					attrs: { language: 'ts' },
					content: [{ type: 'text', text: 'const a = 1 < 2;' }],
				},
				{
					type: 'image',
					attrs: { src: 'https://cdn/x.png', alt: 'A "photo"', width: 10, height: 5 },
				},
				{ type: 'image', attrs: { uploading: true, blob_url: 'blob:x' } },
			),
		);
		expect(html).toContain('data-callout="warning"');
		expect(html).toContain('<code class="language-ts">const a = 1 &lt; 2;</code>');
		expect(html).toContain('alt="A &quot;photo&quot;"');
		expect(html).not.toContain('blob:');
	});

	it('resolves image ids through image_url', () => {
		const html = renderHTML(
			doc({ type: 'image', attrs: { image_id: 'img9', alt: '' } }),
			{ image_url: (id) => `https://cdn.example/${id}/lg` },
		);
		expect(html).toContain('src="https://cdn.example/img9/lg"');
	});

	it('renders breakout width modes and normal-width percentages', () => {
		const wide = renderHTML(
			doc({ type: 'image', attrs: { src: 'x.jpg', alt: '', width_mode: 'wide' } }),
		);
		expect(wide).toContain('data-width-mode="wide"');
		expect(wide).toContain('--editor-wide-width');
		expect(wide).toContain('margin-left:50%');

		const full = renderHTML(
			doc({ type: 'video', attrs: { src: 'v.mp4', width_mode: 'full' } }),
		);
		expect(full).toContain('data-width-mode="full"');
		expect(full).toContain('--editor-full-width');

		const pct = renderHTML(
			doc({
				type: 'image',
				attrs: { src: 'x.jpg', alt: '', width_mode: 'normal', width_pct: 50 },
			}),
		);
		expect(pct).toContain('width:50%');
		expect(pct).not.toContain('data-width-mode');
	});

	it('renders cropped images with cover + focal point and sizes from width mode', () => {
		const html = renderHTML(
			doc({
				type: 'image',
				attrs: {
					src: 'x.jpg',
					srcset: 'x-400.jpg 400w, x-800.jpg 800w',
					alt: '',
					width: 800,
					height: 600,
					crop_aspect: 2.5,
					focal_x: 30,
					focal_y: 70,
				},
			}),
		);
		expect(html).toContain('aspect-ratio:2.5');
		expect(html).toContain('object-fit:cover');
		expect(html).toContain('object-position:30% 70%');
		expect(html).toContain('sizes="(max-width: 768px) 100vw, 736px"');
	});

	it('renders gallery captions as figcaptions unless hidden', () => {
		const items = [{ id: 'a', src: 'a.jpg', caption: 'A caption' }];
		const shown = renderHTML(doc({ type: 'gallery', attrs: { items } }));
		expect(shown).toContain('<figcaption>A caption</figcaption>');
		expect(shown).toContain('data-captions="hover"');

		const hidden = renderHTML(
			doc({ type: 'gallery', attrs: { items, captions: 'none' } }),
		);
		expect(hidden).not.toContain('figcaption');
	});

	it('supports custom block renderer overrides', () => {
		const html = renderHTML(doc({ type: 'widget', attrs: { kind: 'chart' } }), {
			blocks: {
				widget: (node, ctx) => `<div data-w="${ctx.esc(node.attrs?.kind)}"></div>`,
			},
		});
		expect(html).toBe('<div data-w="chart"></div>');
	});

	it('ignores unknown nodes instead of throwing', () => {
		expect(renderHTML(doc({ type: 'mystery' }))).toBe('');
	});
});

describe('heading ids', () => {
	it('ids every heading level from its own text', () => {
		const html = renderHTML(
			doc(
				heading('Getting Started', 1),
				heading('Install It', 2),
				heading('Deep Detail', 6),
			),
		);
		expect(html).toContain('<h1 id="getting-started">Getting Started</h1>');
		expect(html).toContain('<h2 id="install-it">Install It</h2>');
		expect(html).toContain('<h6 id="deep-detail">Deep Detail</h6>');
	});

	it('slugs the text a reader sees, marks and hard breaks included', () => {
		const html = renderHTML(
			doc({
				type: 'heading',
				attrs: { level: 2 },
				content: [
					{ type: 'text', text: 'Rate ' },
					{ type: 'text', text: 'limits', marks: [{ type: 'bold' }] },
					{ type: 'hard_break' },
					{ type: 'text', text: '& quotas' },
				],
			}),
		);
		expect(ids(html)).toEqual(['rate-limits-quotas']);
	});

	it('numbers repeats within the document, in document order', () => {
		const html = renderHTML(
			doc(heading('Notes'), heading('Body'), heading('Notes'), heading('Notes')),
		);
		expect(ids(html)).toEqual(['notes', 'body', 'notes-2', 'notes-3']);
	});

	it('does not let a generated id collide with a heading that spells it out', () => {
		const html = renderHTML(doc(heading('Notes'), heading('Notes'), heading('Notes 2')));
		expect(ids(html)).toEqual(['notes', 'notes-2', 'notes-2-2']);
		expect(new Set(ids(html)).size).toBe(3);
	});

	it('starts the numbering fresh for each document', () => {
		expect(ids(renderHTML(doc(heading('Notes'))))).toEqual(['notes']);
		expect(ids(renderHTML(doc(heading('Notes'))))).toEqual(['notes']);
	});

	it('leaves a heading with no sluggable text unidentified', () => {
		const html = renderHTML(doc(heading('🎉'), heading('Real Heading')));
		expect(html).toContain('<h2>🎉</h2>');
		expect(ids(html)).toEqual(['real-heading']);
	});

	it('can be turned off', () => {
		const html = renderHTML(doc(heading('Getting Started')), { heading_ids: false });
		expect(html).toBe('<h2>Getting Started</h2>');
	});
});

describe('slugifyHeading', () => {
	it('lowercases, folds accents, and collapses everything else to single dashes', () => {
		expect(slugifyHeading('Getting Started')).toBe('getting-started');
		expect(slugifyHeading('Café — naïve résumé')).toBe('cafe-naive-resume');
		expect(slugifyHeading('C++ / Rust: a "comparison"')).toBe('c-rust-a-comparison');
		expect(slugifyHeading('  Trim   me!  ')).toBe('trim-me');
		expect(slugifyHeading('Section 2.1')).toBe('section-2-1');
	});

	it('keeps accented characters as their base letter rather than dropping them', () => {
		// Without the combining-mark strip, `naïve` would slug to `nai-ve`.
		expect(slugifyHeading('Café')).toBe('cafe');
		expect(slugifyHeading('naïve')).toBe('naive');
		// NFKD has nothing to decompose `ß` into, so it falls to the catch-all
		// dash rule like any other non-`[a-z0-9]` character.
		expect(slugifyHeading('Jürgen Straße')).toBe('jurgen-stra-e');
	});

	it('returns an empty string when nothing sluggable is left', () => {
		expect(slugifyHeading('🎉 ✨')).toBe('');
		expect(slugifyHeading('')).toBe('');
		expect(slugifyHeading('—')).toBe('');
	});

	it('matches the ids renderHTML emits', () => {
		const text = 'Résumé & Références';
		const html = renderHTML(doc(heading(text)));
		expect(html).toContain(`id="${slugifyHeading(text)}"`);
	});
});

describe('renderText', () => {
	it('extracts plaintext with block boundaries', () => {
		const text = renderText(
			doc(
				{
					type: 'heading',
					attrs: { level: 2 },
					content: [{ type: 'text', text: 'Title' }],
				},
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'Hello ' },
						{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
					],
				},
				{ type: 'image', attrs: { src: 'x', alt: 'a sunset' } },
			),
		);
		expect(text).toBe('Title\n\nHello bold\n\na sunset');
	});
});
