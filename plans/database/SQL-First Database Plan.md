# SQL-First Database Plan

Status: D1–D6 built 2026-11-07, uncommitted. See "Status" below for where the build differs
from this plan and what was measured.

## Status (2026-11-07)

All six phases are built and tested, nothing is committed. Changeset:
`.changeset/database-sql-first.md` (major). New tests: `src/__workerd__/*.workerd.test.ts`, run
by `vitest.workers.config.ts` inside workerd against real Durable Object SQLite.

### Where the build differs from the plan

- **D5 is a safety net under the existing write path, not a replacement.** `create`/`update`/
  `delete`/`transaction` still keep search, sync, history and broadcasts in step inline, in their
  own transaction. The triggers capture only writes that did *not* come through them: library
  writes flip a one-bit `_w` column in the same statement (raw SQL leaves it alone) and write
  their delete tombstone first. So library writes cost no extra billed row, and nothing about
  them changed.
- **Sync stays on `updated_at`; no protocol break.** The drain stamps a fresh `updated_at` on each
  caught-up row, so the existing client sync sees raw writes without a `seq` cursor. A raw write
  that sets `updated_at` itself keeps it only when it is ahead of the table's sync clock
  (`_changes.stamped`); a backdate would sit under a client's cursor and never sync.
- **Catch-up broadcasts wait for commit.** A drain inside an app's own `transactionSync()` defers
  its broadcasts to a microtask and re-checks each against the database, so a rolled-back write
  is never announced.
- **Actor attribution** goes through the existing write scope: `scoped(db, actor).exec(...)`.
  Temp tables are `SQLITE_AUTH` in DO SQLite, so a trigger can't read the actor itself.
- **D3 keeps the automatic additive pass** (new tables, nullable or defaulted columns). Everything
  else is a numbered migration, run *before* that pass, and the pass waits while any migration is
  pending (failed or preflight), so a rename's new column is never added under it.
- **Review fixes (independent review, 2026-11-07):** the held-back additive pass above; the
  `updated_at` rule above; cascaded children caught up before `transaction()` returns; a row the
  catch-up throws on is quarantined in `_changes_failed` instead of blocking every entry point;
  `_mv_*` triggers stop the JSON move resurrecting a value raw SQL cleared; `alterColumn` drops
  generated `sv$` columns first and rewrites a self-referencing `CHECK`; `exec()` always checks for
  pending changes; aquillity's missed `json_array_length(ld.json, …)` read. Each has a regression
  test.
- **Preflight is a two-step deploy, not a pre-deploy check.** Migrations are code inside the new
  version, so nothing can run them before it is deployed. `preflight: true` ships a migration
  without applying it; `checkMigrations()` dry-runs it on each tenant and rolls back.
- **`rebuildTable` refuses tables other tables reference.** Measured in workerd: dropping the old
  table runs SQLite's implicit `DELETE`, which deletes `ON DELETE CASCADE` children, and
  `foreign_keys` can't be switched off inside a transaction. Column-level changes use
  `alterColumn` (add, copy, drop, rename), which keeps children intact.
- **A failing migration or index no longer bricks the object.** It rolls back, is reported by
  `schemaReport()`/`migrationStatus()`, and is retried next wake.
- **D4 columns are always nullable** (`TEXT CHECK (json_valid(col))`): SQLite can only add a
  column to a populated table that way. Old rows move from the `json` blob in background slices
  (the search rebuild's slice budget and `searchRebuildInConstructor` switch); library reads and
  the search engine's generated columns fall back to the blob meanwhile.
- **Ids index as exact-match `enum`** (D2, not in the plan). Tokenized random ids were about a
  third of every create's billed writes and 80% of the token dictionary.
- **`execMany`, not `batch`**: `batch` was already the write-batching method.
- **`SqlDatabase` is the base class, but DatabaseServer runs its migrations itself.** A base
  constructor runs before the subclass's schema config exists, so `SqlDatabase` only runs
  migrations from its own constructor when used directly.

### Second review (three independent reviewers, 2026-11-07)

Two reviewers read the build; a third read their fixes. Every finding was reproduced in workerd
first, then fixed, with a test in `src/__workerd__/edges.workerd.test.ts` or
`edges-2.workerd.test.ts`:

- A preflight or failed migration shipped with the 2.5.1 upgrade held back `_w`, so every write
  failed. The library's own columns (`_w`, `json`, and during the v3 upgrade the JSON field
  columns) are now always added.
- `rebuildTable` wrote NULL into a new `NOT NULL DEFAULT` column; such columns are left out of
  the copy so the default applies.
- `explainSql('SELECT 1; DELETE …')` ran the DELETE, and `execMany` let DDL (`SELECT 1; DROP
  TABLE`) and connection-changing PRAGMAs through, including behind `EXPLAIN` (SQLite applies
  flag pragmas at prepare time). Both now take exactly one statement (a scanner that skips
  strings and comments) and only introspection PRAGMAs.
- An `exec` op followed by a library update of the same row in one `transaction()`
  double-recorded history; the drain now runs right after each `exec` op.
- A raw insert or update followed by a raw delete in one drain window lost history and file GC;
  the catch-up now replays create/update + delete, and GCs every object any version of the row
  pointed at during the run.
- A state row with no tables (an earlier wake threw) counted as "not fresh". (The first fix,
  "none of the declared tables exist", would have baselined a table-rename migration without
  running it; fresh now means "no app table at all".)
- Aquillity's job ledgers (`outbox`, `processed_job`) paid change capture plus a websocket
  broadcast on every raw job write: new `capture_raw_writes: false` table option.
- Automatic drains were unbounded (a 200k-row raw import would be caught up inside the next
  request); capped at 2,000 rows, the alarm does the rest.
- The JSON move's cursor was in memory (an evicted instance rescanned) and raw reads saw NULL for
  rows not yet moved. The cursor is persisted, and the whole move runs on the first wake, in
  1,000-row statements, when the blobs total under 128 MB (measured 240 MB/s locally), which
  should cover current Aquillity accounts (unverified until A1 measures production). The move
  copies with `"json" -> '$.f'` (always valid JSON) instead of `json_extract`, which turned a
  legacy scalar string into bare text that failed the column's CHECK and threw on every wake;
  the move is also guarded so it can never fail the constructor.
- The catch-up rewrote a row with nothing to stamp (18 → 17 rows); a no-op `update()` wrote 3
  rows and re-synced every client (now 0, also on tables with derived fields); `execMany` skipped the drain;
  `transaction()` silently skipped unknown operation shapes (now a 400).

Not changed: a wake reads ~13.7k rows / ~4 ms at 37 tables (schema introspection), with zero
writes. Reads are 1000× cheaper than writes, so it was left alone.

### D7. Search (built 2026-11-07, after the review)

Measured in workerd on 5,000 notes (title + a 60–260-word body + a thumbnail key, 6.4 MB of
text), before → after:

| | Before | After |
|---|---|---|
| Database size | 94.2 MB | 39.8 MB |
| Create, 200-word body | 575 rows | 387 |
| Create, 2,000-word body | 4,457 | 2,013 (1,000-word cap) |
| Add one word to a 2,000-word body | 1,489 | 3 |
| Create with a thumbnail key | 51 | 13 (`.keyword()`) |
| First search after wake (dictionary load) | 17 ms, 55k rows read | 9–13 ms, 12.6k |
| Most common word | 42 ms, 52.9k read | 15 ms, 17.3k |
| Two-letter prefix | 42 ms | 10 ms |
| Most common word + `where` | 45 ms, 65 statements | 16 ms, 12 |
| Typo search | 0.6 ms | 0.4 ms |
| One mid-frequency word | 0.3 ms | 1.6 ms (typo, plural and prefix matches now) |
| Two words | 0.3 ms | 4.9 ms (proximity re-rank of the top 100) |

Aquillity's real schema (250 deals, 2.5.1 → this tree): fresh account 84,489 → 33,758 rows
written (−60%); the one-time upgrade wrote 15,564 rows in 192 ms; every entity and every exact
search answer identical; the old search tables dropped.

What was built:

- **`.keyword()`** (string and string-array) and keyword-by-default `datetime`, `date`, `time`,
  `uuid`, `url` formats; a definition-time error for full-text fields named like identifiers
  (`*_id`, `*_ids`, `*_key`, `*_url`, `*_hash`, `*_token`, `*_at`) unless `{ text: true }`.
  Found in four apps: aquillity `thumbnail_key`; foreverfamily `user_id`, `author_id`,
  `uploader_id`, `entity_id`, `person_ids`; mail `account_ids`, `label_ids`. (A datetime
  tokenized into 5 junk rows, an id into 7–8, a URL into 10.)
- **`.searchable({ weight, max_tokens })`**: schema field weights, a 1,000-distinct-word default
  cap per value (mail hand-rolled a 4 KB excerpt; delightwrite allows 1 MB of extracted text).
- **Query planning** (`core/expansion.ts`, shared by all three drivers): default typo tolerance
  by word length (none for words with digits), plural/singular variants, weights exact 1 /
  plural 0.9 / prefix 0.75 / typo 0.6 / 0.4, prefix and typo expansions capped by count and by
  postings (2,000 / 1,000 per field).
- **Rounded field lengths** in BM25 (5 significant bits, Lucene-style), so the stored length on a
  posting changes only across a step.
- **Proximity re-rank** of the top 100 for multi-word queries, from the documents themselves
  (no positions stored), limited to documents matching two or more words; **highlights**
  (`highlight: true | { fields, length }`) with `[start, end)` offsets.
- **Compact server index**: `search_entries (fid, token, doc, tf, len)`, one B-tree, no
  by-document index; `search_terms (fid, token, df)`; `search_documents` (integer doc id, the
  document's words and lengths as JSON, for diffs and deletes); `search_fields` (integer field
  id + stats). An integer-term-id layout was tried first: 6× smaller, but each new word cost 2
  rows, which made Aquillity's mostly-unique words (names, addresses) dearer (create deal 28 →
  35); word-keyed entries cost 1.
- **Term-first filtering**: a term with an exact `where` scores first and checks the filter for
  the matched ids only (one read of the filter's ids above 900 matches).
- **Tokenizer fast path** for plain ASCII words (exact same output, proven against the full
  pipeline): ~20× faster per word, on both indexing and re-ranking.
- **`searchReport()`**: per-field documents, words, entries, estimated bytes, capped values, and
  warnings. (`dbstat` is not available in DO SQLite, so bytes are estimated.)

Reviewed by a fresh judge agent; fixed with tests: a cached field id could outlive a rolled-back
savepoint and index later writes under a vanished id (now verified on every write, and the
caches drop as soon as a catch-up row fails); `highlight` options from the URL are validated on
every driver; prefix candidates' frequencies are one range read; keyword/format strings are
`enum` at the type level too; the vector no-op check is back; the rerank's documents are reused
when paging; plurals derive one singular per word. `src/search/__tests__/parity.test.ts` holds
the three drivers to identical ids, scores and highlights on long fields, caps, weights,
expansions and proximity, which the golden battery doesn't exercise.

Not built: WAND / block-max top-k. After the expansion caps, a common exact word reads ~5k
entries in ~2 ms; a DO-sized index doesn't need it.

### Measured (workerd, billed `rowsWritten` / `rowsRead`)

| Operation (fixture schema) | Before | After |
|---|---|---|
| Plain-column update | 8 | 3 |
| Document autosave (history table) | 10 | 8 |
| Create deal | 49 | 28 |
| Create participant | 35 | 13 |
| Delete document | 45 written / 102 read | 22 / 41 |
| Raw `UPDATE`, fully caught up | 1 (and left search, sync, broadcast stale) | 6 |

On Aquillity's real 37-table schema, upgrading a 2.5.1 database with 250 deals:

| | 2.5.1 | After |
|---|---|---|
| Rows written to create the account | 83,325 | 38,241 (−54%) |
| Rows written for a day of edits (7,500 autosaves, 250 updates) | 47,000 | 23,250 (−51%) |
| Search tokens / postings | 11,457 / 23,633 | 2,273 / 6,753 |
| Database size | 19.4 MB | 17.4 MB (−10%) |
| Fuzzy/prefix search latency | 0.93 ms | 0.90 ms (no real change) |
| Entities and search answers after upgrade | — | identical |
| One-time upgrade on first wake | — | 224 ms, ~56k rows written |

Twelve reads over RPC (in-process, so no network): 12 sequential `exec` 6.5 ms, 12 parallel
2.2 ms, one `execMany` 0.7 ms. In production each saved call is also a network hop and a
billed request.

Aquillity on the new build: worker 626/626 and app 1270/1270 tests, both type checks clean,
the five local account databases upgraded with no drift and 83 entities identical to the
pre-upgrade backup, and the dashboard, lists, binder and document editor load and save.

## Goal

`@delightstack/database` was designed for human developer experience: short calls
(`db.create`, `db.update`), migrations that happen by themselves, and as little SQL as
possible. Agents now write most of the code, and what they need is different:

- **Explicit over implicit.** An agent can't see what `db.update()` does behind the
  call: deep-merge, readonly stripping, search reindex, FK-derived fields, cascade
  reindex, history, broadcast. Bugs come from behaviour that isn't visible at the call
  site.
- **Checked over convenient.** Agents write SQL reliably, but nothing checks a SQL
  string against the schema, and every row comes back untyped.
- **SQL is a first-class way to write.** Today a raw `UPDATE` silently skips the
  search index, sync, websocket broadcast, history and file GC, because all of those
  live in JS methods. A raw write should be as safe as `db.update()`.

The plan keeps the parts that are good (the search engine with identical client and
server results, the reactive client, per-tenant Durable Objects, the outbox/op_id
dedupe) and changes how writes are tracked, how schemas migrate, and how SQL is typed.

## What the measurements show

Measured against Aquillity's real schema (37 tables, 21 extra hand-written indexes)
inside AccountDB in the workerd test pool, reading the SQL cursor's billed
`rowsWritten` / `rowsRead`:

| Operation | Rows written | Rows read |
|---|---|---|
| `create('transaction')` | 57 | 33 |
| `create('document')` | 54 | 35 |
| `update()` of one plain, unindexed column | 10 | 17 |
| The same change as a raw `UPDATE` | 1 | 1 |
| `update('document', { field_values })` (autosave) | 8 | 15 |
| `delete('document')` | 54 | 143 |

Where the extra rows go on an update: `UPDATE` sets every column, so every index on the
table is rewritten, plus a `search_docs` upsert and a `search_state` bump, even when no
searchable field changed. Creates and deletes are dominated by postings and `df` rows in
`search_postings` / `search_tokens`.

This is not a cost emergency. At $1 per million rows written after 50M a month included
(Workers Paid, as of this writing; check current pricing), a heavy 100k rows per user
per month is about $50 a month at 1,000 users. The point of this plan is correctness and
agent-friendliness. Cheaper writes come along as a side effect.

### SQLite features verified in DO SQLite (workerd)

| Feature | Works | Notes |
|---|---|---|
| `AFTER INSERT/UPDATE/DELETE` triggers, `WHEN`, `UPDATE OF col` | Yes | Writes made by a trigger are billed with the statement that fired it |
| JSON functions inside a trigger body | Yes | `json_object(...)` of `OLD.*` / `NEW.*` works |
| `UPDATE ... RETURNING` on a table with triggers | Yes | |
| `PRAGMA recursive_triggers` | Off by default | Good: a trigger's own writes don't re-fire it |
| A trigger that stamps `updated_at` with a second `UPDATE` | Works, but don't | Doubles the rows written and fires the change trigger twice |
| `AUTOINCREMENT` | Works | Costs an extra `sqlite_sequence` write per insert; use a plain `INTEGER PRIMARY KEY` |
| `CREATE TEMP TABLE` | **No** | `SQLITE_AUTH`. A trigger can't read "who is writing" from a temp table |
| `PRAGMA foreign_keys` | On by default | |
| `PRAGMA defer_foreign_keys = ON` | Yes | |
| Table rebuild (`CREATE new`, `INSERT SELECT`, `DROP`, `RENAME`) inside `transactionSync`, with a child table referencing it | Yes | Child FK still resolves; `foreign_key_check` clean. This is how `NOT NULL` gets relaxed |
| `CHECK (status IN (...))`, `STRICT` tables, `CHECK (json_valid(j))` | Yes | |
| Generated columns (`json_extract`) and an index on one | Yes | |
| Partial indexes | Yes | |
| `ALTER TABLE RENAME COLUMN` / `DROP COLUMN` | Yes | `DROP COLUMN` refuses while an index uses the column, as SQLite always does |
| `ctx.storage.sql.databaseSize` | Yes | |

Still to confirm on a deployed DO (staging): the same trigger and rebuild checks. workerd
runs the same SQLite build, so no difference is expected.

## Architecture: two layers

Today there's one class, `DatabaseServer`, and apps that want plain SQL write their own
`DurableObject` and their own migration code. Aquillity alone has three migration
schemes: DatabaseServer's add-column auto-migration, DealRoom's add-column loop, and
SupportDB's `schema_version` row with table renames.

Split it:

1. **`SqlDatabase`** (new, lower layer). A Durable Object base class for apps that want
   SQL and nothing else: numbered migrations, change capture by trigger, the drain hook,
   typed `exec`, `batch`, `databaseSize`. DealRoom and SupportDB would use this.
2. **`DatabaseServer`** (existing, built on `SqlDatabase`). Adds the declarative schema,
   validation, search, sync, history, file GC and the CRUD handler. Its write path
   becomes "write SQL, let the drain catch up" instead of "maintain everything inline".

## Phases

Ordered by risk: low-risk agent wins first, then migrations, which the trigger work
needs.

### D1. Typed SQL, schema snapshot, batched reads, declared indexes

2/10 difficulty, 8/10 recommendation.

- **Generated row types.** `Database.Row<Table>` is the *storage* shape, not the entity
  shape: booleans as `0 | 1`, `created_at`/`updated_at` as numbers, JSON fields as
  strings, optional columns as `T | null`. `exec<Row>(sql, ...bindings)` returns
  `Row[]`. The generic is still a cast, and the docs should say so; the value is that the
  agent picks a generated type instead of writing `String(row.x)` (Aquillity has 525 of
  those and 179 `as unknown as`).
- **`schema.sql` snapshot.** A build step writes the exact DDL the server would emit
  (tables, every index including declared ones, triggers once D5 lands) to a committed
  file. An agent writing SQL reads one file to see the real columns. The test suite
  fails if the snapshot is stale.
- **`explain(sql)`.** A helper that runs `EXPLAIN` on a statement against the live
  schema and throws on unknown tables or columns. Apps can keep their queries in named
  constants and have one test that checks all of them.
- **`batch(statements)`.** Runs several read statements in one call and returns one
  result array per statement. From a SvelteKit worker that is one DO round trip instead
  of N. Read-only on purpose: a write batch is `transaction()`.
- **Declared indexes.** `Database.table(name, fields).indexes([...])` with columns,
  sort direction and an optional partial `where`. They go into `schema.sql` and the
  migration generator (D3). This replaces hand-written `CREATE INDEX IF NOT EXISTS`
  blocks in app constructors (Aquillity has 21).

### D2. Trim write amplification

3/10 difficulty, 4/10 recommendation.

- `update()` sets only the columns whose value changed, so unchanged indexed columns
  don't rewrite their index entries.
- `indexDocument` returns early when the sparse projection is unchanged: no
  `search_docs` upsert, no tombstone delete, no field-stat cleanup.
- Look at why `delete()` reads 143 rows (postings read back with `RETURNING` and the
  `df` decrement path).
- Re-run the measurement table above to confirm.

Low recommendation because the dollar amounts are small. It is cheap, though, and D5
replaces part of this path anyway, so do it only if D5 is far off.

### D3. Explicit, numbered migrations

6/10 difficulty, 9/10 recommendation.

The add-column auto-migration was a DX feature, and now it is bending app schemas.
Columns are made `.optional()` only because `ADD COLUMN` can't add `NOT NULL`;
"absent means true" defaults spread; Aquillity stores `''` in address columns because
`NOT NULL` can't be relaxed. A changed unique index that live data violates throws in
the constructor and leaves that tenant's DO unusable until a rollback.

- **Migrations are files.** `migrations: [{ id: '0007_relax_address', up(db) {...} }]`.
  A `_migrations` table records applied ids. Pending migrations run in the constructor
  inside `blockConcurrencyWhile`, each in its own `transactionSync`, in order.
- **The schema still generates them.** A CLI diffs the declarative schema against the
  committed `schema.sql` and writes a draft migration file: `ADD COLUMN` for simple
  cases, a full table rebuild for anything SQLite can't alter (nullability, defaults,
  CHECK, column type, dropping a column with an index). An agent reviews and edits it.
- **`rebuildTable(name, new_ddl, select_expr)`** helper with `defer_foreign_keys`,
  index and trigger re-creation, and `foreign_key_check` before commit (verified to
  work, see the table above).
- **Preflight.** `checkMigrations()` runs pending migrations inside a transaction,
  reports errors and rolls back. An admin script calls it on every tenant DO before
  the deploy that ships the migration, so a unique-index violation is found per tenant
  before it can break one.
- **Expand, then contract.** Workers deploys roll out gradually, so old code briefly
  runs against the new schema. The docs and the generator follow expand/contract: add
  first, backfill, switch readers, drop in a later migration.
- **Compatibility.** The add-column auto-migration stays available as a mode
  (`migrations: 'auto'`) for existing apps through v2; explicit becomes the default
  in v3.

### D4. One real column per field

7/10 difficulty: every table in every tenant's DO is rebuilt once, and every read that
uses `json_extract(json, '$.field')` changes. 6/10 recommendation.

Root-level scalars have columns today. Objects, arrays, vectors and geopoints all share
one `json` TEXT column. An agent has to know which fields live where (Aquillity has 37
`json_extract(json, ...)` reads), and those fields can't be indexed or constrained.

- Every field gets its own column. Objects and arrays become TEXT columns with
  `CHECK (json_valid(col))`. Vectors stay as BLOBs.
- Indexing a path inside a JSON column uses a generated column plus an index (verified).
- Enums optionally get `CHECK (col IN (...))`. Off by default: adding an enum value then
  needs a table rebuild, which D3 makes routine but not free.
- Ships as a D3 migration the package generates for each table.

### D5. Change capture by trigger, plus the drain

8/10 difficulty: it rewrites the write path that sync, search, broadcast, history and
file GC all depend on; it changes the client sync protocol; and every existing DO needs
a migration. 9/10 recommendation.

**Triggers.** For each table, one `AFTER INSERT`, one `AFTER UPDATE` and one
`AFTER DELETE` trigger, each appending a row to `_changes`:

```sql
CREATE TABLE _changes (
	seq INTEGER PRIMARY KEY,  -- rowid alias; no AUTOINCREMENT (extra write per insert)
	entity_type TEXT NOT NULL,
	entity_id TEXT NOT NULL,
	op TEXT NOT NULL,         -- insert | update | delete
	at INTEGER NOT NULL,
	before TEXT               -- json_object(OLD.*) for history tables only
);
```

Triggers don't stamp `updated_at`: that needs a second `UPDATE`, which doubled the
writes and fired the change trigger twice in testing. The library's own writes keep
setting `updated_at` in their SQL. Sync moves to `_changes.seq`.

**The drain.** Triggers can't run JS, so they only record *that* a row changed. The
drain reads `_changes` past its cursor and, for each change: re-reads the row,
re-indexes it for search (or removes it), recomputes FK-derived fields and cascade
re-indexes, writes history, queues file GC, queues auto-embeds, and broadcasts. These
are the jobs `transaction()` does inline today.

- **When it runs.** Inside the same `transactionSync` at the end of every
  `DatabaseServer` write (including `exec`), so the current guarantee holds: a
  rolled-back write never leaves a stale index. For writes made straight through
  `ctx.storage.sql`, the next call into the DO drains first (one cheap
  `SELECT max(seq)`), and an alarm runs as a backstop.
- **Cost.** About one extra billed row per write (the `_changes` row) against the
  ~9 extra a framework `update()` costs today.
- **Who made the change.** Temp tables are not allowed, so the trigger can't read the
  actor. The DO runs synchronous code without interleaving, so `DatabaseServer`
  records the `seq` range around each synchronous write span and attributes every
  change in it to that call's actor and `op_id`. Raw writes outside a wrapper are
  `'system'`. An `exec(sql, { actor })` overload covers attributed raw writes.
- **Validation.** Raw SQL skips JS validation (email format, `.check()`). The DDL now
  carries what SQLite can enforce: `NOT NULL`, `json_valid`, optional enum `CHECK`s
  (D4). Rich validation stays on the API path. Document this split.
- **Sync protocol.** One `seq` cursor per database replaces per-entity `updated_at`
  windows, and deletes come from `_changes` instead of `search_tombstones`. This is a
  protocol break: bump `config_version` so every client resyncs once (the mechanism
  already exists), and keep the old endpoint for one minor version.
- **Retention.** `_changes` is pruned on the alarm after N days. A client whose cursor
  falls behind the oldest retained `seq` does a full resync, as tombstone pruning works
  now.
- **History.** `history: true` tables get the `before` snapshot in the trigger. The
  drain diffs it against the current row to build today's field-level `_change_log`
  entries, so `history()`, `revert()` and `revertOperation()` keep their API.

### D6. Port the hand-rolled DOs (app side, after D3 and D5)

Not package work, but the payoff that proves the lower layer: Aquillity's DealRoom and
SupportDB move onto `SqlDatabase` with numbered migrations and change capture, and drop
their own migration code.

## Open questions (resolved in the build)

- **Drain on direct `ctx.storage.sql` writes**: caught up at the start of the next read or write
  through the class (one indexed `SELECT` when nothing is pending), after every `exec()` that
  writes, on the alarm, and on wake. `drainChanges()` is public for the rare case that must see
  search results immediately.
- **Search lag for raw writes**: none through `exec()` (it drains before returning); until the
  next call for direct `ctx.storage.sql` writes.
- **Keep `updated_at`?** Kept, and it remains the sync cursor (see Status).
- **Enum CHECKs**: off. `schemaSql()` lists each enum's allowed values instead, so raw SQL authors
  can see them without making every enum change a table rebuild.

## Not changing

- One DO per tenant, single writer.
- The search engine and its identical client/server results.
- The reactive client, IndexedDB cache, coverage-based routing.
- `op_id` dedupe and the outbox pattern.
- The CRUD handler and its hooks.
