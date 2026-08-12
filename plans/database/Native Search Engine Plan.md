# Native Search Engine Plan

Replace Orama in `@delightstack/database` with a purpose-built, isomorphic search/filter/sort engine: a shared pure core with two storage drivers — synchronous DO-SQLite postings on the server, asynchronous IndexedDB postings on the client.

**Status:** Phases 1–2 implemented (working tree, pending review) as of 2026-08-12. Phase 1 (owned types + snake_case renames) and Phase 2 (`search/core/*`, the memory reference engine and store, the differential harness, and the golden-vector suite) are in `packages/database/src/search/`. Every `[verify-vs-orama]` marker below is resolved against `plans/database/orama-verification-report.md` and the spec is frozen. Phases 3–5 not started.
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
- **Query-key renames are approved breaking changes** (2026-08-11, extended 2026-08-12 — full table in §6): snake_case (`distinctOn` → `distinct_on`, `containsAll` → `contains_all`) and vocabulary (`properties` → `fields`, `vector.property` → `vector.field`, `order[].key` → `order[].field` — the package's own vocabulary is *fields*: `searchable_fields`, `.searchable()`; plus `nin` → `not_in`). `q` leaves the API entirely. `tolerance` is deliberately kept. Renames land in **Phase 1** (so harness + golden fixtures are written against final names) with a thin translation shim at the two remaining Orama call sites. **Amended 2026-08-12: there are no legacy read aliases** — decode and normalize accept the new names only, and `q` is dead outright (it is not even a decode alias). Phase 1's changeset becomes **major**.
- **FK-derived field values are persisted into the entity row's `json` overflow column** (2026-08-11), under a reserved `$derived` sub-object, written at entity-write time and cascade time (§7.2b). Derived fields currently exist *only* inside the Orama index (no SQLite column — schema.ts skips them in `table_definition`), which would leave the SQL compiler (§7.4) and the sync rewrite (§7.5) with nothing to read. Persisting them makes both trivial and keeps `rebuildSearchTables` a pure function of the entity tables.
- **Sync deletion tombstones move to a real table** (`search_tombstones`, §7.1) with today's retention policy verbatim (cap 10k per type, prune oldest half, `config_version` bump → full resync). `config_version` / `first_updated_at` / `last_updated_at` move to a per-entity-type `search_state` row — today all of this lives on the `search_index` row this plan deletes.
- **Orama parity is required at the *principles* level only** (decided 2026-08-12) — never at the level of implementation, scores, ranking, or tokenization. Two binding constraints, and only these two: (1) **end users must not notice wildly different or wrong search/filter/sort results**; (2) **developers must not face burdensome migration for breaking changes that carry no benefit**. Wherever a deviation makes the engine better and violates neither constraint, deviate — and changelog it. This is the rule the four scoring deviations (§4.4), the tokenizer rules (§4.1), the array-filter widening (§5) and the `threshold` fixes (§4.5) all descend from.
- **No legacy-alias backward compatibility** (decided 2026-08-12, reversing the 2026-08-11 "legacy read aliases" clause): `decodeSearchQuery` reads only the canonical names and `normalizeWhere` only the canonical operators. `q`, `distinctOn`, `properties`, `vector.property`, `order[].key`, `containsAll`, `containsAny` and `nin` are simply gone — pre-rename bookmarked URLs and pre-rename cursors stop working. The changeset is already major, and an alias layer that must be carried forever is exactly the "burdensome for no benefit" trade running in the other direction.
- **`vector.similarity` is public API** (decided 2026-08-12): the vector-mode admission floor lives *inside* the vector object (`vector: { value, field, similarity? }`, default `0.8`, inclusive `>=`), so it rides in the existing `vector` JSON URL param for free. See §4.9.
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

1. Query-API compatible for consumers (`SearchQuery` shape, `where` DSL, `order[]`, facets, cursor, URL encoding all preserved) — except the deliberate breaking key renames locked 2026-08-11/12 (§6 table: `distinct_on`, `contains_all`, `fields`, `vector.field`, `order[].field`, `not_in`; `q` dropped from the typed API). Encode emits the new names and decode reads only the new names — there are no legacy read aliases (decided 2026-08-12).
2. Deterministic parity: same corpus + same query ⇒ byte-identical result *order and membership* on client and server — **for traditional search** (term/filter/sort/facets). Vector and hybrid queries are server-only and exempt.
3. O(changed-doc) write cost on both sides; zero cold-start index work on the server.
4. Feature parity: prefix search, tolerance (fuzzy), `exact`, `boost`, `fields`, `threshold`, `distinct_on`, facets, vector + hybrid mode (server-only), child-key filter/sort, array-field filters (`in`/`not_in`/`contains_all`), geosearch (`radius`/`polygon` on geopoint fields, §5.1).
5. Performance: index-write overhead per entity write in the low milliseconds; text search over 100k+ docs in low tens of milliseconds on the server.

**Non-goals**

- Score-*value* parity with Orama. Nothing consumes raw scores; only membership, order, and counts must match Orama closely enough to not surprise consumers (validated by the differential harness, §8.1).
- Embedding generation. Callers supply `number[]` vectors on write and query, exactly as today.
- Stemming, stopwords, language packs. Today's setup uses none (no Orama plugins exist in the repo); we replicate the default pipeline only. The tokenizer module should leave room for these later.
- **CJK bigram indexing** — explicitly rejected (decision Brian 2026-08-12): no Chinese/Japanese support is needed. CJK runs stay whole tokens (already strictly better than Orama, which indexes no CJK at all). See §4.1 step 12.
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

This section is the spec both drivers implement and the golden tests encode. **Every `[verify-vs-orama]` marker is resolved (2026-08-12)** against `plans/database/orama-verification-report.md`; the resolutions are inline below, and the report holds the source citations and empirical output. Deliberate deviations are called out as such and belong in the Phase 3/4 changesets.

### 4.1 Tokenizer

Input: a string field value. Output: ordered token list — **duplicates kept**, so `tf` is a real term frequency. *Deviation (report finding A):* Orama's tokenizer ends with `Array.from(new Set(...))`, which makes its `tokenFrequency` always 1 and its `tf` always `1 / distinct_token_count` — so repeating a word *raises* a document's score there. Keeping duplicates is the right engineering call but it changes ranking on any corpus with repeated terms; changelog it.

1. Unicode-normalize NFKD, strip combining marks (`\p{M}`) — folds diacritics (`café` → `cafe`).
2. Lowercase (`toLowerCase()`).
3. **Fold intra-word apostrophes, then split.** An apostrophe (`U+0027` or `U+2019`) is deleted when — and only when — its two immediate neighbours are both `\p{L}\p{N}`; the rule is evaluated per apostrophe character against the pre-fold string. So `john's` → `johns`, `it's` → `its`, `o'brien` → `obrien`, while a leading, trailing, isolated or **doubled** apostrophe stays an ordinary separator (`'quoted'` → `quoted`, `don''t` → `don` + `t` — in a run of two, each apostrophe's neighbour is the other, so neither qualifies). Then split on any run of characters not in `\p{L}\p{N}` (Unicode letters/digits); underscore and hyphen split (so `snake_case` yields `snake`, `case` and `well-known` yields two tokens). The query side runs the identical function.
   *Frozen 2026-08-12 (supersedes "apostrophes split"):* folding is the better rule on both constraints of the parity principle — splitting puts a junk `s` token on every possessive (inflating `df` for a token that means nothing) and makes `johns` unfindable as a word, whereas folding keeps `john` a prefix match for `johns` and makes the apostrophe-less query `obrien` an exact match. *Deliberate deviation (report §1):* Orama's English splitter is `/[^A-Za-zàèéìòóù0-9_'-]+/gim`, so `_`, `'` and `-` are **word characters** there (only ASCII `'`, never `’`) and every non-ASCII letter except six Italian accented vowels is a **separator** — which destroys CJK and Cyrillic entirely and mangles `ï/ü/ñ/ç`.
4. **Email handling** (matters for `from:` search): the pre-split pass runs **per whitespace-delimited chunk** of the raw value — not whole-value, so embedded emails in prose (`contact jane@x.com today`) count too. Any chunk matching a simple email shape (`local@domain`) additionally emits the whole normalized address as one token *plus* the split parts. E.g. `jane.doe@showandtour.com` → `jane.doe@showandtour.com`, `jane`, `doe`, `showandtour`, `com`. Applied uniformly to all string fields (no per-field config in v1). The query side runs the identical pass, so an email query becomes a multi-token union under the default `threshold: 1` — membership balloons (any doc sharing `com`) while the whole-address token dominates ranking. Same membership behavior as today's Orama splitter; the whole-address token is the only addition.
5. **Truncate** tokens longer than 64 chars to 64 chars, identically on the doc side and the query side — two tokens sharing their first 64 characters therefore collide on one indexed token, and an over-long query term still finds them. (Orama has no cap at all; the cap is ours. Frozen 2026-08-12 during Phase 2 — the implementation originally *dropped* over-long tokens, which made them unsearchable and made the fixture pair `edge_long_token` / `edge_long_token_twin` meaningless.)
6. **Strip format characters** (2026-08-12): every `\p{Cf}` (soft hyphen, ZWSP/ZWJ/ZWNJ, BOM, bidi controls) and Arabic tatweel `U+0640` folds to nothing, *before* chunking — so `data\u00ADbase` is the single token `database` and `مـــد` equals `مد`. Orama treats each as a separator.
7. **Widen the apostrophe fold set** (2026-08-12): `U+02BC` joins `U+0027`/`U+2019` under the same both-neighbours-`\p{L}\p{N}` rule, so `johnʼs` → `johns`. It is a `\p{L}`, so a *non*-intra-word `U+02BC` is demoted to an ordinary separator rather than being allowed to survive inside a token (and a doubled `ʼʼ` splits, exactly like `''`).
8. **camelCase boundary splitting, whole token retained** (2026-08-12): before lowercasing, split each letter/digit run at `\p{Ll}→\p{Lu}` and at the acronym boundary `\p{Lu}(?=\p{Lu}\p{Ll})`; emit the whole lowercased token *plus* the lowercased parts, and only when a boundary exists (`getUserData` → `getuserdata`, `get`, `user`, `data`; `HTTPServer` → `httpserver`, `http`, `server`; `hello` is emitted once). A digit followed by an uppercase letter is deliberately not a boundary.
9. **Acronym dot folding** (2026-08-12): a run of **single** letters separated by dots, optional trailing dot, folds to the concatenation — `U.S.A.` → `usa`, `e.g.` → `eg`, `U.S. Army` → `us` + `army`. The single-letter restriction plus the surrounding guards keep `example.com`, `3.14` and `u.s.army` untouched.
10. **Whole-token emission for number chunks** (2026-08-12): a whitespace chunk that is purely numeric with at least one internal `.`, `,` or `-` emits the whole chunk as a token as well as its digit runs (`3.14` → `3.14`, `3`, `14`; `1,000`; `2.5.1`; `555-1234`), mirroring the email rule. Letters disqualify the chunk (`v2.5`), and a separator is required so a plain `42` is emitted once.
11. **Frozen pipeline order** (2026-08-12) — encoded in a torture test in `tokenizer.test.ts`. Whole value: NFKD → strip `\p{M}` → strip `\p{Cf}`+tatweel → split on whitespace. Per chunk: camelCase scan (pre-lowercase) → lowercase → acronym dot fold → apostrophe fold (+`ʼ` demotion) → whole-chunk emission (email, else number) → split on `[^\p{L}\p{N}]+` → truncate to 64 → emit the camelCase parts. Acronym folding precedes the apostrophe fold so `U.S.A.'s` → `usas` rather than stranding a lone `s`; both precede the email test so detection sees the folded form (`O'Brien@x.com` → `obrien@x.com`). Every whole-chunk token is still subject to the 64-char cap (an over-long *address* is skipped rather than truncated — a truncated address is a different, fake address; an over-long *number* truncates like any other token).
12. **CJK bigram indexing: explicitly rejected** (decision Brian 2026-08-12). No Chinese/Japanese support is needed. CJK runs stay whole tokens, which is already strictly better than Orama (which indexes no CJK at all); bigram indexing would multiply postings size and change ranking for zero current benefit. Revisit only if a CJK corpus appears.
13. No stemming, no stopwords (matches current behavior).
14. A term that tokenizes to **nothing** (empty, whitespace-only, or entirely outside `\p{L}\p{N}` — e.g. a bare emoji) is **no term constraint at all**: the query behaves as if `term` were absent and every document matches. *Frozen 2026-08-12; deviation:* Orama returns everything for `term: ''` but the empty set for a non-empty term with no tokens, which is an accident of a truthiness check rather than a rule.

`string[]`/`enum[]` fields: tokenize each element; postings don't distinguish element positions. `enum` fields: **not tokenized** — indexed as a single exact value for filtering and faceting only. *Resolved — matches Orama (report §2):* `innerFullTextSearch` restricts term matching to `string`/`string[]` properties. Naming an enum field in `fields` throws `DelightError.badRequest` (§4.10).

### 4.2 Term matching (prefix)

Default (`exact: false`): every query token matches index tokens **by prefix** (query token `dat` matches `data`, `database`). This mirrors Orama's radix `find` behavior.

`exact: true`: whole-token equality, **case-insensitive** (tokens are already lowercased), and it works on array fields. *Deviation (report finding C):* Orama's `exact` is a post-filter `new RegExp('\\b' + term + '\\b')` with no `i` flag, run against the **raw** property value and only when `typeof value === 'string'` — so it is case-*sensitive* and silently never matches `string[]` fields. Ours is the sane definition; the visible consequence is that `exact` on a mixed-case corpus now returns *more* results than before. Changelog it.

### 4.3 Tolerance (fuzzy)

`tolerance: N` additionally admits index tokens within bounded Levenshtein distance ≤ N of the query token (whole-token distance, computed after normalization). Candidate set per query token = *prefix matches ∪ tolerance matches*, deduplicated. Fuzzy-matched tokens contribute at full weight (no score penalty). *Resolved — matches Orama (report §3):* verified byte-identical scores for an exact and a distance-1 match, and confirmed that `tolerance` is a **union with** prefix matching (not a replacement) and that `exact: true` suppresses `tolerance` entirely. Practical implementation: scan the field's token dictionary, pre-filter by `|len(candidate) − len(term)| ≤ N` and (for N ≤ 2) a cheap first-character check, then run bounded Levenshtein with early-exit rows. Dictionaries are small (distinct tokens, not occurrences) and cached in memory on both sides (§7.3, §7.6), so this is an in-memory scan.

### 4.4 Scoring: BM25

Standard BM25 with Orama's default parameters `k1 = 1.2`, `b = 0.75`, `d = 0.5` (BM25+ lower bound). Per field:

```
score(doc, token, field) = idf(token, field) * ((tf * (k1+1)) / (tf + k1 * (1 - b + b * len(doc,field)/avgLen(field))) + d)
idf = ln(1 + (N(field) - df + 0.5) / (df + 0.5))
```

- `N(field)` = docs containing that field; `df` = docs containing the token in that field; `avgLen` = mean token count of the field.
- A doc's total score = Σ over (query token × matched index token × field), with per-field `boost[field]` multiplier applied to that field's contribution (default 1). `boost: 0` is a legitimate zero multiplier here; Orama rejects it with `Boost value must be a number greater than, or less than 0` (found by the Phase 2 harness).
- When one query token prefix-expands to multiple index tokens, each match contributes. *Resolved — matches Orama (report §4):* `calculateResultScores` accumulates additively per matched word; verified a 12× gap between a 4-expansion and a 1-expansion document, which rules out max-per-query-token.

**The formula above is *not* Orama's formula (report finding B).** Orama computes `(idf * (d + tf * (k + 1))) / (tf + k * (1 - b + b * fieldLength / avgFieldLength))` — `d` inside the numerator, divided by the length normalization, i.e. not BM25+. It also uses the **global** document count for `N` (not documents containing the field) and maintains `avgFieldLength` against that same global count, so both statistics are simply wrong for a sparsely-populated field. The plan's definitions are the correct ones and stay; combined with the duplicate-keeping tokenizer (finding A) that makes **four** deliberate scoring deviations, which is why §8.1 asserts matched-set membership rather than rank order.
- Summation order: fields sorted ascending, tokens sorted ascending, docs accumulated in sorted-doc-id order (determinism rule).
- The `ln` inside `idf` is the in-house deterministic implementation (§3 determinism rules) — never `Math.log`.

### 4.5 `threshold`

**Frozen (report §5):** with multiple query tokens, let `U` = docs matching *any* query token in any searched field and `A ⊆ U` = docs matching **every** distinct query token, **anywhere in the document**. `threshold: 0` → `A`. `threshold: 1` (the default when the key is absent or null) → `U`. `0 < t < 1` → `A` followed by the top `ceil(|U \ A| * t)` of `U \ A` by score (then PK ascending).

Three deliberate deviations from Orama 3.1.18, all verified: **(a)** Orama requires all tokens within a **single property**, so a doc with `alpha` in one field and `beta` in another fails its `threshold: 0` — we require them within the *document*, which is what the key's name promises; **(b)** Orama counts *matched index words* per property, so one query token's prefix expansion can satisfy "all tokens" spuriously (`al be` matches a doc containing only `alp alpine`) — we count distinct **query** tokens; **(c)** Orama skips the fractional filter entirely when `A` is empty — we always apply it. (a) is a behavior change and must be changelogged; (b) and (c) are bug fixes.

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
- `distinct_on`: after ordering, keep the first hit per distinct value of the given field. Missing/null values form one group like any other value, so at most one field-less document survives. **`count` is reported AFTER distinct** — *deviation (report finding D):* Orama's `fetchDocumentsWithDistinct` applies distinctness during hydration only and reports the *pre*-distinct total, which makes pagination arithmetic wrong. Changelog it.
- `limit`/`offset` apply after ordering + distinct. **`limit: 0` returns no `hits` while `count` still reports the full matched total** (frozen 2026-08-12; the same split Orama produces, and the only reading that keeps `count` a property of the query rather than of the page). `offset` beyond the end returns no hits with the same full `count`. Existing server clamps stay (`limit` clamped to 1..5000 sparse / 1..100 hydrated; `order` keys validated against `sortable_fields` → 400). Cursor semantics unchanged from today's `list` implementation (opaque cursor over the ordering keys + PK).

### 4.8 Facets

Same shapes as Orama's `FacetDefinition` (already leaked into `SearchQueryInput`): string facets → value counts (with `limit`/`order` options), number facets → configured ranges, boolean facets → true/false counts. Counted over the **full matched set** (after `where`, before `limit`/`offset`). Facet value ordering: count descending, then value ascending via core comparator.

### 4.9 Vector and hybrid — **server-only**

Vector and hybrid queries never run on the client (locked decision): the query embedding requires a model call, which requires the server, so client-side vector scoring can never save a round trip. Any query carrying `vector` routes to the server unconditionally (§7.6 routing rule). This deviates from Orama deliberately; the differential harness exempts vector/hybrid from client-side parity.

- **Unit-normalize at write, score by dot product.** Vectors are L2-normalized once, at index time; queries are normalized once, at query time; the score is then a plain dot product (identical ranking to cosine at roughly half the per-doc cost, and no divide in the hot loop). Zero vectors (norm 0) are rejected at write with `DelightError.badRequest` — cosine is undefined for them and Orama's behavior there was never meaningful.
- `vector: { value: number[], field: 'embedding_field' }` (inner key renamed from `property` — §6) → mode `vector`: brute-force dot product over all docs having that field. Result ordering: similarity desc, PK asc. **`similarity` lives inside the vector object** — `vector: { value, field, similarity? }` — defaults to `0.8` and admits documents scoring `>= similarity` (inclusive), in **both** vector and hybrid mode. *Resolved (report §11 + Appendix B4), decided 2026-08-12:* `0.8` is Orama's `DEFAULT_SIMILARITY`, and `similarity` was **not reachable** through the typed API or the URL wire, so 0.8 was its entire observable behavior — there is no back-compat constraint. It is now part of the public typed API (`SearchVectorQuery`), nested rather than top-level because it is meaningless without `vector` and because nesting means it travels inside the existing `vector` JSON URL param with **no new URL param and no encode/decode change**. (Thresholds are unaffected by normalization — unit-vector dot product *is* cosine similarity.)
- `term` + `vector` → mode `hybrid`: run both, divide each score set by **its own maximum** (`score / max`, guarded to 0 when the set is empty or its maximum is 0), combine `0.5 * text_normalized + 0.5 * vector_normalized`, then sort by fused score descending and primary key ascending. *Resolved — the plan's own text was wrong (report §12):* Orama's `minMaxScoreNormalization` is a misnomer for plain max-normalization (no minimum subtraction), and its `getQueryWeights()` is a stub returning a fixed `{text: 0.5, vector: 0.5}`. Max-normalization is also the better rule — min-max maps the worst candidate to exactly 0 and degenerates on one-element sets. Two deliberate additions Orama lacks: the empty/zero-max guards and the PK tie-break. `hybridWeights` was never reachable through this package's API, so fusion weights stay fixed in v1. Hybrid is server-only by construction (fusion needs both score sets in one place).
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
| `{eq}` / `{in}` on array fields | array fields | array contains the value / contains any listed value |
| `and: [...]`, `or: [...]`, `not: {...}` | composites | logical composition; `not` = complement **within the corpus** (a doc missing the field passes `not: {eq}`) |

**Array-field matrix — resolved, deliberate widening (report §6).** Orama's behavior here is a type-dispatch accident with three different failure modes for one user intent: `{eq}`/`{in}` on `string[]` (and on a scalar `string`) return a **silent empty set**, `contains_all` works only on `enum[]`, and `enum[]` **throws** `Invalid operation` on `eq`/`in`/bare values. Ours is uniform across `string[]`/`enum[]`/`number[]`/`boolean[]` and across operand forms, and anything outside the matrix throws `DelightError.badRequest` — never a silent empty result. Every query that changes does so from "no results" to "results", so no consumer can be depending on the old answer.

The Phase 2 harness found this is **wider than the report recorded**: a scalar `string` field is Radix-backed in Orama, and its filter branch fires only for a *bare* string or array — which it then **tokenizes** and unions. So in Orama a bare string operand is a tokenized contains rather than equality (`'東京'` and `'😀'` tokenize to nothing and match nothing), and *every* operator object on a scalar string — `eq`, `not_in`, `gt`, `gte`, `lt`, `lte`, `between` — silently yields ∅. Ours is strict typed equality and core-comparator ordering throughout. Two more Orama operand-shape errors the report missed: a **bare number** throws (`Cannot read properties of undefined (reading 'toString')`) rather than normalizing to `{eq}`, and two operators in one object throw `INVALID_FILTER_OPERATION` where we AND-compose them.

**`not` with missing fields — resolved, matches Orama (report §7).** Orama's `not` branch takes the complement over *every* internal id, so a document missing the field passes `not`. The asymmetry with `not_in` (which requires the field to be present) is Orama's actual behavior, not an oversight, and it is also the reading that makes `not` a true complement. `and: []` and `or: []` both evaluate to the empty set, confirmed on both sides.

**Empty operand lists — frozen 2026-08-12.** `contains_all: []` is **vacuously true** for any document whose field is present as an array; a missing or null field still fails it, per the null rule below. `contains_any: []` (and `in: []`) match **nothing**. Orama returns the empty set for `containsAll: []`; ours is the reading that makes `contains_all` a conjunction over the list.

**Normalization** (`core/where.ts`, ported from today's `normalizeWhere` in `search-query.ts:215-266`): plain scalar on enum → `{eq}`, array on enum → `{in}`, plain number → `{eq}`. Both drivers run the same normalizer first. **No legacy spellings are accepted** (decided 2026-08-12): `containsAll`/`containsAny`/`nin` are unknown operators and throw `DelightError.badRequest`, and `decodeSearchQuery` ignores `distinctOn`, `properties`, `order[].key`, `vector.property` and `q` entirely. Encode emits only the new names.

**Null/missing rule (freeze this):** every leaf predicate evaluates **false** when the field is missing or null, except inside `not` per the row above. The SQL compiler must reproduce this exactly (SQL three-valued logic makes `NOT(col = x)` silently drop NULL rows — compile `not` explicitly as `(col IS NULL OR NOT(...))` per the frozen semantics).

**Type coercion rule:** the schema declares every path's type, so both sides coerce explicitly per type. Critical on SQL: `json_extract` returns booleans as `0`/`1` — the compiler compares against `0`/`1` for boolean paths. Golden vectors must cover: booleans, null vs absent key, empty arrays, empty strings, unicode strings, numeric strings (no implicit numeric coercion — `'5' ≠ 5`).

**Child keys:** paths use dot notation (`'address.city'`) exactly as today's nested Orama schema exposed them. The set of legal paths is closed: only fields declared `.searchable()`/`.sortable()` in the table schema (this is what makes SQL compilation tractable — see §7.4).

### 5.1 Geosearch (locked 2026-08-12: keep both `radius` and `polygon`)

`geopoint` is a schema type that is *always searchable* ("that is the primary point of a geopoint field" — `schema.ts:198`), and Orama's geo operators pass straight through the untyped `where` today — so both stay. Neither is hard: point-in-polygon is ~20 lines of even-odd ray casting, and the bounding-box machinery is shared with radius anyway (a rectangle-only compromise would save nothing).

**Operator shapes (preserved from Orama's wire format), on geopoint fields only:**

| Operator | Shape | Semantics |
|---|---|---|
| `{radius}` | `{ coordinates: {lat, lon}, value: number, unit?: 'cm'\|'m'\|'km'\|'ft'\|'yd'\|'mi', inside?: boolean }` | haversine distance to `coordinates` ≤ `value` (defaults: `unit: 'm'`, `inside: true`; `inside: false` = complement) |
| `{polygon}` | `{ coordinates: [{lat, lon}, ...], inside?: boolean }` | planar even-odd ray casting treating lat/lon as flat 2D — matching Orama's planar treatment |

**Radius — resolved, matches Orama exactly (report §8).** Defaults `unit: 'm'`, `inside: true`. Unit multipliers to metres are exactly `cm 0.01`, `m 1`, `km 1000`, `ft 0.3048`, `yd 0.9144`, `mi 1609.344`; any other unit throws `DelightError.badRequest`. Distance is spherical haversine with `EARTH_RADIUS = 6371e3` metres and `c = 2·atan2(√a, √(1−a))`. `inside: true` is boundary-**inclusive** (`distance <= value`), `inside: false` is boundary-exclusive (`distance > value`) — exact complements over documents that *have* a geopoint. `core/geo.ts` ports Orama's expression tree operand-for-operand: the two forms differ at the ~2-ulp level, so golden boundary fixtures must be generated from the port, never from an independently written haversine.

**Polygon — resolved, matches Orama bit-for-bit (report §9).** The PNPOLY predicate is `(yi > y) !== (yj > y) && x < ((xj − xi) * (y − yi)) / (yj − yi) + xi`, with the ring implicitly closed (an explicit repeated first vertex is harmless). The boundary is **half-open**: bottom and left edges and the bottom-left vertex are inside; top and right edges and the top-right vertex are outside. `inside: false` is the exact complement. A **degenerate ring** (fewer than three vertices) encloses nothing and matches no document — it is a shape, not a query-shape error, and Orama agrees (frozen 2026-08-12; a vertex that is not a `{lat, lon}` pair still throws a 400).

- **`core/geo.ts`**: haversine (fixed earth radius, meters) + unit multipliers + planar point-in-polygon. Orama's `highPrecision` flag is **accepted and ignored** — we are always precise (at DO scale the cost is nothing); document the ignore.
- **Missing/null geopoint fails both `inside: true` and `inside: false`** — the §5 null rule applies to geo like every other leaf predicate. *Resolved — matches Orama, the plan's worry was unfounded (report §10):* unindexed documents are absent from Orama's BKD tree and therefore from both the result and its complement. (Contrast `not: {field: {radius: ...}}`, which *does* admit missing-geopoint documents, because `not` complements over the corpus.)
- **Determinism caveat (radius only):** haversine needs `sin`/`cos`/`atan2` — implementation-varying across JS engines, same class of problem as `Math.log` (§3). Unlike BM25, where scores *order* results and near-ties are common, a geo predicate is a boolean filter: a cross-engine flip requires a doc within ~1 ulp of the exact radius boundary (sub-nanometer). Accepted and documented; not worth porting deterministic trig (~300 lines vs `ln`'s ~40). **Polygon has no such caveat** — ray casting is comparisons and multiplication only, fully deterministic.
- **Antimeridian/pole-spanning shapes are out of scope**, matching Orama's planar math (a polygon crossing ±180° longitude doesn't work there either). Document, don't handle.
- **Server compilation (§7.4):** bounding-box prefilter over two generated columns per geopoint field (`sv$<field>__lat` / `sv$<field>__lon` over `json_extract`, both indexed), then the exact `core/geo` check over the candidates. Polygon bbox = vertex min/max; radius bbox = `lat ± Δ`, `lon ± Δ/cos(lat)`, widening to the full longitude range when the circle nears a pole. The bbox is a *prefilter only* — membership is always decided by `core/geo`, per the §3 contract. Counts 2 columns per geopoint field against the 100-column budget.
- **Client:** `core/geo` predicate over the window's docs (optionally an IDB range on the lat path for candidate extraction — a positive number predicate, allowed per §7.6; plain scanning is fine at window sizes).
- **Golden coverage (§8.2):** boundary-distance docs, `inside: false`, missing geopoint, a doc on a polygon vertex/edge (freeze whatever ray casting decides), and an antimeridian case asserting the *defined* (planar, unsupported-wrap) result.

---

## 6. Public API compatibility (type decoupling)

Phase 1, zero behavior change, independent of everything else:

- Re-declare in `search/core/types.ts`, structurally identical to today's shapes: `SearchQuery` (the `Pick<SearchParams…>` union collapses into one owned interface with `term, where, order, limit, offset, facets, boost, fields, tolerance, threshold, exact, distinct_on, vector, sparse, cursor` — `q` is gone entirely, and `vector` is `{ value, field, similarity? }` per §4.9), `SearchQueryResults` (`count, elapsed, facets, hits, cursor`), `WhereCondition`, `FacetDefinition`, `FacetResult`, `SearchableType`, and the hit shape (`{ id, score, document }`).
- Replace the Orama type imports in `src/schema/schema.ts:1-12` and `src/search-query.ts:1` with these. Keep re-exports from the barrels so consumer import paths don't change.
- `mode` and `sortBy` remain non-public (derived internally, as today). The README's mention of settable `mode: 'vector'` is already wrong vs the types — fix the README, don't widen the type.
- Type-level names on the generic plumbing (`SearchSchema<Table>`, `OramaType<T>` → `IndexFieldType<T>`, `orama_schema` → `index_schema` in `table.config`) get renamed in Phase 3 when the engine lands; Phase 1 only severs the *import* dependency.
- **The key renames land here, in Phase 1** (locked 2026-08-11 + 2026-08-12) — done first so the differential harness and golden vectors are written against final names. **There are no legacy read aliases** (decided 2026-08-12): decode reads only the new names, `normalizeWhere` only the new operators, and pre-rename bookmarked URLs and pre-rename cursors (which could carry `q`) break — accepted, the changeset is major. A thin shim at the two remaining Orama call sites translates *outbound* to Orama's spellings until Phases 3–4 delete those call sites. Phase 1's changeset is **major**.

| Old | New | Notes |
|---|---|---|
| `distinctOn` | `distinct_on` | URL param was already `distinct_on` (`search-query.ts:95`) — the typed API catches up to the wire |
| `containsAll` (where op) | `contains_all` | changes the `where` JSON on the wire |
| `properties` | `fields` | Orama-ism; the package's vocabulary is fields (`searchable_fields`, `.searchable()`). URL param renames too |
| `vector.property` | `vector.field` | same vocabulary fix, inside the `vector` JSON param |
| `order[].key` | `order[].field` | `key` reads like "primary key"; inside the `order` JSON param |
| `nin` (where op) | `not_in` | MongoDB-ism, cryptic next to snake_case keys |
| `q` | *deleted* | gone from the typed API **and** from the URL wire (2026-08-12); use `term` |
| `tolerance` | *kept* | deliberately unchanged (decision 2026-08-12) |
- `encodeSearchQuery`/`decodeSearchQuery` and the URL wire format are otherwise untouched forever — they're engine-neutral already (both sides speak the new names, and only those). `vector.similarity` (§4.9) needs no wire work: it rides inside the `vector` JSON param.

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
	len         INTEGER NOT NULL,   -- token count of THIS doc's field, denormalized from search_docs
	PRIMARY KEY (entity_type, field, token, doc_id)
) WITHOUT ROWID;
-- PK is the covering index for the only read pattern: (type, field, token[, prefix-range]) → (doc_id, tf, len)
-- `len` is BM25's length normalization, carried on the posting row so the term
-- path never joins back to search_docs. Reading it from search_docs made the
-- scoring loop cost O(corpus) rather than O(postings touched) — 12ms of a 30ms
-- search at 10k docs, and linear from there (Phase 3 perf pass, §8.3). Cost:
-- one extra INTEGER per posting, and a field whose length changed rewrites all
-- of that field's posting rows, not just the ones whose `tf` moved.

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
	lengths     TEXT NOT NULL,             -- JSON { field_path: token_count }
	PRIMARY KEY (entity_type, doc_id)
) WITHOUT ROWID;
-- NOT on the search hot path since `search_postings.len` exists. It stays because
-- the write path needs it: the DELETE…RETURNING repair branch recovers a
-- document's field-stat deltas from it (`field, token` alone cannot), and
-- rebuild verification compares against it.

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
CREATE INDEX IF NOT EXISTS search_vectors_by_doc ON search_vectors (entity_type, doc_id);
-- (added during Phase 3 implementation) the delete path needs (entity_type, doc_id)
-- just like search_postings does; without it, dropping one document's vectors is a
-- full scan of the table.
```

**`INDEXED BY` is required on the by-doc deletes, not optional.** These tables are
`WITHOUT ROWID` and are never `ANALYZE`d, so SQLite's planner has no statistics and
routinely prefers the primary-key index (a full scan for a `doc_id`-only predicate)
over the secondary index. `DELETE FROM search_vectors INDEXED BY search_vectors_by_doc
WHERE entity_type = ? AND doc_id = ?` (and the equivalent on `search_postings`) forces
the right plan. `INDEXED BY` is a hard assertion: if the named index is ever dropped
the statement fails loudly rather than silently degrading, which is the behavior we
want here.

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

Each cached dictionary carries two **parallel arrays** alongside the sorted tokens, maintained by the same sorted insert/remove: each token's code-point length, and a 32-bit character-set signature (one bit per distinct character, hashed onto 32 buckets). A tolerance scan tests both before touching the string, and both are *necessary* conditions for `distance <= k`, never heuristics — an edit moves the length by at most one and adds/removes at most one distinct character, and hashing characters together only makes the signature test more permissive. On a high-cardinality field (primary keys, slugs) this keeps the Levenshtein DP off effectively the whole dictionary: fuzzy expansion of two tokens over a 100k-token dictionary went from 35ms to 2ms (§8.3).

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
- Migration when the declared path set changes: diff **`PRAGMA table_xinfo`** against the schema at DO bootstrap (allowed in DO SQLite), `ADD COLUMN` + `CREATE INDEX` for new paths, `DROP INDEX` **then** `DROP COLUMN` for removed ones (an indexed column can't be dropped). *Correction from Phase 3:* it must be `table_xinfo`, **not** `table_info` — `table_info` omits VIRTUAL generated columns entirely, so diffing against it re-`ADD COLUMN`s every existing generated column on every boot and fails.
- **Generated columns are declared with NO type name** (correction from Phase 3; the DDL sketch above shows `TEXT`). A declared `TEXT` gives the column TEXT affinity, and SQLite applies a column's affinity to the *other* operand of a comparison — so `sv$x = 5` would convert `5` to `'5'` and match a stored `'5'`, the opposite of the frozen DSL's strict typed equality. Omitting the type name leaves BLOB/"any" affinity, which compares by storage class exactly like `core/compare`. The same hazard exists on *real* columns the schema declares `TEXT` (notably `enum`): there the fix is per-predicate — an operand that is not a string degrades to a polarity-correct literal and `core/where` decides (`text_affinity_fields` in `sql_where.ts`).
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
		      fetch postings per matched token — each row carries (doc_id, tf, len), so
		      scoring reads nothing else; accumulate BM25 into Map<doc_id, score>
		      (skip docs ∉ candidate_ids when the SQL set is smaller; otherwise filter after)
		vector: brute-force dot product over unit vectors in search_vectors (∩ candidates); qvec prefilter when enabled (§4.9)
		hybrid: fuse (core/fusion)
		apply threshold (§4.5) · order (core/compare — by order[] if given, else score) ·
		distinct_on · facets (core/facets, pre-limit) · cursor/limit/offset · hydrate docs
		  ^ when order[] is empty and there is no distinct_on and no facets, hydrate
		    ONLY the page: score ordering needs a score and a primary key, and doc_id
		    IS String(primary key), so nothing before the slice needs a document
```

**Deferred hydration (the `order[]`-free page).** Score-ordered paging reads back `limit` documents, not the whole matched set — the difference between 12k `SELECT *` rows and 20 at a 100k corpus. It is exact, not an approximation: the full matched set is still scored, so `count` and `threshold` are unchanged, and the sort key is literally the same comparator. The one behavior it cannot reproduce for free is the fully-hydrated path's silent drop of a matched id whose *entity row* is missing, which also removes it from `count`; this path sees that only for ids it reads. The two agree exactly whenever the search index and the entity table agree, which is a write-path invariant rather than a hope — postings are written in the same transaction as the entity row (§7.2), and the memory reference engine has no notion of the two disagreeing at all. If one does appear, the page path drops it from the page and from `count` by pulling the next entry forward, rather than returning a hit with no document. Queries with `order[]`, `distinct_on` or `facets` keep the fully-hydrated path, because each of those reads fields off every matched document.

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

*Implemented 2026-08-12 (Phase 4 stage 2), with two refinements:* the version is `1 + Σ config_version` over the registered types, **and** the declared index set is compared against the live one on open — a database created before this design (version 1, `entities`/`sync_meta`/`search_index`, no postings stores) and a code deploy that changes a table's indexable paths both force an upgrade at an unchanged sum. `openSearchDatabase` gained an optional `version` (open at whatever exists — the probe open that reads `sync_meta` *before* the versions are known) and `delete_stores` (the legacy `search_index` blob store is dropped on that first upgrade). Every string/number/enum path is indexed, not only the declared-sortable ones: in this API every searchable field is filterable, and an index is only ever a candidate-range optimization.

**IDB gotchas (encode as review checklist for the implementing agent):**
- A transaction auto-commits the moment you `await` any non-IDB promise inside it. Structure each write as: open ONE readwrite transaction; read the old doc *inside it*; tokenize/diff/compute df deltas synchronously in the request callback (synchronous compute doesn't auto-commit); then issue all writes — never interleaving foreign awaits. The old-doc read must NOT happen in an earlier separate transaction: production is a SharedWorker (single writer), but dev and non-SharedWorker browsers fall back to per-tab `Worker`s (`database.worker.init.ts:18-26`) sharing one IDB, and a read-then-reopen gap lets two tabs interleave and silently corrupt `df`/field stats. IDB serializes overlapping readwrite transactions — lean on that.
- Booleans and `null` are **not valid IDB keys**: an index over a boolean path indexes nothing (records with invalid keys are silently omitted from the index), and a doc missing the keyPath is absent from that index entirely. Index-driven candidate extraction is therefore valid only for *positive* predicates on string/number paths; boolean filters, `not_in`, and `not` (where missing-field docs must match, §5) evaluate as `core/where` predicates over the window's docs (or as complements against the full `docs` store) — never via an index.
- Index writes go **in the same transaction** as `sync_meta` updates (preserving today's invariant that the synced window can never outrun the persisted index — `#persistSyncState`'s property, `database.worker.ts:1193-1240`).
- Prefer `getAll(range)` over cursor iteration (order-of-magnitude fewer event-loop round-trips). Batch per-token posting fetches with `Promise.all` inside one readonly transaction.
- Safari IDB is slower and quirkier; keep per-query IDB round-trips bounded (dictionary cache means token expansion is memory-only; only postings/docs hit IDB).
- Comparator caution: IDB key sort ≠ core comparator for edge cases (IDB sorts by type ordering, code-unit strings). Any user-visible ordering must be re-sorted by `core/compare.ts` after fetch — IDB indexes are used for *candidate range extraction*, not final order. *Resolved (report §13):* the IndexedDB specification defines string key comparison as code-unit-wise over UTF-16, identical to JS `<`, which diverges from code-point order (and from SQLite's BINARY/UTF-8 order) for astral-plane characters — `'\u{1F600}'` sorts *before* `'�'` there and *after* it by code point. The re-sort rule stands as written.
- **Astral upper bound in prefix ranges (report §13, second-order consequence).** Because of that code-unit ordering, the prefix range in the `postings` row above is **wrong as written**: `IDBKeyRange.bound([t,f,prefix], [t,f,prefix+'￿'])` misses every token whose next character is astral, since those sort above `'￿'` (U+FFFF) in code-unit order. ~~Use `prefix + '\u{10FFFF}'`~~ **Corrected 2026-08-12 (Phase 4 stage 1):** appending `'\u{10FFFF}'` is still wrong — `prefix + '\u{10FFFF}' + 'x'` sorts above the bound and is missed. The correct rule (implemented as `codeUnitUpperBound` in `client/idb_store.ts`, tested with real astral tokens): increment the prefix's last UTF-16 **code unit** and use it as an *exclusive* bound, dropping trailing `U+FFFF` units first, falling back to the array sentinel `[]` (arrays sort after strings in IDB key order) when no incrementable unit remains — mirroring the care §7.3 already takes over SQLite's surrogate-block increment.

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

*Implemented 2026-08-12 (Phase 4 stage 2).* Coverage is `start_updated_at === 0` — the existing backfill-complete sentinel, so no new state was introduced. `search_mode: 'client'` opts a type in regardless of coverage (an explicit partial-corpus answer); `'server'` opts out of local search *and* local syncing, as before. The threshold valve is now **off unless configured**: `default_threshold` is no longer defaulted to 5000 by the client, and `undefined` means "no count valve". `getSearchMode()` became a live routing decision rather than a stored mode — it reports `'server'` while the window fills and `'client'` once it is complete.

**Worker deletions:** orama imports, `#projectToIndex`, the `removeMultiple` batch-size workaround, the `insertMultiple` fallback, ghost filtering, `saveOrama`/`loadOrama` and the doubling persist schedule (index persistence is now continuous and transactional). *All deleted 2026-08-12, plus `#switchToServerMode` (its memory rationale is gone) and the `search_index` IDB store.*

**Derived-field key shape — verified, and the news is good (stage-2 finding).** The stage-1 warning was that a derived value persisted under a *literal dotted key* would be invisible to its `docs` index, whose keyPath is a genuinely nested path. It does not arise: `derived()` fields are declared as ordinary top-level fields, so `toSparse` writes them as top-level keys (`sparse_doc.author_name`), and the server's `$derived` merge (`nativeSparseFromRow`) assigns them by the same top-level name. Nested schema objects are the only multi-segment paths, and `toSparse` materializes them as real nested objects (`{ address: { city } }` for the declared path `address.city`) — exactly what `keyPath: 'sparse_doc.address.city'` resolves against. `use_index_candidates: false` therefore stays an unused escape valve.

**Optimistic (client-originated) writes.** The plan's "index their local `toSparse`" needed a client-side stand-in, because the worker has no access to a table's `toSparse` function (only the serializable schema crosses the Comlink boundary). It is a pure *key filter* driven by the flattened schema — keep the declared searchable paths, drop null/undefined, keep every value untouched — not a revival of `#projectToIndex`'s type guarding, which existed only because Orama threw on a type mismatch. FK-derived values cannot be computed locally and simply arrive with the server echo, which overwrites the document whole.

---

## 8. Testing strategy — this is the consistency guarantee, not garnish

### 8.1 Differential harness (vs Orama, Phase 2 gate)

**Implemented 2026-08-12** as `search/__tests__/differential.test.ts` (+ `orama_reference.ts`, `support.ts`). Test-only; it retires with `@orama/orama` in Phase 5. It runs the same corpus + query battery through real Orama (3.1.16, the resolved version) and the memory reference engine:

- Corpora: seeded deterministic generators (`__tests__/fixtures/corpus.ts`) — realistic strings, emails, shared vocabulary, numbers, booleans, enums, arrays, nested objects, geopoints, vectors; two presets, one string-PK (`article`) and one **integer-PK** (`event`); sizes 10 / 1000 / 20000. The harness runs 10 and 1000 by default; 20000 is behind `DELIGHT_SEARCH_DIFF_LARGE=1` because it surfaces nothing 1000 does not.
- Query battery: 249 tagged cases (`__tests__/fixtures/battery.ts`) covering every operator × type × edge case, term queries across prefix/tolerance/threshold/boost/fields/exact, facets, `distinct_on`, geo (`radius`/`polygon` × `inside` both ways, boundary and vertex documents — Orama is run with **`highPrecision: false`**, because we are always *haversine*-precise, never Vincenty-precise; report §8), and vector + hybrid (memory reference only — those are server-only per §4.9).
- The battery is written in the new DSL; the existing `search/orama-compat.ts` shim translates keys for the Orama side.
- **Assertions.** Exact membership + `count` parity for filter-only queries; the number of distinct groups for `distinct_on` queries; per-value counts for facets; and for scored text queries, exact **matched-set** membership + `count` parity — membership is decided by token matching and `threshold`, not by score, so it *is* comparable, while rank is not.
- **Rank order and top-N membership are both unachievable, and neither is asserted.** Finding B lists four deliberate scoring deviations (duplicate-keeping `tf`, `d` outside the numerator, per-field `N`, per-field `avgLen`). Measured across the scored battery on the 1000-document corpus, top-10 *membership* agreement ranges from **0/10 to 8/10** — so the original plan's Kendall-tau-plus-identical-top-10 assertion, and even a plain top-N membership assertion, would be noise. Score values were always exempt (§2).
- Three things Orama cannot express are never compared: multi-key `order` (its `sortBy` takes one property and has no tie-break — every comparison runs unpaged and compares sets), integer primary keys (Orama throws on a numeric document id, so the `event` corpus is handed to it stringified), and result order generally. Ordering, paging and tie-breaks are frozen by the golden vectors (§8.2) instead.
- Known Orama bugs are excluded from parity (ghost docs, null arrays, deferred removals) — the harness runs Orama with the same guards production code uses today (null-stripped `toSparse` documents, ghost-hit filtering, `properties: '*'`, explicit `mode`).
- Every remaining disagreement lives in one `ORAMA_DIVERGENCES` table with a written reason, and each entry is **asserted to actually diverge** on the 1000-document corpus, so the table cannot rot into a silent exclusion list. Likewise every `orama-throws` case is asserted to really throw in Orama, and every `deviation`/`orama-bug` case is asserted to really diverge (six exceptions, listed in the test, whose deviation is in scoring only or is not separable by this corpus).

### 8.2 Golden vectors (permanent, both drivers)

**Implemented 2026-08-12.** Three JSON fixture files under `search/__tests__/golden/` (~900KB total), generated from the memory reference by `golden/generate.ts` (`DELIGHT_REGEN_GOLDEN=1 pnpm --filter @delightstack/database exec vitest run src/search/__tests__/golden/regenerate.test.ts`) and replayed by `golden.test.ts`: `tiny.json` (all cases over ten-document corpora), `edges.json` (all cases over a corpus of *nothing but* the hand-authored edge documents — 69 article / 20 event, which is where the mandatory coverage below actually lives and what makes hand-auditing possible), and `small.json` (the `scored` and `facets` cases over 1000-document corpora, the only answers that move with corpus statistics). Cases tagged `error` are frozen as `GoldenErrorVector`s asserting the `DelightError` status and message.

A single JSON fixture set (`search/__tests__/golden/`) of `{ corpus, query, expected_ids_in_order, expected_counts, expected_facets }`, generated once from the memory reference implementation and hand-audited. The **same fixtures** run against: core+memory store (vitest), server driver over real DO SQLite (existing `db.server.*.test.ts` infra / miniflare), client driver over real IDB (fake-indexeddb in vitest + real-browser passes in Chrome **and at least one non-V8 engine** — Safari or Firefox — the pass that would catch engine-varying math if the deterministic-`ln` rule (§3) is ever violated). Byte-identical output required. Exception: vector/hybrid fixtures run against the memory reference and server driver only (no client vector path exists, §4.9); a routing test asserts the worker sends any `vector` query to the server. Mandatory edge coverage: astral-plane string ordering, null vs absent, empty string/array, boolean coercion through `json_extract`, `not` with missing fields, equal-score PK tie-breaks, equal `updated_at` ordering, tolerance boundary lengths, email tokenization, geo boundary/vertex/missing-geopoint cases (§5.1). At least one corpus must use an **integer primary key** (`primary_key_type: 'number'`) — postings store `doc_id` as `String(pk)` while tie-breaks compare as the declared PK type, so integer-PK ordering (`2 < 10`, not `'10' < '2'`) must be exercised end-to-end.

### 8.3 Performance benchmarks (regression-gated)

Targets on a dev machine (document actuals; the point is trend, not the absolute number): server single-doc index write < 5ms at 100k-doc corpus; FK-derived cascade < 1ms per dependent row measured at 100 dependents (§7.2b); server text search (2 tokens, tolerance 1) < 30ms at 100k docs; filter+sort-only < 5ms at 100k docs; client search < 50ms at 20k-doc window (Chrome); DO cold-start added search cost = 0 (assert no search table reads on boot). Compare against Orama baselines captured before the switch, including the 10s serialize being eliminated.

#### Measured — server driver, Phase 3 term-search performance pass

`packages/database/src/search/server/engine.bench.test.ts`, opt-in via `DELIGHT_SEARCH_BENCH=1`. **Dev-box caveat, and it is not a small one:** this is `node:sqlite` in-process on one developer's Linux machine, not Durable Object storage. Read the numbers as a relative floor and the before/after ratio as the real result — a DO adds its own per-statement overhead, and any absolute figure here will be optimistic. Both columns were measured on the same machine, the same harness and the same corpus; "before" is the Phase 3 driver as it stood at the start of the pass, reconstructed in place to measure it.

The corpus is Zipf-ish over a 4k-word vocabulary plus a 100k-token primary-key dictionary (`id` is a declared `string` field, so it is searchable), and the term query is the worst case the target is written for: two tokens each one edit away from a HEAD term, so the whole dictionary is expanded and the longest posting lists in the corpus are walked (12,124 of 100,000 documents match).

| ms, mean of a warm loop | 10k before | 10k after | 100k before | 100k after |
|---|---|---|---|---|
| **text search, 2 tokens, tolerance 1** | 64.06 | **3.52** | 714.69 | **29.35** |
| text search, same query, cold | 88.31 | 24.08 | 824.67 | 123.43 |
| text search, same query + `order[]` | 57.76 | 10.50 | 721.99 | 104.75 |
| text search, 2 tokens, prefix | 69.80 | 12.14 | 1053.95 | 120.34 |
| single write, previous doc supplied | 0.36 | 0.22 | 0.35 | 0.21 |
| single write, RETURNING fallback | 0.58 | 0.45 | 0.62 | 0.45 |
| bulk index, per document | 0.90 | 0.52 | 1.23 | 0.81 |
| filter + sort fast path | 5.74 | 5.09 | 60.36 | 61.91 |
| filter + sort, child key | 8.89 | 7.73 | 92.65 | 93.87 |

**Where the target lands.** The 30ms/100k text-search target is met (29.35ms) for the query it is written about, with no cost to the write path — writes got *faster*, because a posting row that carries its own length removes a `search_docs` read from the write path's verification too. What is left at 100k is roughly 9ms of SQLite materializing 12.5k posting rows, ~2ms of dictionary expansion, and ~15ms of BM25 accumulation and score ordering over the matched set; all three are proportional to the *matched set*, which is the honest floor for an exact `count` plus exact BM25.

**Two numbers still miss, both pre-existing and neither caused by this pass.**

- `order[]`-qualified term search (104.75ms) and prefix search over four head terms (120.34ms) are above 30ms at 100k. Neither is the §8.3 target query. `order[]` forces every matched document to be read back so its ordering field can be compared, so it cannot use deferred hydration by construction; prefix search over `dat`/`tok` expands to four head terms and walks a much larger posting set. Both improved ~7-9x anyway.
- **filter+sort-only is 62ms at 100k against a 5ms target**, and it was 60ms before this pass — the term path never touched it. The benchmark indexes `status` and `(updated_at, id)` separately, and `WHERE status = ? ORDER BY updated_at DESC LIMIT 20` then makes SQLite choose one: it filters on `status`, materializes ~33k rows and sorts them. The fix is an index-planning one (a composite `(status, updated_at)`), which belongs to §7.4 and the schema's index declarations, not to the engine. Flagged here so it is not mistaken for a regression.

---

## 9. Rollout phases

Each phase lands independently and is releasable. **Never auto-commit; Brian reviews everything.**

**Phase 1 — Type decoupling + snake_case renames** (small, do anytime)
Own the public types (§6) and land the breaking key renames (full table in §6: `distinct_on`, `contains_all`, `fields`, `vector.field`, `order[].field`, `not_in`, `q` deleted outright) with **no** legacy read aliases and the outbound Orama-translation shim at the two call sites. Expose `vector.similarity` (§4.9). Fix the `threshold` docstring while the types move (§4.5 — it currently describes semantics the key doesn't have). Acceptance: no orama imports outside `db.server.ts` / `database.worker.ts`; `.d.ts` output orama-free; existing tests green, updated only for renamed keys. Changeset: **major**.

**Phase 2 — Core engine + memory store + harnesses** — *implemented 2026-08-12 (working tree, pending review)*
`core/*` complete per §4–5; memory-backed reference store; differential harness green with all `[verify-vs-orama]` markers resolved and the spec frozen; golden vectors generated and hand-audited. No production code path touched.

**Phase 3 — Server driver**
Tables (§7.1), write path in-transaction (§7.2), FK-derived cascade port + `$derived` persistence (§7.2b, §7.0), dictionary cache (§7.3), SQL compiler + generated-column migration incl. the `updated_at` index (§7.4), sync-pagination divorce over the tombstone/state tables (§7.5). The cut-over migration moves per-index state before dropping it: `search_index.deleted_entity` → `search_tombstones`, `config_version`/`first_updated_at`/`last_updated_at` → `search_state`. Gated by per-table flag `search_engine: 'native' | 'orama'` (default `'orama'`) in table config; on first native wake, `rebuildSearchTables` populates from the entity scan (reuse the in-flight-rebuild re-entrancy guard pattern). Bump `config_version` on switch so clients resync cleanly. Keep the orama path compiling for one release as fallback; then delete `getIndex`/`saveIndex`/journal/`search_index`/`search_journal` and Appendix-A workarounds ①–⑧.

**Phase 4 — Client driver** — *implemented 2026-08-12 (working tree, pending review); real-browser golden passes still owed*
Unified sparse projection with vector strip (§7.0) — requires Phase 3 server shipping sparse docs verbatim-minus-vectors; IDB stores + async driver (§7.6); config_version-driven IDB upgrade + full local rebuild on switch; routing policy (vector→server unconditional, then coverage-based). No client vector/fusion code — that whole subsystem is server-only (§4.9). Delete worker orama code and Appendix-A ⑨–⑫. Real-browser golden passes required (Chrome + one non-V8 engine, §8.2) — **still outstanding**; `fake-indexeddb` is the gate that has been run. Changeset note: synced entities stop exposing vector fields on the client (§7.0 strip — today they arrive inside the Orama doc, so apps could technically read them).

*What landed:* the strip is one server-side helper applied by **both** sync paths (`nativeSyncEntity` and the Orama one), so the wire contract is engine-independent; the worker's index is `search/client/idb_store.ts` opened over the existing client database with `entities`/`sync_meta` as `extra_stores`, so each sync page's documents, entity-cache deletions and cursor commit in one transaction (the invariant `#persistSyncState` used to carry, now per page instead of on a doubling schedule); a config bump purges the type's documents, reopens at the new version, clears the dictionary cache and restarts the backfill from scratch — matching the previous full-resync behavior. Worker-level tests over `fake-indexeddb` cover ingest atomicity, a failed page leaving the cursor untouched, deletions removing postings and field statistics, optimistic-write correction by the server echo, verbatim indexing of a wire-supplied sparse document, all five routing decisions, the config bump, the legacy-store drop, and an equivalence battery against the memory reference over the documents the worker actually indexed.

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
Client: ⑨ `removeMultiple` batchSize fix (`database.worker.ts:356-397`) ⑩ `insertMultiple` mid-page-throw fallback (`:400-408`) ⑪ `#projectToIndex` type-guarding (`:1055-1121`) ⑫ ghost filter (`:861-877`). **⑨–⑫ deleted 2026-08-12 (Phase 4 stage 2).**

**Deliberately absent from this list:** `cascadeReindexReferencing` (`db.server.ts:2343`) — the FK-derived cascade is a *feature*, ported by §7.2b, not an Orama workaround to delete.

## Appendix B — Open questions (answer before or during Phase 2)

1. Email tokenization scope: uniform on all string fields (planned) vs opt-in per field? Uniform is simpler; cost is a few extra tokens per email-shaped value.
2. Facet parity depth: are number-range and boolean facets actually used by any consumer, or only string facets? Trim scope if unused.
3. Is there a real offline-first product driving large client windows? It shaped the IDB-postings decision (already locked yes); it should also shape the default coverage policy (§7.6).
4. ~~`similarity` threshold for vector mode~~ — resolved 2026-08-12 (report §11 / Appendix B4): **not reachable** through the typed API or the URL wire, so `0.8` was its entire observable behavior. It is now a public, optional key **inside** the vector object — `vector: { value, field, similarity? }`, default `0.8`, inclusive, vector *and* hybrid modes — carried by the existing `vector` URL param (§4.9).
5. ~~Geosearch~~ — resolved 2026-08-12: keep both `radius` and `polygon` (§5.1). Polygon is ~20 lines of ray casting; no rectangle compromise needed.
6. Fractional `threshold` (0 < t < 1): does any consumer send one? (§4.5 — have the harness log it.) If unused, a future major can replace the float blend with `match: 'all' | 'any'` — out of scope for this plan.
