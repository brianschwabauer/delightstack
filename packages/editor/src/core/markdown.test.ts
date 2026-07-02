import { describe, expect, it } from 'vitest';
import { looksLikeMarkdown, parseInline, parseMarkdown } from './markdown.js';
import { buildSchema } from '../schema/index.js';
import { Node as PMNode } from 'prosemirror-model';

describe('looksLikeMarkdown', () => {
	it('detects markdown-ish text', () => {
		expect(looksLikeMarkdown('# Title')).toBe(true);
		expect(looksLikeMarkdown('- a list item')).toBe(true);
		expect(looksLikeMarkdown('some **bold** text')).toBe(true);
		expect(looksLikeMarkdown('a [link](https://x.co)')).toBe(true);
		expect(looksLikeMarkdown('plain sentence here.')).toBe(false);
	});
});

describe('parseMarkdown', () => {
	it('parses headings, paragraphs, and rules', () => {
		const blocks = parseMarkdown('## Hello\n\nWorld paragraph\n\n---');
		expect(blocks.map((block) => block.type)).toEqual([
			'heading',
			'paragraph',
			'horizontal_rule',
		]);
		// `##` maps to document level 3: markdown hashes are user-facing
		// heading numbers, and document levels start at 2 (h1 = page title)
		expect(blocks[0].attrs?.level).toBe(3);
	});

	it('parses lists including todos and ordered starts', () => {
		const blocks = parseMarkdown(
			'- one\n- two\n\n3. three\n4. four\n\n- [x] done\n- [ ] open',
		);
		expect(blocks.map((block) => block.type)).toEqual([
			'bullet_list',
			'ordered_list',
			'todo_list',
		]);
		expect(blocks[1].attrs?.start).toBe(3);
		expect(blocks[2].content?.[0].attrs?.checked).toBe(true);
		expect(blocks[2].content?.[1].attrs?.checked).toBe(false);
	});

	it('parses fenced code and quotes', () => {
		const blocks = parseMarkdown(
			'```ts\nconst x = 1;\nconst y = 2;\n```\n\n> quoted\n> lines',
		);
		expect(blocks[0].type).toBe('code_block');
		expect(blocks[0].attrs?.language).toBe('ts');
		expect(blocks[0].content?.[0].text).toBe('const x = 1;\nconst y = 2;');
		expect(blocks[1].type).toBe('blockquote');
		expect(blocks[1].content?.[0].type).toBe('paragraph');
	});

	it('parses inline marks and links, including nesting', () => {
		const inline = parseInline('a **bold _both_** and [link](https://x.co) and `code`');
		expect(inline).toBeDefined();
		const bold = inline!.find((node) => node.marks?.some((mark) => mark.type === 'bold'));
		expect(bold).toBeDefined();
		const both = inline!.find((node) => node.text === 'both');
		expect(both?.marks?.map((mark) => mark.type).sort()).toEqual(['bold', 'italic']);
		const link = inline!.find((node) => node.marks?.some((mark) => mark.type === 'link'));
		expect(link?.text).toBe('link');
		const code = inline!.find((node) => node.marks?.some((mark) => mark.type === 'code'));
		expect(code?.text).toBe('code');
	});

	it('produces schema-valid nodes', () => {
		const schema = buildSchema();
		const blocks = parseMarkdown(
			'# Title\n\nBody with **bold**\n\n- item\n\n> quote\n\n```js\ncode\n```\n\n---',
		);
		for (const block of blocks) {
			expect(() => PMNode.fromJSON(schema, block)).not.toThrow();
		}
	});
});
