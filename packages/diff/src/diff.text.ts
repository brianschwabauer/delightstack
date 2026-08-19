/**
 * Word-level and line-level Myers diff over text.
 *
 * Zero runtime dependencies.
 *
 * Design notes live in README.md; the short version:
 *   - Tokenization is lossless: `tokenizeWords(t).join('') === t` for every input, and the
 *     same holds for `tokenizeLines`.
 *   - The diff is the greedy O(ND) Myers algorithm in its linear-space (divide & conquer
 *     middle-snake) refinement, so memory is O(n + m) rather than O(n * m).
 *   - A `max_edit_distance` guard bounds pathological inputs (see `DEFAULT_MAX_EDIT_DISTANCE`).
 */

/** What a single span of the diff represents. */
export type DiffOpType = 'equal' | 'insert' | 'delete';

/**
 * One contiguous span of the diff.
 *
 * - `equal`  — present in both texts.
 * - `delete` — present in the old text only.
 * - `insert` — present in the new text only.
 *
 * Invariants (asserted by the round-trip property test):
 *   ops.filter(equal|delete).map(text).join('') === old_text
 *   ops.filter(equal|insert).map(text).join('') === new_text
 *
 * Adjacent ops always differ in `type`, and no op has an empty `text`.
 * Within a changed region, the `delete` op is emitted before the `insert` op.
 */
export interface DiffOp {
	type: DiffOpType;
	text: string;
}

export interface DiffOptions {
	/**
	 * Upper bound on the Myers edit distance explored inside any one recursion.
	 * When exceeded, that region degrades to a single delete + insert pair
	 * (still correct, just coarser). Defaults to `DEFAULT_MAX_EDIT_DISTANCE`.
	 */
	max_edit_distance?: number;
}

/**
 * Default edit-distance ceiling. Two 20k-word documents that share most of their
 * content have an edit distance in the hundreds, so this never trips in practice;
 * it only fires on inputs that are effectively unrelated, where a coarse
 * "replace everything" answer is the useful answer anyway.
 */
export const DEFAULT_MAX_EDIT_DISTANCE = 8192;

/**
 * Characters that are written without spaces between them, so a run of them must be
 * split per character or the whole paragraph becomes one token.
 */
const CJK_CLASS = '\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}\\p{sc=Hangul}';

/**
 * Ordered alternation, first match wins:
 *   1. a run of whitespace
 *   2. a regional-indicator pair (flag emoji)
 *   3. a pictographic grapheme cluster (emoji + variation selectors, ZWJ joins, skin tones)
 *   4. a single CJK / Kana / Hangul character
 *   5. a run of word characters (letters, marks, digits, `_`, intra-word apostrophes)
 *   6. any other single code point (punctuation, symbols, stray surrogates)
 */
const TOKEN_PATTERN = new RegExp(
	[
		'\\s+',
		'\\p{RI}\\p{RI}',
		'\\p{Extended_Pictographic}(?:[\\uFE0E\\uFE0F\\p{Mn}\\p{Me}]|\\u200D\\p{Extended_Pictographic}[\\uFE0E\\uFE0F]?|[\\u{1F3FB}-\\u{1F3FF}])*',
		`[${CJK_CLASS}]`,
		`(?:(?![${CJK_CLASS}])[\\p{L}\\p{M}\\p{N}_])+(?:['\\u2019](?:(?![${CJK_CLASS}])[\\p{L}\\p{M}\\p{N}_])+)*`,
		'[\\s\\S]',
	].join('|'),
	'gu',
);

/**
 * Split text into diff tokens. Lossless: `tokenizeWords(text).join('') === text`.
 *
 * Latin-script words are one token each (whitespace and punctuation are their own
 * tokens, so prose reflow does not register as a change). CJK, Kana and Hangul are
 * tokenized **per character** because they are written without word separators.
 * Emoji are tokenized per grapheme cluster, so a ZWJ family sequence or a
 * skin-toned emoji stays a single indivisible token.
 */
export function tokenizeWords(text: string): string[] {
	if (text === '') return [];
	TOKEN_PATTERN.lastIndex = 0;
	const tokens: string[] = [];
	let match: RegExpExecArray | null;
	while ((match = TOKEN_PATTERN.exec(text)) !== null) {
		tokens.push(match[0]);
		// Defensive: a zero-length match would spin forever. The pattern cannot
		// produce one, but the cost of the guard is nil.
		if (match[0].length === 0) TOKEN_PATTERN.lastIndex += 1;
	}
	return tokens;
}

/**
 * Split text into lines, each keeping its own terminator.
 *
 * Lossless: `tokenizeLines(text).join('') === text` for every input, so a line diff
 * round-trips byte for byte. `\r\n`, `\n` and a lone `\r` all terminate a line, and a
 * trailing fragment with no terminator is its own token. Because the terminator is part
 * of the token, converting a file from LF to CRLF changes every line — which is the
 * honest answer for a line diff; use `diffWords` if you want line endings ignored.
 */
export function tokenizeLines(text: string): string[] {
	if (text === '') return [];
	const lines: string[] = [];
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		const character = text[i];
		if (character === '\n') {
			lines.push(text.slice(start, i + 1));
			start = i + 1;
		} else if (character === '\r') {
			if (text[i + 1] === '\n') i++;
			lines.push(text.slice(start, i + 1));
			start = i + 1;
		}
	}
	if (start < text.length) lines.push(text.slice(start));
	return lines;
}

/**
 * Word-level diff of two strings.
 *
 * Returns a merged list of `DiffOp`s covering both texts in order. Word-level rather than
 * line-level because prose reflows: rewrapping a paragraph moves whitespace tokens, not
 * word tokens, so it produces a tiny local diff instead of two entirely changed lines.
 */
export function diffWords(
	old_text: string,
	new_text: string,
	options: DiffOptions = {},
): DiffOp[] {
	return diffWithTokenizer(old_text, new_text, tokenizeWords, options);
}

/**
 * Line-level diff of two strings.
 *
 * The same Myers core as {@link diffWords}, tokenized by line instead of by word. Use it
 * for code, logs, configuration, or anything where the line is the unit a reader thinks in.
 * For prose, prefer {@link diffWords}.
 */
export function diffLines(
	old_text: string,
	new_text: string,
	options: DiffOptions = {},
): DiffOp[] {
	return diffWithTokenizer(old_text, new_text, tokenizeLines, options);
}

/** Shared body of `diffWords` / `diffLines`, parameterized by the tokenizer. */
function diffWithTokenizer(
	old_text: string,
	new_text: string,
	tokenize: (text: string) => string[],
	options: DiffOptions,
): DiffOp[] {
	if (old_text === new_text)
		return old_text === '' ? [] : [{ type: 'equal', text: old_text }];
	if (old_text === '') return [{ type: 'insert', text: new_text }];
	if (new_text === '') return [{ type: 'delete', text: old_text }];
	return diffTokens(tokenize(old_text), tokenize(new_text), options);
}

/**
 * Diff two arrays of string tokens directly.
 *
 * The engine underneath {@link diffWords} and {@link diffLines}, exported for callers that
 * bring their own tokenizer. `DiffOp.text` values are the tokens joined back together, so
 * the round-trip guarantee holds exactly as far as the tokenizer is lossless.
 */
export function diffTokens(
	old_tokens: string[],
	new_tokens: string[],
	options: DiffOptions = {},
): DiffOp[] {
	const max_edit_distance = Math.max(
		1,
		Math.floor(options.max_edit_distance ?? DEFAULT_MAX_EDIT_DISTANCE),
	);

	if (old_tokens.length === 0 && new_tokens.length === 0) return [];
	if (old_tokens.length === 0) return [{ type: 'insert', text: new_tokens.join('') }];
	if (new_tokens.length === 0) return [{ type: 'delete', text: old_tokens.join('') }];

	// Map tokens to integers once so the inner loops compare numbers, not strings.
	const token_ids = new Map<string, number>();
	const old_ids = encodeTokens(old_tokens, token_ids);
	const new_ids = encodeTokens(new_tokens, token_ids);

	const spans: DiffSpan[] = [];
	diffRange(
		old_ids,
		new_ids,
		0,
		old_ids.length,
		0,
		new_ids.length,
		max_edit_distance,
		spans,
	);
	return materializeSpans(spans, old_tokens, new_tokens);
}

/** A span of token indices, before it is turned back into text. */
interface DiffSpan {
	type: DiffOpType;
	/** Start index into the old token array (for `equal` and `delete`). */
	old_start: number;
	old_end: number;
	/** Start index into the new token array (for `equal` and `insert`). */
	new_start: number;
	new_end: number;
}

function encodeTokens(tokens: string[], token_ids: Map<string, number>): Int32Array {
	const ids = new Int32Array(tokens.length);
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		let id = token_ids.get(token);
		if (id === undefined) {
			id = token_ids.size;
			token_ids.set(token, id);
		}
		ids[i] = id;
	}
	return ids;
}

/**
 * Diff `a[a_lo, a_hi)` against `b[b_lo, b_hi)`, appending spans in order.
 *
 * Trims the common prefix and suffix, then recurses around the middle snake.
 * Iterative-in-spirit but written recursively; recursion depth is O(log D) on
 * realistic inputs and is bounded in practice by the edit-distance guard.
 */
function diffRange(
	a: Int32Array,
	b: Int32Array,
	a_lo: number,
	a_hi: number,
	b_lo: number,
	b_hi: number,
	max_edit_distance: number,
	out: DiffSpan[],
): void {
	// Common prefix.
	let prefix = 0;
	while (
		a_lo + prefix < a_hi &&
		b_lo + prefix < b_hi &&
		a[a_lo + prefix] === b[b_lo + prefix]
	) {
		prefix++;
	}
	if (prefix > 0) {
		out.push({
			type: 'equal',
			old_start: a_lo,
			old_end: a_lo + prefix,
			new_start: b_lo,
			new_end: b_lo + prefix,
		});
		a_lo += prefix;
		b_lo += prefix;
	}

	// Common suffix — held back and emitted after the middle.
	let suffix = 0;
	while (
		a_hi - suffix > a_lo &&
		b_hi - suffix > b_lo &&
		a[a_hi - suffix - 1] === b[b_hi - suffix - 1]
	) {
		suffix++;
	}
	const suffix_a_start = a_hi - suffix;
	const suffix_b_start = b_hi - suffix;
	a_hi = suffix_a_start;
	b_hi = suffix_b_start;

	const n = a_hi - a_lo;
	const m = b_hi - b_lo;

	if (n === 0 && m > 0) {
		out.push({
			type: 'insert',
			old_start: a_lo,
			old_end: a_lo,
			new_start: b_lo,
			new_end: b_hi,
		});
	} else if (m === 0 && n > 0) {
		out.push({
			type: 'delete',
			old_start: a_lo,
			old_end: a_hi,
			new_start: b_lo,
			new_end: b_lo,
		});
	} else if (n > 0 && m > 0) {
		const split = findMiddleSnake(a, b, a_lo, a_hi, b_lo, b_hi, max_edit_distance);
		if (split === null) {
			// Guard tripped: fall back to a coarse replace for this region.
			out.push({
				type: 'delete',
				old_start: a_lo,
				old_end: a_hi,
				new_start: b_lo,
				new_end: b_lo,
			});
			out.push({
				type: 'insert',
				old_start: a_hi,
				old_end: a_hi,
				new_start: b_lo,
				new_end: b_hi,
			});
		} else {
			diffRange(a, b, a_lo, split.a, b_lo, split.b, max_edit_distance, out);
			diffRange(a, b, split.a, a_hi, split.b, b_hi, max_edit_distance, out);
		}
	}

	if (suffix > 0) {
		out.push({
			type: 'equal',
			old_start: suffix_a_start,
			old_end: suffix_a_start + suffix,
			new_start: suffix_b_start,
			new_end: suffix_b_start + suffix,
		});
	}
}

/** The point at which the two halves of a linear-space Myers diff meet. */
interface SnakeSplit {
	a: number;
	b: number;
}

/**
 * Myers' linear-space refinement: run the greedy edit-graph search forwards from the
 * top-left and backwards from the bottom-right simultaneously, and return the first
 * point where the two searches overlap. Only two 1-D frontier arrays are held, so
 * space is O(n + m).
 *
 * Returns `null` if the edit distance exceeds `max_edit_distance`.
 */
function findMiddleSnake(
	a: Int32Array,
	b: Int32Array,
	a_lo: number,
	a_hi: number,
	b_lo: number,
	b_hi: number,
	max_edit_distance: number,
): SnakeSplit | null {
	const n = a_hi - a_lo;
	const m = b_hi - b_lo;
	const max_d = Math.min(Math.ceil((n + m) / 2), max_edit_distance);
	const offset = max_d;
	const width = 2 * max_d + 2;

	const forward = new Int32Array(width).fill(-1);
	const reverse = new Int32Array(width).fill(-1);
	forward[offset + 1] = 0;
	reverse[offset + 1] = 0;

	const delta = n - m;
	// When delta is odd the forward search is the one that can first detect an overlap.
	const check_forward = (delta & 1) !== 0;

	// Shrink the explored band once a diagonal runs off the edge of the graph.
	let f_start = 0;
	let f_end = 0;
	let r_start = 0;
	let r_end = 0;

	for (let d = 0; d <= max_d; d++) {
		for (let k = -d + f_start; k <= d - f_end; k += 2) {
			const k_index = offset + k;
			let x: number;
			if (k === -d || (k !== d && forward[k_index - 1] < forward[k_index + 1])) {
				x = forward[k_index + 1];
			} else x = forward[k_index - 1] + 1;
			let y = x - k;
			while (x < n && y < m && a[a_lo + x] === b[b_lo + y]) {
				x++;
				y++;
			}
			forward[k_index] = x;
			if (x > n) {
				f_end += 2;
			} else if (y > m) {
				f_start += 2;
			} else if (check_forward) {
				const mirror = offset + delta - k;
				if (mirror >= 0 && mirror < width && reverse[mirror] !== -1) {
					const reverse_x = n - reverse[mirror];
					if (x >= reverse_x) return { a: a_lo + x, b: b_lo + y };
				}
			}
		}

		for (let k = -d + r_start; k <= d - r_end; k += 2) {
			const k_index = offset + k;
			let x: number;
			if (k === -d || (k !== d && reverse[k_index - 1] < reverse[k_index + 1])) {
				x = reverse[k_index + 1];
			} else x = reverse[k_index - 1] + 1;
			let y = x - k;
			while (x < n && y < m && a[a_hi - x - 1] === b[b_hi - y - 1]) {
				x++;
				y++;
			}
			reverse[k_index] = x;
			if (x > n) {
				r_end += 2;
			} else if (y > m) {
				r_start += 2;
			} else if (!check_forward) {
				const mirror = offset + delta - k;
				if (mirror >= 0 && mirror < width && forward[mirror] !== -1) {
					const forward_x = forward[mirror];
					const forward_y = forward_x - (delta - k);
					if (forward_x >= n - x) return { a: a_lo + forward_x, b: b_lo + forward_y };
				}
			}
		}
	}

	return null;
}

/**
 * Turn index spans back into merged text ops.
 *
 * Within a run of consecutive changed spans (no `equal` between them) all deletions are
 * emitted before all insertions — the recursion can produce them in either order
 * depending on which side of a middle snake they landed on, and reordering a delete
 * against an insert changes neither projection, since a delete contributes only to the
 * old text and an insert only to the new.
 */
function materializeSpans(
	spans: DiffSpan[],
	old_tokens: string[],
	new_tokens: string[],
): DiffOp[] {
	const ops: DiffOp[] = [];
	let pending_delete = '';
	let pending_insert = '';

	const push = (type: DiffOpType, text: string): void => {
		if (text === '') return;
		const previous = ops[ops.length - 1];
		if (previous !== undefined && previous.type === type) previous.text += text;
		else ops.push({ type, text });
	};

	const flush = (): void => {
		push('delete', pending_delete);
		push('insert', pending_insert);
		pending_delete = '';
		pending_insert = '';
	};

	for (const span of spans) {
		if (span.type === 'equal') {
			flush();
			push('equal', old_tokens.slice(span.old_start, span.old_end).join(''));
		} else if (span.type === 'delete') {
			pending_delete += old_tokens.slice(span.old_start, span.old_end).join('');
		} else {
			pending_insert += new_tokens.slice(span.new_start, span.new_end).join('');
		}
	}
	flush();

	return ops;
}
