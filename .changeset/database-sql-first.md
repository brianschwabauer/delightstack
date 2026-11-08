---
'@delightstack/database': major
---

SQL-first: raw SQL writes are caught up, numbered migrations, one column per field

Raw SQL is now a first-class way to write, not only to read. Triggers on every entity table
record writes that bypass the library (`exec()`, `ctx.storage.sql`, foreign-key cascades) and
`drainChanges()` catches them up: search index, a fresh `updated_at` for sync, history, file GC,
auto-embeds and websocket broadcasts. Library writes are told apart by a `_w` marker flipped in
the same statement, so they cost no extra billed row.

- **Migrations**: `new DatabaseServer(tables, ws, ctx, env, { migrations })` runs numbered
  migrations in order on wake, before the additive schema pass. Helpers `alterColumn` (column
  swap), `rebuildTable` (refuses tables other tables reference, since dropping them cascades into
  child rows) and `dropColumn`. A failing migration rolls back without taking the database down;
  `preflight: true` + `checkMigrations()` dry-runs against real data first. While a migration is
  pending, the automatic additive pass waits (except the library's own columns), so migrations
  always see the previous schema.
- **`schemaReport()`**: migration status, drift from the declared schema with the fix for each,
  failed indexes, pending catch-ups, database size. A unique index the data violates is now
  reported instead of throwing out of the constructor.
- **`SqlDatabase`**: the lower layer (migrations, typed `exec`, `execMany`, `explainSql`,
  `databaseSize`) for Durable Objects with no declared schema. `DatabaseServer` extends it.
- **`execMany(statements)`**: up to 100 read-only statements in one round trip, one snapshot.
- **`capture_raw_writes: false`** table option, for internal ledgers only raw SQL writes: no
  triggers, no catch-up, no broadcast.
- **`explainSql(sql)`**, **`schemaSql(tables)`** (the exact DDL, with enum values noted) and
  **`Database.Row<Table>`** (the storage shape, for `exec<Row>()`).
- **Table-level `indexes` option**: multi-column, enum, partial (`where`) and unique indexes.
- **Search**: `.keyword()` for ids, keys, codes and URLs (matched whole, never split into
  words); `.searchable({ weight, max_tokens, text })`; default typo tolerance scaled by word
  length; plural/singular matching; exact > plural > prefix > typo weighting; capped prefix and
  typo expansion; proximity re-ranking of the top 100; `highlight` snippets with match offsets;
  `searchReport()` with per-field size and warnings.

Breaking:

- Objects, arrays, vectors, geopoints and file references get a JSON text column of their own
  instead of sharing the `json` overflow column. Old rows move on the first wake, before any
  request, when the blobs total under 128 MB; bigger databases move in alarm slices, with
  library reads falling back meanwhile. Raw SQL reading `json_extract(json, '$.field')` must read
  the column.
- String primary keys (and `.searchable()` string foreign keys) index as exact-match `enum`, not
  tokenized text. Each database rebuilds its search index once and clients resync once; a `term`
  query no longer matches id fragments.
- A raw write can't backdate `updated_at` below the table's sync clock (it gets a fresh one, so
  sync clients see it).
- An update that changes nothing writes nothing (no new `updated_at`, no history, no broadcast).
- A full-text string field named like an identifier (`*_id`, `*_ids`, `*_key`, `*_url`,
  `*_hash`, `*_token`, `*_at`) throws at table definition: use `.keyword()`, `.carried()`, or
  `.searchable({ text: true })`. `datetime`/`date`/`time`/`uuid`/`url` strings index as keywords.
- Ranking changed (typos on by default, plurals, weighted expansions, proximity); a field value
  indexes its first 1,000 distinct words unless `max_tokens` says otherwise.
- New search index tables (`search_entries`, `search_terms`, `search_documents`,
  `search_fields`); the old ones are dropped and every type rebuilds once on wake.
- `transaction()` rejects operations of unknown shape instead of skipping them.
- `ScopedDatabase` gains `exec`; `DatabaseServer` extends `SqlDatabase`.

Fixes: `.indexable({ unique: true })` emitted invalid SQL; cascaded child rows stayed in search
and never synced; updates rewrote every column (now only changed ones, 8 → 3 billed rows for a
plain update, 8 → 0 for a no-op) and every search row (now skipped when nothing indexed
changed); editing a long text field rewrote all of its postings (1,489 rows to add one word to
a 2,000-word body, now 3); a short prefix scored every posting of every completion (42 ms for
`sen` over 5,000 notes, now 10 ms); a new `NOT NULL` boolean column defaulted to `''`.
