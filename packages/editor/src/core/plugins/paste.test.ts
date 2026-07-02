import { describe, expect, it } from 'vitest';
import { scrubHTML } from './paste.js';
import { DOMParser as PMDOMParser } from 'prosemirror-model';
import { buildSchema } from '../../schema/index.js';

function parseHTML(html: string) {
	const schema = buildSchema();
	const div = document.createElement('div');
	div.innerHTML = scrubHTML(html);
	return PMDOMParser.fromSchema(schema).parse(div).toJSON() as {
		content?: { type: string; content?: unknown[] }[];
	};
}

describe('scrubHTML', () => {
	it('unwraps the Google Docs internal-guid bold wrapper', () => {
		const html =
			'<b style="font-weight:normal;" id="docs-internal-guid-abc-123"><p>Hello <span style="font-weight:700">bold</span></p></b>';
		const doc = parseHTML(html);
		expect(doc.content?.[0].type).toBe('paragraph');
		const text = doc.content?.[0].content as {
			text: string;
			marks?: { type: string }[];
		}[];
		expect(text?.[0].text).toBe('Hello ');
		expect(text?.[0].marks).toBeUndefined();
		expect(text?.[1].marks?.[0].type).toBe('bold');
	});

	it('strips Word conditional comments, o:p tags, and mso classes', () => {
		const html =
			'<!--[if gte mso 9]><xml>junk</xml><![endif]--><p class="MsoNormal">Word text<o:p></o:p></p><style>p{}</style>';
		const scrubbed = scrubHTML(html);
		expect(scrubbed).not.toContain('mso');
		expect(scrubbed).not.toContain('o:p');
		expect(scrubbed).not.toContain('<style>');
		const doc = parseHTML(html);
		expect(doc.content?.[0].type).toBe('paragraph');
	});

	it('keeps semantic structure from web pastes', () => {
		const doc = parseHTML(
			'<h2>Title</h2><ul><li><p>item</p></li></ul><pre><code class="language-js">x</code></pre>',
		);
		expect(doc.content?.map((node) => node.type)).toEqual([
			'heading',
			'bullet_list',
			'code_block',
		]);
	});

	it('parses inline styles into marks', () => {
		const doc = parseHTML(
			'<p><span style="font-style:italic">it</span><span style="text-decoration:underline">un</span><span style="text-decoration:line-through">st</span></p>',
		);
		const text = doc.content?.[0].content as {
			text: string;
			marks?: { type: string }[];
		}[];
		expect(text?.[0].marks?.[0].type).toBe('italic');
		expect(text?.[1].marks?.[0].type).toBe('underline');
		expect(text?.[2].marks?.[0].type).toBe('strike');
	});
});
