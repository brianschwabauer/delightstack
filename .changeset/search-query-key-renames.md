---
'@delightstack/database': major
---

Own the search types and rename the search-query keys (first phase of the native search engine).

**Type ownership.** `SearchQuery`, `SearchQueryResults`, `WhereCondition`, `FacetDefinition`, `FacetResult`, `SearchableType` and the hit shape are now declared by this package in `src/search/core/types.ts` instead of being re-exported Orama types. The published `.d.ts` output no longer references `@orama/orama` at all, so consumers stop inheriting Orama's type surface (and its future breaking changes). Import paths are unchanged — `Database.SearchQuery<Table>` and friends still come from the same barrels — and the new types are also exported directly from the package root.

**Breaking query-key renames.** The query DSL now uses this package's own vocabulary (*fields*, matching `.searchable()` / `searchable_fields`) and its snake_case convention:

| Old | New |
| --- | --- |
| `distinctOn` | `distinct_on` |
| `properties` | `fields` |
| `vector.property` | `vector.field` |
| `order[].key` | `order[].field` |
| `containsAll` (where op) | `contains_all` |
| `containsAny` (where op) | `contains_any` |
| `nin` (where op) | `not_in` |
| `q` | removed entirely — from the typed API **and** from the URL wire |

`tolerance` is deliberately unchanged.

**No legacy aliases — old spellings stop working.** There is deliberately *no* read-alias layer: `decodeSearchQuery` reads only the new names and `normalizeWhere` only the new where operators. Old URLs therefore break — `?q=`, `?distinctOn=`, `?properties=`, a `vector` param carrying `property`, an `order` entry carrying `key`, and `containsAll`/`containsAny`/`nin` inside a `where` JSON param are all ignored (or rejected as unknown operators) rather than translated. Pagination cursors minted before this release can carry `q` and break the same way; re-issue the query. `encodeSearchQuery` emits only the new names, including the URL params `fields` (was `properties`) and `order` entries built from `field`.

**Migration.** Rename the keys above in any typed query you build, and update any hard-coded or bookmarked search URLs (`q` → `term`, `distinctOn` → `distinct_on`, `properties` → `fields`).

**New: a public `similarity` floor for vector search.** `vector` is now `{ value, field, similarity? }` — `similarity` is the inclusive minimum cosine similarity a document must reach (default `0.8`, applying to vector and hybrid queries). It was previously fixed at `0.8` with no way to change it through the typed API or a URL; because it lives *inside* the `vector` object it travels in the existing `vector` JSON URL param, so no new URL param exists.

**Docs.** The `threshold` docstring described semantics the key never had ("minimum relevance threshold"); it now documents the real behavior — `0` returns only documents matching every term token, `1` (the default) returns documents matching any token, and a fractional value returns all-token matches plus that top fraction of the partial matches. The README's settable `mode: 'vector'` example is also gone — the search mode has always been derived from whether `term`/`vector` are present.

**Tokenizer: apostrophes fold instead of splitting.** An apostrophe (`'` or `’`) between two letters or digits is now removed before tokens are split, so `john's` indexes as `johns`, `it's` as `its`, and `o'brien` as `obrien` — no stray `s` token on every possessive, and the apostrophe-less spelling matches exactly. Apostrophes anywhere else (leading, trailing, isolated, doubled) remain ordinary separators. This changes which documents match terms containing apostrophes, and slightly shifts relevance ranking for corpora that contain them.

**Tokenizer: five further rules (all behavior changes vs Orama).**

- **Invisible format characters are stripped, not treated as separators.** Every `\p{Cf}` (soft hyphen, zero-width space/joiner/non-joiner, BOM, bidi controls) and Arabic tatweel `U+0640` folds to nothing before anything else, so a soft-hyphenated `data\u00ADbase` indexes as the single token `database` (Orama indexed `data` + `base`) and an elongated `مـــد` equals `مد`.
- **`U+02BC` (modifier letter apostrophe) folds like `'` and `’`.** `johnʼs` now indexes as `johns`. Because `U+02BC` is a Unicode *letter*, it previously glued the possessive into one odd token; outside a word it is now an ordinary separator.
- **camelCase words split, and the whole word is kept too.** `getUserData` indexes as `getuserdata`, `get`, `user`, `data`, and `HTTPServer` as `httpserver`, `http`, `server` — so both the literal spelling and each part are findable. Plain words are still emitted exactly once; a digit before a capital (`v2Beta`) is not a boundary.
- **Dotted acronyms fold.** `U.S.A.` and `u.s.a` both index as `usa`, `e.g.` as `eg`. Only *single* letters between dots qualify, so `example.com`, `3.14` and `u.s.army` are untouched.
- **Numbers with internal separators are kept whole as well as split.** `3.14`, `1,000`, `2.5.1` and `555-1234` each emit the whole chunk plus their digit runs, so a decimal or a phone number is findable as itself (previously only `3` and `14` were indexed). A chunk containing a letter (`v2.5`) does not qualify.

Together these change which documents match affected terms and shift relevance ranking on corpora containing camelCase identifiers, acronyms, decimals or soft hyphens. The query side runs the identical function, so both sides always agree.

No other behavior changes beyond the renames.
