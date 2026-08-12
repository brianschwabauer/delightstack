# Native Search Engine Plan

Replace Orama in `@delightstack/database` with a purpose-built, isomorphic search/filter/sort engine: a shared pure core with two storage drivers — synchronous DO-SQLite postings on the server, asynchronous IndexedDB postings on the client.

**Status:** Planned, not started.
**Decisions locked with Brian (2026-08-11):**

- Consumers must not have to change their queries (API-compatible with today's `SearchQuery`). **Amended 2026-08-11:** two deliberate breaking snake_case renames are approved — see the renames decision below.
- Client and server must return identical results for the same query over the same corpus, so callers can choose client or server per query.
- Server index storage is DO-SQLite-native rows; client index storage is IndexedDB. The storage layouts may differ; the *semantics* may not.
- Filtering/sorting moves to SQL (server) / IDB indexes (client), including **child-key paths** (`address.city`) — this capability is kept.
- Fuzzy (tolerance) search parity with Orama is required.
- **Vector and hybrid search are server-only** (decided 2026-08-11): a vector query needs a query embedding, the embedding needs a model call, and the model call goes through the server anyway — client-side vector search never saves a round trip. Isomorphism applies to traditional search (term/filter/sort/facets) only. Callers still supply raw vectors on write and query — no embedding generation, same as today.
- No Cloudflare Vectorize — vector search stays in-DO (Vectorize is eventually consistent and outside the entity write transaction; explicitly rejected).
- **Server storage interface stays synchronous** (DO SQLite is synchronous by design); **client storage interface is async** (IDB requires it). The two drivers are allowed to deviate structurally; consistency comes from shared pure modules + golden tests, not from a single awaited-everywhere core.
- The client gets a real **IDB postings backend** (not just an in-memory Map index), removing the memory ceiling that forces the current 5000-doc auto-switch to server mode.
- **Query-key renames are approved breaking changes** (2026-08-11, extended 2026-08-12 — full table in §6): snake_case (`distinctOn` → `distinct_on`, `containsAll` → `contains_all`) and vocabulary (`properties` → `fields`, `vector.property` → `vector.field`, `order[].key` → `order[].field` — the package's own vocabulary is *fields*: `searchable_fields`, `.searchable()`; plus `nin` → `not_in`). `q` leaves the typed API (it survives only as a URL-decode alias for `term`). `tolerance` is deliberately kept. Renames land in **Phase 1** (so harness + golden fixtures are written against final names) with a thin translation shim at the two remaining Orama call sites and legacy read aliases at the decode/normalize boundary. Phase 1's changeset becomes **major**.
- **FK-derived field values are persisted into the entity row's `json` overflow column** (2026-08-11), under a reserved `$derived` sub-object, written at entity-write time and cascade time (§7.2b). Derived fields currently exist *only* inside the Orama index (no SQLite column — schema.ts skips them in `table_definition`), which would leave the SQL compiler (§7.4) and the sync rewrite (§7.5) with nothing to read. Persisting them makes both trivial and keeps `rebuildSearchTables` a pure function of the entity tables.
- **Sync deletion tombstones move to a real table** (`search_tombstones`, §7.1) with today's retention policy verbatim (cap 10k per type, prune oldest half, `config_version` bump → full resync). `config_version` / `first_updated_at` / `last_updated_at` move to a per-entity-type `search_state` row — today all of this lives on the `search_index` row this plan deletes.
- **Geosearch stays — both `radius` and `polygon`** (decided 2026-08-12): `geopoint` is a searchable schema type today and the operators pass through the untyped `where`. Polygon costs ~20 lines of planar ray casting (matching Orama's planar treatment) — no rectangle compromise needed. Spec in §5.1; Orama's `highPrecision` flag is accepted-and-ignored (we are always precise).

> **Caveat for implementers:** line numbers below were captured 2026-08-11 while another agent was concurrently landing a "serialize less often" journal change in `db.server.ts`. Treat them as anchors, not gospel — re-locate by symbol name. Full paths: `db.server.ts` = `packages/database/src/server/db.server.ts`, `database.worker.ts` = `packages/database/src/client/database.worker.ts`. The journal machinery itself is interim and is *deleted* by this plan (Phase 3).

> **DO SQLite compatibility (verified 2026-08-11 against Cloudflare docs + the workerd authorizer source, SQLite 3.47.0):** everything this plan uses is supported — `WITHOUT ROWID`, VIRTUAL generated columns added via `ALTER TABLE`, indexes on them, `DROP COLUMN`, `json_extract` + table-valued `json_each`, `PRAGMA table_info`, `RETURNING`, upsert. Transactions must go through `ctx.storage.transactionSync()` (raw `BEGIN` is blocked in `sql.exec`) — which is already how `db.server.ts` works. Hard limits that shape this design: **100 columns per table** (§7.4 budget check), **100 bound parameters per query / 100KB per statement** (§7.2 batching), 2MB max row/blob (nothing here approaches it), no `PRAGMA user_version` (irrelevant — migration diffing uses `PRAGMA table_info`).

---

## 1. Why

### 1.1 The immediate problem

Orama is an in-memory index with no incremental persistence. The server serializes the **entire** index (`saveOrama` → msgpack → chunked 1.9MB BLOBs in DO SQLite) after writes (`db.server.ts` — `saveIndex`, ~`:2044-2086`). At current data volumes this takes 10+ seconds per save. A write-ahead journal (`search_journal` + compaction at 500 rows) is being added to amortize this, but it's a bandaid: the full serialize still happens, just less often, and cold start must replay the journal on top of the snapshot.

### 1.2 The structural problems

1. **No incremental persistence, ever.** Orama cannot update storage per-document. Any Orama-based design carries snapshot + journal + replay + compaction complexity forever, and the snapshot cost grows with corpus size without bound.
2. **Memory ceiling.** The whole index must live in DO memory (128MB isolate limit). The client has the same problem, capped today by a 5000-doc auto-switch to server search.
3. **Client/server divergence today.** The two sides index *different projections* (server: `table.toSparse()` + FK-derived fields; client: its own runtime-type-checking `#projectToIndex` that silently drops vector/geopoint and mismatched fields). Same query can already give different results — the opposite of the isomorphic goal. (The vector-dropping part becomes *spec* under this plan — vectors are server-only, §4.9 — but the rest of the divergence is the bug.)
4. **A workaround zoo.** A meaningful fraction of `db.server.ts`/`database.worker.ts` exists to work around Orama bugs (inventory in §9 of this doc's Appendix A). All of it deletes with this plan.
5. **Deep type leakage.** `SearchQuery`, `SearchQueryResults`, `SearchSchema`, etc. are defined in terms of Orama's types and re-exported from the root barrel. Any engine change requires owning those types anyway — so own them.

### 1.3 Why not SQLite FTS5?

Far less code on the server, but it cannot run on the client. FTS5's tokenizer and BM25 would never match a JS engine, killing the "identical results, choose client or server per query" requirement. Consciously rejected.

### 1.4 Why this design wins

- **Server:** postings become SQLite rows updated **in the same transaction as the entity row**. Per-doc incremental persistence by construction. No serialize step, no snapshot, no journal, no cold-start replay, no rollback divergence, no memory ceiling (queries read only the posting rows the terms touch).
- **Client:** postings become IDB records updated in the same IDB transaction as sync state. No index blob, no memory ceiling, no rebuild-on-load cost, windows can grow past 5000 docs.
- **Both:** one pure core defines tokenization, scoring, filter/sort semantics, and tie-breaking. Same query in → same ranking out, whenever the corpora match.

---

## 2. Goals and non-goals

**Goals**

1. Query-API compatible for consumers (`SearchQuery` shape, `where` DSL, `order[]`, facets, cursor, URL encoding all preserved) — except the deliberate breaking key renames locked 2026-08-11/12 (§6 table: `distinct_on`, `contains_all`, `fields`, `vector.field`, `order[].field`, `not_in`; `q` dropped from the typed API). Legacy keys and wire params remain readable at the decode/normalize boundary; encode always emits the new names.
2. Deterministic parity: same corpus + same query ⇒ byte-identical result *order and membership* on client and server — **for traditional search** (term/filter/sort/facets). Vector and hybrid queries are server-only and exempt.
3. O(changed-doc) write cost on both sides; zero cold-start index work on the server.
4. Feature parity: prefix search, tolerance (fuzzy), `exact`, `boost`, `fields`, `threshold`, `distinct_on`, facets, vector + hybrid mode (server-only), child-key filter/sort, array-field filters (`in`/`not_in`/`contains_all`), geosearch (`radius`/`polygon` on geopoint fields, §5.1).
5. Performance: index-write overhead per entity write in the low milliseconds; text search over 100k+ docs in low tens of milliseconds on the server.

**Non-goals**

- Score-*value* parity with Orama. Nothing consumes raw scores; only membership, order, and counts must match Orama closely enough to not surprise consumers (validated by the differential harness, §8.1).
- Embedding generation. Callers supply `number[]` vectors on write and query, exactly as today.
- Stemming, stopwords, language packs. Today's setup uses none (no Orama plugins exist in the repo); we replicate the default pipeline only. The tokenizer module should leave room for these later.
- Client-side vector/hybrid search. Server-only by decision (see locked decisions) — the client never stores or scores vectors.
- ANN vector indexes. Brute-force (over normalized vectors, §4.9) is fine at DO scale, and the quantized prefilter (§4.9) extends its runway well past 100k vectors by fixing the real bottleneck (blob I/O, not dot products). If a table ever genuinely outgrows that: **IVF in-DO** is the designated escape hatch — centroid id behaves like a token, cluster membership is a postings row, so it reuses this plan's storage shape and stays inside the entity transaction. **HNSW is rejected** (graph index over SQLite rows: heavy code, painful incremental deletes, structure-dependent results). **Cloudflare Vectorize is rejected** (eventually consistent, outside the write transaction, can't run the `where` DSL).

**Important honesty about goal 2:** determinism guarantees identical results *given identical corpora*. When the client's synced window doesn't cover the query, results legitimately differ (membership *and* BM25 stats). The per-query client/server choice is therefore a **coverage decision**, not a correctness gamble. See §7.6.

---

## 3. Architecture

```
packages/database/src/search/
├── core/                      # PURE, isomorphic, zero storage access, zero deps
│   ├── tokenizer.ts           # normalize + split + email splitting (§4.1)
│   ├── levenshtein.ts         # bounded edit distance for tolerance (§4.3)
│   ├── bm25.ts                # scoring math (§4.4)
│   ├── compare.ts             # THE comparator: code-point strings, typed values, tie-break (§4.6)
│   ├── where.ts               # where-DSL normalization + JS predicate evaluation (§5)
│   ├── geo.ts                 # haversine + planar point-in-polygon for radius/polygon (§5.1)
│   ├── facets.ts              # facet counting over a matched set (§4.8)
│   └── types.ts               # engine-neutral SearchQuery/Results/Where types (§6)
├── server/
│   ├── sqlite_store.ts        # postings/tokens/docs/vectors tables + dictionary cache (§7.1–7.3)
│   ├── sql_where.ts           # where/order → SQL compiler over generated columns (§7.4)
│   ├── vector.ts              # dot product over unit Float32Arrays + quantized prefilter (§4.9) — pure, but server-only (vectors never reach the client)
│   ├── fusion.ts              # hybrid text+vector score fusion (§4.9) — pure, server-only
│   └── engine.ts              # SYNC driver: full search pipeline (§7.5)
└── client/
    ├── idb_store.ts           # IDB object stores + dictionary cache (§7.6)
    └── engine.ts              # ASYNC driver: same pipeline shape, awaited (§7.6)
```

**The consistency contract.** The server driver is synchronous end-to-end; the client driver is async. They are two implementations of one *specification*, sharing every piece of pure logic (`core/*`). Anything that decides membership, order, or a count must live in `core/` and be imported by both drivers — a driver may orchestrate, batch, and cache however it likes, but it may not reimplement semantics. The enforcement mechanism is the shared golden-vector suite (§8.2), which runs the identical query battery through both drivers and asserts byte-identical output. Per Brian's conventions, duplication between the two drivers' *orchestration* code is fine; duplication of *semantics* is a bug.

**Determinism rules (apply everywhere):**

- Never rely on `Map`/object iteration order or SQL result order for anything user-visible. Every result list is explicitly sorted by the core comparator.
- Final ordering always ends with a primary-key ascending tie-break (compare as the PK's declared type).
- Accumulate scores in a defined order (sorted token order, then sorted doc-id order) so floating-point summation is identical on both sides. IEEE-754 arithmetic (`+ − × ÷`, `sqrt`) is exactly specified and engine-independent; only *order of operations* can diverge. **Transcendentals are not**: the client driver runs under JSC (Safari) and SpiderMonkey (Firefox), not just V8, and ECMAScript allows implementation-varying `Math.log` — a 1-ulp `idf` difference can reorder near-tied docs. BM25's `ln` is the *scoring* pipeline's only transcendental, so `core/bm25.ts` ships its own deterministic `ln` (fdlibm-style port, ~40 lines) and never calls `Math.log`. (Geo `radius` filters use `Math` trig with a documented, filter-only boundary caveat — §5.1.) Golden tests run on at least one non-V8 engine to hold the line (§8.2).
- No `Date.now()`, no randomness anywhere in the engine.

---

## 4. The query semantics specification

This section is the spec both drivers implement and the golden tests encode. Where marked **[verify-vs-orama]**, the differential harness (§8.1) must confirm Orama's actual behavior before freezing the spec; if we deviate deliberately, record it in the doc and changelog.

### 4.1 Tokenizer

Input: a string field value. Output: ordered token list (duplicates kept — tf counting needs them).

1. Unicode-normalize NFKD, strip combining marks (`\p{M}`) — folds diacritics (`café` → `cafe`).
2. Lowercase (`toLowerCase()`).
3. Split on any run of characters not in `\p{L}\p{N}` (Unicode letters/digits). Underscore splits too (so `snake_case` yields `snake`, `case`) **[verify-vs-orama — Orama's default splitter differs slightly; pick ours deliberately and document]**.
4. **Email handling** (matters for `from:` search): the pre-split pass runs **per whitespace-delimited chunk** of the raw value — not whole-value, so embedded emails in prose (`contact jane@x.com today`) count too. Any chunk matching a simple email shape (`local@domain`) additionally emits the whole normalized address as one token *plus* the split parts. E.g. `jane.doe@showandtour.com` → `jane.doe@showandtour.com`, `jane`, `doe`, `showandtour`, `com`. Applied uniformly to all string fields (no per-field config in v1). The query side runs the identical pass, so an email query becomes a multi-token union under the default `threshold: 1` — membership balloons (any doc sharing `com`) while the whole-address token dominates ranking. Same membership behavior as today's Orama splitter; the whole-address token is the only addition.
5. Drop tokens longer than 64 chars (truncate the doc side; query side truncates identically).
6. No stemming, no stopwords (matches current behavior).

`string[]`/`enum[]` fields: tokenize each element; postings don't distinguish element positions. `enum` fields: **not tokenized** — indexed as a single exact token (they're filter-oriented; matches Orama, which excludes enums from full-text term matching) **[verify-vs-orama]**.

### 4.2 Term matching (prefix)

Default (`exact: false`): every query token matches index tokens **by prefix** (query token `dat` matches `data`, `database`). `exact: true`: whole-token equality only. This mirrors Orama's radix `find` behavior.

### 4.3 Tolerance (fuzzy)

`tolerance: N` additionally admits index tokens within bounded Levenshtein distance ≤ N of the query token (whole-token distance, computed after normalization). Candidate set per query token = *prefix matches ∪ tolerance matches*, deduplicated. Fuzzy-matched tokens contribute at full weight (no score penalty) **[verify-vs-orama — Orama historically doesn't down-weight]**. Practical implementation: scan the field's token dictionary, pre-filter by `|len(candidate) − len(term)| ≤ N` and (for N ≤ 2) a cheap first-character check, then run bounded Levenshtein with early-exit rows. Dictionaries are small (distinct tokens, not occurrences) and cached in memory on both sides (§7.3, §7.6), so this is an in-memory scan.

### 4.4 Scoring: BM25

Standard BM25 with Orama's default parameters `k1 = 1.2`, `b = 0.75`, `d = 0.5` (BM25+ lower bound). Per field:

```
score(doc, token, field) = idf(token, field) * ((tf * (k1+1)) / (tf + k1 * (1 - b + b * len(doc,field)/avgLen(field))) + d)
idf = ln(1 + (N(field) - df + 0.5) / (df + 0.5))
```

- `N(field)` = docs containing that field; `df` = docs containing the token in that field; `avgLen` = mean token count of the field.
- A doc's total score = Σ over (query token × matched index token × field), with per-field `boost[field]` multiplier applied to that field's contribution (default 1).
- When one query token prefix-expands to multiple index tokens, each match contributes **[verify-vs-orama — check whether Orama takes max-per-query-token instead; match observed behavior]**.
- Summation order: fields sorted ascending, tokens sorted ascending, docs accumulated in sorted-doc-id order (determinism rule).
- The `ln` inside `idf` is the in-house deterministic implementation (§3 determinism rules) — never `Math.log`.

### 4.5 `threshold`

Orama semantics **[verify-vs-orama, then freeze]**: with multiple query tokens, let `A` = docs matching *all* tokens, `U` = docs matching *any*. `threshold: 0` → return only `A`. `threshold: 1` (default) → return all of `U`. `0 < t < 1` → `A` plus the top `t`-fraction (by score) of `U \ A`.

`threshold` keeps its name (no honest short alternative), but today's docstring — "Minimum relevance threshold (0-1)" (`search-query.ts`) — describes semantics the key does not have; fix it when the types move in Phase 1. The harness should log whether any consumer ever sends a fractional value (Appendix B6): if not, a future major can replace the float blend with `match: 'all' | 'any'`.

### 4.6 Ordering, comparator, ties

- If `order[]` is present (note: **both** the client's `DEFAULT_SEARCH_QUERY` and the server `list` default to `updated_at DESC`, so this is the dominant path — BM25 ordering only applies when a caller explicitly clears `order`), results sort by each `order[]` field in sequence via the core comparator, then PK-ascending tie-break.
- Else, with a `term`: score descending, then PK ascending.
- Else (no term, no order — shouldn't occur given defaults, but define it): PK ascending.

**Core comparator (`core/compare.ts`) — the single most consistency-critical module:**

- Numbers: numeric. `NaN` never occurs (rejected at write). Booleans: `false < true`.
- **Strings: Unicode code-point order** — NOT naive JS `<` (UTF-16 code-unit order diverges from code-point order for astral-plane chars: emoji, rare CJK). SQLite's BINARY collation over UTF-8 *is* code-point order, so the JS side must match SQLite, not vice versa. Implement by comparing via `codePointAt` iteration; golden vectors must include astral-plane cases (`'\u{1F600}'` vs `'�'`).
- `null`/missing sort **last** regardless of direction **[decision — SQLite sorts NULL first ASC by default; the SQL compiler must emit `ORDER BY col IS NULL, col` to enforce nulls-last so both sides agree]**.

### 4.7 `fields`, `distinct_on`, `limit`/`offset`/`cursor`

- `fields` (renamed from Orama's `properties` — §6): restricts which searchable fields participate in term matching (default `'*'`). Unknown field → 400 `DelightError.badRequest`.
- `distinct_on`: after ordering, keep the first hit per distinct value of the given field.
- `limit`/`offset` apply after ordering + distinct. Existing server clamps stay (`limit` clamped to 1..5000 sparse / 1..100 hydrated; `order` keys validated against `sortable_fields` → 400). Cursor semantics unchanged from today's `list` implementation (opaque cursor over the ordering keys + PK).

### 4.8 Facets

Same shapes as Orama's `FacetDefinition` (already leaked into `SearchQueryInput`): string facets → value counts (with `limit`/`order` options), number facets → configured ranges, boolean facets → true/false counts. Counted over the **full matched set** (after `where`, before `limit`/`offset`). Facet value ordering: count descending, then value ascending via core comparator.

### 4.9 Vector and hybrid — **server-only**

Vector and hybrid queries never run on the client (locked decision): the query embedding requires a model call, which requires the server, so client-side vector scoring can never save a round trip. Any query carrying `vector` routes to the server unconditionally (§7.6 routing rule). This deviates from Orama deliberately; the differential harness exempts vector/hybrid from client-side parity.

- **Unit-normalize at write, score by dot product.** Vectors are L2-normalized once, at index time; queries are normalized once, at query time; the score is then a plain dot product (identical ranking to cosine at roughly half the per-doc cost, and no divide in the hot loop). Zero vectors (norm 0) are rejected at write with `DelightError.badRequest` — cosine is undefined for them and Orama's behavior there was never meaningful.
- `vector: { value: number[], field: 'embedding_field' }` (inner key renamed from `property` — §6) → mode `vector`: brute-force dot product over all docs having that field. Result ordering: similarity desc, PK asc. A `similarity` threshold defaults to Orama's `0.8` **[verify-vs-orama — confirm the default and whether the current API exposes it; preserve whatever the wire accepts today]**. (Thresholds are unaffected by normalization — unit-vector dot product *is* cosine similarity.)
- `term` + `vector` → mode `hybrid`: run both, min-max normalize each score set to [0,1] over its own candidates, combine `0.5 * text + 0.5 * vector` **[verify-vs-orama — replicate Orama's actual fusion weights/normalization from source, then freeze ours]**. Hybrid is server-only by construction (fusion needs both score sets in one place).
- Vectors are stored as unit `Float32Array` BLOBs (§7.1). Compute in float64 accumulators, deterministic iteration order (sorted doc-id).
- **Quantized prefilter (planned v1.5, behind a flag).** The real scaling bottleneck is blob I/O, not arithmetic: at 768 dims, 100k float32 vectors ≈ 300MB of reads per brute-force query. Fix: store a 1-bit sign-quantized copy per vector (`qvec` BLOB, dims/8 bytes — ~32× smaller); query by Hamming distance (XOR + popcount) over `qvec`, take a deterministic top-C candidate set (C = max(4×limit, 200), ties broken by doc-id asc), then rescore only those C against the full float32 vectors. Deterministic and exact-given-the-algorithm (results can differ slightly from pure brute force; scores are exempt from parity anyway). Ship v1 without it; add when a table's vector count makes brute-force latency visible.

### 4.10 Error mapping

All query-shape errors (unknown filter field, invalid operator for type, unknown `order[]` field, unknown search field) throw `DelightError.badRequest(...)` — replacing today's remap of Orama's `UNKNOWN_FILTER_PROPERTY`/`INVALID_FILTER_OPERATION` internal errors.

---

## 5. The `where` DSL specification

The DSL is unchanged from what consumers use today (it was raw Orama syntax; it becomes ours):

| Operator | Applies to | Semantics |
|---|---|---|
| bare scalar / `{eq}` | string, number, boolean, enum | strict typed equality |
| bare array (enum) / `{in}` | scalar fields | value ∈ list |
| `{not_in}` | scalar fields | value present AND ∉ list (missing/null ⇒ no match) |
| `{gt,gte,lt,lte}` | number, string, boolean | core comparator ordering |
| `{between: [a,b]}` | number, string | inclusive both ends |
| `{contains_all: [...]}` | array fields | every listed value present in the array |
| `{eq}` / `{in}` on array fields | array fields | array contains the value / contains any listed value **[verify-vs-orama]** |
| `and: [...]`, `or: [...]`, `not: {...}` | composites | logical composition; `not` = complement **within the corpus** (a doc missing the field passes `not: {eq}` — define, test, freeze **[verify-vs-orama]**) |

**Normalization** (`core/where.ts`, ported from today's `normalizeWhere` in `search-query.ts:215-266`): plain scalar on enum → `{eq}`, array on enum → `{in}`, plain number → `{eq}`. Both drivers run the same normalizer first. The normalizer also accepts the legacy where-op keys (`containsAll`, `nin`) as read aliases (`where` JSON travels in bookmarked URLs), and `decodeSearchQuery` does the same for the renamed top-level keys (`distinctOn`, `properties`, `order[].key`, `vector.property`, `q`) — encode always emits only the new names.

**Null/missing rule (freeze this):** every leaf predicate evaluates **false** when the field is missing or null, except inside `not` per the row above. The SQL compiler must reproduce this exactly (SQL three-valued logic makes `NOT(col = x)` silently drop NULL rows — compile `not` explicitly as `(col IS NULL OR NOT(...))` per the frozen semantics).

**Type coercion rule:** the schema declares every path's type, so both sides coerce explicitly per type. Critical on SQL: `json_extract` returns booleans as `0`/`1` — the compiler compares against `0`/`1` for boolean paths. Golden vectors must cover: booleans, null vs absent key, empty arrays, empty strings, unicode strings, numeric strings (no implicit numeric coercion — `'5' ≠ 5`).

**Child keys:** paths use dot notation (`'address.city'`) exactly as today's nested Orama schema exposed them. The set of legal paths is closed: only fields declared `.searchable()`/`.sortable()` in the table schema (this is what makes SQL compilation tractable — see §7.4).

### 5.1 Geosearch (locked 2026-08-12: keep both `radius` and `polygon`)

`geopoint` is a schema type that is *always searchable* ("that is the primary point of a geopoint field" — `schema.ts:198`), and Orama's geo operators pass straight through the untyped `where` today — so both stay. Neither is hard: point-in-polygon is ~20 lines of even-odd ray casting, and the bounding-box machinery is shared with radius anyway (a rectangle-only compromise would save nothing).

**Operator shapes (preserved from Orama's wire format), on geopoint fields only:**

| Operator | Shape | Semantics |
|---|---|---|
| `{radius}` | `{ coordinates: {lat, lon}, value: number, unit?: 'cm'\|'m'\|'km'\|'ft'\|'yd'\|'mi', inside?: boolean }` | haversine distance to `coordinates` ≤ `value` (defaults: `unit: 'm'`, `inside: true`; `inside: false` = complement) **[verify-vs-orama — confirm defaults, unit list, earth radius, and default distance formula; preserve exactly what the wire accepts]** |
| `{polygon}` | `{ coordinates: [{lat, lon}, ...], inside?: boolean }` | planar even-odd ray casting treating lat/lon as flat 2D — matching Orama's planar treatment **[verify-vs-orama]** |

- **`core/geo.ts`**: haversine (fixed earth radius, meters) + unit multipliers + planar point-in-polygon. Orama's `highPrecision` flag is **accepted and ignored** — we are always precise (at DO scale the cost is nothing); document the ignore.
- **Missing/null geopoint fails both `inside: true` and `inside: false`** — the §5 null rule applies to geo like every other leaf predicate **[verify-vs-orama — Orama likely differs on `inside: false`; ours is the frozen rule]**.
- **Determinism caveat (radius only):** haversine needs `sin`/`cos`/`atan2` — implementation-varying across JS engines, same class of problem as `Math.log` (§3). Unlike BM25, where scores *order* results and near-ties are common, a geo predicate is a boolean filter: a cross-engine flip requires a doc within ~1 ulp of the exact radius boundary (sub-nanometer). Accepted and documented; not worth porting deterministic trig (~300 lines vs `ln`'s ~40). **Polygon has no such caveat** — ray casting is comparisons and multiplication only, fully deterministic.
- **Antimeridian/pole-spanning shapes are out of scope**, matching Orama's planar math (a polygon crossing ±180° longitude doesn't work there either). Document, don't handle.
- **Server compilation (§7.4):** bounding-box prefilter over two generated columns per geopoint field (`sv$<field>__lat` / `sv$<field>__lon` over `json_extract`, both indexed), then the exact `core/geo` check over the candidates. Polygon bbox = vertex min/max; radius bbox = `lat ± Δ`, `lon ± Δ/cos(lat)`, widening to the full longitude range when the circle nears a pole. The bbox is a *prefilter only* — membership is always decided by `core/geo`, per the §3 contract. Counts 2 columns per geopoint field against the 100-column budget.
- **Client:** `core/geo` predicate over the window's docs (optionally an IDB range on the lat path for candidate extraction — a positive number predicate, allowed per §7.6; plain scanning is fine at window sizes).
- **Golden coverage (§8.2):** boundary-distance docs, `inside: false`, missing geopoint, a doc on a polygon vertex/edge (freeze whatever ray casting decides), and an antimeridian case asserting the *defined* (planar, unsupported-wrap) result.

---

## 6. Public API compatibility (type decoupling)

Phase 1, zero behavior change, independent of everything else:

- Re-declare in `search/core/types.ts`, structurally identical to today's shapes: `SearchQuery` (the `Pick<SearchParams…>` union collapses into one owned interface with `term, where, order, limit, offset, facets, boost, fields, tolerance, threshold, exact, distinct_on, vector, sparse, cursor` — `q` is gone from the typed interface, surviving only as a decode alias for `term`), `SearchQueryResults` (`count, elapsed, facets, hits, cursor`), `WhereCondition`, `FacetDefinition`, `FacetResult`, `SearchableType`, and the hit shape (`{ id, score, document }`).
- Replace the Orama type imports in `src/schema/schema.ts:1-12` and `src/search-query.ts:1` with these. Keep re-exports from the barrels so consumer import paths don't change.
- `mode` and `sortBy` remain non-public (derived internally, as today). The README's mention of settable `mode: 'vector'` is already wrong vs the types — fix the README, don't widen the type.
- Type-level names on the generic plumbing (`SearchSchema<Table>`, `OramaType<T>` → `IndexFieldType<T>`, `orama_schema` → `index_schema` in `table.config`) get renamed in Phase 3 when the engine lands; Phase 1 only severs the *import* dependency.
- **The key renames land here, in Phase 1** (locked 2026-08-11 + 2026-08-12) — done first so the differential harness and golden vectors are written against final names. Legacy names stay readable at the decode/normalize boundary (bookmarked URLs keep working); encode emits only new names; a thin shim at the two remaining Orama call sites translates back until Phases 3–4 delete those call sites. Phase 1's changeset is **major**.

| Old | New | Notes |
|---|---|---|
| `distinctOn` | `distinct_on` | URL param was already `distinct_on` (`search-query.ts:95`) — the typed API catches up to the wire |
| `containsAll` (where op) | `contains_all` | changes the `where` JSON on the wire |
| `properties` | `fields` | Orama-ism; the package's vocabulary is fields (`searchable_fields`, `.searchable()`). URL param renames too |
| `vector.property` | `vector.field` | same vocabulary fix, inside the `vector` JSON param |
| `order[].key` | `order[].field` | `key` reads like "primary key"; inside the `order` JSON param |
| `nin` (where op) | `not_in` | MongoDB-ism, cryptic next to snake_case keys |
| `q` | *dropped from typed API* | survives only as a URL-decode alias for `term` |
| `tolerance` | *kept* | deliberately unchanged (decision 2026-08-12) |
- `encodeSearchQuery`/`decodeSearchQuery` and the URL wire format are otherwise untouched forever — they're engine-neutral already (encode emits the new names; decode reads both).

Acceptance: `@orama/orama` appears in exactly two files after Phase 1 (`db.server.ts`, `database.worker.ts`), and the package's `.d.ts` output contains no orama imports.

---

## 7. Storage and drivers

### 7.0 One sparse projection to rule them all (prerequisite for parity)

Today the server indexes `table.toSparse(entity)` + `computeFkDerivedFields`, while the client worker re-derives its own projection (`#projectToIndex`, `database.worker.ts:1063-1121`) — dropping vectors, geopoints, and type-mismatched values. **This fork must close or engine parity is meaningless.**

Rule: the server computes the sparse doc once per write; that exact object is (a) what the server indexes, (b) what the sync protocol ships, (c) what the client indexes **verbatim**. Delete `#projectToIndex`; the client trusts the wire. (Client-originated optimistic writes index their local `toSparse` result and are corrected when the server echo arrives — same as entity state today.)

**FK-derived fields are part of the sparse doc — and must be persisted (locked decision).** The sparse doc = `table.toSparse(entity)` + `computeFkDerivedFields`. Derived fields have *no SQLite column* today (schema.ts skips them in `table_definition`; they exist only inside Orama), so their computed values are written into the entity row's `json` overflow column under a reserved `$derived` sub-object — at entity-write time and at cascade time (§7.2b). JSON path for extraction: `json_extract(json, '$."$derived".author_name')` (the `$`-prefixed key needs quoting). The `$derived` sub-object is stripped when parsing rows back into entities, so it never leaks into app-visible entity data. This persistence is what lets the SQL compiler filter/sort derived fields (§7.4 rule 4), lets the rewritten sync (§7.5) ship them with zero recomputation, and keeps `rebuildSearchTables` a pure function of the entity tables.

**One carve-out: vector fields are stripped from the synced projection.** Vector search is server-only (§4.9), so the client never needs embeddings — and they're by far the heaviest fields in a sparse doc (a 768-dim vector ≈ the size of dozens of text fields). The server indexes the full sparse doc; sync ships and the client indexes *sparse doc minus vector fields*. "Verbatim" means verbatim-after-this-strip, applied server-side in one place so the client still never re-projects. Note the strip is **client-observable**, not just an optimization: today sync ships the Orama doc with vectors included, so app code could technically read `entity.embedding` off a synced entity. Call it out in the Phase 4 changeset.

### 7.1 Server tables (DDL)

All tables `WITHOUT ROWID`, created alongside the existing bootstrap DDL (`db.server.ts:412-428` area). Everything written **in the same SQLite transaction as the entity row** — this is the entire point.

```sql
CREATE TABLE IF NOT EXISTS search_postings (
	entity_type TEXT NOT NULL,
	field       TEXT NOT NULL,   -- dot-path, e.g. 'title' or 'address.city'
	token       TEXT NOT NULL,
	doc_id      TEXT NOT NULL,   -- String(primary key), as getDocumentIndexId does today
	tf          INTEGER NOT NULL,
	PRIMARY KEY (entity_type, field, token, doc_id)
) WITHOUT ROWID;
-- PK is the covering index for the only read pattern: (type, field, token[, prefix-range]) → (doc_id, tf)

CREATE TABLE IF NOT EXISTS search_tokens (
	entity_type TEXT NOT NULL,
	field       TEXT NOT NULL,
	token       TEXT NOT NULL,
	df          INTEGER NOT NULL,          -- docs containing token in field
	PRIMARY KEY (entity_type, field, token)
) WITHOUT ROWID;
-- the term dictionary: prefix scans, fuzzy scans, idf. Small (distinct tokens, not occurrences).

CREATE TABLE IF NOT EXISTS search_docs (
	entity_type TEXT NOT NULL,
	doc_id      TEXT NOT NULL,
	lengths     TEXT NOT NULL,             -- JSON { field_path: token_count } for BM25 norms
	PRIMARY KEY (entity_type, doc_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS search_field_stats (
	entity_type TEXT NOT NULL,
	field       TEXT NOT NULL,
	doc_count   INTEGER NOT NULL,          -- N(field)
	total_len   INTEGER NOT NULL,          -- Σ lengths → avgLen
	PRIMARY KEY (entity_type, field)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS search_vectors (
	entity_type TEXT NOT NULL,
	field       TEXT NOT NULL,
	doc_id      TEXT NOT NULL,
	vec         BLOB NOT NULL,             -- unit-normalized Float32Array bytes, little-endian (§4.9)
	                                       -- v1.5 adds: qvec BLOB (1-bit sign-quantized, dims/8 bytes) for the Hamming prefilter
	PRIMARY KEY (entity_type, field, doc_id)
) WITHOUT ROWID;
```

```sql
CREATE TABLE IF NOT EXISTS search_tombstones (
	entity_type TEXT NOT NULL,
	doc_id      TEXT NOT NULL,
	deleted_at  INTEGER NOT NULL,
	PRIMARY KEY (entity_type, doc_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS search_tombstones_by_time ON search_tombstones (entity_type, deleted_at);
-- the sync deletion feed (§7.5). Today deletions live in search_index.deleted_entity — a JSON
-- map on the row this plan deletes. Retention = today's policy verbatim (pruneTombstones,
-- db.server.ts:2314): past 10k tombstones per type, delete the oldest half (by deleted_at)
-- and bump config_version → affected clients full-resync, same path as schema changes.

CREATE TABLE IF NOT EXISTS search_state (
	entity_type      TEXT NOT NULL,
	config_version   INTEGER NOT NULL,
	first_updated_at INTEGER NOT NULL,
	last_updated_at  INTEGER NOT NULL,
	PRIMARY KEY (entity_type)
) WITHOUT ROWID;
-- replaces the per-index metadata currently stored on the search_index row (db.server.ts:1909-1911):
-- config_version drives client resyncs, first/last_updated_at are the sync window bounds, and
-- last_updated_at feeds ensureMonotonicTimestamp (strictly-increasing write timestamps,
-- db.server.ts:2333). All maintained inside the entity write transaction.
```

`search_index` and `search_journal` (and their row types, chunking, msgpack, compaction, replay, `invalidateIndexes`) are **dropped** at the end of Phase 3 — *after* their contents migrate: `deleted_entity` → `search_tombstones`, `config_version`/`first_updated_at`/`last_updated_at` → `search_state` (§9 Phase 3).

### 7.2 Server write path

On entity upsert (inside the existing write transaction, after the entity row):

1. Compute the sparse doc (§7.0 — `toSparse` + FK-derived fields, persisting the derived values into the row's `json` `$derived` sub-object in this same transaction) and tokenize each searchable text field (`core/tokenizer.ts`), producing `{ field → Map<token, tf> }` and `{ field → length }`.
2. Remove the doc's old postings **and capture which tokens were removed** — `df`/field-stat decrements are impossible without the old token set, so the delete must never be blind. Update branch: the previous entity is already in hand (`current_data`, `db.server.ts` update branch ~`:1607`) but the previous *sparse doc* is not — compute it explicitly via `table.toSparse(current_data)` and tokenize it to get the old token set (cheap; same code path as step 1). Create branch: no previous state exists, skip this step. Fallback (previous doc unavailable, e.g. repair paths): `DELETE FROM search_postings WHERE entity_type=? AND doc_id=? RETURNING field, token, tf` via the `(entity_type, doc_id)` secondary index — `RETURNING` is supported in DO SQLite and yields the token set for the `df` decrements *plus* the `tf` values whose per-field sums are the old lengths needed for the field-stat decrements (equivalently: read `search_docs.lengths` before deleting that row — `field, token` alone is not enough to fix the stats). Then decrement `df` per removed token (delete `search_tokens` rows reaching 0) and decrement field stats.
3. Insert new postings, upsert `df` (+1 per newly-present token/doc pair), upsert `lengths`, bump field stats. **Batching:** DO SQLite caps bound parameters at 100 per query and statements at 100KB — batch multi-row `INSERT`s at ≤20 rows per statement (5 columns each).
4. Vector fields: L2-normalize (reject zero vectors with `DelightError.badRequest`, §4.9), replace `search_vectors` rows.

Delete path: step 2 + drop `search_docs`/`search_vectors` rows. Rollback safety is free — it's all one SQLite transaction with the entity write. Cost per write: tens of small indexed row operations; benchmark target < 5ms for a typical doc (§8.3).

Add the secondary index for the delete path:

```sql
CREATE INDEX IF NOT EXISTS search_postings_by_doc ON search_postings (entity_type, doc_id);
```

### 7.2b FK-derived cascade (ported, not deleted)

`cascadeReindexReferencing` (`db.server.ts:2343`) is a *feature* this plan must port, not an Orama workaround it deletes: when entity B changes, every row in other tables whose FK-derived fields depend on B (via the reverse FK map) must be re-derived and re-indexed. The ported cascade, per dependent row, inside the same write transaction:

1. Recompute the sparse doc (`toSparse` + derived, with the memoized ref cache) and persist the new derived values into the row's `json` `$derived` sub-object.
2. Bump the row's `updated_at` via the monotonic allocator (`search_state.last_updated_at`) so sync ships the change — semantics unchanged from today (`db.server.ts:2384-2397`).
3. Run the §7.2 postings update for the row (the old-token diff comes from the row's previous sparse state, same as any update).

The fan-out is unbounded (`SELECT * FROM dep WHERE fk = ?`, no LIMIT) — true today too, but each dependent now costs a postings rewrite instead of an in-memory Orama update, so §8.3 gains a cascade benchmark. If a hot FK target ever makes it visible, splitting the cascade across batched follow-up transactions is the escape valve (the per-row work is idempotent), at the cost of a brief window where dependents' derived fields lag — take it only if the benchmark forces it.

### 7.3 Server term-dictionary cache

Per (entity_type, field), lazily load the token list from `search_tokens` into a sorted in-memory array on first search touching that field; invalidate incrementally on write (insert/remove in sorted position) — this keeps prefix expansion (binary search + range walk) and fuzzy scans (§4.3) purely in-memory while postings stay on disk. Dictionaries are the *small* part of an index; if one ever exceeds a sanity bound (say 200k tokens), fall back to SQL range queries `token >= ? AND token < ?` with the upper bound computed in JS by incrementing the prefix's last code point — skipping the surrogate block: U+D7FF increments to U+E000, never U+D800 (a lone surrogate gets mangled at the JS→UTF-8 boundary, and U+D7FF is a Hangul letter, so it *is* reachable in real tokens). Do **not** concatenate a blob sentinel like `prefix||x'F7BFBFBF'` instead — TEXT‖BLOB yields a BLOB in SQLite, and all TEXT sorts before all BLOB, so that range is silently wrong. Cache lives on the `SearchIndex`-equivalent struct; dropped when the DO evicts — rebuilt lazily, no correctness impact.

### 7.4 SQL filter/sort compilation (child keys included)

Entities already live in SQLite. `where` + `order` + pagination compile to SQL over the entity table; the postings tables are touched only when a `term`/`vector` is present. Since both the client `DatabaseSearch` default and server `list` default are `term: '', order: updated_at DESC`, **the dominant query becomes a single indexed SQL query** — this alone removes most observed latency.

**Where values actually live (important — there is no `data` column):** entity tables store every top-level *scalar* field as a real SQLite column; non-scalars (objects, arrays, vectors, geopoints) go into the internal overflow column named **`json`** (`schema.ts:2925-2935`, `db.server.ts:490`). The compiler therefore has a four-way split:

1. Top-level scalar → real column exists; compile directly against it, no generated column.
2. Child path into an object (e.g. `address.city`) → the object lives in `json`; VIRTUAL generated column over `json_extract(json, ...)`.
3. Array field → lives in `json`; `json_each` predicate (below), no generated column in v1.
4. FK-derived field → persisted in the `$derived` sub-object of `json` (§7.0, locked decision) → VIRTUAL generated column over `json_extract(json, '$."$derived".field')`, exactly like rule 2. Without the persistence decision these fields would be *uncompilable* — they exist in no column and no JSON path.

**Child-key paths → VIRTUAL generated columns.** For every declared filterable/sortable child path (the closed set from the schema — `sortable_fields` + searchable scalars):

```sql
ALTER TABLE "<entity_table>" ADD COLUMN "sv$address__city" TEXT
	GENERATED ALWAYS AS (json_extract(json, '$.address.city')) VIRTUAL;
CREATE INDEX IF NOT EXISTS "idx_<entity>_address__city" ON "<entity_table>" ("sv$address__city");
```

Rationale (from design discussion, keep these):
- `ALTER TABLE ADD COLUMN` works for VIRTUAL generated columns (NOT for STORED) → adding a sortable field later is cheap DDL, no table rewrite.
- An index on a VIRTUAL column materializes the computed values *in the index* → query perf equals a real column, zero row-write amplification.
- Naming: `sv$` prefix + path with `.` → `__` avoids identifier-quoting hazards and collisions with real columns.
- Migration when the declared path set changes: diff `PRAGMA table_info` against the schema at DO bootstrap (allowed in DO SQLite), `ADD COLUMN` + `CREATE INDEX` for new paths, `DROP INDEX` **then** `DROP COLUMN` for removed ones (an indexed column can't be dropped).
- **Column budget:** DO SQLite caps tables at **100 columns** (vs stock SQLite's 2000). Real field columns + `json` + `sv$` generated columns all share that budget. At DO bootstrap, count declared columns + generated columns (child paths, persisted-derived paths, and the lat/lon pair per geopoint field — §5.1) and throw a descriptive `DelightError` if the total would exceed 100 — fail loudly at migration time, not with an opaque SQLite error mid-DDL.

**`updated_at` gets an index — it's the dominant path.** `updated_at` is reserved/auto-managed (the schema rejects user fields with that name), so no user-declared index can exist on it, and today nothing needs one (Orama sorts in memory). After this plan, the default query (`order: updated_at DESC`) *and* the rewritten sync paging (§7.5) both hit the entity table directly — create `CREATE INDEX IF NOT EXISTS "idx_<entity>_updated_at" ON "<entity_table>" (updated_at, <pk>)` per entity table at bootstrap. Without it, the dominant query is a full scan + sort and the <5ms filter+sort target (§8.3) is unreachable at 100k rows.

**Compiler rules (`server/sql_where.ts`):**
- Boolean paths: compare against `0/1` (json_extract convention).
- `not`: emit `(col IS NULL OR NOT (...))` per the frozen null rule (§5).
- Order: `ORDER BY (col IS NULL), col ASC|DESC, pk ASC` (nulls-last, PK tie-break).
- String comparisons: BINARY collation (default) = code-point order = the core comparator. Do not set any collation.
- Array-field predicates (`contains_all`/`in`/`eq`-on-array): `EXISTS (SELECT 1 FROM json_each(json_extract(json,'$.path')) WHERE json_each.value = ?)` composed per element (`json_each` is on the DO SQLite function allowlist). No index in v1; add a `search_values(entity_type, field, doc_id, value)` side table later only if a hot array filter demands it (note the IDB `multiEntry` symmetry, §7.6).
- Geo predicates: bbox prefilter over the `sv$<field>__lat`/`__lon` columns, exact check via `core/geo` (§5.1) — the SQL side never decides geo membership.

### 7.5 Server search pipeline (`server/engine.ts`, synchronous)

```
list(entity_type, query):
	normalize where (core/where) · validate order[].field / fields → DelightError.badRequest
	if no term, no vector, no facets, no distinct_on:
		SQL: SELECT ids (or full rows) WHERE <compiled> ORDER BY <compiled> LIMIT/OFFSET
		     + companion SELECT COUNT(*) with the same WHERE (results.count)  → done
	else if no term and no vector:            -- facets and/or distinct_on present
		SQL: fetch the FULL matched id set (+ facet/distinct field values), ordered;
		     facets via core/facets, distinct_on + count in JS — the §3 contract puts
		     every user-visible count in core/, so facets NEVER compile to GROUP BY
	else:
		candidate_ids = where ? SQL id-set : null   -- convert to String(pk) at this boundary; postings doc_ids are always String(pk)
		text: for each query token (sorted): expand via dictionary cache (prefix ∪ tolerance);
		      fetch postings per matched token; accumulate BM25 into Map<doc_id, score>
		      (skip docs ∉ candidate_ids when the SQL set is smaller; otherwise filter after)
		vector: brute-force dot product over unit vectors in search_vectors (∩ candidates); qvec prefilter when enabled (§4.9)
		hybrid: fuse (core/fusion)
		apply threshold (§4.5) · order (core/compare — by order[] if given, else score) ·
		distinct_on · facets (core/facets, pre-limit) · cursor/limit/offset · hydrate docs
```

Ghost-document filtering, null-array stripping, and the Orama error remap all cease to exist. `getIndex`/`rebuildIndex`/`saveIndex`/journal functions are deleted; a `rebuildSearchTables(entity_type)` full-scan (entity table → write path per row, batched transactions) replaces `rebuildIndex` as the migration/repair path.

**Sync pagination divorce (do this in the same phase):** the sync path currently pages via `searchOrama` (`db.server.ts:1035`, `:1085`) — the source of the >1000-doc deferred-removal data-loss class. Rewrite sync paging as direct SQL over the entity table (`updated_at` + PK tie-order, using the §7.4 `updated_at` index), preserving the half-open window semantics and grow-and-retry equal-timestamp handling documented in `db.server.sync.test.ts`. The index struct being deleted currently carries four things sync depends on — each gets a new home: **deletions** come from `search_tombstones` (merged into the change timeline exactly as `index.deleted_entity` is today, same retention/prune/config-bump policy); **window bounds** (`first_updated_at`/`last_updated_at`) and **`config_version`** come from `search_state`; **monotonic write timestamps** (`ensureMonotonicTimestamp`, `db.server.ts:2333`) read/advance `search_state.last_updated_at` in-transaction. Synced docs are `toSparse(row)` — derived fields included for free because they're persisted in `json` (§7.0) — minus vector fields (§7.0 strip). Sync becomes engine-independent forever.

### 7.6 Client: IDB postings store (`client/idb_store.ts` + `client/engine.ts`, async)

**Decision:** real IDB-backed postings (not in-memory rebuild). Removes the memory ceiling and the load-time rebuild; windows may exceed 5000 docs.

Object stores (in the existing client DB alongside `sync_meta`; the `search_index` blob store is deleted):

| Store | Key | Value | Notes |
|---|---|---|---|
| `postings` | `[entity_type, field, token, doc_id]` | `tf` | prefix scan = `IDBKeyRange.bound([t,f,prefix], [t,f,prefix+'￿'])` — IDB stores are sorted B-trees, same range-scan as SQLite |
| `tokens` | `[entity_type, field, token]` | `df` | dictionary; loaded per (type,field) into a sorted in-memory array on first use, incrementally maintained (mirror of §7.3) |
| `docs` | `[entity_type, doc_id]` | `{ sparse_doc, lengths }` | the server sparse doc, vector fields already stripped server-side (§7.0) — also serves filter/sort. No vector store exists on the client (§4.9) |
| `field_stats` | `[entity_type, field]` | `{ doc_count, total_len }` | |

**Filter/sort on the client:** declare IDB indexes on the `docs` store for each sortable/filterable **string/number** path (`keyPath: 'sparse_doc.address.city'`), with `multiEntry: true` for array fields (native array-containment — the exact analogue of the SQL side table). Boolean paths get no index — booleans aren't valid IDB keys (see gotchas below). Index definitions happen in `onupgradeneeded`; derive the IDB version from the existing `config_version` so a schema change triggers index re-creation + full local rebuild through the machinery that already exists for config bumps.

**IDB gotchas (encode as review checklist for the implementing agent):**
- A transaction auto-commits the moment you `await` any non-IDB promise inside it. Structure each write as: open ONE readwrite transaction; read the old doc *inside it*; tokenize/diff/compute df deltas synchronously in the request callback (synchronous compute doesn't auto-commit); then issue all writes — never interleaving foreign awaits. The old-doc read must NOT happen in an earlier separate transaction: production is a SharedWorker (single writer), but dev and non-SharedWorker browsers fall back to per-tab `Worker`s (`database.worker.init.ts:18-26`) sharing one IDB, and a read-then-reopen gap lets two tabs interleave and silently corrupt `df`/field stats. IDB serializes overlapping readwrite transactions — lean on that.
- Booleans and `null` are **not valid IDB keys**: an index over a boolean path indexes nothing (records with invalid keys are silently omitted from the index), and a doc missing the keyPath is absent from that index entirely. Index-driven candidate extraction is therefore valid only for *positive* predicates on string/number paths; boolean filters, `not_in`, and `not` (where missing-field docs must match, §5) evaluate as `core/where` predicates over the window's docs (or as complements against the full `docs` store) — never via an index.
- Index writes go **in the same transaction** as `sync_meta` updates (preserving today's invariant that the synced window can never outrun the persisted index — `#persistSyncState`'s property, `database.worker.ts:1193-1240`).
- Prefer `getAll(range)` over cursor iteration (order-of-magnitude fewer event-loop round-trips). Batch per-token posting fetches with `Promise.all` inside one readonly transaction.
- Safari IDB is slower and quirkier; keep per-query IDB round-trips bounded (dictionary cache means token expansion is memory-only; only postings/docs hit IDB).
- Comparator caution: IDB key sort ≠ core comparator for edge cases (IDB sorts by type ordering, code-unit strings). Any user-visible ordering must be re-sorted by `core/compare.ts` after fetch — IDB indexes are used for *candidate range extraction*, not final order **[exception: verify whether IDB's string key order diverges from code-point order for astral chars; if it does — it does, IDB uses code-unit order — range-scan then re-sort]**.

**The async driver** mirrors §7.5's pipeline shape with awaits at storage boundaries. All semantics via `core/*`. Storage interface (client-only; the server driver's sync interface deviates freely per the locked decision):

```ts
interface AsyncSearchStore {
	getTokenDictionary(entity_type: string, field: string): Promise<SortedTokens>; // then cached
	getPostings(entity_type: string, field: string, tokens: string[]): Promise<Map<string, Posting[]>>;
	getDocs(entity_type: string, doc_ids: string[]): Promise<Map<string, SparseDocRow>>;
	getFieldStats(entity_type: string, field: string): Promise<FieldStats>;
	applyWrites(txn_docs: DocWrite[]): Promise<void>; // one IDB txn incl. sync_meta
}
```

**Client/server choice policy:** the 5000-doc auto-switch (`database.worker.ts:415`, `#switchToServerMode`) loses its original justification (memory). Two rules, in order: **(1) any query carrying `vector` — including hybrid — routes to the server unconditionally** (vectors don't exist on the client, §4.9); (2) otherwise, replace count-based switching with a **coverage-based** rule: client search is used when the entity type's synced window is complete (full-table sync) or the query is explicitly marked client-side; otherwise route to the server, which has the full corpus and correct global BM25 stats. Keep the existing threshold config as an override valve for one release, then remove. Document loudly: *identical results are guaranteed only when the corpora match; window ⊂ corpus ⇒ the server answer is the authoritative one.*

**Worker deletions:** orama imports, `#projectToIndex`, the `removeMultiple` batch-size workaround, the `insertMultiple` fallback, ghost filtering, `saveOrama`/`loadOrama` and the doubling persist schedule (index persistence is now continuous and transactional).

---

## 8. Testing strategy — this is the consistency guarantee, not garnish

### 8.1 Differential harness (vs Orama, Phase 2 gate)

A test-only harness that runs the same corpus + query battery through real Orama 3.1.18 and the new core (memory-backed store):

- Corpora: seeded deterministic generators — realistic strings (names, emails, sentences with shared vocabulary), numbers, booleans, enums, arrays, nested objects, vectors; sizes 10 / 1k / 20k docs; plus a dump of a real dev corpus if available.
- Query battery: every operator × type × edge case; term queries hitting prefix/tolerance/threshold/boost/fields/exact combinations; facets; distinct_on; geo (`radius`/`polygon` × `inside` both ways, boundary docs — compare against Orama run with `highPrecision: true`, since we are always-precise; §5.1); vector + hybrid (server/memory reference only — vector deviations from Orama are deliberate per §4.9: dot product over unit vectors, zero-vector rejection; the harness checks rank-order agreement, not parity).
- The battery is written in the new DSL; a small shim translates keys for the Orama side (`distinct_on`→`distinctOn`, `contains_all`→`containsAll`, `not_in`→`nin`, `fields`→`properties`, `vector.field`→`vector.property`, `order[].field`→`order[].key`).
- Assertions: **exact** membership/count/facet parity for filter-only queries; **rank-order** parity (Kendall-tau ≥ threshold + identical top-10 membership) for scored text queries (score values exempt); every `[verify-vs-orama]` marker in §4–5 resolved and the spec updated to record what Orama actually does and what we chose.
- Known Orama bugs are excluded from parity (ghost docs, null arrays, deferred removals) — the harness runs Orama with the same guards production code uses today.

### 8.2 Golden vectors (permanent, both drivers)

A single JSON fixture set (`search/__tests__/golden/`) of `{ corpus, query, expected_ids_in_order, expected_counts, expected_facets }`, generated once from the memory reference implementation and hand-audited. The **same fixtures** run against: core+memory store (vitest), server driver over real DO SQLite (existing `db.server.*.test.ts` infra / miniflare), client driver over real IDB (fake-indexeddb in vitest + real-browser passes in Chrome **and at least one non-V8 engine** — Safari or Firefox — the pass that would catch engine-varying math if the deterministic-`ln` rule (§3) is ever violated). Byte-identical output required. Exception: vector/hybrid fixtures run against the memory reference and server driver only (no client vector path exists, §4.9); a routing test asserts the worker sends any `vector` query to the server. Mandatory edge coverage: astral-plane string ordering, null vs absent, empty string/array, boolean coercion through `json_extract`, `not` with missing fields, equal-score PK tie-breaks, equal `updated_at` ordering, tolerance boundary lengths, email tokenization, geo boundary/vertex/missing-geopoint cases (§5.1). At least one corpus must use an **integer primary key** (`primary_key_type: 'number'`) — postings store `doc_id` as `String(pk)` while tie-breaks compare as the declared PK type, so integer-PK ordering (`2 < 10`, not `'10' < '2'`) must be exercised end-to-end.

### 8.3 Performance benchmarks (regression-gated)

Targets on a dev machine (document actuals; the point is trend, not the absolute number): server single-doc index write < 5ms at 100k-doc corpus; FK-derived cascade < 1ms per dependent row measured at 100 dependents (§7.2b); server text search (2 tokens, tolerance 1) < 30ms at 100k docs; filter+sort-only < 5ms at 100k docs; client search < 50ms at 20k-doc window (Chrome); DO cold-start added search cost = 0 (assert no search table reads on boot). Compare against Orama baselines captured before the switch, including the 10s serialize being eliminated.

---

## 9. Rollout phases

Each phase lands independently and is releasable. **Never auto-commit; Brian reviews everything.**

**Phase 1 — Type decoupling + snake_case renames** (small, do anytime)
Own the public types (§6) and land the breaking key renames (full table in §6: `distinct_on`, `contains_all`, `fields`, `vector.field`, `order[].field`, `not_in`, `q` dropped from the typed API) with legacy read aliases and the Orama-translation shim at the two call sites. Fix the `threshold` docstring while the types move (§4.5 — it currently describes semantics the key doesn't have). Acceptance: no orama imports outside `db.server.ts` / `database.worker.ts`; `.d.ts` output orama-free; existing tests green, updated only for renamed keys. Changeset: **major**.

**Phase 2 — Core engine + memory store + harnesses**
`core/*` complete per §4–5; memory-backed reference store; differential harness green with all `[verify-vs-orama]` markers resolved and the spec frozen; golden vectors generated. No production code path touched yet.

**Phase 3 — Server driver**
Tables (§7.1), write path in-transaction (§7.2), FK-derived cascade port + `$derived` persistence (§7.2b, §7.0), dictionary cache (§7.3), SQL compiler + generated-column migration incl. the `updated_at` index (§7.4), sync-pagination divorce over the tombstone/state tables (§7.5). The cut-over migration moves per-index state before dropping it: `search_index.deleted_entity` → `search_tombstones`, `config_version`/`first_updated_at`/`last_updated_at` → `search_state`. Gated by per-table flag `search_engine: 'native' | 'orama'` (default `'orama'`) in table config; on first native wake, `rebuildSearchTables` populates from the entity scan (reuse the in-flight-rebuild re-entrancy guard pattern). Bump `config_version` on switch so clients resync cleanly. Keep the orama path compiling for one release as fallback; then delete `getIndex`/`saveIndex`/journal/`search_index`/`search_journal` and Appendix-A workarounds ①–⑧.

**Phase 4 — Client driver**
Unified sparse projection with vector strip (§7.0) — requires Phase 3 server shipping sparse docs verbatim-minus-vectors; IDB stores + async driver (§7.6); config_version-driven IDB upgrade + full local rebuild on switch; routing policy (vector→server unconditional, then coverage-based). No client vector/fusion code — that whole subsystem is server-only (§4.9). Delete worker orama code and Appendix-A ⑨–⑫. Real-browser golden passes required (Chrome + one non-V8 engine, §8.2). Changeset note: synced entities stop exposing vector fields on the client (§7.0 strip — today they arrive inside the Orama doc, so apps could technically read them).

**Phase v1.5 (optional, any time after Phase 3) — Quantized vector prefilter**
`qvec` column + Hamming prefilter + rescore per §4.9, behind a per-table flag. Trigger: a table's vector count makes brute-force latency visible in the §8.3 benchmarks. Not a blocker for anything else. (If a table someday outgrows even this: IVF in-DO per §2 non-goals — centroids as tokens, cluster postings rows. HNSW and Vectorize stay rejected.)

**Phase 5 — Excision**
Remove `@orama/orama` from `dependencies` — the differential harness (§8.1) retires with it (its job ended when the spec froze in Phase 2; golden vectors are the permanent guard). Move orama to `devDependencies` only if keeping the harness runnable for fixture regeneration is worth it; otherwise delete the harness too. Legacy `search_index`/`search_journal` table drop migration; README/SKILL.md/agent-docs updates; delete obsolete memory entries (orama-ghost-documents, the null-array-props note) and add a native-search memory. Changeset: minor (the breaking renames already shipped in Phase 1), with a migration note that server search tables rebuild automatically on first wake per table.

**Effort (calibration, not commitment):** core+spec+harness ≈ 2–3k lines incl. tests; server driver ≈ 1–1.5k; client driver ≈ 1–1.5k; net LOC change near zero after deletions. The expensive part is resolving the `[verify-vs-orama]` markers and the golden edge cases — budget as much time for §8 as for the engine.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Orama where-DSL quirks consumers accidentally depend on | Differential harness before any production cut-over; deviations documented + changelogged |
| SQL vs JS semantic drift (collation, NULLs, bool coercion) | Single frozen spec (§4.6, §5) + golden vectors on all three storage backends; comparator matches SQLite, never vice versa |
| Fuzzy/threshold behavior underdocumented in Orama | `[verify-vs-orama]` markers force reading Orama source / empirical tests before freezing |
| IDB transaction auto-commit corrupting index/sync atomicity | Pure-compute-then-single-transaction write structure (§7.6 checklist); invariant test that sync_meta and postings commit together |
| Generated-column migration on live DOs | VIRTUAL columns = cheap DDL; diff-based bootstrap migration; `rebuildSearchTables` as universal repair |
| DO SQLite 100-column cap: wide schema + many `sv$` columns overflows the table | Bootstrap budget check throws a descriptive `DelightError` before any DDL (§7.4); escape valve: trim declared sortable/filterable paths |
| Concurrent journal work (in flight now) conflicts | Journal is additive to the orama path only; Phase 3 deletes it wholesale — coordinate timing, don't rebase around it |
| BM25 stats divergence on partial client windows | Not fixable by design — coverage-based mode policy + explicit documentation (§7.6) |
| FK cascade fan-out: a hot FK target → many dependent postings rewrites in one transaction | Same fan-out exists today (in-memory Orama updates); §8.3 cascade benchmark; batched-transaction escape valve (§7.2b) |
| Tombstone pruning outruns slow clients | Same policy as today: prune oldest half → `config_version` bump → full resync (§7.1) |
| Cross-engine float divergence (Safari/Firefox clients vs V8 server) | The only transcendental is BM25's `ln` → in-house deterministic `ln` (§3); non-V8 golden pass (§8.2) |

## Appendix A — Orama workaround inventory (deleted by this plan)

Server: ① ghost-document filters (`db.server.ts:1325-1358`, `:1053-1056`) ② null-array stripping ×4 (`toSparse`, snapshot load, journal encode/decode) ③ msgpack chunked snapshot + journal + replay + compaction (`:2044-2196+`) ④ config-comparison function-drop bug (`:1832-1842`) ⑤ rollback `invalidateIndexes` (`:2161-2173`) ⑥ orama-error→400 remap (`:1315-1323`) ⑦ sync paging via orama incl. >1000-doc deferred-removal fix ⑧ re-entrant rebuild guard (`:1975-1984`).
Client: ⑨ `removeMultiple` batchSize fix (`database.worker.ts:356-397`) ⑩ `insertMultiple` mid-page-throw fallback (`:400-408`) ⑪ `#projectToIndex` type-guarding (`:1055-1121`) ⑫ ghost filter (`:861-877`).

**Deliberately absent from this list:** `cascadeReindexReferencing` (`db.server.ts:2343`) — the FK-derived cascade is a *feature*, ported by §7.2b, not an Orama workaround to delete.

## Appendix B — Open questions (answer before or during Phase 2)

1. Email tokenization scope: uniform on all string fields (planned) vs opt-in per field? Uniform is simpler; cost is a few extra tokens per email-shaped value.
2. Facet parity depth: are number-range and boolean facets actually used by any consumer, or only string facets? Trim scope if unused.
3. Is there a real offline-first product driving large client windows? It shaped the IDB-postings decision (already locked yes); it should also shape the default coverage policy (§7.6).
4. `similarity` threshold for vector mode: is it reachable through today's public `SearchQuery`? Preserve exactly what the wire accepts.
5. ~~Geosearch~~ — resolved 2026-08-12: keep both `radius` and `polygon` (§5.1). Polygon is ~20 lines of ray casting; no rectangle compromise needed.
6. Fractional `threshold` (0 < t < 1): does any consumer send one? (§4.5 — have the harness log it.) If unused, a future major can replace the float blend with `match: 'all' | 'any'` — out of scope for this plan.
