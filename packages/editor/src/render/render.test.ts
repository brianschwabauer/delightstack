import { describe, expect, it } from 'vitest';
import { renderHTML, renderText } from './index.js';
import type { JSONContent } from '../types/index.js';

const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

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
			'<h2>Title</h2><p>a <em><strong>b</strong></em><br><code>c</code></p><hr>',
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
