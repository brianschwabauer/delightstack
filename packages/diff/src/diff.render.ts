import { DiffError } from './diff.error';
import type { DiffOp, DiffOpType } from './diff.text';

const HTML_ESCAPES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
};

/** Escape text for safe interpolation into HTML element content or a quoted attribute. */
export function escapeHTML(text: string): string {
	return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

export interface RenderDiffHTMLOptions {
	/** Element wrapping inserted spans. Default `'ins'`. Empty string renders bare text. */
	insert_tag?: string;
	/** Element wrapping deleted spans. Default `'del'`. Empty string renders bare text. */
	delete_tag?: string;
	/** Element wrapping unchanged spans. Default `''` — bare text, no element. */
	equal_tag?: string;
	/** `class` attribute for inserted spans. Omitted when unset. */
	insert_class?: string;
	/** `class` attribute for deleted spans. Omitted when unset. */
	delete_class?: string;
	/** `class` attribute for unchanged spans. Only applies when `equal_tag` is set. */
	equal_class?: string;
	/**
	 * Replace every `\n` with `<br>` after escaping, so the diff reads correctly inside a
	 * non-`pre` container. Default `false` — the text is left exactly as it was.
	 */
	break_lines?: boolean;
}

/** Tag names are interpolated into markup, so they are validated rather than escaped. */
const TAG_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9-]*$/;

/**
 * Render a diff as HTML: insertions in `<ins>`, deletions in `<del>`, equal spans as bare
 * escaped text — all overridable via `options`.
 *
 * **Every op's text is HTML-escaped**, so the output is safe to inject regardless of what
 * the source text contained. Tag names are validated against `/^[A-Za-z][A-Za-z0-9-]*$/`
 * and class names are escaped, so no option can be used to inject markup either.
 *
 * Styling is the caller's business — with no options the elements carry no classes and no
 * inline styles.
 */
export function renderDiffHTML(
	ops: DiffOp[],
	options: RenderDiffHTMLOptions = {},
): string {
	const tags: Record<DiffOpType, string> = {
		insert: options.insert_tag ?? 'ins',
		delete: options.delete_tag ?? 'del',
		equal: options.equal_tag ?? '',
	};
	const classes: Record<DiffOpType, string | undefined> = {
		insert: options.insert_class,
		delete: options.delete_class,
		equal: options.equal_class,
	};

	for (const [type, tag] of Object.entries(tags)) {
		if (tag !== '' && !TAG_NAME_PATTERN.test(tag)) {
			throw new DiffError(
				`Invalid ${type} tag name: ${JSON.stringify(tag)}`,
				'invalid_tag_name',
			);
		}
	}

	let html = '';
	for (const op of ops) {
		let text = escapeHTML(op.text);
		if (options.break_lines === true) text = text.replace(/\n/g, '<br>');
		const tag = tags[op.type];
		if (tag === '') {
			html += text;
			continue;
		}
		const class_name = classes[op.type];
		const attribute =
			class_name === undefined ? '' : ` class="${escapeHTML(class_name)}"`;
		html += `<${tag}${attribute}>${text}</${tag}>`;
	}
	return html;
}
