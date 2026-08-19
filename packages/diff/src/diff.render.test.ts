import { describe, expect, it } from 'vitest';
import { DiffError } from './diff.error';
import { escapeHTML, renderDiffHTML } from './diff.render';
import { diffWords } from './diff.text';

describe('renderDiffHTML', () => {
	it('wraps insertions and deletions', () => {
		const ops = diffWords('one two three', 'one four three');
		expect(renderDiffHTML(ops)).toBe('one <del>two</del><ins>four</ins> three');
	});

	it('escapes HTML in every op type', () => {
		const old_text = 'a <script>alert("x")</script> & b';
		const new_text = 'a <script>alert("y")</script> & b';
		const html = renderDiffHTML(diffWords(old_text, new_text));
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('&amp;');
		expect(html).toContain('&quot;');
	});

	it('renders an empty diff as an empty string', () => {
		expect(renderDiffHTML([])).toBe('');
	});

	it('escapes the five significant characters', () => {
		expect(escapeHTML(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
	});

	it('accepts custom tags and classes', () => {
		const ops = diffWords('one two three', 'one four three');
		const html = renderDiffHTML(ops, {
			insert_tag: 'span',
			delete_tag: 'span',
			equal_tag: 'span',
			insert_class: 'diff-insert',
			delete_class: 'diff-delete',
			equal_class: 'diff-equal',
		});
		expect(html).toBe(
			'<span class="diff-equal">one </span>' +
				'<span class="diff-delete">two</span>' +
				'<span class="diff-insert">four</span>' +
				'<span class="diff-equal"> three</span>',
		);
	});

	it('renders bare text for a tag set to the empty string', () => {
		const ops = diffWords('a b', 'a c');
		expect(renderDiffHTML(ops, { delete_tag: '' })).toBe('a b<ins>c</ins>');
	});

	it('escapes a class name so it cannot break out of the attribute', () => {
		const ops = diffWords('a', 'b');
		const html = renderDiffHTML(ops, { insert_class: '"><script>' });
		expect(html).not.toContain('<script>');
		expect(html).toContain('&quot;&gt;&lt;script&gt;');
	});

	it('rejects a tag name that is not a tag name', () => {
		const ops = diffWords('a', 'b');
		expect(() => renderDiffHTML(ops, { insert_tag: 'ins onclick=x' })).toThrow(DiffError);
		try {
			renderDiffHTML(ops, { delete_tag: '<script>' });
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(DiffError);
			expect((error as DiffError).code).toBe('invalid_tag_name');
			expect((error as DiffError).status).toBe(400);
		}
	});

	it('converts newlines to <br> only when asked', () => {
		const ops = diffWords('a\nb', 'a\nc');
		expect(renderDiffHTML(ops)).toContain('\n');
		const broken = renderDiffHTML(ops, { break_lines: true });
		expect(broken).toContain('<br>');
		expect(broken).not.toContain('\n');
	});
});
