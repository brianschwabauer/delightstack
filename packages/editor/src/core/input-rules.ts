import {
	InputRule,
	inputRules,
	textblockTypeInputRule,
	wrappingInputRule,
} from 'prosemirror-inputrules';
import type { MarkType, Schema } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';

/**
 * Markdown-style typing shortcuts: `# ` headings, `- ` lists, `> ` quotes,
 * ``` code fences, `---` rules, and inline `**bold**` / `*italic*` /
 * `` `code` `` / `~~strike~~` marks.
 */
export function buildInputRules(schema: Schema): Plugin {
	const rules: InputRule[] = [];

	if (schema.nodes.heading) {
		rules.push(
			textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, (match) => ({
				level: match[1].length,
			})),
		);
	}
	if (schema.nodes.blockquote) {
		rules.push(wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote));
	}
	if (schema.nodes.bullet_list) {
		rules.push(wrappingInputRule(/^\s*[-*+]\s$/, schema.nodes.bullet_list));
	}
	if (schema.nodes.ordered_list) {
		rules.push(
			wrappingInputRule(
				/^(\d+)\.\s$/,
				schema.nodes.ordered_list,
				(match) => ({ start: Number(match[1]) }),
				(match, node) => node.childCount + node.attrs.start === Number(match[1]),
			),
		);
	}
	if (schema.nodes.todo_list) {
		rules.push(
			wrappingInputRule(/^\s*\[([ xX]?)\]\s$/, schema.nodes.todo_list, (match) => ({
				checked: /[xX]/.test(match[1]),
			})),
		);
	}
	if (schema.nodes.code_block) {
		rules.push(
			textblockTypeInputRule(/^```(\S*)\s$/, schema.nodes.code_block, (match) => ({
				language: match[1] ?? '',
			})),
		);
	}
	if (schema.nodes.horizontal_rule) {
		const hr = schema.nodes.horizontal_rule;
		rules.push(
			new InputRule(/^(?:---|—-|___)$/, (state, _match, start, end) => {
				return state.tr.replaceRangeWith(start, end, hr.create());
			}),
		);
	}

	if (schema.marks.bold) {
		rules.push(markInputRule(/(?:\*\*|__)([^*_]+)(?:\*\*|__)$/, schema.marks.bold));
	}
	if (schema.marks.italic) {
		rules.push(
			markInputRule(/(?<![*\w])\*([^*]+)\*$/, schema.marks.italic),
			markInputRule(/(?<![_\w])_([^_]+)_$/, schema.marks.italic),
		);
	}
	if (schema.marks.strike) {
		rules.push(markInputRule(/~~([^~]+)~~$/, schema.marks.strike));
	}
	if (schema.marks.code) {
		rules.push(markInputRule(/(?<!`)`([^`]+)`$/, schema.marks.code));
	}

	return inputRules({ rules });
}

/**
 * Applies `mark` to the first capture group and deletes the delimiters.
 * The rule fires on the closing character.
 */
export function markInputRule(pattern: RegExp, mark: MarkType): InputRule {
	return new InputRule(pattern, (state, match, start, end) => {
		const [full, inner] = match;
		if (!inner) return null;
		// Don't apply inside code (mark or block)
		const $start = state.doc.resolve(start);
		if ($start.parent.type.spec.code) return null;
		if (state.schema.marks.code?.isInSet($start.marks())) return null;
		const innerStart = start + full.indexOf(inner);
		const innerEnd = innerStart + inner.length;
		let tr = state.tr;
		if (innerEnd < end) tr = tr.delete(innerEnd, end);
		if (innerStart > start) tr = tr.delete(start, innerStart);
		const mappedEnd = start + inner.length;
		tr = tr.addMark(start, mappedEnd, mark.create());
		// Typing continues without the mark
		return tr.removeStoredMark(mark);
	});
}

/** Re-exported for custom block input rules. */
export { InputRule, textblockTypeInputRule, wrappingInputRule };
