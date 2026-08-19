# @delightstack/diff

## 1.1.0

### Minor Changes

- 504543b: New package: `@delightstack/diff` — zero-dependency diffing.

  `diffWords(a, b)` and `diffLines(a, b)` return a flat list of `{ type: 'equal' | 'insert' | 'delete', text }` ops covering both texts. The core is the greedy O(ND) Myers algorithm in its linear-space (divide-and-conquer middle-snake) refinement, so memory is O(n + m) rather than O(n·m), and tokens are interned to integers so the inner loops compare numbers. Tokenization is lossless in both directions — the ops reassemble both original texts byte for byte, which is a property-tested invariant — and `tokenizeWords` / `tokenizeLines` / `diffTokens` are exported for callers who want to bring their own. Word tokenization is Unicode-aware: CJK, Kana and Hangul split per character, emoji stay whole as grapheme clusters (ZWJ sequences, skin tones, flags), and whitespace is its own token so paragraph reflow does not register as a change. A `max_edit_distance` guard (default 8192) bounds pathological inputs by degrading a region to a coarse replace rather than by timing out, so the output stays deterministic.

  `diffStructured(a, b, key)` diffs two sequences by stable identity and detects **moves**, which a text diff fundamentally cannot: it intersects the key sequences and takes the longest increasing subsequence of the survivors' old positions as the stable spine, in O(n log n). Every item from both sequences comes back exactly once in render order, with per-type counts. Duplicate keys throw a `DiffError` by default, or can be paired by occurrence with `{ duplicate_keys: 'index' }`.

  `renderDiffHTML(ops, options)` renders a diff as HTML with configurable tags and classes; every op's text is escaped, tag names are validated, and class names are escaped, so no input or option can inject markup. `escapeHTML` is exported alongside it.

  Errors are `DiffError` (`message`, `status`, `code`) — deliberately the same shape as `DelightError`, because the package depends on nothing at all, not even `@delightstack/utilities`.

  Measured on a development machine: `diffWords` over two 50,000-word documents ~58ms median, `diffLines` ~9ms, `diffStructured` over 20,000 blocks ~26ms. The suite asserts those budgets off CI, and asserts sub-quadratic scaling everywhere.
