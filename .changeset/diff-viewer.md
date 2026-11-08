---
'@delightstack/components': minor
---

`DiffViewer` — a word-level diff of two texts, inline or side-by-side.

Whole words are marked rather than characters, because prose reflows and a character diff of a
rewritten sentence is confetti; `granularity` takes `'char'` and `'line'` for the cases where the
unit is smaller or larger. Line numbers for both sides, a long unchanged stretch collapsed behind
an expander at `context_lines`, `n` / `p` to step through the changes, and `wrap` /
`show_line_numbers` / `max_height` for the shape of it.

A caller that knows which parts of the two documents correspond — blocks paired by a stable id,
rows paired by primary key — passes `hunks` instead of the two strings, and the alignment it
worked out is the alignment that gets rendered. That includes a `moved` kind, which a text diff
can never infer: it is recorded on every row it produces (`moved`, `moved_from`, `moved_to`, and
`data-moved` in the DOM) and rendered in place with a rule down its leading edge. Drawing the pair
as a move is not built.

The alignment inside a changed span is anchored on the text the two sides share: every `equal`
span lands in exactly one line on each side, and those pairs are the spine. Lines between two
anchors pair from the top of the gap, so a wholly rewritten line stays one row rather than
becoming a deletion followed by an insertion — and appending a line to a document leaves the line
above it alone, which bottom-pairing did not.

`buildDiffModel` and the rest of `diff-model.ts` are exported from
`@delightstack/components/display` as a pure module — no runes, no DOM — so the same rows,
sections and counts can be computed in a Worker or asserted in a test without mounting anything.
`tokenizeGraphemes` comes with it: `@delightstack/diff` has no character tokenizer, and splitting
by code point cuts a ZWJ family emoji into six pieces.

`@delightstack/diff` is a new dependency of the package. It carries the Myers engine, the word
tokenizer and the HTML renderer, all of which this uses as published — nothing was added to it.

The diff inherits the type of whatever it sits in (`--diff-font` defaults to `inherit`), so a
diff of a document is set in the document's own face rather than in a monospace box.

**Moves are drawn as moves.** A move has two ends and a reader needs both, so a caller that knows
one happened passes two `moved` hunks sharing `before_index` / `after_index`: one with
`stub: true`, standing where the old document had the span, and the span itself where the new one
has it. The span is drawn once, at the destination, labelled with the line it came from; the stub
is a single dimmed line saying where the text went, with a dashed rule down its leading edge. The
old side's line numbers go to the stub — that is where the old document put the text — so the
numbers under a move stay true on both sides. `changed` marks a span that was edited on the way,
and the word diff runs inside it as usual.

Colour is not the signal. Both ends carry a `⇅` glyph and an arrow pointing the way the text went,
because insertions and deletions have already spent green and red and a reader who cannot separate
those two hues has nothing left to read a third by. `--moved` defaults to `--color-action`:
`@delightstack/styles` has no info hue on purpose, and informational surfaces there are the action
colour.

Rows gained `moved_stub`, `moved_head`, `moved_changed`, `moved_from_line` and `moved_to_line` —
the last two resolved after layout, so each end can name the other's line whichever way round the
move landed. `data-moved` is now `from` on the stub and `to` on the span rather than an empty
attribute; `[data-moved]` selectors are unaffected. A `moved` hunk passed without a stub renders
exactly as it did before.

**Two stops per move, and a hue of its own.** `n` / `p` step to the head of each run of change,
which is right for eight rewritten lines in a row and wrong for a move: its two ends touch
whenever two adjacent blocks swap, and folding them into one run lands on the stub, says "moved to
line 3", and then skips line 3. Both ends are always their own stop now, and both are focusable.

The move colour is derived from `--color-action` with its hue rotated 40° rather than taken as-is.
Used raw it is the colour of the focus ring, the links and every other interactive affordance on
the page, so a marked-up region of a document reads as something you can click. `--moved-fg` is a
new foreground variant with its lightness clamped into a legible band — `--moved` is a surface
colour and fails 4.5:1 as small type, the same split `--color-action-fg` makes for
`--color-action`. Measured on the marker: 5.8:1 (chip) and 5.0:1 (stub) in light, 4.9:1 in dark.

A `moved` hunk with `stub: true` and no `before_index` / `after_index` now throws a `DiffError`
(`stub_without_indices`) in dev instead of pairing wrongly — the indices are the only thing that
matches a stub to its span, so every such stub folds onto one key and pairs with the wrong row.

`DiffViewer.test.ts` is the package's first component test: `render` from `svelte/server` and
assertions against the markup, for the one thing the pure model cannot answer — which way a move's
arrows point. See the README's Testing section for when that is the right tool.
