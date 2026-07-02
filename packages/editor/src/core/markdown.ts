import type { JSONContent } from '../types/index.js';

/**
 * Minimal markdown → editor JSON parser for paste handling. Deliberately
 * small (no dependency): headings, lists (bullet/ordered/todo), quotes,
 * fenced code, rules, and inline bold/italic/code/strike/links. Anything it
 * doesn't understand degrades to plain paragraphs.
 */

/** Quick heuristic: does this plain text look like markdown? */
export function looksLikeMarkdown(text: string): boolean {
	return (
		/^(#{1,6}\s|\s*[-*+]\s|\s*\d+\.\s|>\s|```|---\s*$)/m.test(text) ||
		/\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|`[^`]+`/.test(text)
	);
}

export function parseMarkdown(text: string): JSONContent[] {
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	const blocks: JSONContent[] = [];
	let index = 0;

	while (index < lines.length) {
		const line = lines[index];

		if (!line.trim()) {
			index++;
			continue;
		}

		// Fenced code block
		const fence = line.match(/^```(\S*)\s*$/);
		if (fence) {
			const code: string[] = [];
			index++;
			while (index < lines.length && !/^```\s*$/.test(lines[index])) {
				code.push(lines[index]);
				index++;
			}
			index++; // closing fence
			blocks.push({
				type: 'code_block',
				attrs: { language: fence[1] ?? '' },
				content: code.length ? [{ type: 'text', text: code.join('\n') }] : undefined,
			});
			continue;
		}

		// Horizontal rule
		if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
			blocks.push({ type: 'horizontal_rule' });
			index++;
			continue;
		}

		// Heading
		const heading = line.match(/^(#{1,6})\s+(.*)$/);
		if (heading) {
			blocks.push({
				type: 'heading',
				// `#` maps to document level 2 — h1 is reserved for the page title
				attrs: { level: Math.min(heading[1].length + 1, 6) },
				content: parseInline(heading[2]),
			});
			index++;
			continue;
		}

		// Blockquote (consume consecutive `>` lines)
		if (/^>\s?/.test(line)) {
			const quoted: string[] = [];
			while (index < lines.length && /^>\s?/.test(lines[index])) {
				quoted.push(lines[index].replace(/^>\s?/, ''));
				index++;
			}
			blocks.push({ type: 'blockquote', content: parseMarkdown(quoted.join('\n')) });
			continue;
		}

		// Lists (consecutive items of the same flavor)
		const todo = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+/);
		const bullet = !todo && line.match(/^\s*[-*+]\s+/);
		const ordered = line.match(/^\s*(\d+)\.\s+/);
		if (todo || bullet || ordered) {
			const items: JSONContent[] = [];
			const start = ordered ? Number(ordered[1]) : 1;
			const flavor = todo ? 'todo' : ordered ? 'ordered' : 'bullet';
			while (index < lines.length) {
				const item = lines[index];
				const todoMatch = item.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
				const bulletMatch = item.match(/^\s*[-*+]\s+(.*)$/);
				const orderedMatch = item.match(/^\s*\d+\.\s+(.*)$/);
				if (flavor === 'todo' && todoMatch) {
					items.push({
						type: 'todo_item',
						attrs: { checked: /[xX]/.test(todoMatch[1]) },
						content: [{ type: 'paragraph', content: parseInline(todoMatch[2]) }],
					});
				} else if (flavor === 'bullet' && bulletMatch && !todoMatch) {
					items.push({
						type: 'list_item',
						content: [{ type: 'paragraph', content: parseInline(bulletMatch[1]) }],
					});
				} else if (flavor === 'ordered' && orderedMatch) {
					items.push({
						type: 'list_item',
						content: [{ type: 'paragraph', content: parseInline(orderedMatch[1]) }],
					});
				} else {
					break;
				}
				index++;
			}
			blocks.push(
				flavor === 'todo'
					? { type: 'todo_list', content: items }
					: flavor === 'ordered'
						? { type: 'ordered_list', attrs: { start }, content: items }
						: { type: 'bullet_list', content: items },
			);
			continue;
		}

		// Paragraph: consume until a blank line or a block marker
		const paragraph: string[] = [line];
		index++;
		while (
			index < lines.length &&
			lines[index].trim() &&
			!/^(#{1,6}\s|\s*[-*+]\s|\s*\d+\.\s|>\s?|```|\s*---+\s*$)/.test(lines[index])
		) {
			paragraph.push(lines[index]);
			index++;
		}
		blocks.push({ type: 'paragraph', content: parseInline(paragraph.join(' ')) });
	}

	return blocks;
}

interface InlineToken {
	pattern: RegExp;
	marks: (match: RegExpMatchArray) => { type: string; attrs?: Record<string, unknown> }[];
	text: (match: RegExpMatchArray) => string;
}

const INLINE_TOKENS: InlineToken[] = [
	{
		pattern: /\[([^\]]+)\]\(([^)\s]+)\)/,
		marks: (match) => [{ type: 'link', attrs: { href: match[2], target: null } }],
		text: (match) => match[1],
	},
	{
		// Non-greedy body so nested single-char marks (like _italic_) survive
		pattern: /(\*\*|__)(.+?)\1/,
		marks: () => [{ type: 'bold' }],
		text: (match) => match[2],
	},
	{
		pattern: /(\*|_)([^*_]+)\1/,
		marks: () => [{ type: 'italic' }],
		text: (match) => match[2],
	},
	{
		pattern: /~~([^~]+)~~/,
		marks: () => [{ type: 'strike' }],
		text: (match) => match[1],
	},
	{
		pattern: /`([^`]+)`/,
		marks: () => [{ type: 'code' }],
		text: (match) => match[1],
	},
];

export function parseInline(text: string): JSONContent[] | undefined {
	if (!text) return undefined;
	const nodes: JSONContent[] = [];
	let remaining = text;

	while (remaining) {
		// Find the earliest token match
		let earliest: { token: InlineToken; match: RegExpMatchArray; index: number } | null =
			null;
		for (const token of INLINE_TOKENS) {
			const match = remaining.match(token.pattern);
			if (match?.index === undefined) continue;
			if (!earliest || match.index < earliest.index) {
				earliest = { token, match, index: match.index };
			}
		}
		if (!earliest) {
			nodes.push({ type: 'text', text: remaining });
			break;
		}
		if (earliest.index > 0) {
			nodes.push({ type: 'text', text: remaining.slice(0, earliest.index) });
		}
		// Parse nested marks inside the token text (e.g. bold containing italic)
		const innerText = earliest.token.text(earliest.match);
		const marks = earliest.token.marks(earliest.match);
		const inner = parseInline(innerText) ?? [];
		for (const node of inner) {
			nodes.push({ ...node, marks: [...(node.marks ?? []), ...marks] });
		}
		remaining = remaining.slice(earliest.index + earliest.match[0].length);
	}

	return nodes.length ? nodes : undefined;
}
