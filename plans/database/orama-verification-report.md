# Orama verification report — resolving every `[verify-vs-orama]` marker

**Scope:** every `[verify-vs-orama]` marker in §4 and §5 of `plans/database/Native Search Engine Plan.md`, plus Appendix B #4.
**Method:** read the installed `@orama/orama@3.1.18` ESM dist source, then confirm each behavior empirically with small scripts against the installed package. Where source-reading and empirics disagreed, empirics won (they did not disagree).
**Date:** 2026-08-12. **Version under test:** `@orama/orama@3.1.18` (`node_modules/.pnpm/@orama+orama@3.1.18/node_modules/@orama/orama/dist/esm`).
**No repo source was modified.** Probe scripts live in the session scratchpad (`t1-tokenizer.mjs`, `t2-search.mjs`, `t3-where.mjs`, `t4-geo-vec.mjs`, `t5-bm25.mjs`).

All paths below are relative to `dist/esm/` inside that package unless stated otherwise.

---

## Summary table

| # | Marker | Plan's assumption | Orama's actual behavior | Verdict |
|---|---|---|---|---|
| 1 | §4.1 splitter / underscore | underscore splits | `_`, `'`, `-` are **word characters**; all non-ASCII except `àèéìòóù` are separators | plan WRONG about Orama; **deviate deliberately** |
| 2 | §4.1 enums excluded from full-text | excluded | confirmed excluded | **match** |
| 3 | §4.3 fuzzy not down-weighted | not down-weighted | confirmed, byte-identical scores | **match** |
| 4 | §4.4 prefix expansion sum vs max | each match contributes (sum) | confirmed sum | **match** |
| 5 | §4.5 threshold semantics | A = docs matching all tokens | A = docs matching all tokens **within a single field**; plus 3 quirks | plan INCOMPLETE; **match core, drop quirks** |
| 6 | §5 `{eq}`/`{in}` on array fields | "contains value / contains any" | `{eq}`/`{in}` **silently match nothing** on `string[]`, **throw** on `enum[]`; only bare value/array works | plan WRONG; **deviate deliberately** |
| 7 | §5 `not` with missing fields | missing-field doc passes `not` | confirmed | **match** |
| 8 | §5.1 radius defaults/units/earth radius/formula | `unit:'m'`, `inside:true`, haversine | confirmed; R = 6371e3 m; units cm/m/km/mi/yd/ft; `<=` inclusive, `>` exclusive | **match** |
| 9 | §5.1 polygon planar | planar even-odd ray casting | confirmed PNPOLY; half-open (bottom/left in, top/right out) | **match** |
| 10 | §5.1 missing geopoint under `inside:false` | "Orama likely differs" | Orama **agrees** — missing geopoint fails both directions | plan's *worry* was wrong; **match** |
| 11 | §4.9 `similarity` default + reachability | 0.8, "confirm exposure" | `DEFAULT_SIMILARITY = 0.8`; **not reachable** through the typed API or the URL wire | **match default, add the key explicitly** |
| 12 | §4.9 hybrid fusion | "min-max normalize to [0,1], 0.5/0.5" | **max-normalization only** (divide by max, no min subtraction), 0.5/0.5 default | plan WRONG on normalization; **deviate deliberately** |
| 13 | §7.6 IDB astral key order | "it does [diverge]" | correct — IDB sorts strings by UTF-16 code unit | **confirmed, keep the re-sort rule** |
| B4 | `similarity` wire reachability | open question | not in `SearchQuery`, not in `encode`/`decodeSearchQuery` | **not reachable today** |

Plus five **unmarked** behaviors that contradict text already frozen in the plan — see "Additional findings" at the end. Two of them (`tf` normalization + tokenizer de-duplication, and BM25's `d` placement) mean **§4.4's stated formula is not Orama's formula**.

---

## 1. §4.1 step 3 — default splitter behavior

### What Orama actually does

`components/tokenizer/languages.js:35`

```js
english: /[^A-Za-zàèéìòóù0-9_'-]+/gim
```

`components/tokenizer/index.js` → `tokenize()`: `input.toLowerCase().split(splitRule).map(normalizeToken).filter(Boolean)`. Diacritic folding happens *after* splitting, per token, in `normalizeToken` → `replaceDiacritics` (`components/tokenizer/diacritics.js`), which maps char codes 192–383 to ASCII and is a no-op outside that range. There is no NFKD normalization anywhere.

Empirical (`t1-tokenizer.mjs`):

```
"snake_case_field"      => ["snake_case_field"]      # underscore does NOT split
"it's a well-known co-op" => ["it's","a","well-known","co-op"]  # apostrophe/hyphen do NOT split
"foo--bar"              => ["foo--bar"]
"_under_"               => ["_under_"]               # leading/trailing underscore kept
"jane.doe@showandtour.com" => ["jane","doe","showandtour","com"]
"café"                  => ["cafe"]                  # é survives the split, then folds
"naïve résumé"          => ["na","ve","resume"]      # ï is a SEPARATOR
"Zürich München"        => ["z","rich","m","nchen"]  # ü is a SEPARATOR
"東京 москва"            => []                        # all CJK/Cyrillic destroyed
"emoji 😀 test"         => ["emoji","test"]
"x".repeat(80)          => [<the whole 80-char token>]  # no length cap
"repeat repeat repeat"  => ["repeat"]                # de-duplicated (see finding A)
```

The allowed-character class is ASCII letters/digits plus exactly six accented vowels (`à è é ì ò ó ù` — Italian). Every other non-ASCII letter, including `ï ü ñ ç ø å` and all non-Latin scripts, is a **separator**, so `Zürich` indexes as two junk tokens `z` and `rich` and `москва` indexes as nothing at all. This is a genuine defect, not a design choice.

### Recommendation: **deviate deliberately** (the plan's rule 3 is the better rule, but its stated rationale is wrong)

The plan says "Orama's default splitter differs slightly." It differs *substantially*, and in Orama's favor on exactly one point (`snake_case`) and against it on everything else.

- Keep `\p{L}\p{N}` splitting + NFKD + combining-mark stripping. This fixes non-Latin scripts and non-Italian diacritics, which is a strict correctness win and directly affects membership for any non-English content.
- Keep splitting on `_`. Orama does not, but `snake_case_field` as one opaque token is worse for the package's own domain (field names, identifiers) and prefix search already recovers the whole-token case.
- **Note the collateral:** splitting on `'` and `-` (which `\P{L}\P{N}` does and Orama does not) changes membership for `it's` → `it`,`s` and `well-known` → `well`,`known`. This is a *behavior change consumers can observe* and belongs in the Phase 4 changeset, alongside the vector-strip note. Apostrophes in particular produce a bare `s` token on every possessive; consider (and document a decision on) whether to keep `'` as a word character to avoid that.

> **Resolved (2026-08-12) — apostrophes FOLD, they do not split.** An apostrophe (`U+0027` or `U+2019`) whose two immediate neighbours are both `\p{L}\p{N}` is deleted before splitting; every other apostrophe (leading, trailing, isolated, or one of a doubled pair — each has the other as a neighbour) remains an ordinary separator. So `john's` → `johns`, `it's` → `its`, `o'brien` → `obrien`, `'quoted'` → `quoted`, `don''t` → `don` + `t`. This removes the bare `s` token this recommendation flagged, keeps `john` a prefix match for `johns`, and makes the apostrophe-less query `obrien` an exact match. Hyphen and underscore splitting is unchanged. Plan §4.1 step 3 carries the frozen spec.

> **Extended (2026-08-12):** five further deliberate deviations from Orama's tokenizer were frozen the same day, all in plan §4.1 (steps 6–11) and all verified against this report's `t1-tokenizer.mjs` behavior. (1) **Format characters fold to nothing** — every `\p{Cf}` plus Arabic tatweel `U+0640`, so a soft-hyphenated `data\u00ADbase` is one token here and two in Orama. (2) **`U+02BC` joins the apostrophe fold class** — `johnʼs` → `johns`; because it is a `\p{L}` a non-intra-word one is demoted to a separator rather than surviving inside a token (Orama treats it as a separator always). (3) **camelCase boundary splitting with whole-token retention** — `getUserData` → `getuserdata` + `get`/`user`/`data`, `HTTPServer` → `httpserver` + `http`/`server`; Orama has no case-boundary rule at all. (4) **Acronym dot folding** — `U.S.A.` → `usa`, `e.g.` → `eg`; Orama splits them into single-letter tokens. (5) **Whole-token emission for separator-bearing number chunks** — `3.14`, `1,000`, `2.5.1`, `555-1234` emit the whole chunk alongside their digit runs, mirroring the email rule; Orama emits only the digit runs. Battery cases `term.camel_case.*`, `term.format_characters.*`, `term.acronym_dots.*`, `term.number_chunk.*` and `term.punctuation.modifier_apostrophe*` pin each one, and the differential harness asserts the divergence is real.
- Keep the 64-char truncation (Orama has no cap; capping is ours and is safe).

### Spec sentence to freeze

> Tokenization normalizes NFKD, strips `\p{M}`, lowercases, **folds intra-word apostrophes** (see the 2026-08-12 resolution above), and splits on any run of characters outside `\p{L}\p{N}`; underscore and hyphen are separators. This deviates from Orama 3.1.18, whose English splitter `/[^A-Za-zàèéìòóù0-9_'-]+/gim` treats `_`, `'` and `-` as word characters and treats every non-ASCII letter except `àèéìòóù` as a separator (destroying CJK, Cyrillic, and `ï/ü/ñ/ç` words entirely). The deviation is intentional: Orama's behavior is a defect for non-English content. Consumer-visible consequence: `well-known` now indexes as two tokens, and `it's` indexes as the single token `its`.

---

## 2. §4.1 — enum fields excluded from full-text term matching

### What Orama actually does

`methods/search-fulltext.js:innerFullTextSearch` builds `propertiesToSearch` by filtering `getSearchablePropertiesWithTypes` to `type.startsWith('string')` — so only `string` and `string[]` participate. `components/index.js:create` gives `enum`/`enum[]` a `FlatTree`, and `components/index.js:search` throws `WRONG_SEARCH_PROPERTY_TYPE` for any non-`Radix` property that is explicitly requested via `properties`.

Empirical (`t2-search.mjs`): with `{status: 'open'}` (enum) on docs 1 and 3 and `tags: ['open']` (string[]) on doc 3 only, `search({term:'open'})` returns **only doc 3** — the enum never contributes.

### Recommendation: **match**

The plan is correct. Also inherit the *error*: naming an enum field in `fields` should be a 400, not a silent no-op (§4.10 already routes this to `DelightError.badRequest`).

### Spec sentence to freeze

> `enum`/`enum[]` fields are never tokenized and never participate in term matching (matching Orama, which restricts full-text search to `string`/`string[]` properties). They are indexed as single exact values for filtering and faceting only. Naming an enum field in `fields` throws `DelightError.badRequest`.

---

## 3. §4.3 — fuzzy matches are not down-weighted

### What Orama actually does

`trees/radix.js:RadixNode.find()`: when `tolerance` is set and `exact` is false, it takes the `_findLevenshtein` branch, which (a) collects the full subtree for any node whose word starts with the term — i.e. ordinary prefix expansion — and (b) additionally admits any terminal word passing `syncBoundedLevenshtein(term, w, tolerance).isBounded`. The union of both is returned as one flat `{word: docIDs}` map, and `components/index.js:search` feeds every entry of that map through the *same* `calculateResultScores` call with no distance term anywhere. There is no penalty factor in `components/algorithms.js:BM25` either.

Empirical (`t2-search.mjs`): docs `exactword` (`hello world one two`) and `fuzzyword` (`hallo world one two`), query `hello` with `tolerance: 1`:

```
exactword  0.5019341652330639
fuzzyword  0.5019341652330639   # byte-identical
```

Also confirmed: `tolerance` is a **union with** prefix matching, not a replacement (query `hel`, tolerance 1, still finds `hello` by prefix but not `hallo` at distance 2); and `exact: true` **suppresses tolerance entirely** (the `find()` branch condition is `tolerance && !exact`).

### Recommendation: **match**

Full weight for fuzzy matches. Down-weighting would be defensible but changes ranking versus today for no requested reason, and score values are a non-goal anyway (§2).

### Spec sentence to freeze

> With `tolerance: N`, the candidate set per query token is *prefix matches ∪ tokens within bounded Levenshtein distance ≤ N*, de-duplicated; every candidate contributes at full BM25 weight with no distance-based penalty (matching Orama 3.1.18). `exact: true` suppresses `tolerance` — the two are never combined.

---

## 4. §4.4 — prefix expansion: sum, not max

### What Orama actually does

`components/index.js:search` iterates the words returned by `tree.node.find(...)` and calls `calculateResultScores` once per matched word; `calculateResultScores` does `resultsMap.set(id, resultsMap.get(id) + bm25 * boostPerProperty)`. Accumulation is additive across (property × query token × matched index word).

Empirical (`t2-search.mjs`), doc `A` = `aa ab ac ad` (4 tokens with prefix `a`), doc `B` = `aa zz yy xx` (1 such token), query `a`:

```
A  1.6378284506189518
B  0.1320259549197602
```

A max-per-query-token rule would put these within a factor of ~1 of each other; the 12× gap is unambiguous summation. Cross-field accumulation is likewise additive (doc matching in two fields scores ~2× the doc matching in one — `t5-bm25.mjs`), and `boost[field]` is a plain multiplier on that field's contribution (`boost: {a: 2}` exactly doubles).

### Recommendation: **match**

### Spec sentence to freeze

> A document's score is the sum over (field × query token × matched index token) of `boost[field] * bm25(...)`; when one query token prefix-expands to several index tokens, **each** expansion contributes (matching Orama). Summation order is fields ascending, then tokens ascending, then doc ids ascending.

---

## 5. §4.5 — `threshold` semantics

### What Orama actually does

`components/index.js:search` (the live path; `components/algorithms.js:prioritizeTokenScores` is dead code for this version's fulltext flow). `methods/search-fulltext.js:41` defaults `threshold` to **1** when absent or null.

`keywordMatchesMap: Map<docId, Map<property, count>>` counts, per document and per property, how many *matched index words* were scored into it. Then:

- `threshold === 1` → return the full union `U` (all docs matching any token), score-sorted.
- `threshold === 0` → if *any* query token found zero matches anywhere, return `[]` outright; otherwise keep only docs where **some single property** has `matchCount === tokens.length`.
- `0 < t < 1` → compute the same "full match" set `F`; if `F` is non-empty return `F` followed by the first `ceil(|U \ F| * t)` of the remainder in score order; **if `F` is empty, return all of `U` unfiltered.**

Empirical (`t2-search.mjs`), query `alpha beta` over 5 docs:

| threshold | result |
|---|---|
| absent | 4 ids (full union) |
| `0` | `["both_same_field"]` — `split_fields` (alpha in `a`, beta in `b`) is **excluded** |
| `0.25` | 2 ids |
| `0.5` | 3 ids |
| `1` | 4 ids |

Three quirks, all confirmed empirically:

1. **Per-property, not per-document.** A doc carrying `alpha` in field `a` and `beta` in field `b` fails `threshold: 0`. This is the single biggest divergence from the plan's wording.
2. **Prefix expansion falsely satisfies "all tokens."** Query `al be` with `threshold: 0`, doc `t: 'alp alpine'` — `al` expands to *two* index words in the same property, bumping the counter to 2 == `keywordsCount`, so the doc is returned despite containing no `be*` token at all. Confirmed: both `quirk` and `control` returned.
3. **Fractional threshold degenerates to no filter when nothing matches everything.** Query `alpha qqqqqq` (second token matches nothing) with `threshold: 0.5` returns all 3 alpha-matching docs — the fraction is never applied.

### Recommendation: **match the intent, drop the quirks**

Freeze the plan's document-level definition (`A` = docs matching *all* tokens anywhere in the searched fields). Deliberately drop quirks 2 and 3 — they are bugs, not semantics; quirk 2 in particular makes `threshold: 0` non-deterministic in a way no consumer could rely on intentionally. Quirk 1 (per-property) is a real semantic choice, but the per-document reading is what the key's name and docstring promise and is what a consumer filtering a multi-field corpus expects; deviating here is a *behavior change* and must be changelogged.

`threshold: 0` with a token matching nothing → `[]` under both readings; keep that.

### Spec sentence to freeze

> Let `U` = documents matching at least one query token in any searched field and `A ⊆ U` = documents matching **every** query token (across the searched fields as a whole). `threshold: 0` → `A`; `threshold: 1` (the default when the key is absent) → `U`; `0 < t < 1` → `A` followed by the top `ceil(|U \ A| * t)` of `U \ A` by score. Deviations from Orama 3.1.18, all deliberate: (a) Orama requires all tokens within a *single* property, we require them within the document; (b) Orama lets one query token's prefix expansion count as several tokens, satisfying "all tokens" spuriously — we count distinct query tokens; (c) Orama skips the fractional filter entirely when `A` is empty — we always apply it.

---

## 6. §5 table — `{eq}` / `{in}` on array fields

### What Orama actually does

`components/index.js:searchByWhereClause` dispatches on the index type *before* looking at operators:

- **`string[]` → `Radix`.** The array branch is `if (type === 'Radix' && (typeof operation === 'string' || Array.isArray(operation)))` — it only fires for a **bare** string or bare array, which it tokenizes and unions (contains-any). An object operand like `{eq: 'red'}` matches neither this branch nor the later `Flat`/`AVL` branches, so control **falls off the end of the loop** leaving `filtersMap[param]` an empty `Set`, and the final `setIntersection` yields nothing. No error is raised.
- **`enum[]` → `Flat` + `isArray` → `node.filterArr()`** (`trees/flat.js`), which supports only `containsAll` and `containsAny` and **throws** `Invalid operation` for anything else — including a bare value.
- **`number[]` → `AVL`**, where `eq`/`gt`/`between` work per-element (contains-semantics) as expected.

Empirical (`t3-where.mjs`):

```
sa (string[]) bare "red"                => ["full"]     # contains
sa (string[]) bare ["red","green"]      => ["full","other"]  # contains-any
sa (string[]) {eq:"red"}                => []          # SILENT empty
sa (string[]) {in:["red"]}              => []          # SILENT empty
sa (string[]) {containsAll:["red","blue"]} => []       # SILENT empty (containsAll is enum-only!)
ea (enum[])  {eq:"x"}                   => THROW Invalid operation
ea (enum[])  {in:["x"]}                 => THROW Invalid operation
ea (enum[])  bare "x"                   => THROW Invalid operation
ea (enum[])  {containsAll:["x","y"]}    => ["full"]
ea (enum[])  {containsAny:["x","z"]}    => ["full","other"]
na (number[]) {eq:1}                    => ["full"]
na (number[]) {gt:2}                    => ["other"]
s  (string)  {eq:"hello"}               => []          # SILENT empty on a SCALAR string too
```

Two things the plan does not currently say: **`containsAll` does not work on `string[]` at all today** (only `enum[]`), and **`{eq}` on a scalar `string` field silently returns nothing** — a bare string is the only working form.

### Recommendation: **deviate deliberately — make the whole matrix uniform**

Orama's behavior here is not semantics worth preserving; it is a type-dispatch accident with three different failure modes (silent empty, throw, work) for the same user intent. The plan's row is the right target — implement it as written and treat it as an intentional widening:

| Operand | scalar `string`/`number`/`boolean`/`enum` | `string[]` / `enum[]` / `number[]` |
|---|---|---|
| bare value | `{eq}` | contains value |
| bare array | `{in}` | contains-any |
| `{eq: v}` | equality | contains value |
| `{in: [...]}` | value ∈ list | contains-any |
| `{contains_all: [...]}` | 400 | every listed value present |
| `{not_in: [...]}` | present AND ∉ list | present AND no element ∈ list |

Anything not in the matrix throws `DelightError.badRequest` (§4.10) — never a silent empty result.

Migration note for the differential harness: queries written as `{eq}` on a `string[]` will *change* from "no results" to "contains", and `contains_all` on `string[]` from "no results" to working. Both strictly widen; no consumer can be depending on the empty set.

### Spec sentence to freeze

> On array fields (`string[]`, `enum[]`, `number[]`), `{eq: v}` and a bare `v` mean "the array contains `v`"; `{in: [...]}` and a bare array mean "the array contains any listed value"; `contains_all` means "every listed value is present"; `not_in` means "the field is present and no element is in the list". This is uniform across all three array types and across scalar/object operand forms. It deviates from Orama 3.1.18, where `{eq}`/`{in}` on `string[]` (and on scalar `string`) silently return the empty set, `contains_all` works only on `enum[]`, and `enum[]` throws on `eq`/`in`/bare values. Any operator not in the matrix throws `DelightError.badRequest`.

---

## 7. §5 table — `not` with missing fields

### What Orama actually does

`components/index.js:searchByWhereClause`, `not` branch: it builds `allDocs` = every internal id `1..internalIdToId.length`, evaluates the inner filter, and returns `setDifference(allDocs, notResult)`. Because the complement is taken over the whole corpus rather than over "docs having the field," a document missing the field passes `not`.

Empirical (`t3-where.mjs`), corpus `full` / `other` / `missing_e` (which has no `e`, `n`, `b`, or `sa`):

```
not {e:{eq:"open"}}  => ["missing_e","other"]
not {n:{eq:5}}       => ["missing_e","other"]
not {b:true}         => ["missing_e","other"]
not {sa:"red"}       => ["missing_e","other"]
```

Also confirmed, on the adjacent rows: `{nin: ['open']}` on enum returns only `other` — `missing_e` is **excluded**, matching the plan's `not_in` row exactly ("value present AND ∉ list"). Positive leaf predicates (`{gt:0}`, `b: true`) also exclude the missing-field doc. And `and: []` / `or: []` both evaluate to the empty set.

### Recommendation: **match**

The plan is correct, and the asymmetry between `not: {eq}` (missing passes) and `not_in` (missing fails) is Orama's actual behavior, not an oversight to correct. Keep it — it is also the reading that makes `not` a true complement.

### Spec sentence to freeze

> Every leaf predicate evaluates false when the field is missing or null. `not: {...}` is the complement of its inner predicate **over the whole corpus**, so a document missing the field passes `not` (matching Orama). `not_in` is *not* a `not` — it requires the field to be present, so a missing field fails it. `and: []` and `or: []` both evaluate to the empty set. The SQL compiler emits `(col IS NULL OR NOT (...))` for `not` to reproduce this under three-valued logic.

---

## 8. §5.1 — radius: defaults, units, earth radius, distance formula

### What Orama actually does

`components/index.js` BKD branch: `const { value, coordinates, unit = 'm', inside = true, highPrecision = false } = operation.radius`, then `convertDistanceToMeters(value, unit)` and `node.searchByRadius(coordinates, meters, inside, undefined, highPrecision)`.

`utils.js:246`:

```js
const mapDistanceToMeters = { cm: 0.01, m: 1, km: 1000, ft: 0.3048, yd: 0.9144, mi: 1609.344 };
```

An unrecognized unit **throws** `Invalid distance suffix "<value>". Valid suffixes are: cm, m, km, mi, yd, ft.`

`trees/bkd.js`: `const EARTH_RADIUS = 6371e3;` — standard spherical haversine with `atan2(√a, √(1−a))`. Membership is `inclusive ? dist <= radius : dist > radius` — so `inside: true` is **inclusive** of the boundary and `inside: false` is **strictly** outside; they are exact complements. `highPrecision: true` swaps `haversineDistance` for `vincentyDistance` (WGS-84, iterative, 1000-iteration cap, returns `NaN` on non-convergence).

Empirical (`t4-geo-vec.mjs`): computed `haversine(center, near) = 1111.9492664453662` m with R = 6371e3 independently in the probe, then queried at exactly that radius — `near` **is** included at `inside: true` and **is not** included at `inside: false`.

> **Correction (coordinator, 2026-08-12):** the probe's `1111.9492664453662` came from the probe script's own independently-written haversine, which differs from Orama's expression tree at the ~2-ulp level (`lat * (Math.PI/180)` vs `(lat * Math.PI)/180`, and product order in `cos·cos·sin·sin`). Orama's actual `BKDTree.haversineDistance` yields `1111.9492664455875` for the same inputs (identical source in 3.1.16 and 3.1.18). `core/geo.ts` ports Orama operand-for-operand; golden geo fixtures must be generated from that port, never from the probe's literal. `unit: 'km'` at value 2 matches `unit: 'm'` at 2000. `unit: 'nm'` throws. `highPrecision: true` returns the same set at this scale.

### Recommendation: **match exactly**

Including the earth radius constant (`6371e3`, not 6371008.8 or 6378137) — a different constant shifts every boundary by ~0.1%, which is exactly the kind of silent membership change the differential harness exists to catch.

Keep the plan's decision to accept-and-ignore `highPrecision` (Vincenty vs haversine differ by up to ~0.5% and Vincenty adds a `NaN` failure mode; being "always haversine" is the simpler frozen rule — but note it means we are always *haversine*-precise, not always *Vincenty*-precise, so §8.1's "compare against Orama run with `highPrecision: true`" is the wrong harness setting and should be `highPrecision: false`).

### Spec sentence to freeze

> `{radius: {coordinates, value, unit?, inside?}}` on a geopoint field. Defaults: `unit: 'm'`, `inside: true`. Unit multipliers to meters are exactly `cm 0.01`, `m 1`, `km 1000`, `ft 0.3048`, `yd 0.9144`, `mi 1609.344`; any other unit throws `DelightError.badRequest`. Distance is spherical haversine with `EARTH_RADIUS = 6371e3` metres and `c = 2·atan2(√a, √(1−a))`. `inside: true` matches `distance <= value` (boundary inclusive); `inside: false` matches `distance > value` (boundary exclusive) — exact complements. All values match Orama 3.1.18. `highPrecision` is accepted and ignored; we are always haversine.

---

## 9. §5.1 — polygon: planar treatment and vertex/edge behavior

### What Orama actually does

`trees/bkd.js:BKDTree.isPointInPolygon` — textbook PNPOLY crossing test, planar, treating `lon` as `x` and `lat` as `y` with no projection:

```js
const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
if (intersect) isInside = !isInside;
```

The ring is implicitly closed (`for (let i = 0, j = len - 1; i < len; j = i++)`), so callers need not repeat the first vertex. `searchByPolygon(polygon, inclusive)` keeps a node when `(isInside && inclusive) || (!isInside && !inclusive)`, so `inside: false` is the exact complement over indexed points.

Empirical (`t4-geo-vec.mjs`), a box with corners (0,0)–(10,10) and probe points on every edge and two opposite vertices:

```
inside => ["e_bottom","e_left","inside","v_bottomleft"]
```

So the test is **half-open**: the bottom edge, the left edge, and the bottom-left vertex are *inside*; the top edge, the right edge, and the top-right vertex are *outside*. This is the standard consequence of the strict `yi > y !== yj > y` and strict `x <` comparisons and is deterministic — comparisons and one multiply/divide, no transcendentals.

Antimeridian, as expected: a "polygon" from lon 179 to lon −179 planar-spans the *long* way, returning `w179` and `zero` while excluding `e179`.

### Recommendation: **match**

Port `isPointInPolygon` verbatim (it is ~10 lines), including the implicit ring closure and the half-open boundary. The plan's §5.1 golden coverage ("a doc on a polygon vertex/edge — freeze whatever ray casting decides") is now answerable without running Orama.

One implementation note: keep the operand order of `((xj - xi) * (y - yi)) / (yj - yi) + xi` literally identical. It is pure IEEE-754 `+ − × ÷`, so it is bit-reproducible across engines *only* if the expression tree matches.

### Spec sentence to freeze

> `{polygon: {coordinates: [{lat, lon}, ...], inside?}}` uses planar even-odd ray casting over raw `lon`/`lat` as `x`/`y`, with the ring implicitly closed, via the exact PNPOLY predicate `(yi > y) !== (yj > y) && x < ((xj − xi) * (y − yi)) / (yj − yi) + xi` (matching Orama 3.1.18 bit-for-bit). The boundary is **half-open**: points on the bottom and left edges and on the bottom-left vertex are inside; points on the top and right edges and on the top-right vertex are outside. `inside: false` is the exact complement. Antimeridian- and pole-spanning polygons are undefined and unsupported (planar math spans the long way); the golden fixtures assert the defined planar result, not a geographic one. Polygon is fully deterministic — no transcendentals — so it carries no cross-engine caveat.

---

## 10. §5.1 — missing/null geopoint under `inside: false`

### What Orama actually does

A document with no geopoint value is never inserted into the BKD tree (`components/index.js:insertScalarBuilder` only reaches the `BKD` case when a value exists), and both `searchByRadius` and `searchByPolygon` walk *tree nodes only*. Their complement (`inside: false`) is therefore taken over indexed points, not over the corpus — unlike the `not` operator (§7), which explicitly enumerates `allDocs`.

Empirical (`t4-geo-vec.mjs`), corpus including `nogeo` (no `p` field):

```
radius 2000 inside:false  => ["far"]     # nogeo absent
polygon inside:false      => ["far"]     # nogeo absent
```

### Recommendation: **match** — and note the plan's stated worry was unfounded

The plan says "Orama likely differs on `inside: false`; ours is the frozen rule." It does **not** differ: Orama already fails missing geopoints in both directions, which is exactly the §5 null rule. This marker resolves in the plan's favor with no deviation, and the sentence hedging about a likely difference should be deleted rather than kept as a documented deviation.

### Spec sentence to freeze

> A document whose geopoint field is missing or null fails **both** `inside: true` and `inside: false` — the §5 null rule applies to geo predicates like any other leaf. This matches Orama 3.1.18, where unindexed documents are absent from the BKD tree and therefore from both the radius/polygon result and its complement. (Contrast `not: {p: {radius: ...}}`, which *does* admit missing-geopoint documents, because `not` complements over the corpus.)

---

## 11. §4.9 — vector `similarity` default and wire reachability

### What Orama actually does

`trees/vector.js:1`: `export const DEFAULT_SIMILARITY = 0.8;`
`methods/search-vector.js:31`: `vectorIndex.node.find(vector.value, params.similarity ?? DEFAULT_SIMILARITY, whereFiltersIDs)`.

`VectorIndex` stores `[magnitude, Float32Array]` per doc and `findSimilarVectors` divides the dot product by both magnitudes — i.e. it computes true cosine similarity at query time rather than normalizing at write time.

Empirical (`t4-geo-vec.mjs`), 4 docs, query `[1,0,0]`:

```
default          => x:1, y:0.9938837341719244            # w (0.707) and z (0) dropped
similarity: 0    => x:1, y:0.9938…, w:0.7071…, z:0
similarity: 0.99 => x:1, y:0.9938…
query [2,0,0]    => identical scores to [1,0,0]          # confirms cosine, not raw dot
```

Default of **0.8** confirmed, and the threshold also applies inside hybrid mode (doc `w`, cosine 0.707, contributes zero vector score to the fusion).

### Reachability — this also answers Appendix B #4

**`similarity` is not reachable through any public surface today.**

- Not in `SearchQueryInput` (`packages/database/src/search-query.ts`) — the fields are `term/q/limit/offset/where/facets/boost/distinct_on/exact/fields/threshold/tolerance/vector/sparse/cursor/order`.
- Not in the newly-owned `SearchQuery` in `packages/database/src/search/core/types.ts` either (the Phase-1 type-decoupling work that landed while this report was written declares `vector?: SearchVectorQuery` with `value` + `field` and no `similarity`).
- Not decoded from the URL: `decodeSearchQuery` reads only `term, q, cursor, distinct_on/distinctOn, limit, offset, threshold, tolerance, sparse, exact, where, facets, boost, vector, fields/properties, order`. No `similarity`, no `hybridWeights`, no `relevance`, no `mode`.
- The only leak is `db.server.ts:list()`, which spreads `...base_query` straight into `searchOrama`, so an in-process TypeScript caller casting through `any` could smuggle `similarity` (and `hybridWeights`, `relevance`, `groupBy`) into Orama. Nothing in this repo does.

`similarity` also cannot ride inside the `vector` JSON param, because it is a sibling of `vector`, not a member of it.

### Recommendation: **keep 0.8; add `similarity` to the typed API explicitly (server-only)**

> **Resolved (2026-08-12): now public, nested inside `vector`.** `SearchVectorQuery` is `{ value, field, similarity? }`, default `0.8`, inclusive `>=`, applying to vector *and* hybrid mode. Nesting it (rather than making it a sibling, as Orama did) means it rides inside the existing `vector` JSON URL param — no new URL param and no `encodeSearchQuery`/`decodeSearchQuery` change at all, which is why the sibling-position note above no longer applies.

"Preserve exactly what the wire accepts today" resolves to "the wire accepts nothing," so there is no back-compat constraint at all — the default is the entire observable behavior. Freeze 0.8 so existing in-process behavior is unchanged, and since §4.9 normalizes at write time, a unit-vector dot product *is* cosine, so 0.8 transfers unchanged.

Adding the key is cheap and closes a real gap (0.8 is a high floor; a caller wanting recall has no way to lower it). If added, add it to `encodeSearchQuery`/`decodeSearchQuery` as a plain number param at the same time, and document that it is ignored for non-vector queries.

### Spec sentence to freeze

> Vector mode scores by dot product over write-time L2-normalized vectors (identical to cosine) and admits only documents scoring `>= similarity`, defaulting to **0.8** (Orama's `DEFAULT_SIMILARITY`, verified). The threshold applies in hybrid mode too: a document below it contributes zero vector score to the fusion. `similarity` was unreachable through the typed API and the URL wire in the Orama implementation, so 0.8 was its total observable behavior; it becomes an explicit optional `number` **inside** `vector` (`vector: { value, field, similarity? }`, server-only), carried by the existing `vector` URL param.

---

## 12. §4.9 — hybrid fusion weights and normalization

### What Orama actually does

`methods/search-hybrid.js`:

```js
const fullTextIDs = minMaxScoreNormalization(innerFullTextSearch(...));  // score / max
const vectorIDs   = innerVectorSearch(...);
return mergeAndRankResults(fullTextIDs, vectorIDs, params.term ?? '', params.hybridWeights);
```

`minMaxScoreNormalization` is **misnamed**: it is `score / Math.max(...scores)` with no minimum subtraction, so the low end is not pulled to 0. `mergeAndRankResults` then normalizes *again* by the max of each set (a no-op for text, which is already max-1) and combines `text * textWeight + vector * vectorWeight`. Weights come from `params.hybridWeights` when both `.text` and `.vector` are truthy, else from `getQueryWeights()`, which is a stub returning a fixed `{ text: 0.5, vector: 0.5 }` (the source comments that an ML weight model is planned). Documents present in only one set get 0 for the other. Final sort is score descending with no tie-break.

Empirical (`t4-geo-vec.mjs`), term `alpha` + vector `[1,0,0]`:

```
fulltext raw:  w 0.5068538677024093, x 0.2853399551509859, y 0.2853399551509859
vector:        x 1, y 0.9938837341719244        (w at 0.707 is below the 0.8 floor)
hybrid:        x 0.7814814814814814, y 0.7784233485674437, w 0.5
```

Check: `x = (0.28534/0.50685)*0.5 + 1*0.5 = 0.28148 + 0.5 = 0.78148` ✓ — max-normalization, not min-max. `w = (0.50685/0.50685)*0.5 + 0 = 0.5` ✓. With `hybridWeights: {text:0.9, vector:0.1}` the ordering flips to `w 0.9, x 0.6067, y 0.6061` ✓.

### Recommendation: **keep 0.5/0.5; deviate on the normalization (the plan's own text is what needs fixing)**

The plan currently promises "min-max normalize each score set to [0,1]" — that is *not* what Orama does, and it is also not obviously better. Min-max maps the worst candidate in each set to exactly 0, which is unstable when a set has one or two members (the sole candidate becomes 0/0 or 0) and discards the information that a weak-but-nonzero match is still a match. Max-normalization has neither problem.

Recommend **max-normalization** (match Orama), guarded for the empty/zero-max cases Orama does not guard (`Math.max.apply(Math, [])` is `-Infinity` and every score becomes `-0`; a single all-zero score set yields `NaN`). Add a deterministic PK-ascending tie-break, which Orama lacks.

`hybridWeights` is unreachable through the wire (same analysis as §11), so 0.5/0.5 is the entire observable behavior; keep it fixed in v1 rather than exposing weights.

### Spec sentence to freeze

> Hybrid fusion divides each score set by its own maximum (`score / max`, guarded to 0 when the set is empty or its maximum is 0) and combines `0.5 * text_normalized + 0.5 * vector_normalized`; a document present in only one set contributes 0 from the other. Results sort by fused score descending, then primary key ascending. This matches Orama 3.1.18's actual behavior — whose `minMaxScoreNormalization` is a misnomer for plain max-normalization, and whose `getQueryWeights()` is a stub returning a fixed 0.5/0.5 — with two deliberate additions: the empty/zero-max guards and the PK tie-break. Fusion weights are not configurable in v1 (Orama's `hybridWeights` was never reachable through this package's API).

---

## 13. §7.6 — IDB string key order vs code-point order

Not an Orama question, but the plan marks it. **Confirmed as the plan already suspects.** The IndexedDB specification defines string key comparison as code-unit-wise over the UTF-16 representation, identical to JS `<`. That diverges from code-point order for astral-plane characters: a lone-surrogate pair (U+D800–U+DFFF, code units 0xD800+) sorts *before* U+E000–U+FFFF in code-unit order but *after* it by code point. So `'\u{1F600}'` (😀, U+1F600, code units D83D DE00) sorts before `'�'` (�) in IDB, and after it by code point — which is also SQLite's BINARY/UTF-8 order.

**Recommendation:** keep the plan's rule verbatim — IDB indexes are for candidate *range extraction* only; every user-visible ordering is re-sorted through `core/compare.ts`. Note the second-order consequence the plan does not spell out: a *prefix range scan* built with `IDBKeyRange.bound([t,f,prefix], [t,f,prefix+'￿'])` is **not** a correct upper bound for tokens containing astral characters, since those sort above `￿` in code-unit order. Use `prefix + '\u{10FFFF}'` (or an explicitly open upper bound) for the IDB side, mirroring the §7.3 care already taken over SQLite's surrogate-block increment.

---

## Additional findings (unmarked, but they contradict text the plan has already frozen)

These were not tagged `[verify-vs-orama]`, but they surfaced during verification and each invalidates something the plan currently asserts. Flagging them here rather than silently letting the harness discover them in Phase 2.

### A. The tokenizer de-duplicates, so Orama's `tf` is not a term frequency

`components/tokenizer/index.js`: `allowDuplicates` defaults to `false` and `tokenize` ends with `Array.from(new Set(trimTokens))`. `insertTokenScoreParameters` then computes `tf = tokenFrequency / tokens.length` over that de-duplicated list — so **`tokenFrequency` is always 1** and `tf` is always `1 / distinct_token_count`. Empirically, `'repeat repeat repeat'` tokenizes to `['repeat']`.

The perverse consequence: repeating a word makes a document score **higher**, because repetition shrinks the recorded field length. Doc `cat cat cat cat` (length 1) scores 0.2965 for `cat` while doc `cat dog bird fish` (length 4) scores 0.0962.

**This directly contradicts §4.1's opening line** — "Output: ordered token list (duplicates kept — tf counting needs them)" — as a description of parity. Keeping duplicates is the right engineering call (it makes `tf` a real term frequency and makes BM25 behave as designed), but it is a **deviation**, and it changes ranking on any corpus with repeated terms. It should be recorded as such, not presented as Orama's behavior.

### B. §4.4's BM25 formula is not Orama's BM25 formula

`components/algorithms.js`:

```js
export function BM25(tf, matchingCount, docsCount, fieldLength, averageFieldLength, { k, b, d }) {
    const idf = Math.log(1 + (docsCount - matchingCount + 0.5) / (matchingCount + 0.5));
    return (idf * (d + tf * (k + 1))) / (tf + k * (1 - b + (b * fieldLength) / averageFieldLength));
}
```

The plan writes `idf * ((tf*(k1+1))/(tf + k1*(…)) + d)` — `d` added **outside** the fraction (true BM25+). Orama puts `d` **inside the numerator**, so it is divided by the length-normalization denominator too. These are different functions; verified numerically (predicted 0.29655 from Orama's form matches the observed 0.2965471104479984 exactly, while the plan's form does not).

Additionally, Orama's `docsCount` is the **global document count**, not the count of documents having the field, and `matchingCount` is `tokenOccurrences[prop][token]`, incremented once per *insertion* (so array fields inflate it). Verified: a 3-doc corpus where only 1 doc has field `t` yields idf computed with N = 3. And `avgFieldLength` is maintained by an incremental running average that also divides by the global `docsCount`, so it is simply wrong for any sparsely-populated field (observed `avgFieldLength.t === 1` where the true average is 1 but the arithmetic only coincides).

The plan's `N(field)` = docs-containing-the-field is the correct definition and should stay — but it is a **deviation**, and combined with (A) it means the ranking-parity assertion in §8.1 (Kendall-tau + identical top-10) is optimistic. Recommend loosening §8.1's scored-query assertion to top-N *membership* agreement plus a documented list of the four scoring deviations (dedup/tf, `d` placement, `N` definition, `avgLen` definition), or dropping rank-order parity for multi-term queries entirely.

### C. `exact: true` is case-sensitive and silently never matches array fields

`methods/search-fulltext.js` post-filters `exact` results with `new RegExp('\\b' + escapeRegex(searchTerm) + '\\b')` — no `i` flag — tested against the **original** property value, and only when `typeof propValue === 'string'`.

```
corpus: {U: 'Cat sat'}, {l: 'cat ran'}
{term:'cat', exact:true} => ["l"]      # case-SENSITIVE
{term:'Cat', exact:true} => ["U"]
{term:'cat'}             => ["U","l"]  # non-exact is case-insensitive as expected
string[] field + exact:true => []      # arrays fail the typeof check, always
```

§4.2 defines `exact: true` as "whole-token equality only," which is case-*insensitive* (tokens are lowercased) and works on arrays. That is the sane definition and should stay — but it is a third undeclared deviation, and it is the one most likely to be user-visible (any consumer using `exact` on a mixed-case corpus gets *more* results than before).

### D. `count` ignores `distinct_on`

`fetchDocumentsWithDistinct` applies distinctness during hydration only; `searchResult.count` is set from the pre-distinct `uniqueDocsArray.length`. Verified: 3 docs across 2 distinct groups, `distinctOn: 'g'` → `hits` has 2 ids but `count === 3`.

§4.7 orders `distinct_on` before `limit`/`offset` but never says what `count` reports. Freeze it explicitly — recommend **post-distinct** count (the honest number) and changelog the difference, since the current value makes pagination arithmetic wrong.

### E. `where` error surface is inconsistent

Confirmed error behaviors: unknown field → `UNKNOWN_FILTER_PROPERTY` (throws); two operators in one object (`{n: {gt:1, lt:9}}`) → `INVALID_FILTER_OPERATION` (throws); bare value on an enum → `INVALID_FILTER_OPERATION` with the nonsense message "you requested 4" (it is reading `Object.keys('open')`); unsupported operator on `string[]` → **silent empty set**. §4.10 already routes all query-shape errors to `DelightError.badRequest`, which is right — note that this converts case (d) from silent-empty to a 400, a strict improvement but a behavior change. The existing `normalizeWhere` shim (`search-query.ts`) exists purely to paper over the enum case and is deleted by this plan.

---

## Markers not resolved

None. Every `[verify-vs-orama]` marker in §4 and §5, the §7.6 IDB-ordering exception marker, and Appendix B #4 are resolved above with both a source citation and an empirical result.

---

## Addendum (2026-08-12, differential-harness pass) — five behaviors the original probes missed

Discovered while running the full 256-case battery through Orama 3.1.16 (haversine/BKD source identical to 3.1.18) in `packages/database/src/search/__tests__/differential.test.ts`. Each is asserted in that harness's `ORAMA_DIVERGENCES` table (which fails if the divergence ever stops reproducing). All five are handled as deliberate deviations, already frozen in the plan §4–5 text:

1. **Scalar `string` filtering is tokenized radix matching, not equality.** A bare string operand is a tokenized *contains* (`'東京'`/`'😀'` tokenize to nothing → match nothing), and every operator object on a scalar string — `eq`, `not_in`, `gt`, `gte`, `lt`, `lte`, `between` — silently returns the empty set. §6 above only covered `{eq}` and mis-described the bare-value row. Ours: strict typed equality / code-point ordering per the frozen §5 spec.
2. **A bare number operand throws** (`Cannot read properties of undefined (reading 'toString')`) instead of normalizing to `{eq}`. Ours normalizes.
3. **`boost: 0` is rejected** ("Boost value must be a number greater than, or less than 0"). Ours treats 0 as a legitimate multiplier.
4. **Boolean facets count a missing field as `false`** and omit empty buckets. Ours applies the §5 null rule (missing ≠ false) and always emits both buckets.
5. **`getFacets` crashes** (`TypeError: facetValue is not iterable`) on an array-typed facet when any document lacks the field. Ours counts per element over present arrays.

Also corrected during that pass (see the correction block in §8): the haversine boundary literal, and two engine bugs the harness caught (tokenizer must *truncate* at 64 chars, not drop; a degenerate <3-vertex polygon ring returns empty rather than 400).
