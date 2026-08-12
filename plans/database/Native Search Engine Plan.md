# Native Search Engine Plan

Replace Orama in `@delightstack/database` with a purpose-built, isomorphic search/filter/sort engine: a shared pure core with two storage drivers — synchronous DO-SQLite postings on the server, asynchronous IndexedDB postings on the client.

**Status:** Planned, not started.
**Decisions locked with Brian (2026-08-11):**

- Consumers must not have to change their queries (API-compatible with today's `SearchQuery`).
- Client and server must return identical results for the same query over the same corpus, so callers can choose client or server per query.
- Server index storage is DO-SQLite-native rows; client index storage is IndexedDB. The storage layouts may differ; the *semantics* may not.
- Filtering/sorting moves to SQL (server) / IDB indexes (client), including **child-key paths** (`address.city`) — this capability is kept.
- Fuzzy (tolerance) search parity with Orama is required.
- Vector search parity with Orama is required (brute-force similarity; callers supply raw vectors — no embedding generation, same as today).
- **Server storage interface stays synchronous** (DO SQLite is synchronous by design); **client storage interface is async** (IDB requires it). The two drivers are allowed to deviate structurally; consistency comes from shared pure modules + golden tests, not from a single awaited-everywhere core.
- The client gets a real **IDB postings backend** (not just an in-memory Map index), removing the memory ceiling that forces the current 5000-doc auto-switch to server mode.

> **Caveat for implementers:** line numbers below were captured 2026-08-11 while another agent was concurrently landing a "serialize less often" journal change in `db.server.ts`. Treat them as anchors, not gospel — re-locate by symbol name. The journal machinery itself is interim and is *deleted* by this plan (Phase 3).

---

## 1. Why

### 1.1 The immediate problem

Orama is an in-memory index with no incremental persistence. The server serializes the **entire** index (`saveOrama` → msgpack → chunked 1.9MB BLOBs in DO SQLite) after writes (`db.server.ts` — `saveIndex`, ~`:2044-2086`). At current data volumes this takes 10+ seconds per save. A write-ahead journal (`search_journal` + compaction at 500 rows) is being added to amortize this, but it's a bandaid: the full serialize still happens, just less often, and cold start must replay the journal on top of the snapshot.

### 1.2 The structural problems

1. **No incremental persistence, ever.** Orama cannot update storage per-document. Any Orama-based design carries snapshot + journal + replay + compaction complexity forever, and the snapshot cost grows with corpus size without bound.
2. **Memory ceiling.** The whole index must live in DO memory (128MB isolate limit). The client has the same problem, capped today by a 5000-doc auto-switch to server search.
3. **Client/server divergence today.** The two sides index *different projections* (server: `table.toSparse()` + FK-derived fields; client: its own runtime-type-checking `#projectToIndex` that silently drops vector/geopoint and mismatched fields). Same query can already give different results — the opposite of the isomorphic goal.
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

1. Zero query-API changes for consumers (`SearchQuery` shape, `where` DSL, `order[]`, facets, cursor, URL encoding all preserved).
2. Deterministic parity: same corpus + same query ⇒ byte-identical result *order and membership* on client and server.
3. O(changed-doc) write cost on both sides; zero cold-start index work on the server.
4. Feature parity: prefix search, tolerance (fuzzy), `exact`, `boost`, `properties`, `threshold`, `distinctOn`, facets, vector + hybrid mode, child-key filter/sort, array-field filters (`in`/`nin`/`containsAll`).
5. Performance: index-write overhead per entity write in the low milliseconds; text search over 100k+ docs in low tens of milliseconds on the server.

**Non-goals**

- Score-*value* parity with Orama. Nothing consumes raw scores; only membership, order, and counts must match Orama closely enough to not surprise consumers (validated by the differential harness, §8.1).
- Embedding generation. Callers supply `number[]` vectors on write and query, exactly as today.
- Stemming, stopwords, language packs. Today's setup uses none (no Orama plugins exist in the repo); we replicate the default pipeline only. The tokenizer module should leave room for these later.
- ANN vector indexes (IVF/HNSW). Brute-force is what Orama does and is fine at DO scale; revisit if a table exceeds ~100k vectors.

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
│   ├── facets.ts              # facet counting over a matched set (§4.8)
│   ├── fusion.ts              # hybrid text+vector score fusion (§4.9)
│   ├── vector.ts              # cosine similarity over Float32Array (§4.9)
│   └── types.ts               # engine-neutral SearchQuery/Results/Where types (§6)
├── server/
│   ├── sqlite_store.ts        # postings/tokens/docs/vectors tables + dictionary cache (§7.1–7.3)
│   ├── sql_where.ts           # where/order → SQL compiler over generated columns (§7.4)
│   └── engine.ts              # SYNC driver: full search pipeline (§7.5)
└── client/
    ├── idb_store.ts           # IDB object stores + dictionary cache (§7.6)
    └── engine.ts              # ASYNC driver: same pipeline shape, awaited (§7.6)
```

**The consistency contract.** The server driver is synchronous end-to-end; the client driver is async. They are two implementations of one *specification*, sharing every piece of pure logic (`core/*`). Anything that decides membership, order, or a count must live in `core/` and be imported by both drivers — a driver may orchestrate, batch, and cache however it likes, but it may not reimplement semantics. The enforcement mechanism is the shared golden-vector suite (§8.2), which runs the identical query battery through both drivers and asserts byte-identical output. Per Brian's conventions, duplication between the two drivers' *orchestration* code is fine; duplication of *semantics* is a bug.

**Determinism rules (apply everywhere):**

- Never rely on `Map`/object iteration order or SQL result order for anything user-visible. Every result list is explicitly sorted by the core comparator.
- Final ordering always ends with a primary-key ascending tie-break (compare as the PK's declared type).
- Accumulate scores in a defined order (sorted token order, then sorted doc-id order) so floating-point summation is identical on both sides. IEEE-754 doubles in V8 are deterministic; only *order of operations* can diverge.
- No `Date.now()`, no randomness anywhere in the engine.

---

## 4. The query semantics specification

This section is the spec both drivers implement and the golden tests encode. Where marked **[verify-vs-orama]**, the differential harness (§8.1) must confirm Orama's actual behavior before freezing the spec; if we deviate deliberately, record it in the doc and changelog.

### 4.1 Tokenizer

Input: a string field value. Output: ordered token list (duplicates kept — tf counting needs them).

1. Unicode-normalize NFKD, strip combining marks (`\p{M}`) — folds diacritics (`café` → `cafe`).
2. Lowercase (`toLowerCase()`).
3. Split on any run of characters not in `\p{L}\p{N}` (Unicode letters/digits). Underscore splits too (so `snake_case` yields `snake`, `case`) **[verify-vs-orama — Orama's default splitter differs slightly; pick ours deliberately and document]**.
4. **Email handling** (matters for `from:` search): if the raw value matches a simple email shape (`local@domain`), additionally emit the whole address as one token *plus* the split parts. E.g. `jane.doe@showandtour.com` → `jane.doe@showandtour.com`, `jane`, `doe`, `showandtour`, `com`. Implemented as a pre-split pass, applied uniformly to all string fields (no per-field config in v1).
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

### 4.5 `threshold`

Orama semantics **[verify-vs-orama, then freeze]**: with multiple query tokens, let `A` = docs matching *all* tokens, `U` = docs matching *any*. `threshold: 0` → return only `A`. `threshold: 1` (default) → return all of `U`. `0 < t < 1` → `A` plus the top `t`-fraction (by score) of `U \ A`.

### 4.6 Ordering, comparator, ties

- If `order[]` is present (note: **both** the client's `DEFAULT_SEARCH_QUERY` and the server `list` default to `updated_at DESC`, so this is the dominant path — BM25 ordering only applies when a caller explicitly clears `order`), results sort by each key in sequence via the core comparator, then PK-ascending tie-break.
- Else, with a `term`: score descending, then PK ascending.
- Else (no term, no order — shouldn't occur given defaults, but define it): PK ascending.

**Core comparator (`core/compare.ts`) — the single most consistency-critical module:**

- Numbers: numeric. `NaN` never occurs (rejected at write). Booleans: `false < true`.
- **Strings: Unicode code-point order** — NOT naive JS `<` (UTF-16 code-unit order diverges from code-point order for astral-plane chars: emoji, rare CJK). SQLite's BINARY collation over UTF-8 *is* code-point order, so the JS side must match SQLite, not vice versa. Implement by comparing via `codePointAt` iteration; golden vectors must include astral-plane cases (`'\u{1F600}'` vs `'�'`).
- `null`/missing sort **last** regardless of direction **[decision — SQLite sorts NULL first ASC by default; the SQL compiler must emit `ORDER BY col IS NULL, col` to enforce nulls-last so both sides agree]**.

### 4.7 `properties`, `distinctOn`, `limit`/`offset`/`cursor`

- `properties`: restricts which searchable fields participate in term matching (default `'*'`). Unknown property → 400 `DelightError.badRequest`.
- `distinctOn`: after ordering, keep the first hit per distinct value of the given field.
- `limit`/`offset` apply after ordering + distinct. Existing server clamps stay (`limit` clamped to 1..5000 sparse / 1..100 hydrated; `order` keys validated against `sortable_fields` → 400). Cursor semantics unchanged from today's `list` implementation (opaque cursor over the ordering keys + PK).

### 4.8 Facets

Same shapes as Orama's `FacetDefinition` (already leaked into `SearchQueryInput`): string facets → value counts (with `limit`/`order` options), number facets → configured ranges, boolean facets → true/false counts. Counted over the **full matched set** (after `where`, before `limit`/`offset`). Facet value ordering: count descending, then value ascending via core comparator.

### 4.9 Vector and hybrid

- `vector: { value: number[], property: 'embedding_field' }` → mode `vector`: score = cosine similarity, brute-force over all docs having that field. Result ordering: similarity desc, PK asc. A `similarity` threshold defaults to Orama's `0.8` **[verify-vs-orama — confirm the default and whether the current API exposes it; preserve whatever the wire accepts today]**.
- `term` + `vector` → mode `hybrid`: run both, min-max normalize each score set to [0,1] over its own candidates, combine `0.5 * text + 0.5 * vector` **[verify-vs-orama — replicate Orama's actual fusion weights/normalization from source, then freeze ours]**.
- Vectors are stored as `Float32Array` (client passes them from sync; server reads BLOBs). Compute in float64 accumulators, deterministic iteration order. **This plan makes vector fields work on the client too** (today `#projectToIndex` silently drops them) — the unified sparse doc (§7.0) carries them.

### 4.10 Error mapping

All query-shape errors (unknown filter property, invalid operator for type, unknown order key, unknown searchable property) throw `DelightError.badRequest(...)` — replacing today's remap of Orama's `UNKNOWN_FILTER_PROPERTY`/`INVALID_FILTER_OPERATION` internal errors.

---

## 5. The `where` DSL specification

The DSL is unchanged from what consumers use today (it was raw Orama syntax; it becomes ours):

| Operator | Applies to | Semantics |
|---|---|---|
| bare scalar / `{eq}` | string, number, boolean, enum | strict typed equality |
| bare array (enum) / `{in}` | scalar fields | value ∈ list |
| `{nin}` | scalar fields | value present AND ∉ list (missing/null ⇒ no match) |
| `{gt,gte,lt,lte}` | number, string, boolean | core comparator ordering |
| `{between: [a,b]}` | number, string | inclusive both ends |
| `{containsAll: [...]}` | array fields | every listed value present in the array |
| `{eq}` / `{in}` on array fields | array fields | array contains the value / contains any listed value **[verify-vs-orama]** |
| `and: [...]`, `or: [...]`, `not: {...}` | composites | logical composition; `not` = complement **within the corpus** (a doc missing the field passes `not: {eq}` — define, test, freeze **[verify-vs-orama]**) |

**Normalization** (`core/where.ts`, ported from today's `normalizeWhere` in `search-query.ts:215-266`): plain scalar on enum → `{eq}`, array on enum → `{in}`, plain number → `{eq}`. Both drivers run the same normalizer first.

**Null/missing rule (freeze this):** every leaf predicate evaluates **false** when the field is missing or null, except inside `not` per the row above. The SQL compiler must reproduce this exactly (SQL three-valued logic makes `NOT(col = x)` silently drop NULL rows — compile `not` explicitly as `(col IS NULL OR NOT(...))` per the frozen semantics).

**Type coercion rule:** the schema declares every path's type, so both sides coerce explicitly per type. Critical on SQL: `json_extract` returns booleans as `0`/`1` — the compiler compares against `0`/`1` for boolean paths. Golden vectors must cover: booleans, null vs absent key, empty arrays, empty strings, unicode strings, numeric strings (no implicit numeric coercion — `'5' ≠ 5`).

**Child keys:** paths use dot notation (`'address.city'`) exactly as today's nested Orama schema exposed them. The set of legal paths is closed: only fields declared `.searchable()`/`.sortable()` in the table schema (this is what makes SQL compilation tractable — see §7.4).

---

## 6. Public API compatibility (type decoupling)

Phase 1, zero behavior change, independent of everything else:

- Re-declare in `search/core/types.ts`, structurally identical to today's shapes: `SearchQuery` (the `Pick<SearchParams…>` union collapses into one owned interface with `term, where, order, limit, offset, facets, boost, properties, tolerance, threshold, exact, distinctOn, vector, q, sparse, cursor`), `SearchQueryResults` (`count, elapsed, facets, hits, cursor`), `WhereCondition`, `FacetDefinition`, `FacetResult`, `SearchableType`, and the hit shape (`{ id, score, document }`).
- Replace the Orama type imports in `src/schema/schema.ts:1-12` and `src/search-query.ts:1` with these. Keep re-exports from the barrels so consumer import paths don't change.
- `mode` and `sortBy` remain non-public (derived internally, as today). The README's mention of settable `mode: 'vector'` is already wrong vs the types — fix the README, don't widen the type.
- Type-level names on the generic plumbing (`SearchSchema<Table>`, `OramaType<T>` → `IndexFieldType<T>`, `orama_schema` → `index_schema` in `table.config`) get renamed in Phase 3 when the engine lands; Phase 1 only severs the *import* dependency.
- `encodeSearchQuery`/`decodeSearchQuery` and the URL wire format are untouched forever — they're engine-neutral already.

Acceptance: `@orama/orama` appears in exactly two files after Phase 1 (`db.server.ts`, `database.worker.ts`), and the package's `.d.ts` output contains no orama imports.

---

## 7. Storage and drivers

### 7.0 One sparse projection to rule them all (prerequisite for parity)

Today the server indexes `table.toSparse(entity)` + `computeFkDerivedFields`, while the client worker re-derives its own projection (`#projectToIndex`, `database.worker.ts:1063-1121`) — dropping vectors, geopoints, and type-mismatched values. **This fork must close or engine parity is meaningless.**

Rule: the server computes the sparse doc once per write; that exact object is (a) what the server indexes, (b) what the sync protocol ships, (c) what the client indexes **verbatim**. Delete `#projectToIndex`; the client trusts the wire. (Client-originated optimistic writes index their local `toSparse` result and are corrected when the server echo arrives — same as entity state today.)

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
	vec         BLOB NOT NULL,             -- Float32Array bytes, little-endian
	PRIMARY KEY (entity_type, field, doc_id)
) WITHOUT ROWID;
```

`search_index` and `search_journal` (and their row types, chunking, msgpack, compaction, replay, `invalidateIndexes`) are **dropped** at the end of Phase 3.

### 7.2 Server write path

On entity upsert (inside the existing write transaction, after the entity row):

1. Compute the sparse doc (§7.0) and tokenize each searchable text field (`core/tokenizer.ts`), producing `{ field → Map<token, tf> }` and `{ field → length }`.
2. Read the doc's old `lengths` row; for each previously-indexed field, delete this doc's postings (`DELETE FROM search_postings WHERE entity_type=? AND field=? AND doc_id=?` — needs a scan within the field unless we also read old tokens; **simplest correct approach:** store the old token set per doc. Rather than a second table, recompute old tokens by tokenizing the *previous* sparse doc, which the write path already has in hand for `updated_at`/diff purposes; where it doesn't, fall back to `DELETE ... WHERE entity_type=? AND doc_id=?` via a `(entity_type, doc_id)` secondary index on `search_postings`). Decrement `df` per removed token (delete `search_tokens` rows reaching 0), decrement field stats.
3. Insert new postings, upsert `df` (+1 per newly-present token/doc pair), upsert `lengths`, bump field stats.
4. Vector fields: replace `search_vectors` rows.

Delete path: step 2 + drop `search_docs`/`search_vectors` rows. Rollback safety is free — it's all one SQLite transaction with the entity write. Cost per write: tens of small indexed row operations; benchmark target < 5ms for a typical doc (§8.3).

Add the secondary index for the delete path:

```sql
CREATE INDEX IF NOT EXISTS search_postings_by_doc ON search_postings (entity_type, doc_id);
```

### 7.3 Server term-dictionary cache

Per (entity_type, field), lazily load the token list from `search_tokens` into a sorted in-memory array on first search touching that field; invalidate incrementally on write (insert/remove in sorted position) — this keeps prefix expansion (binary search + range walk) and fuzzy scans (§4.3) purely in-memory while postings stay on disk. Dictionaries are the *small* part of an index; if one ever exceeds a sanity bound (say 200k tokens), fall back to SQL `BETWEEN prefix AND prefix||x'F7BFBFBF'` range queries. Cache lives on the `SearchIndex`-equivalent struct; dropped when the DO evicts — rebuilt lazily, no correctness impact.

### 7.4 SQL filter/sort compilation (child keys included)

Entities already live in SQLite. `where` + `order` + pagination compile to SQL over the entity table; the postings tables are touched only when a `term`/`vector` is present. Since both the client `DatabaseSearch` default and server `list` default are `term: '', order: updated_at DESC`, **the dominant query becomes a single indexed SQL query** — this alone removes most observed latency.

**Child-key paths → VIRTUAL generated columns.** For every declared filterable/sortable path (the closed set from the schema — `sortable_fields` + searchable scalars):

```sql
ALTER TABLE "<entity_table>" ADD COLUMN "sv$address__city" TEXT
	GENERATED ALWAYS AS (json_extract(data, '$.address.city')) VIRTUAL;
CREATE INDEX IF NOT EXISTS "idx_<entity>_address__city" ON "<entity_table>" ("sv$address__city");
```

Rationale (from design discussion, keep these):
- `ALTER TABLE ADD COLUMN` works for VIRTUAL generated columns (NOT for STORED) → adding a sortable field later is cheap DDL, no table rewrite.
- An index on a VIRTUAL column materializes the computed values *in the index* → query perf equals a real column, zero row-write amplification.
- Naming: `sv$` prefix + path with `.` → `__` avoids identifier-quoting hazards and collisions with real columns. Top-level fields that are already real columns need no generated column — compile directly against them.
- Migration when the declared path set changes: diff `PRAGMA table_info` against the schema at DO bootstrap, `ADD COLUMN` + `CREATE INDEX` for new paths, `DROP INDEX`/`DROP COLUMN` for removed ones.

**Compiler rules (`server/sql_where.ts`):**
- Boolean paths: compare against `0/1` (json_extract convention).
- `not`: emit `(col IS NULL OR NOT (...))` per the frozen null rule (§5).
- Order: `ORDER BY (col IS NULL), col ASC|DESC, pk ASC` (nulls-last, PK tie-break).
- String comparisons: BINARY collation (default) = code-point order = the core comparator. Do not set any collation.
- Array-field predicates (`containsAll`/`in`/`eq`-on-array): `EXISTS (SELECT 1 FROM json_each(json_extract(data,'$.path')) WHERE json_each.value = ?)` composed per element. No index in v1; add a `search_values(entity_type, field, doc_id, value)` side table later only if a hot array filter demands it (note the IDB `multiEntry` symmetry, §7.6).

### 7.5 Server search pipeline (`server/engine.ts`, synchronous)

```
list(entity_type, query):
	normalize where (core/where) · validate order keys / properties → DelightError.badRequest
	if no term and no vector:
		SQL: SELECT ids (or full rows) WHERE <compiled> ORDER BY <compiled> LIMIT/OFFSET  → done
	else:
		candidate_ids = where ? SQL id-set : null
		text: for each query token (sorted): expand via dictionary cache (prefix ∪ tolerance);
		      fetch postings per matched token; accumulate BM25 into Map<doc_id, score>
		      (skip docs ∉ candidate_ids when the SQL set is smaller; otherwise filter after)
		vector: brute-force cosine over search_vectors rows (∩ candidates)
		hybrid: fuse (core/fusion)
		apply threshold (§4.5) · order (core/compare — by order[] if given, else score) ·
		distinctOn · facets (core/facets, pre-limit) · cursor/limit/offset · hydrate docs
```

Ghost-document filtering, null-array stripping, and the Orama error remap all cease to exist. `getIndex`/`rebuildIndex`/`saveIndex`/journal functions are deleted; a `rebuildSearchTables(entity_type)` full-scan (entity table → write path per row, batched transactions) replaces `rebuildIndex` as the migration/repair path.

**Sync pagination divorce (do this in the same phase):** the sync path currently pages via `searchOrama` (`db.server.ts:1035`, `:1085`) — the source of the >1000-doc deferred-removal data-loss class. Rewrite sync paging as direct SQL over the entity table (`updated_at` + PK tie-order), preserving the half-open window semantics and grow-and-retry equal-timestamp handling documented in `db.server.sync.test.ts`. Sync becomes engine-independent forever.

### 7.6 Client: IDB postings store (`client/idb_store.ts` + `client/engine.ts`, async)

**Decision:** real IDB-backed postings (not in-memory rebuild). Removes the memory ceiling and the load-time rebuild; windows may exceed 5000 docs.

Object stores (in the existing client DB alongside `sync_meta`; the `search_index` blob store is deleted):

| Store | Key | Value | Notes |
|---|---|---|---|
| `postings` | `[entity_type, field, token, doc_id]` | `tf` | prefix scan = `IDBKeyRange.bound([t,f,prefix], [t,f,prefix+'￿'])` — IDB stores are sorted B-trees, same range-scan as SQLite |
| `tokens` | `[entity_type, field, token]` | `df` | dictionary; loaded per (type,field) into a sorted in-memory array on first use, incrementally maintained (mirror of §7.3) |
| `docs` | `[entity_type, doc_id]` | `{ sparse_doc, lengths }` | the verbatim server sparse doc (§7.0) — also serves filter/sort |
| `field_stats` | `[entity_type, field]` | `{ doc_count, total_len }` | |

**Filter/sort on the client:** declare IDB indexes on the `docs` store for each sortable/filterable path (`keyPath: 'sparse_doc.address.city'`), with `multiEntry: true` for array fields (native array-containment — the exact analogue of the SQL side table). Index definitions happen in `onupgradeneeded`; derive the IDB version from the existing `config_version` so a schema change triggers index re-creation + full local rebuild through the machinery that already exists for config bumps.

**IDB gotchas (encode as review checklist for the implementing agent):**
- A transaction auto-commits the moment you `await` any non-IDB promise inside it. Structure each write as: compute everything pure *first* (tokenize, diff, df deltas), then open one transaction and issue all requests without interleaving foreign awaits.
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

**Client/server choice policy:** the 5000-doc auto-switch (`database.worker.ts:415`, `#switchToServerMode`) loses its original justification (memory). Replace count-based switching with a **coverage-based** rule: client search is used when the entity type's synced window is complete (full-table sync) or the query is explicitly marked client-side; otherwise route to the server, which has the full corpus and correct global BM25 stats. Keep the existing threshold config as an override valve for one release, then remove. Document loudly: *identical results are guaranteed only when the corpora match; window ⊂ corpus ⇒ the server answer is the authoritative one.*

**Worker deletions:** orama imports, `#projectToIndex`, the `removeMultiple` batch-size workaround, the `insertMultiple` fallback, ghost filtering, `saveOrama`/`loadOrama` and the doubling persist schedule (index persistence is now continuous and transactional).

---

## 8. Testing strategy — this is the consistency guarantee, not garnish

### 8.1 Differential harness (vs Orama, Phase 2 gate)

A test-only harness that runs the same corpus + query battery through real Orama 3.1.18 and the new core (memory-backed store):

- Corpora: seeded deterministic generators — realistic strings (names, emails, sentences with shared vocabulary), numbers, booleans, enums, arrays, nested objects, vectors; sizes 10 / 1k / 20k docs; plus a dump of a real dev corpus if available.
- Query battery: every operator × type × edge case; term queries hitting prefix/tolerance/threshold/boost/properties/exact combinations; facets; distinctOn; vector + hybrid.
- Assertions: **exact** membership/count/facet parity for filter-only queries; **rank-order** parity (Kendall-tau ≥ threshold + identical top-10 membership) for scored text queries (score values exempt); every `[verify-vs-orama]` marker in §4–5 resolved and the spec updated to record what Orama actually does and what we chose.
- Known Orama bugs are excluded from parity (ghost docs, null arrays, deferred removals) — the harness runs Orama with the same guards production code uses today.

### 8.2 Golden vectors (permanent, both drivers)

A single JSON fixture set (`search/__tests__/golden/`) of `{ corpus, query, expected_ids_in_order, expected_counts, expected_facets }`, generated once from the memory reference implementation and hand-audited. The **same fixtures** run against: core+memory store (vitest), server driver over real DO SQLite (existing `db.server.*.test.ts` infra / miniflare), client driver over real IDB (fake-indexeddb in vitest + at least one real-browser pass). Byte-identical output required. Mandatory edge coverage: astral-plane string ordering, null vs absent, empty string/array, boolean coercion through `json_extract`, `not` with missing fields, equal-score PK tie-breaks, equal `updated_at` ordering, tolerance boundary lengths, email tokenization.

### 8.3 Performance benchmarks (regression-gated)

Targets on a dev machine (document actuals; the point is trend, not the absolute number): server single-doc index write < 5ms at 100k-doc corpus; server text search (2 tokens, tolerance 1) < 30ms at 100k docs; filter+sort-only < 5ms at 100k docs; client search < 50ms at 20k-doc window (Chrome); DO cold-start added search cost = 0 (assert no search table reads on boot). Compare against Orama baselines captured before the switch, including the 10s serialize being eliminated.

---

## 9. Rollout phases

Each phase lands independently and is releasable. **Never auto-commit; Brian reviews everything.**

**Phase 1 — Type decoupling** (small, do anytime, zero behavior change)
Own the public types (§6). Acceptance: no orama imports outside `db.server.ts` / `database.worker.ts`; `.d.ts` output orama-free; all existing tests green untouched.

**Phase 2 — Core engine + memory store + harnesses**
`core/*` complete per §4–5; memory-backed reference store; differential harness green with all `[verify-vs-orama]` markers resolved and the spec frozen; golden vectors generated. No production code path touched yet.

**Phase 3 — Server driver**
Tables (§7.1), write path in-transaction (§7.2), dictionary cache (§7.3), SQL compiler + generated-column migration (§7.4), sync-pagination divorce (§7.5). Gated by per-table flag `search_engine: 'native' | 'orama'` (default `'orama'`) in table config; on first native wake, `rebuildSearchTables` populates from the entity scan (reuse the in-flight-rebuild re-entrancy guard pattern). Bump `config_version` on switch so clients resync cleanly. Keep the orama path compiling for one release as fallback; then delete `getIndex`/`saveIndex`/journal/`search_index`/`search_journal` and Appendix-A workarounds ①–⑧.

**Phase 4 — Client driver**
Unified sparse projection (§7.0) — requires Phase 3 server shipping sparse docs verbatim; IDB stores + async driver (§7.6); config_version-driven IDB upgrade + full local rebuild on switch; coverage-based mode policy. Delete worker orama code and Appendix-A ⑨–⑫. Real-browser golden pass required.

**Phase 5 — Excision**
Remove `@orama/orama` from package.json; legacy `search_index`/`search_journal` table drop migration; README/SKILL.md/agent-docs updates; delete obsolete memory entries (orama-ghost-documents, the null-array-props note) and add a native-search memory. Changeset: minor (API-identical), with a migration note that server search tables rebuild automatically on first wake per table.

**Effort (calibration, not commitment):** core+spec+harness ≈ 2–3k lines incl. tests; server driver ≈ 1–1.5k; client driver ≈ 1–1.5k; net LOC change near zero after deletions. The expensive part is resolving the `[verify-vs-orama]` markers and the golden edge cases — budget as much time for §8 as for the engine.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Orama where-DSL quirks consumers accidentally depend on | Differential harness before any production cut-over; deviations documented + changelogged |
| SQL vs JS semantic drift (collation, NULLs, bool coercion) | Single frozen spec (§4.6, §5) + golden vectors on all three storage backends; comparator matches SQLite, never vice versa |
| Fuzzy/threshold behavior underdocumented in Orama | `[verify-vs-orama]` markers force reading Orama source / empirical tests before freezing |
| IDB transaction auto-commit corrupting index/sync atomicity | Pure-compute-then-single-transaction write structure (§7.6 checklist); invariant test that sync_meta and postings commit together |
| Generated-column migration on live DOs | VIRTUAL columns = cheap DDL; diff-based bootstrap migration; `rebuildSearchTables` as universal repair |
| Concurrent journal work (in flight now) conflicts | Journal is additive to the orama path only; Phase 3 deletes it wholesale — coordinate timing, don't rebase around it |
| BM25 stats divergence on partial client windows | Not fixable by design — coverage-based mode policy + explicit documentation (§7.6) |

## Appendix A — Orama workaround inventory (deleted by this plan)

Server: ① ghost-document filters (`db.server.ts:1325-1358`, `:1053-1056`) ② null-array stripping ×4 (`toSparse`, snapshot load, journal encode/decode) ③ msgpack chunked snapshot + journal + replay + compaction (`:2044-2196+`) ④ config-comparison function-drop bug (`:1832-1842`) ⑤ rollback `invalidateIndexes` (`:2161-2173`) ⑥ orama-error→400 remap (`:1315-1323`) ⑦ sync paging via orama incl. >1000-doc deferred-removal fix ⑧ re-entrant rebuild guard (`:1975-1984`).
Client: ⑨ `removeMultiple` batchSize fix (`database.worker.ts:356-397`) ⑩ `insertMultiple` mid-page-throw fallback (`:400-408`) ⑪ `#projectToIndex` type-guarding (`:1055-1121`) ⑫ ghost filter (`:861-877`).

## Appendix B — Open questions (answer before or during Phase 2)

1. Email tokenization scope: uniform on all string fields (planned) vs opt-in per field? Uniform is simpler; cost is a few extra tokens per email-shaped value.
2. Facet parity depth: are number-range and boolean facets actually used by any consumer, or only string facets? Trim scope if unused.
3. Is there a real offline-first product driving large client windows? It shaped the IDB-postings decision (already locked yes); it should also shape the default coverage policy (§7.6).
4. `similarity` threshold for vector mode: is it reachable through today's public `SearchQuery`? Preserve exactly what the wire accepts.
