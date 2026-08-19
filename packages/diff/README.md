# @delightstack/diff

Zero-dependency diffing: word-level and line-level Myers diff over text, plus a key-based structural diff that detects **moves**.

Nothing here touches the DOM, the network, or any other package — it is plain TypeScript that runs identically in a browser, a Cloudflare Worker, and Node.

## Features

- **Word-level text diff** — `diffWords()` tokenizes prose so a rewrapped paragraph produces a tiny local diff instead of two entirely changed lines. Unicode-aware: CJK per character, emoji per grapheme cluster.
- **Line-level text diff** — `diffLines()` for code, logs and configuration, where the line is the unit a reader thinks in.
- **Bring your own tokenizer** — `diffTokens()` is the engine underneath both, exported directly.
- **Structural diff with move detection** — `diffStructured()` diffs two sequences by stable key and tells you which items moved, which a text diff fundamentally cannot.
- **Safe HTML rendering** — `renderDiffHTML()` escapes every op's text and validates tag names, so the output is injectable regardless of what the source contained.
- **Lossless round-trip** — for every input, the ops reassemble both original texts byte for byte. This is a property-tested invariant, not an aspiration.
- **Fast** — 50,000 words diffed in tens of milliseconds, in linear space.
- **Zero dependencies** — not even on `@delightstack/utilities`.

## Installation

```bash
pnpm add @delightstack/diff
```

## Quickstart

```typescript
import { diffWords, renderDiffHTML } from '@delightstack/diff';

const ops = diffWords('the quick brown fox', 'the quick red fox');
// [
//   { type: 'equal',  text: 'the quick ' },
//   { type: 'delete', text: 'brown' },
//   { type: 'insert', text: 'red' },
//   { type: 'equal',  text: ' fox' },
// ]

renderDiffHTML(ops, { insert_class: 'added', delete_class: 'removed' });
// 'the quick <del class="removed">brown</del><ins class="added">red</ins> fox'
```

## Text diffing

### `DiffOp`

Every text function returns a flat, ordered list of contiguous spans:

```typescript
type DiffOpType = 'equal' | 'insert' | 'delete';

interface DiffOp {
	type: DiffOpType;
	text: string;
}
```

| Type     | Meaning                       |
| -------- | ----------------------------- |
| `equal`  | present in both texts         |
| `delete` | present in the old text only  |
| `insert` | present in the new text only  |

These invariants hold for every input, and are covered by a property test. The ops reassemble both original texts exactly:

```typescript
ops.filter((op) => op.type !== 'insert').map((op) => op.text).join('') === old_text;
ops.filter((op) => op.type !== 'delete').map((op) => op.text).join('') === new_text;
```

- Adjacent ops always differ in `type` — runs are merged.
- No op ever has an empty `text`.
- Within a changed region the `delete` op is emitted **before** the `insert` op, always.

Identical inputs return a single `equal` op (or `[]` for two empty strings), so `ops.length === 1 && ops[0].type === 'equal'` is the cheap "nothing changed" check.

### `diffWords(old_text, new_text, options?)`

Word-level diff. Prefer this for prose.

Line diffs are wrong for prose because prose reflows: change one word near the top of a paragraph and every subsequent line shifts, so a line diff reports the whole paragraph as replaced. A word diff sees only the word — whitespace tokens absorb the reflow.

Tokenization (`tokenizeWords`) is lossless — `tokenizeWords(text).join('') === text` for every input — and ordered so the first matching rule wins:

1. a run of whitespace
2. a regional-indicator pair (flag emoji)
3. a pictographic grapheme cluster — emoji with variation selectors, ZWJ joins, skin tones
4. a single CJK / Kana / Hangul character
5. a run of word characters (letters, marks, digits, `_`, intra-word apostrophes)
6. any other single code point (punctuation, symbols, stray surrogates)

So a Latin word is one token, a ZWJ family emoji is one indivisible token, and CJK — which is written without word separators — is diffed per character. Whitespace and punctuation are their own tokens, which is what keeps reflow cheap.

### `diffLines(old_text, new_text, options?)`

Line-level diff, same Myers core. Use it for code, logs, configuration — anything where the line is the unit.

Tokenization (`tokenizeLines`) is also lossless. **Each line keeps its own terminator**, and `\r\n`, `\n` and a lone `\r` all terminate a line; a trailing fragment without a terminator is its own token. Because the terminator is part of the token, converting a file from LF to CRLF changes every line — which is the honest answer for a line diff. Use `diffWords` if you want line endings ignored.

### `diffTokens(old_tokens, new_tokens, options?)`

The engine, for callers with their own tokenizer. `DiffOp.text` values are the tokens joined back together, so the round-trip guarantee holds exactly as far as your tokenizer is lossless.

```typescript
import { diffTokens } from '@delightstack/diff';

diffTokens(['a', '·', 'b'], ['a', '·', 'c']);
```

### `tokenizeWords(text)` / `tokenizeLines(text)`

Exported so you can pre-tokenize once and diff a document against several others, or feed the same tokens into your own alignment.

### `options.max_edit_distance`

```typescript
interface DiffOptions {
	max_edit_distance?: number; // default: DEFAULT_MAX_EDIT_DISTANCE (8192)
}
```

Myers' running time is O(ND) — proportional to the *size* of the edit script, not the input. That is exactly what you want for two versions of the same document, and exactly what you don't want for two unrelated ones, where D approaches N + M and the diff degenerates towards quadratic.

`max_edit_distance` bounds the edit distance explored inside any one recursion. When the ceiling is hit, that region degrades to a single `delete` + `insert` pair — **still correct**, and still satisfying every round-trip invariant, just coarser. The rest of the diff is unaffected: the guard fires per recursion, not globally, so the common prefix/suffix and every other region keep their fine-grained alignment.

The default of `8192` never trips on real edits — two 20,000-word documents that share most of their content have an edit distance in the hundreds. It fires only on inputs that are effectively unrelated, where "replace everything" is the useful answer anyway. Lower it to bound worst-case latency on untrusted input; raise it if you genuinely need fine-grained alignment between two very different texts and can afford the time.

`DEFAULT_MAX_EDIT_DISTANCE` is exported so you can reason about it rather than hard-code `8192`.

## Structural diffing

A text diff cannot detect a move: swap two paragraphs and it reports one deletion and one insertion. `diffStructured()` diffs by **stable identity** instead, so a reordered block is reported as moved.

```typescript
import { diffStructured } from '@delightstack/diff';

const result = diffStructured(old_blocks, new_blocks, (block) => block.id);

for (const change of result.changes) {
	if (change.type === 'moved') {
		console.log(change.key, change.old_index, '→', change.new_index);
	}
}
```

### `StructuredChange<T>`

A discriminated union on `type`, so `old_item` / `new_item` narrow correctly:

| `type`      | `old_index` | `new_index` | `old_item` | `new_item` | Meaning                                              |
| ----------- | ----------- | ----------- | ---------- | ---------- | ---------------------------------------------------- |
| `unchanged` | real        | real        | `T`        | `T`        | present in both, and on the stable spine             |
| `moved`     | real        | real        | `T`        | `T`        | present in both, but its relative position changed   |
| `inserted`  | `-1`        | real        | `undefined`| `T`        | only in the new sequence                             |
| `deleted`   | real        | `-1`        | `T`        | `undefined`| only in the old sequence                             |

> **`unchanged` means the *key* is unchanged, not the content.** Both `old_item` and `new_item` are supplied precisely so you can compare them yourself — with `diffWords`, say — and decide whether the body changed. Identity is what this diff tracks; content is yours.

### `StructuredDiff<T>`

```typescript
interface StructuredDiff<T> {
	changes: StructuredChange<T>[];
	counts: Record<StructuredChangeType, number>;
	changed: boolean;
}
```

`changes` contains every item from both sequences exactly once each, **in render order**: the new sequence's order, with each deleted item spliced in at the point it used to occupy relative to its surviving neighbours. Walking `changes` top to bottom therefore produces a readable unified diff with no further sorting.

`changed` is `false` only when both sequences have the same keys in the same order (`inserted + deleted + moved === 0`). Note that a diff where only *content* changed still reports `changed: false` — again, identity is what is being tracked.

### `options.duplicate_keys`

```typescript
interface StructuredDiffOptions {
	duplicate_keys?: 'throw' | 'index'; // default: 'throw'
}
```

- **`'throw'`** (default) — a key repeating within one sequence throws a `DiffError` with code `duplicate_key`, naming the key, its index, and which sequence it was in. Keys are meant to be stable identities; a repeat is almost always a bug upstream (a block ID duplicated by a copy-paste), and silently guessing hides it.
- **`'index'`** — deterministically disambiguate: the *n*-th occurrence of a key is matched against the *n*-th occurrence of that key in the other sequence, and extra occurrences on one side become inserts or deletes. No throw, no ambiguity, order-independent.

Under `'index'`, the *n*-th repeat of a key is internally rewritten as `` `${key}\u0000${n}` `` — a NUL separator, which no sane stable identifier contains. **Those internal keys are what surface in `StructuredChange.key`** — which is the main reason `'throw'` is the default. Read `change.new_item` / `change.old_item` rather than parsing `change.key` if you use this mode.

### How it works

Intersect the two key sequences, then take the **longest increasing subsequence** of the old-side positions of the surviving items. That subsequence is the largest set of items whose relative order is unchanged, so it becomes the stable spine; every other survivor moved.

LIS is used rather than a general LCS because keys are unique within a sequence (which `duplicate_keys` guarantees one way or the other), which makes the two equivalent and lets the whole thing run in **O(n log n)** instead of O(n·m).

Ties in the LIS are broken towards the earliest run, so a block that stayed put reads as `unchanged` and the block that jumped over it reads as `moved` — rather than the other way round.

## Rendering

### `renderDiffHTML(ops, options?)`

```typescript
renderDiffHTML(ops, {
	insert_tag: 'ins', // element wrapping insertions. '' renders bare text. Default 'ins'
	delete_tag: 'del', // element wrapping deletions. '' renders bare text. Default 'del'
	equal_tag: '', //     element wrapping unchanged spans. Default '' — bare text
	insert_class: undefined, // class attribute for insertions. Omitted when unset
	delete_class: undefined, // class attribute for deletions
	equal_class: undefined, //  class attribute for unchanged spans (needs equal_tag)
	break_lines: false, //      replace every \n with <br> after escaping
});
```

**Every op's text is HTML-escaped**, so the output is safe to inject regardless of what the source text contained. Tag names are validated against `/^[A-Za-z][A-Za-z0-9-]*$/` (they are interpolated into markup, so they cannot be escaped) and class names are escaped — no option can be used to inject markup either.

Styling is your business: with no options the elements carry no classes and no inline styles. `break_lines` exists for rendering a diff inside a non-`pre` container; leave it `false` when the container already preserves whitespace.

### `escapeHTML(text)`

The escaper `renderDiffHTML` uses, exported for building your own renderer. Escapes `&`, `<`, `>`, `"` and `'`, so it is safe for both element content and quoted attribute values.

## Errors

```typescript
class DiffError extends Error {
	readonly status: number; // always 400
	readonly code: string;
}
```

The package has zero dependencies — not even on `@delightstack/utilities` — so it cannot throw a `DelightError`. `DiffError` is deliberately shaped the same way (`message`, `status`, `code`), so an app that already narrows on `status` / `code` treats it identically without a special case.

`status` is always `400`: every case is bad input, never an internal failure.

| `code`             | Thrown by            | When                                                                             |
| ------------------ | -------------------- | -------------------------------------------------------------------------------- |
| `duplicate_key`    | `diffStructured()`   | a key repeats within one sequence and `duplicate_keys` is `'throw'` (the default) |
| `invalid_tag_name` | `renderDiffHTML()`   | an `insert_tag` / `delete_tag` / `equal_tag` is not a valid HTML tag name          |

Nothing else throws. Empty inputs, wildly mismatched inputs, and inputs that trip `max_edit_distance` all return a valid diff.

## Performance

Measured by `src/diff.performance.test.ts` on a deterministic pseudo-document corpus (seeded PRNG, no `Math.random`), median of three runs **on a development machine**:

| Operation                                | Input                    | Time    |
| ---------------------------------------- | ------------------------ | ------- |
| `diffWords`                              | two 50,000-word documents | ~58 ms  |
| `diffLines`                              | two 50,000-word documents | ~9 ms   |
| `diffStructured`                         | 20,000 blocks, 100 inserted / 100 deleted / many moved | ~26 ms |

Absolute numbers vary a lot with the machine — the same suite measures 5-8x slower on a shared CI runner — so the 100 ms budgets are asserted only off CI (or anywhere with `DIFF_BENCH=1`).

What is asserted **everywhere** is that doubling the input does not roughly quadruple the time: a ratio cancels out machine speed, so it holds on a laptop and on a throttled runner alike. Observed ratios are ~2.1x for `diffWords` and ~1.3x for `diffStructured`; the bound is 3x, and a deliberately quadratic implementation measures 4.1x. That is the regression these tests exist to catch — raising a millisecond budget until CI passes would have stopped catching a real 4x slowdown while still flaking on a busy runner.

Two design choices carry most of that:

- **Linear space.** The diff is the greedy O(ND) Myers algorithm in its linear-space (divide-and-conquer middle-snake) refinement, so memory is O(n + m) rather than O(n·m). A 50,000-token document costs two `Int32Array` frontiers, not a 2.5-billion-cell matrix.
- **Integer tokens.** Tokens are interned into integer ids once, up front, so the inner loops compare numbers rather than strings.

The common prefix and suffix are trimmed before every recursion, which is why an edit near the end of a large document costs almost nothing.

`diffLines` is markedly faster than `diffWords` on the same text simply because there are far fewer tokens — the algorithm is identical.

## API summary

| Export                      | Kind     | Description                                                        |
| --------------------------- | -------- | ------------------------------------------------------------------ |
| `diffWords`                 | function | Word-level diff of two strings → `DiffOp[]`                        |
| `diffLines`                 | function | Line-level diff of two strings → `DiffOp[]`                        |
| `diffTokens`                | function | Diff two arrays of string tokens → `DiffOp[]`                      |
| `tokenizeWords`             | function | Lossless word tokenizer                                            |
| `tokenizeLines`             | function | Lossless line tokenizer (terminators kept)                         |
| `diffStructured`            | function | Key-based sequence diff with move detection → `StructuredDiff<T>`  |
| `renderDiffHTML`            | function | Render `DiffOp[]` as escaped HTML                                  |
| `escapeHTML`                | function | HTML-escape a string                                               |
| `DiffError`                 | class    | The package's error type (`message`, `status`, `code`)             |
| `DEFAULT_MAX_EDIT_DISTANCE` | const    | `8192`                                                             |
| `DiffOp`, `DiffOpType`, `DiffOptions` | types | Text diff shapes                                         |
| `StructuredDiff`, `StructuredChange`, `StructuredChangeType`, `StructuredDiffOptions` | types | Structural diff shapes |
| `RenderDiffHTMLOptions`     | type     | Renderer options                                                   |

## Design decisions

**Why word-level as the headline API?**
Because the intended reader is a human looking at prose. Line diffs are the right default for source control and the wrong default for a document: reflow makes them report changes that nobody made. The line diff is still here, exported and equally supported — it is just not what `diffWords` is for.

**Why a separate structural diff instead of one clever algorithm?**
They answer different questions from different inputs. A text diff aligns characters and has no notion of identity, so it can never report a move without guessing. A structural diff is handed identity explicitly and cannot say anything about content. Composing them — `diffStructured` for the spine, `diffWords` on each `unchanged` / `moved` pair — gives both answers, and keeps each one explainable.

**Why LIS rather than LCS for the structural spine?**
With unique keys they produce the same spine, and LIS is O(n log n) against LCS's O(n·m). Enforcing key uniqueness (or manufacturing it, under `duplicate_keys: 'index'`) is a cheap precondition that buys a much better complexity class — and uniqueness is what a "stable identity" already promises.

**Why does `renderDiffHTML` return a string rather than nodes?**
A string works in a Worker, in a Svelte `{@html}`, in an email, and in a test assertion. Callers who want nodes have `DiffOp[]` and can build whatever they like — the renderer is a convenience, not the API's centre of gravity.

**Why an edit-distance guard rather than a timeout?**
A timeout makes the output non-deterministic: the same two inputs could diff differently on a loaded machine, and a diff that changes between runs is impossible to test or cache. The distance guard degrades at exactly the same point every time, on every machine, and the degraded output is still a correct diff.
