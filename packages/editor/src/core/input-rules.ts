import {
	InputRule,
	inputRules,
	textblockTypeInputRule,
	undoInputRule,
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
	return inputRules({ rules: baseInputRules(schema) });
}

/**
 * The same rules as a list, for an app that wants to extend, reorder or drop
 * them — `Editor`'s `input_rules` option is handed exactly this.
 *
 * The order is the semantics: `inputRules` runs the list in order and stops at
 * the first rule that fires, so a rule placed *before* one of these shadows it.
 * That is how an app with its own markdown dialect replaces a shortcut whose
 * meaning it disagrees with (`# ` producing a level-2 heading, say) without
 * giving up the dozen it agrees with.
 */
export function baseInputRules(schema: Schema): InputRule[] {
	const rules: InputRule[] = [];

	if (schema.nodes.heading) {
		// `#` produces the biggest user-facing heading (document level 2 —
		// level 1 / h1 is reserved for the page title)
		rules.push(
			textblockTypeInputRule(/^(#{1,5})\s$/, schema.nodes.heading, (match) => ({
				level: match[1].length + 1,
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
		// Separate rules per delimiter: `**snake_case**` must bold (underscores
		// allowed inside `**`), and mismatched pairs like `**text__` must not
		rules.push(
			markInputRule(/\*\*([^*]+)\*\*$/, schema.marks.bold),
			markInputRule(/(?<![\w_])__([^_]+)__$/, schema.marks.bold),
		);
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

	return rules;
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

/**
 * Re-exported for custom block input rules, and for an app assembling its own
 * list through the `input_rules` option — so writing a dialect's rules needs no
 * direct dependency on `prosemirror-inputrules`.
 *
 * `undoInputRule` is here for the same reason and one more: it is what the
 * package's own `Backspace` binding is chained from, so an app testing that a
 * rule it wrote is undoable by one press needs the *real* command rather than a
 * stand-in that only resembles it.
 */
export {
	InputRule,
	inputRules,
	textblockTypeInputRule,
	undoInputRule,
	wrappingInputRule,
};
