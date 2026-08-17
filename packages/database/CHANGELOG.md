# @delightstack/database

## 2.2.0

### Minor Changes

- f23eed0: Generated SQL now double-quotes every consumer-declared identifier, so reserved words work as table and column names.

  `sanitize()` has always stripped table/column/index names to `[a-z0-9_]` as an injection guard, but the names were then interpolated **unquoted** — which meant a table named `transaction` or a column named `order` produced a syntax error at the very first statement, `CREATE TABLE transaction (...)`, and the Durable Object never finished booting. Sanitizing is not the same as being valid: a bare reserved word is a legal identifier only in quotes.

  A `quote()` helper (sanitize + `"..."`) now wraps identifiers at every generated-SQL site in `db.server.ts`: `CREATE TABLE`, `ALTER TABLE ... ADD COLUMN`, `CREATE INDEX` / `DROP INDEX` (name, table and each indexed column), the `get`/`exists` reads, the `INSERT`/`UPDATE`/`DELETE` builders and their column lists, the foreign-key expansion lookups, and the FK-derived cascade's `SELECT`/`UPDATE`. `destroy()` also quotes the table names it reads back out of `sqlite_schema`, which had the same failure. The search subsystem already quoted throughout and is unchanged.

  Column definitions built in `schema/table.ts` are covered too: a `foreignKey()` field emits `REFERENCES "<table>"("<column>")`. This was the last unquoted site, and it failed the same way as the rest — a `CREATE TABLE` naming a reserved-word parent table was a syntax error even though the table's own name was quoted. Both names are already validated to `[a-zA-Z0-9_]` at that point, so the quotes need no escaping.

  Sanitizing still happens first and is unchanged, so this is behavior-neutral for ordinary names — only the emitted SQL text differs. Names compared against `sqlite_schema` or `PRAGMA table_info` output stay unquoted, since SQLite reports them that way.

- c46dd5f: `db.list(type, { sparse: false })` is now typed with full entities.

  A `sparse: false` query has always been answered with complete rows — the client routes it to the server, which reads the entity table rather than the search projection. The types never said so: `ListHandle.hits`, `.items` and `load()` all claimed `Database.SearchEntity<T>` (searchable fields only), so any consumer that queried `sparse: false` to read a non-searchable field had to cast it away. The narrowing is now in the type: `db.list` infers the query type and resolves the document shape through `ListDocument<T, Q>` — `Database.Entity<T>` when the query carries `sparse: false`, `Database.SearchEntity<T>` otherwise.

  Only a **literal** `false` narrows. An object literal, an `as const` query and the function form (`db.list('post', () => ({ sparse: false }))`) all infer it; a query held in a `Database.SearchQuery` variable widens `sparse` to `boolean` and keeps the sparse type, which is the safe direction — the type can never over-promise fields the projection might not carry.

  `SearchHit` and `SearchResult` take a second, defaulted generic (`SearchHit<T, Doc = Database.SearchEntity<T>>`), so existing `SearchResult<typeof POST>` annotations keep exactly their old meaning and compile unchanged. **Pedantically breaking:** code that explicitly annotated the result of a `sparse: false` query as `SearchResult<T>` / `SearchEntity<T>` now sees the wider entity type on one side of that assignment — the annotation still compiles, but the casts it was written to justify are now unnecessary. Runtime behavior is untouched; this release changes types only.

### Patch Changes

- 7b6f516: The first-wake search rebuild is now resumable and chunked across wakes, so a large corpus can no longer wedge a Durable Object in a CPU-limit reset loop.

  Previously `bootstrapSearch()` ran the entire rebuild (re-derive + re-index every entity row) synchronously in the constructor. On a corpus big enough to exceed the Durable Object 30s CPU limit, workerd killed and reset the object — and because the schema signature was only persisted _after_ a completed rebuild, the next wake started over from row one. Every wake died the same way, taking every RPC (and the app on top of it) down with it, forever.

  Now each rebuild persists a per-entity cursor (last primary key, window bounds, config-bump flag) in the state row, checkpointed inside each 200-row batch transaction. A wake advances the rebuild by at most `searchRebuildRowsPerSlice()` rows (default 1000 — a row cap rather than a wall-clock budget, because workerd freezes `Date.now()` during synchronous execution), then defers the rest to a self-re-arming alarm (registered as the `search_rebuild` handler). A killed or deferred wake resumes at the last committed batch instead of restarting. The legacy `search_index`/`search_journal` drop and the `config_version` bump both wait until the rebuild actually finishes, so mid-rebuild clients keep their old corpus and resync exactly once at the end.

  Heads-up for subclasses that override `alarm()`: call `await super.alarm()` (or run the registered handlers yourself), or a deferred rebuild never continues.

## 2.1.0

### Minor Changes

- 738c56e: Per-entity sync gating, and a sign-out that can take sibling databases with it.

  **`hooks[entity].beforeSync` — sync is no longer all-or-nothing.** The sync endpoint returns the sparse (searchable) fields of every entity type, and `beforeList` has never applied to it: an entity with per-user visibility could only be protected by rejecting the whole request or opting the type out client-side with `search_mode: 'server'` (which the client, not the server, decides). The new per-entity hook denies one type and lets the rest of the request through — throw from it and that type is stripped from the query forwarded to `db.sync()` and comes back marked `denied: true`.

  The gate cannot be walked around by shaping the request: an omitted `entity` map means "sync everything", so the handler expands it to the configured types _before_ running the hooks rather than after. Entity types the app never configured are no longer forwarded to the database at all.

  **New response flag: `entity[type].denied`.** A sibling of the existing `deferred`, with the same minimal count-only shape (empty `created`/`updated`/`deleted`, zeroed window) and the opposite lifetime. `deferred` is a size decision, re-probed cheaply on every sync run so it clears by itself; `denied` is a permission decision, and re-asking earns the same answer. The client therefore drops a denied type from every later sync request for the session, routes its queries to the server (`mode: 'server'`, overriding both a forced `search_mode: 'client'` and a per-query `source: 'client'` — the refusal arrives at runtime, long after the query was written, so it is not treated as a caller error), and persists the decision in `sync_meta` so a reload does not re-attempt the backfill. `db.signOut()` wipes that record along with everything else, so a fresh sign-in re-asks.

  **Denial is treated as a revocation, not just a stop-sending.** The first `denied` result for a type purges what was already mirrored — its indexed documents _and_ its cached entity rows — because documents synced before the refusal are exactly what the permission was protecting; leaving them searchable on disk would make the hook a gate on future pages only. The type's sync window is reset to "never synced" at the same time, so a later re-grant backfills from scratch instead of resuming a cursor over documents nothing kept. Only the transition purges (both operations are single ranged deletes, and a reload restores the flag before the first request, so it never repeats).

  From then on the type accepts no local writes: an optimistic create/update, a websocket-pushed change, a local patch, and a `get()`'s fetch-and-cache all skip the index and the entity cache for a denied type — `get()` still answers it, straight from the server, it just leaves nothing behind. **Removals are deliberately not gated**: deleting a stale row out of a revoked mirror is always the right move, so the delete paths keep working.

  **`db.signOut({ databases })` reaches other scopes' data.** Sign-out only ever wiped the current `db_name`. An app that scopes `db_name` per org — the documented pattern — left every other org's mirror (entity cache, sync cursors, search postings) on disk. Pass `databases` as an array of names, or as a predicate run over `indexedDB.databases()`, and those are deleted too. Calling `signOut()` with no argument behaves exactly as before.

  Sibling deletes run after the current database's wipe (the freeze must not wait on them) and are best-effort: `deleteDatabase()` blocks indefinitely while another tab holds a connection, and that tab has no reason to let go — it is not the one signing out. Each delete is therefore bounded by a 2s timeout and its failure swallowed. A blocked sibling is a leftover database, never a failed sign-out. Where `indexedDB.databases()` is unavailable the predicate form has nothing to enumerate and only the current database is wiped.

## 2.0.0

### Major Changes

- d1b53f6: Client search is now IndexedDB-backed, and synced entities no longer carry vector fields.

  **The client index moved into IndexedDB.** The worker no longer builds an in-memory index, serializes it to a `search_index` blob and reloads it on boot. Search runs against real postings stores (`postings`/`tokens`/`docs`/`field_stats`) in the same IndexedDB database as the entity cache, through the same engine core the server uses. Consequences:

  - **No memory ceiling and no rebuild-on-load.** A synced window may be far larger than the old 5000-document limit, and opening a tab no longer deserializes an index before search works.
  - **Index writes are transactional.** Each sync page commits its documents, the entity-cache rows a delete invalidates, and the sync cursor that accounts for them in **one** IndexedDB transaction — so the synced window can never claim documents the index does not have. The old doubling save schedule (persist after page 1, 2, 4, 8…) is gone.
  - **The legacy `search_index` object store is deleted** on the first upgrade after this release. The index rebuilds from the ordinary sync path.
  - **Client and server results now come from one implementation.** Ordering, tie-breaks, tolerance, `threshold`, facets and `distinct_on` are the frozen spec on both sides, and the golden fixtures are replayed against the client driver.

  **Synced entities stop exposing vector fields.** Sync ships the server's sparse document _minus_ its `vector[...]` fields. Vector search is server-only, so the client never needed embeddings — but this is observable: an app reading `entity.embedding` off a _synced_ (sparse) document will now find it absent. Fetching the entity directly is unaffected.

  **The 5000-document auto-switch is replaced by coverage-based routing.** Where a query is answered is now decided per query, in this order:

  1. Any query carrying `vector` (including hybrid) goes to the server unconditionally — no embeddings exist on the client.
  2. Otherwise the client answers only when its synced window covers the whole table; until the backfill completes, the server answers, because it has the full corpus and the correct global relevance statistics. `entities[type].search_mode: 'client'` opts in regardless (a deliberate partial-corpus answer); `'server'` opts out of local search and local syncing entirely.
  3. `default_threshold` / `entities[type].threshold` still force the server above a local document count, but are **deprecated** and unset by default — they existed to defend a memory ceiling that no longer exists. They are removed in the next major.

  `getSearchMode()` therefore reports a live routing decision rather than a stored mode: an entity type reports `'server'` while its window is filling and flips to `'client'` when the backfill completes.

  **Documents are indexed as the server projected them.** The worker no longer re-derives its own projection of a synced document (the old projection dropped values whose runtime type did not match the schema, to avoid the old engine throwing mid-page on an insert). A synced document is indexed verbatim; a document that originates locally — a create/update response, a websocket event carrying a full entity, a local patch — is reshaped exactly the way the server's `toSparse` does (declared searchable paths only, nulls omitted) and is overwritten by the server echo. Nothing in the write path can throw on a malformed value, so the class of bug where one bad document dropped the tail of a sync page cannot recur.

- 6ff9e97: Orama is gone: the built-in SQLite search engine is the only engine.

  `@orama/orama` and `@msgpack/msgpack` are removed from the package's dependencies. Every table is now indexed by the SQLite driver that landed alongside it — postings written inside the same transaction as the entity row, no in-memory index, no msgpack snapshot, no write-ahead journal, no cold-start replay.

  **Your Durable Objects migrate themselves, once.** On the first wake after upgrading, each table:

  1. moves its sync metadata off the legacy `search_index` row — deletion tombstones into `search_tombstones`, `config_version` / `first_updated_at` / `last_updated_at` into `search_state`;
  2. rebuilds its search rows from its entity rows (one full table scan, batched, and it backfills the `$derived` sub-object that FK-derived search fields now live in);
  3. bumps its `config_version`, so **every client discards its local index and resyncs once**;
  4. drops the `search_index` and `search_journal` tables.

  The sequence is idempotent and never drops the legacy tables before the metadata migration and rebuild have succeeded — a wake that fails part way through simply retries on the next one. From then on a wake does **zero** search work: no search table is read or written on boot.

  **Breaking changes**

  - **The per-table `search_engine` option is removed.** It was introduced in this same unreleased major as a temporary opt-in; delete `{ search_engine: 'native' }` from any `Database.table(...)` call — the third `options` argument no longer exists.
  - **`table.config.orama` is now `table.config.index_schema`**, and it is the flat search schema itself rather than `{ schema, sort, components }`. The Orama-only `sort` (`IndexSorterConfig`, also removed from the public types) and `components.getDocumentIndexId` members are gone. The sync response's `entity[type].config` field carries the same shape, so a client on an older version of this package cannot read a newer server's config payload — deploy both sides together.
  - **`DatabaseServer.MAX_DELETE_TOMBSTONES` and `DatabaseServer.MAX_SEARCH_JOURNAL_ROWS` are removed.** Tombstone retention (still 10,000 per type, oldest half pruned with a `config_version` bump) is owned by the search store; there is no journal to bound.
  - `OramaType<T>` is renamed `IndexFieldType<T>`. `SearchSchema` keeps its name; `Database.SearchConfig` is removed.

  **Fixed along the way:** a search state row whose `first_updated_at` was still `0` (a table rebuilt while empty, or migrated from an index that had never been written) stayed pinned at `0` forever, which a descending-backfilling client reads as "you have reached the beginning" after its very first page. The first write to such a type now sets the lower window bound.

- 433c6a4: Own the search types and rename the search-query keys (first phase of the native search engine).

  **Type ownership.** `SearchQuery`, `SearchQueryResults`, `WhereCondition`, `FacetDefinition`, `FacetResult`, `SearchableType` and the hit shape are now declared by this package in `src/search/core/types.ts` instead of being re-exported Orama types. The published `.d.ts` output no longer references `@orama/orama` at all, so consumers stop inheriting Orama's type surface (and its future breaking changes). Import paths are unchanged — `Database.SearchQuery<Table>` and friends still come from the same barrels — and the new types are also exported directly from the package root.

  **Breaking query-key renames.** The query DSL now uses this package's own vocabulary (_fields_, matching `.searchable()` / `searchable_fields`) and its snake_case convention:

  | Old                      | New                                                             |
  | ------------------------ | --------------------------------------------------------------- |
  | `distinctOn`             | `distinct_on`                                                   |
  | `properties`             | `fields`                                                        |
  | `vector.property`        | `vector.field`                                                  |
  | `order[].key`            | `order[].field`                                                 |
  | `containsAll` (where op) | `contains_all`                                                  |
  | `containsAny` (where op) | `contains_any`                                                  |
  | `nin` (where op)         | `not_in`                                                        |
  | `q`                      | removed entirely — from the typed API **and** from the URL wire |

  `tolerance` is deliberately unchanged.

  **No legacy aliases — old spellings stop working.** There is deliberately _no_ read-alias layer: `decodeSearchQuery` reads only the new names and `normalizeWhere` only the new where operators. Old URLs therefore break — `?q=`, `?distinctOn=`, `?properties=`, a `vector` param carrying `property`, an `order` entry carrying `key`, and `containsAll`/`containsAny`/`nin` inside a `where` JSON param are all ignored (or rejected as unknown operators) rather than translated. Pagination cursors minted before this release can carry `q` and break the same way; re-issue the query. `encodeSearchQuery` emits only the new names, including the URL params `fields` (was `properties`) and `order` entries built from `field`.

  **Migration.** Rename the keys above in any typed query you build, and update any hard-coded or bookmarked search URLs (`q` → `term`, `distinctOn` → `distinct_on`, `properties` → `fields`).

  **New: a public `similarity` floor for vector search.** `vector` is now `{ value, field, similarity? }` — `similarity` is the inclusive minimum cosine similarity a document must reach (default `0.8`, applying to vector and hybrid queries). It was previously fixed at `0.8` with no way to change it through the typed API or a URL; because it lives _inside_ the `vector` object it travels in the existing `vector` JSON URL param, so no new URL param exists.

  **Docs.** The `threshold` docstring described semantics the key never had ("minimum relevance threshold"); it now documents the real behavior — `0` returns only documents matching every term token, `1` (the default) returns documents matching any token, and a fractional value returns all-token matches plus that top fraction of the partial matches. The README's settable `mode: 'vector'` example is also gone — the search mode has always been derived from whether `term`/`vector` are present.

  **Tokenizer: apostrophes fold instead of splitting.** An apostrophe (`'` or `’`) between two letters or digits is now removed before tokens are split, so `john's` indexes as `johns`, `it's` as `its`, and `o'brien` as `obrien` — no stray `s` token on every possessive, and the apostrophe-less spelling matches exactly. Apostrophes anywhere else (leading, trailing, isolated, doubled) remain ordinary separators. This changes which documents match terms containing apostrophes, and slightly shifts relevance ranking for corpora that contain them.

  **Tokenizer: five further rules (all behavior changes vs Orama).**

  - **Invisible format characters are stripped, not treated as separators.** Every `\p{Cf}` (soft hyphen, zero-width space/joiner/non-joiner, BOM, bidi controls) and Arabic tatweel `U+0640` folds to nothing before anything else, so a soft-hyphenated `data\u00ADbase` indexes as the single token `database` (Orama indexed `data` + `base`) and an elongated `مـــد` equals `مد`.
  - **`U+02BC` (modifier letter apostrophe) folds like `'` and `’`.** `johnʼs` now indexes as `johns`. Because `U+02BC` is a Unicode _letter_, it previously glued the possessive into one odd token; outside a word it is now an ordinary separator.
  - **camelCase words split, and the whole word is kept too.** `getUserData` indexes as `getuserdata`, `get`, `user`, `data`, and `HTTPServer` as `httpserver`, `http`, `server` — so both the literal spelling and each part are findable. Plain words are still emitted exactly once; a digit before a capital (`v2Beta`) is not a boundary.
  - **Dotted acronyms fold.** `U.S.A.` and `u.s.a` both index as `usa`, `e.g.` as `eg`. Only _single_ letters between dots qualify, so `example.com`, `3.14` and `u.s.army` are untouched.
  - **Numbers with internal separators are kept whole as well as split.** `3.14`, `1,000`, `2.5.1` and `555-1234` each emit the whole chunk plus their digit runs, so a decimal or a phone number is findable as itself (previously only `3` and `14` were indexed). A chunk containing a letter (`v2.5`) does not qualify.

  Together these change which documents match affected terms and shift relevance ranking on corpora containing camelCase identifiers, acronyms, decimals or soft hyphens. The query side runs the identical function, so both sides always agree.

  No other behavior changes beyond the renames.

- d86752e: v2 simplification: one reactive handle API, zod removed, and a much smaller surface.

  **Client — three reactive handles replace five overlapping read APIs.** `db.get(type, id)` returns a cached reactive `EntityHandle` (`.value`, `.status`, `await .load()`), `db.entity(type, id)` stays the editing wrapper (now with `.load()` returning the entity and a `status` getter), and `db.list(type, query)` returns a reactive `ListHandle` — the merger of the old `db.list` and `db.watch` — with live `results`/`docs`/`count`/`has_more`/`mode`, a live `query`, `loadMore()`, and one-shot `await .load()` that also works on SSR. Removed: `db.watch` (`DatabaseWatch`), `db.read` (`EntityReader`), `EntityState.from`, `markHydrated`, the worker RPCs `getSearchMode`/`isSynced` (every result now carries `mode: 'client' | 'server'` — the live routing decision, per result), and `SearchResult.elapsed`. `WatchStatus` is renamed `HandleStatus`. The old `$derived(await db.get(id))` pattern becomes `db.get(id).value` or `$derived(await db.get(id).load())`.

  **Schema — zod is gone.** Validation is in-house and dependency-free; `parse()` behavior is unchanged except failures now throw `DelightError` (status 400, `issues` attached) and format checks compose with `min`/`max` (zod silently dropped a `min` when a format replaced the base schema). The zod-passthrough builder methods (`endsWith`, `transform`, `refine`, `gte`/`lte`, `prefault`, `multipleOf`, …) are deleted — `.check(fn)` is the custom-validation escape hatch and `.step(n)` sets the form step. `table()` now takes 2 generic parameters instead of 12, `Database.Table` is the one table type (`Database.AnyTable` remains as a deprecated alias), and `config.table_definition` is a plain `Record<string, string>`.

  **Server.** `createDatabaseHandle` supports only the `tables` + `hooks` mode (`tables` is required); `defineRoute` and the `routes` array are removed, and the sync endpoint is POST-only. `DatabaseSyncRequest` drops the top-level `start_updated_at`/`end_updated_at`/`limit` — ranges and limits are per-entity in the `entity` map (still one request for any number of entity types; `config_version` is now optional). The batch array overload of `DatabaseServer.get()` is removed, as are the never-read `event.user_id` fields on transaction operations. `SqlServer` moved into `@delightstack/auth` (it was auth-private in practice); `@delightstack/database` keeps `prepareSql`/`SqlTaggedTemplate`.

  **Websocket.** `EntityChangedMessage.user_id` is removed and `entityChanged` is now `(action, entity_type, id, data?, sparse?)` — the `user_id` slot was never populated.

  Internals: the search subsystem's three engines now share `core/pipeline.ts`/`core/dictionary.ts`/`core/schema_fields.ts` (golden vectors unchanged — behavior is frozen), and roughly 5,600 net lines were deleted across the packages.

  **DX round (same release).**

  - **Root entry is schema + types only.** `@delightstack/database` no longer re-exports `/server` — import `createDatabaseHandle` from `@delightstack/database/server`. The unused `./schema` export is removed. A schema-only import can no longer drag the SvelteKit handler into a worker/client bundle.
  - **`prepareSql`/`SqlTaggedTemplate`/`SqlPreparedQuery`/`SqlQueryFn` moved to `@delightstack/utilities`** (re-exported from `@delightstack/database/server` for compatibility). `@delightstack/auth` now depends only on utilities — not on the database package.
  - New **`DatabaseStub<Config>`** type: the async RPC projection of `DatabaseServer`, so a Durable Object stub can be cast once at the boundary (`event.locals.db`) and stay fully typed everywhere — no more hand-written `unknown`-typed RPC interfaces in `app.d.ts`.
  - New **alarm registry**: `DatabaseServer.registerAlarm(name, fn)` + a base `alarm()` that runs every registered handler with per-handler error isolation. `imageProcessing()` and `aiProcessing()` self-register, so subclasses no longer hand-write an `alarm()` fan-out. New `DatabaseServer.instanceName(ctx)` (static) and `this.instance_name` recover the `idFromName()` key without casting `ctx.id`.
  - **Typed database ↔ websocket contract.** `DatabaseBroadcast`, `DatabaseClientHooks`, and `DatabaseEntityChange` are exported from the database root; `WebsocketServer` `implements DatabaseBroadcast` and `WebsocketClient.databaseHooks()` returns `Required<DatabaseClientHooks>` (websocket gains a type-only dependency on database; `EntityChangeEvent` is now an alias of `DatabaseEntityChange`). Drift between the packages is now a compile error.
  - **`foreignKey` accepts the referenced table object** (`table: organizationTable`) as well as its name string — a typo'd reference becomes a compile error.
  - `@delightstack/ai`: the `ws` option is now the minimal `AiBroadcastChannel` (`broadcast()` only), satisfied by a `WebsocketServer` DO stub directly — no more `as unknown as WebsocketServer` at the call site. The AI tables also stop declaring `created_at`/`updated_at` (auto-managed epoch-ms numbers in v2; the old datetime-string declarations threw at table-definition time).

  **Follow-up round (same release).** `ListHandle.results`/`docs` renamed to `hits`/`items` (`SearchResult.docs` → `items`; hit objects keep `{ id, score, document }`). `createDatabaseHandle`'s `sync` option now defaults to `true`. `and`/`or`/`not`/`$derived` are reserved field names (compile-time + runtime errors — they collide with the where-clause grammar and the internal derived-values store). `sparse: false` routes client queries to the server automatically, and `source: 'client'` combined with it is an error like `vector`. Validation gained a coercion stage shared by `parse()` and the form standard schema (previously the form path was strict where `table.parse` was liberal): `Date` → epoch ms for `number()` fields (including `created_at`/`updated_at`) or ISO text for `.date()`/`.time()`/`.datetime()` fields, `URL` → `.href` for `.url()` fields, whole numeric strings → numbers, `'true'`/`'on'`/`'false'`-style tokens → booleans, typed arrays → plain `vector()` arrays, and `{ latitude, longitude }` → `{ lat, lon }` geopoints — ambiguous conversions (JSON strings, ISO text into plain number fields) are deliberately not attempted, and unformatted string fields still reject `Date`s. Several builder methods returned as in-house implementations: `startsWith`/`endsWith`/`includes`, the transforms `trim`/`toLowerCase`/`toUpperCase`/`normalize` (run before validators, in declaration order), and exclusive bounds `gt`/`lt`; `.step(n)` now validates divisibility (decimal-safe) in addition to setting the form step attribute. New `db.signOut()` wipes all locally persisted data (IndexedDB entity cache, sync cursors, and search index) with freeze-then-wipe semantics — no UI repaints between the call and the app's navigation — `init()` after sign-out restores a working client. `DatabaseClient`'s lifecycle booleans are consolidated into **`db.status`** (`'idle' | 'initializing' | 'ready' | 'signed_out'`) — `initialized`, `hydrated`, and `signed_out` are removed (`hydrated` is now internal); the `syncing`/`synced` booleans remain.

### Minor Changes

- b53372b: Let `enum[]` fields be declared searchable through the schema builder.

  `schema.array(schema.enum([...])).searchable()` was silently a no-op: `ArrayFieldGenerator.searchable()` accepted only `string`/`number`/`boolean` item types, so an enum array never reached the index schema — even though the index-schema builder, the engine, the `where` DSL (`contains_all` / `contains_any`) and facets have always understood the `'enum[]'` type. Marking one searchable now emits `'enum[]'` in `config.index_schema` and adds the path to `config.searchable_fields`. Like every other array, the values still live in the row's internal `json` column — no SQLite column is added.

  An `enum[]` field is indexed as a list of exact tokens: it is filterable and facetable, but it never participates in full-text term matching (a term query cannot match a label value).

  **Type fix: searchable arrays now appear in the inferred search schema.** `Database.SearchSchema<Table>` dropped _every_ array field (the inference read the item's `type` one level too shallow and tested the wrong node for `.searchable()`), so `string[]`, `number[]`, `boolean[]` and `enum[]` fields were missing from the typed `where`/`facets`/`order` surfaces even though the runtime indexed them. They are now inferred correctly, which means previously-untyped filters on those fields become type-checked — an array field filtered with an operator that its type does not allow (for example anything other than `contains_all` / `contains_any` on an `enum[]`) is now a type error.

### Patch Changes

- Updated dependencies [d86752e]
  - @delightstack/utilities@1.1.0

## 1.1.0

### Minor Changes

- 2562f06: Search-index persistence moves from "full snapshot on every write" to journal + snapshot. Every entity write used to end in a full-index msgpack encode (`saveIndex`) — O(entire index) blocking CPU per write, which at mailbox scale (~50k docs) made a single `update()` cost ~10 seconds inside the DO. Writes now append one per-doc row to a new `search_journal` table inside the same transaction as the entity row (last-write-wins per doc); cold starts replay the journal on top of the last snapshot; and the expensive full-index snapshot runs only as a scheduled compaction once a journal exceeds 500 rows, off the write path. Also fixes a latent rollback bug: a throw inside `transaction()`/`batch()` rolled back SQL but left the in-memory Orama index mutated — touched indexes are now invalidated on rollback so phantom docs can't be served or baked into the next snapshot.

## 1.0.4

### Patch Changes

- 2336fca: Fix updates/deletes throwing `Cannot read properties of null (reading 'length')` for docs restored from a persisted index. `toSparse()` materialized missing optional searchable fields as explicit `field: undefined` keys; the msgpack index save stores `undefined` as `null` (msgpack has no undefined), and after a DO cold start Orama's `remove()` crashes on a null array property — so an affected doc could never be updated or deleted again (every consumer write to it 500'd). `toSparse()` now omits null/undefined leaves entirely, and index load strips null values from restored docs so already-poisoned persisted indexes heal on their next cold start instead of needing a rebuild.

## 1.0.3

### Patch Changes

- ed3a41e: Fix the client worker losing every synced document past the first 1000 of a sync page. Orama's `removeMultiple` only processes its first batch (default 1000 ids) synchronously and runs the rest on fire-and-forget `setTimeout` chains — so the worker's remove-before-insert had those deferred batches fire AFTER `insertMultiple` and delete every just-inserted doc past #1000, while the synced window still advanced (a 2500-thread mailbox stabilized at exactly its newest 1000 threads and never refetched the rest). All `removeMultiple` calls now pass an explicit `batchSize` covering every id.

## 1.0.2

### Patch Changes

- 3450337: Fix DO cold starts rebuilding every search index and bumping its config_version, which forced every client into a permanent wipe-and-full-resync loop. The persisted orama config (JSON, function members dropped) was deep-compared against the live config (which always carries `components.getDocumentIndexId`), so the check failed on every wake. Both the index-config check and the sql_indexes definition check now compare against the serializable projection.

  Also normalize where-clause shorthands in both search paths: plain values and arrays on enum properties become `{eq}`/`{in}`, plain numbers become `{eq}` (Orama requires operation objects there and its throw surfaced as a 500), and Orama's filter-validation errors now return 400 instead of 500.

## 1.0.1

### Patch Changes

- 4652846: Raise the msgpack `maxDepth` to 4096 when persisting the saved Orama index. Large or deeply-nested indexes could exceed the default depth limit and fail to encode; the higher ceiling lets consumers with bigger indexes persist them without hitting the depth cap.
- 16f9b7f: Fix silent client-index document loss during large/live syncs (the "empty inbox" incident):

  - **Sync pages apply resiliently.** `insertMultiple` throws at the first invalid document, which silently dropped the rest of the page while the synced window still advanced — those documents were never refetched. Pages now fall back to per-document application, so one bad document costs only itself (loudly logged), never the page tail.
  - **Websocket entity events now carry the server's sparse (search-index) projection.** Clients previously inserted the FULL entity into an index built for the sparse schema; validation failures (arrays/objects/nulls) after the remove-before-insert silently evicted the document from the local index. The client indexes the `sparse` payload when present, projects full entities to the index schema otherwise, and rolls the synced window back + resyncs if an insert still fails.
  - **The client→server search-mode switch now measures the actual index size** (`count()`), not cumulative inserts — a live backfill re-syncs the same documents repeatedly and inflated the old counter past the threshold, abandoning the client index mid-sync.
  - **Equal-timestamp runs are never split across sync pages.** The server fetched exactly `limit` docs from Orama, so the "never split equal timestamps" trim could not see past the cut; the next page's exclusive boundary then skipped the rest of the run permanently. The fetch now grows until the boundary run is fully covered (legacy data only — writes get strictly monotonic timestamps).

- 0c92f48: Type-level fixes so consumer apps typecheck cleanly: the database schema's `Table` constraint no longer degenerates into an impossible `table_definition` union when a field generator's shape is `any`, and `StringFieldInputType` now matches the runtime (`tel` / `datetime-local` instead of `phone` / `datetime`); stripe's `PlanDefinition.entitlements` accepts `readonly string[]`; the images and ai request handles and utilities' `createDevHandle` are now generic over the event so they compose with SvelteKit's `Handle` without casts; the editor package no longer emits an `Editor` component export shadowed by the `Editor` class type (which made the component import type-only for consumers).
- Updated dependencies [0c92f48]
  - @delightstack/utilities@1.0.1

## 1.0.0

### Major Changes

- 8420739: First stable release (1.0.0). The DelightStack packages now version together at a coordinated, stable 1.0. This bump declares the public API of each package stable; individual packages may not have changed since their previous release.

### Patch Changes

- Updated dependencies [8420739]
  - @delightstack/utilities@1.0.0
