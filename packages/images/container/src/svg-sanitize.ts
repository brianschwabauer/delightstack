/**
 * SVG sanitization — pure string transforms, no sharp, so it is unit-testable
 * outside the container (see tests/svg-sanitize.test.ts).
 *
 * The threat model: a served SVG is a document. Scripts and event handlers are
 * execution; external references (href, <use>, CSS url(), @import) are network
 * beacons and cross-origin reads. Serving behind a sandboxed CSP is the
 * consumer's load-bearing defence — this sanitizer is the belt that removes
 * what it can find, and it throws SVG_MALICIOUS only for content that is
 * unambiguously hostile (javascript:/data:text/html URLs).
 */

/** Dangerous SVG elements to remove (includes animation elements that can trigger JS) */
const DANGEROUS_ELEMENTS =
	/(<script[\s>][\s\S]*?<\/script>|<foreignObject[\s>][\s\S]*?<\/foreignObject>|<iframe[\s>][\s\S]*?<\/iframe>|<embed[\s>][\s\S]*?<\/embed>|<object[\s>][\s\S]*?<\/object>|<set[\s>][\s\S]*?(?:<\/set>|\/>)|<animate[\s>][\s\S]*?(?:<\/animate>|\/>)|<animateTransform[\s>][\s\S]*?(?:<\/animateTransform>|\/>))/gi;

/** Event handler attributes (supports double-quoted, single-quoted, and unquoted values) */
const EVENT_HANDLERS = /\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/gi;

/**
 * javascript: and data:text/html URLs — no `g` flag to avoid .test()
 * statefulness. The alternation groups the colon with each branch: the old
 * shape put one trailing `:` after the whole group, so `data:text/html,<…>`
 * (comma, the form data URLs actually take) never matched.
 */
const DANGEROUS_URLS = /(?:javascript\s*:|data\s*:\s*text\/html)/i;

/**
 * Every href/xlink:href, whatever the quoting (double, single, or none).
 * Matched broadly and then *allowlisted* in code — a blocklist of URL shapes
 * is how `//protocol-relative` and unquoted values slipped through.
 */
const HREF_ATTRS = /\s+((?:xlink:)?href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>'"]+))/gi;

/** <use> elements with any href (internal #id uses are re-admitted in code) */
const USE_ELEMENTS = /<use[\s>][^>]*\/?>/gi;

/** style="…" attributes, any quoting */
const STYLE_ATTRS = /\s+style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>'"]+))/gi;

/** <style> blocks — CSS inside an SVG can fetch (url(), @import) */
const STYLE_BLOCKS = /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi;

/** A CSS url(...) token, quoted or bare */
const CSS_URLS = /url\s*\(\s*(?:"([^")]*)"|'([^')]*)'|([^)'"]*))\s*\)/gi;

/** @import fetches whatever follows it — there is no internal form to keep */
const CSS_IMPORTS = /@import\b[^;]*;?/gi;

/** Decode HTML/XML numeric and named entities to detect obfuscated URLs */
function decodeEntities(str: string): string {
	return str
		.replace(/&#x([0-9a-fA-F]+);?/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
		.replace(/&#(\d+);?/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

/**
 * Whether a reference value may stay: fragment references (`#id`) and inline
 * raster data (`data:image/…`) are the two shapes with no network in them.
 * Everything else — http(s), protocol-relative `//`, other schemes, relative
 * paths (which resolve against the *serving* origin) — is removed.
 */
function keepableReference(value: string): boolean {
	const trimmed = value.trim();
	return trimmed.startsWith('#') || /^data:image\//i.test(trimmed);
}

/** Neutralize external fetches inside a CSS payload (style attr or block). */
function sanitizeCss(css: string): string {
	return css.replace(CSS_IMPORTS, '').replace(CSS_URLS, (match, dq, sq, bare) => {
		const target = (dq ?? sq ?? bare ?? '') as string;
		return keepableReference(target) ? match : 'none';
	});
}

/**
 * Sanitize SVG content by removing dangerous elements and attributes.
 * Throws SVG_MALICIOUS if javascript: or data:text/html content is found.
 */
export function sanitizeSvg(svgString: string): string {
	// Check for dangerous URLs in both raw and entity-decoded forms
	if (DANGEROUS_URLS.test(svgString) || DANGEROUS_URLS.test(decodeEntities(svgString))) {
		throw Object.assign(new Error('SVG contains dangerous JavaScript or data URLs'), {
			code: 'SVG_MALICIOUS',
			details: 'Contains javascript: or data:text/html URLs',
		});
	}

	let sanitized = svgString;

	// Remove dangerous elements (script, foreignObject, iframe, embed, object, animation)
	sanitized = sanitized.replace(DANGEROUS_ELEMENTS, '');

	// Remove <use> elements unless every href they carry is a #fragment —
	// matched per element rather than by URL shape, so unquoted and
	// protocol-relative references cannot slip past the pattern.
	sanitized = sanitized.replace(USE_ELEMENTS, (element) => {
		let keep = true;
		element.replace(HREF_ATTRS, (match, _name, dq, sq, bare) => {
			const target = ((dq ?? sq ?? bare ?? '') as string).trim();
			if (!target.startsWith('#')) keep = false;
			return match;
		});
		return keep ? element : '';
	});

	// Remove event handler attributes
	sanitized = sanitized.replace(EVENT_HANDLERS, '');

	// Remove hrefs that are not #fragments or inline data:image payloads —
	// allowlist, not blocklist: quoted https was being caught while `//evil`
	// and unquoted values sailed through.
	sanitized = sanitized.replace(HREF_ATTRS, (match, _name, dq, sq, bare) => {
		const target = (dq ?? sq ?? bare ?? '') as string;
		return keepableReference(target) ? match : '';
	});

	// CSS can fetch too: url() in style attributes and <style> blocks, and
	// @import in blocks. External targets become `none`; #fragments stay.
	sanitized = sanitized.replace(STYLE_ATTRS, (match, dq, sq, bare) => {
		const css = (dq ?? sq ?? bare ?? '') as string;
		const clean = sanitizeCss(css);
		if (clean === css) return match;
		const quote = dq !== undefined ? '"' : sq !== undefined ? "'" : '"';
		return ` style=${quote}${clean}${quote}`;
	});
	sanitized = sanitized.replace(
		STYLE_BLOCKS,
		(_match, open, css, close) => `${open}${sanitizeCss(css as string)}${close}`,
	);

	return sanitized;
}
