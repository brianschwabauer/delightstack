---
'@delightstack/database': major
---

Orama is gone: the built-in SQLite search engine is the only engine.

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
