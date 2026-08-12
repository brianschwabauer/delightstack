/**
 * The tokenizer — shared by the index write path and the query path on every
 * driver. See `plans/database/Native Search Engine Plan.md` §4.1 and
 * `plans/database/orama-verification-report.md` §1 + finding A.
 *
 * ## Pipeline order (frozen 2026-08-12)
 *
 * Whole value:
 * 1. Unicode-normalize **NFKD**.
 * 2. Strip combining marks (`\p{M}`) — folds `café` → `cafe`.
 * 3. Strip format characters (`\p{Cf}`: soft hyphen, ZWSP/ZWJ/ZWNJ, BOM, …) and
 *    Arabic tatweel (`U+0640`), both to nothing. This runs *before* chunking so
 *    an invisible character can never split a word or reach the email test.
 * 4. Split on whitespace into chunks.
 *
 * Per chunk, in this exact order:
 * 5. **camelCase scan, pre-lowercase** — the case signal only exists here.
 *    Records the split parts; they are emitted at the end (step 11).
 * 6. Lowercase (`toLowerCase()`).
 * 7. **Acronym dot fold** — `u.s.a.` → `usa`. Before the apostrophe fold, so
 *    `u.s.a.'s` folds to `usas` rather than stranding a lone `s`.
 * 8. **Intra-word apostrophe fold** (`'`, `’`, `ʼ`), then demote any surviving
 *    `ʼ` to a separator (it is a `\p{L}`, so it would otherwise glue a token).
 * 9. **Whole-chunk emission** — the email token, else the number-chunk token.
 *    Both run after 7/8 so email detection sees the folded form
 *    (`O'Brien@x.com` → `obrien@x.com`).
 * 10. Split on any run of characters outside `\p{L}\p{N}`; truncate each token
 *     to 64 characters.
 * 11. Emit the camelCase parts recorded in step 5 (lowercased, truncated).
 *
 * Duplicates are KEPT throughout (tf counting needs them).
 *
 * Deliberate deviations from Orama 3.1.18, all verified against the installed
 * package:
 * - Orama's English splitter is `/[^A-Za-zàèéìòóù0-9_'-]+/gim`: `_`, `'` and
 *   `-` are word characters and every non-ASCII letter except six Italian
 *   accented vowels is a separator, which destroys CJK/Cyrillic and mangles
 *   `ï/ü/ñ/ç` words. We split on `\P{L}\P{N}` instead, so `snake_case` and
 *   `well-known` each yield two tokens and non-Latin scripts survive.
 * - **Apostrophes fold rather than split** (decision 2026-08-12, plan §4.1): an
 *   apostrophe *between* two `\p{L}\p{N}` characters is deleted, so `john's` →
 *   `johns`, `it's` → `its`, `o'brien` → `obrien`. Splitting there would put a
 *   stray `s` token on every possessive (inflating `df` for a token that means
 *   nothing) and would stop `johns` from being findable as one word; folding
 *   keeps `john` a prefix match for `johns` and makes the apostrophe-less query
 *   `obrien` an exact match. Apostrophes anywhere else — leading, trailing,
 *   isolated, or doubled — stay ordinary separators (`'quoted'` → `quoted`,
 *   `don''t` → `don`, `t`).
 * - **Format characters are invisible, not separators** (2026-08-12): Orama
 *   treats every one of them as a separator, so a soft-hyphenated `data­base`
 *   indexes as `data` + `base` there and as `database` here.
 * - **camelCase splits, and the whole token survives** (2026-08-12): Orama has
 *   no case-boundary rule at all.
 * - **Acronym dots fold** and **separator-bearing number chunks emit whole**
 *   (2026-08-12): Orama keeps neither `usa` nor `3.14` as a token.
 * - Orama de-duplicates tokens (`Array.from(new Set(...))`), which makes its
 *   `tf` always `1 / distinct_token_count` — repeating a word *raises* its
 *   score. We keep duplicates so `tf` is a real term frequency.
 * - Orama has no length cap; the 64-character cap is ours.
 *
 * No stemming, no stopwords (matches current behavior). **CJK bigram indexing
 * is explicitly rejected** (decision Brian 2026-08-12): CJK runs stay whole
 * tokens, which is already strictly better than Orama's "destroy it entirely".
 */

/**
 * Tokens longer than this are truncated to it, on both the index and the query
 * side, so the two sides always agree (plan §4.1 step 5, report §1: "keep the
 * 64-char truncation"). Truncating rather than dropping is what makes an
 * over-long token findable at all — the differential harness pins the pair of
 * fixture documents (`edge_long_token` / `edge_long_token_twin`) that share
 * their first 64 characters and must therefore collide on one indexed token.
 */
export const MAX_TOKEN_LENGTH = 64;

/** Any run of characters that is neither a Unicode letter nor a Unicode number. */
const SPLIT_PATTERN = /[^\p{L}\p{N}]+/gu;

/** Unicode combining marks, stripped after NFKD so `café` folds to `cafe`. */
const COMBINING_MARKS = /\p{M}+/gu;

/**
 * Invisible formatting characters, folded to nothing.
 *
 * `\p{Cf}` covers the soft hyphen (`U+00AD`), the zero-width space/joiner/
 * non-joiner (`U+200B`–`U+200D`), the BOM (`U+FEFF`), bidi controls and the
 * rest. Arabic tatweel (`U+0640`) is a `\p{L}` (Lm) rather than a `\p{Cf}`, so
 * it is listed explicitly: it is pure elongation and carries no meaning, and
 * leaving it in would make `مـــد` a different token from `مد`.
 */
const FORMAT_CHARACTERS = /[\p{Cf}ـ]+/gu;

/**
 * The three apostrophes we fold: ASCII `U+0027`, the typographic `U+2019` and
 * the modifier letter `U+02BC` (used as a possessive/glottal-stop apostrophe in
 * several orthographies, and produced by some keyboards).
 *
 * `U+02BC` is a `\p{L}`, so unlike the other two it would otherwise *join* the
 * two sides into one token rather than split them — see `STRAY_MODIFIER_APOSTROPHE`.
 * It is also excluded from the neighbour classes (the `(?<!ʼ)` / `(?!ʼ)`
 * guards), so a *doubled* `ʼ` behaves exactly like a doubled `'`: neither
 * qualifies and the run splits (`donʼʼt` → `don` + `t`).
 */
const INTRA_WORD_APOSTROPHE = /(?<=[\p{L}\p{N}])(?<!ʼ)['’ʼ](?!ʼ)(?=[\p{L}\p{N}])/gu;

/**
 * Any `U+02BC` that survived the intra-word fold. Because it is a `\p{L}` the
 * splitter would keep it inside a token, so it is rewritten to an ASCII
 * apostrophe — an ordinary separator — making its non-intra-word behavior
 * identical to `'` and `’`.
 */
const STRAY_MODIFIER_APOSTROPHE = /ʼ/gu;

/**
 * A run of **single** letters separated by dots, with an optional trailing dot:
 * `u.s.a.`, `e.g.`, `a.b`. Folded to the bare concatenation.
 *
 * The single-letter restriction plus the guards are what keep ordinary dotted
 * text out: `example.com` fails (`com` is three letters and every interior
 * position is blocked by the lookbehind), `3.14` fails (digits are not
 * `\p{L}`), `u.s.army` fails (the lookahead rejects the trailing word).
 */
const ACRONYM_DOTS = /(?<![\p{L}\p{N}.])\p{L}(?:\.\p{L})+\.?(?![\p{L}\p{N}.])/gu;

/** Every dot inside an already-matched acronym run. */
const DOTS = /\./g;

/** Leading/trailing punctuation trimmed before the whole-chunk shape tests. */
const EDGE_PUNCTUATION = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/**
 * A deliberately simple `local@domain.tld` shape. The domain must contain a
 * dot, so `user@localhost` is not treated as an address.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/**
 * A purely numeric chunk with at least one internal `.`, `,` or `-`: `3.14`,
 * `1,000`, `2.5.1`, `555-1234`. Such a chunk emits the whole thing as one token
 * *plus* its split digit runs, the same way an email chunk does — the split
 * parts alone (`3`, `14`) are useless for finding `3.14`.
 *
 * A separator is *required*, so a plain `42` is emitted once by the normal
 * split and not twice. Letters disqualify the chunk, so `v2.5` is untouched.
 */
const NUMBER_CHUNK = /^\p{N}+(?:[.,-]\p{N}+)+$/u;

/**
 * The camelCase boundaries: a lowercase letter followed by an uppercase one
 * (`getUser` → `get`|`User`), and the acronym boundary — the last uppercase of
 * a run that is followed by `Uppercase lowercase` (`HTTPServer` →
 * `HTTP`|`Server`). Both are zero-width, so `String.split` cuts without
 * consuming.
 *
 * A digit followed by an uppercase letter is deliberately **not** a boundary:
 * `v2Beta` is one word with a capital in it far more often than it is two.
 */
const CAMEL_BOUNDARY = /(?<=\p{Ll})(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u;

/** Maximal runs of letters/digits — the units the camelCase scan looks at. */
const WORD_RUNS = /[\p{L}\p{N}]+/gu;

/**
 * Normalize a whole raw value: NFKD, strip combining marks, strip format
 * characters and tatweel. Case is deliberately preserved here — the camelCase
 * scan needs it (step 5).
 */
function normalizeValue(input: string): string {
	return input
		.normalize('NFKD')
		.replace(COMBINING_MARKS, '')
		.replace(FORMAT_CHARACTERS, '');
}

/**
 * Fold acronym dots then intra-word apostrophes, and demote a stray `ʼ`.
 * Runs on the lowercased chunk, before the whole-chunk shape tests.
 */
function foldChunk(chunk: string): string {
	return chunk
		.replace(ACRONYM_DOTS, (run) => run.replace(DOTS, ''))
		.replace(INTRA_WORD_APOSTROPHE, '')
		.replace(STRAY_MODIFIER_APOSTROPHE, "'");
}

/**
 * The lowercased camelCase parts of a chunk, or an empty list when the chunk
 * has no case boundary at all (a plain word must not be emitted twice).
 *
 * The scan runs per letter/digit run of the *pre-lowercase* chunk, so a chunk
 * like `foo-getUserData` contributes only `get`, `user`, `data` — the `foo` run
 * has no boundary and is already emitted by the ordinary split.
 */
function camelCaseParts(chunk: string): string[] {
	const parts: string[] = [];
	WORD_RUNS.lastIndex = 0;
	for (const match of chunk.matchAll(WORD_RUNS)) {
		const run = match[0];
		const pieces = run.split(CAMEL_BOUNDARY);
		if (pieces.length < 2) continue;
		for (const piece of pieces) parts.push(piece.toLowerCase());
	}
	return parts;
}

/** Push a token, truncated to the cap. */
function pushToken(tokens: string[], token: string): void {
	tokens.push(token.length > MAX_TOKEN_LENGTH ? token.slice(0, MAX_TOKEN_LENGTH) : token);
}

/**
 * Tokenize a single string value into an ordered token list, duplicates kept.
 *
 * The whole-chunk passes run per whitespace-delimited chunk (so addresses and
 * numbers embedded in prose count too): an email-shaped chunk emits the whole
 * address as one token *before* its split parts, e.g.
 * `jane.doe@showandtour.com` → `jane.doe@showandtour.com`, `jane`, `doe`,
 * `showandtour`, `com`; a separator-bearing numeric chunk does the same
 * (`3.14` → `3.14`, `3`, `14`). camelCase parts trail the split parts
 * (`getUserData` → `getuserdata`, `get`, `user`, `data`).
 */
export function tokenize(input: string): string[] {
	if (typeof input !== 'string' || input.length === 0) return [];
	const tokens: string[] = [];
	for (const raw_chunk of normalizeValue(input).split(/\s+/)) {
		if (!raw_chunk) continue;
		const camel_parts = camelCaseParts(raw_chunk);
		const chunk = foldChunk(raw_chunk.toLowerCase());
		const trimmed = chunk.replace(EDGE_PUNCTUATION, '');
		if (trimmed) {
			if (trimmed.length <= MAX_TOKEN_LENGTH && EMAIL_SHAPE.test(trimmed)) {
				// An over-long address is *skipped* rather than truncated: a
				// truncated address is a different, fake address that could
				// collide with a real one. A truncated number (below) is just a
				// digit prefix, so it follows the ordinary token rule.
				tokens.push(trimmed);
			} else if (NUMBER_CHUNK.test(trimmed)) {
				pushToken(tokens, trimmed);
			}
		}
		for (const part of chunk.split(SPLIT_PATTERN)) {
			if (!part) continue;
			pushToken(tokens, part);
		}
		for (const part of camel_parts) pushToken(tokens, part);
	}
	return tokens;
}

/**
 * Tokenize a field value of a tokenizable type (`string` or `string[]`).
 *
 * Array elements are tokenized in order and concatenated; postings do not
 * distinguish element positions. Non-string values are ignored.
 */
export function tokenizeValue(value: unknown): string[] {
	if (typeof value === 'string') return tokenize(value);
	if (!Array.isArray(value)) return [];
	const tokens: string[] = [];
	for (const element of value) {
		if (typeof element !== 'string') continue;
		for (const token of tokenize(element)) tokens.push(token);
	}
	return tokens;
}

/**
 * Count term frequencies for a token list.
 *
 * Returned as a Map for O(1) lookup; callers that expose the result to users
 * must sort the keys — Map iteration order is never user-visible (§3).
 */
export function countTokenFrequencies(tokens: readonly string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
	return counts;
}
