/**
 * The SVG sanitizer's reference rules, hole by hole.
 *
 * The consumer's sandboxed CSP is the load-bearing defence when a sanitized
 * SVG is served; these tests hold the belt to its own claim — every *findable*
 * external reference is removed, whatever the quoting or the URL shape.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeSvg } from '../container/src/svg-sanitize';

const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

describe('sanitizeSvg — hostile content throws', () => {
	it('throws on javascript: URLs, raw and entity-obfuscated', () => {
		expect(() => sanitizeSvg(wrap('<a href="javascript:alert(1)">x</a>'))).toThrowError(
			/dangerous/i,
		);
		expect(() =>
			sanitizeSvg(wrap('<a href="java&#x73;cript:alert(1)">x</a>')),
		).toThrowError(/dangerous/i);
	});

	it('throws on data:text/html', () => {
		expect(() =>
			sanitizeSvg(wrap('<a href="data:text/html,<script>x</script>">x</a>')),
		).toThrowError(/dangerous/i);
	});
});

describe('sanitizeSvg — elements and handlers', () => {
	it('removes script blocks and event handlers', () => {
		const out = sanitizeSvg(
			wrap('<script>fetch("x")</script><rect onclick="p()" onload=p width="4"/>'),
		);
		expect(out).not.toContain('script');
		expect(out).not.toContain('onclick');
		expect(out).not.toContain('onload');
		expect(out).toContain('<rect');
	});
});

describe('sanitizeSvg — href allowlist (the shapes the blocklist missed)', () => {
	it('removes protocol-relative hrefs', () => {
		const out = sanitizeSvg(wrap('<image href="//evil.example/x.png"/>'));
		expect(out).not.toContain('evil.example');
		expect(out).not.toContain('href');
	});

	it('removes unquoted hrefs', () => {
		const out = sanitizeSvg(wrap('<image href=https://evil.example/x.png />'));
		expect(out).not.toContain('evil.example');
	});

	it('removes quoted http/https and other schemes, either quote style', () => {
		const out = sanitizeSvg(
			wrap(
				`<image href="https://evil.example/a"/><image xlink:href='http://evil.example/b'/><image href="ftp://evil.example/c"/>`,
			),
		);
		expect(out).not.toContain('evil.example');
	});

	it('removes relative-path hrefs (they resolve against the serving origin)', () => {
		const out = sanitizeSvg(wrap('<image href="../secrets.svg"/>'));
		expect(out).not.toContain('secrets');
	});

	it('keeps #fragment references and inline data:image payloads', () => {
		const out = sanitizeSvg(
			wrap('<use href="#glyph"/><image href="data:image/png;base64,iVBORw0KGgo="/>'),
		);
		expect(out).toContain('href="#glyph"');
		expect(out).toContain('data:image/png');
	});
});

describe('sanitizeSvg — <use>', () => {
	it('removes a <use> whose href is external, however it is quoted', () => {
		expect(sanitizeSvg(wrap('<use href="//evil.example/defs.svg#x"/>'))).not.toContain(
			'<use',
		);
		expect(sanitizeSvg(wrap('<use href=//evil.example/defs.svg#x />'))).not.toContain(
			'<use',
		);
		expect(
			sanitizeSvg(wrap(`<use xlink:href='https://evil.example/d.svg#x'/>`)),
		).not.toContain('<use');
	});

	it('keeps an internal <use>', () => {
		expect(sanitizeSvg(wrap('<defs><g id="x"/></defs><use href="#x"/>'))).toContain(
			'<use',
		);
	});
});

describe('sanitizeSvg — CSS fetches', () => {
	it('neutralizes url() in style attributes, keeping #fragment targets', () => {
		const out = sanitizeSvg(
			wrap(
				`<rect style="fill:url(#grad);filter:url('https://evil.example/f.svg#f')" width="4"/>`,
			),
		);
		expect(out).toContain('url(#grad)');
		expect(out).not.toContain('evil.example');
		expect(out).toContain('none');
	});

	it('neutralizes url() and @import inside <style> blocks', () => {
		const out = sanitizeSvg(
			wrap(
				`<style>@import "https://evil.example/x.css"; .a{background:url(//evil.example/b.png)} .b{fill:url(#ok)}</style>`,
			),
		);
		expect(out).not.toContain('evil.example');
		expect(out).not.toContain('@import');
		expect(out).toContain('url(#ok)');
	});

	it('handles unquoted style attributes', () => {
		const out = sanitizeSvg(wrap('<rect style=fill:url(//evil.example/p) width="4"/>'));
		expect(out).not.toContain('evil.example');
	});
});
