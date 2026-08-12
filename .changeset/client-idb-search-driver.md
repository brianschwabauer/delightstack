---
'@delightstack/database': major
---

Client search is now IndexedDB-backed, and synced entities no longer carry vector fields.

**The client index moved into IndexedDB.** The worker no longer builds an Orama index in memory, serializes it to a `search_index` blob and reloads it on boot. Search runs against real postings stores (`postings`/`tokens`/`docs`/`field_stats`) in the same IndexedDB database as the entity cache, through the same engine core the server uses. Consequences:

- **No memory ceiling and no rebuild-on-load.** A synced window may be far larger than the old 5000-document limit, and opening a tab no longer deserializes an index before search works.
- **Index writes are transactional.** Each sync page commits its documents, the entity-cache rows a delete invalidates, and the sync cursor that accounts for them in **one** IndexedDB transaction — so the synced window can never claim documents the index does not have. The old doubling save schedule (persist after page 1, 2, 4, 8…) is gone.
- **The legacy `search_index` object store is deleted** on the first upgrade after this release. The index rebuilds from the ordinary sync path.
- **Client and server results now come from one implementation.** Ordering, tie-breaks, tolerance, `threshold`, facets and `distinct_on` are the frozen spec on both sides, and the golden fixtures are replayed against the client driver.

**Synced entities stop exposing vector fields.** Sync ships the server's sparse document *minus* its `vector[...]` fields, for both search engines. Vector search is server-only, so the client never needed embeddings — but this is observable: an app reading `entity.embedding` off a *synced* (sparse) document will now find it absent. Fetching the entity directly is unaffected.

**The 5000-document auto-switch is replaced by coverage-based routing.** Where a query is answered is now decided per query, in this order:

1. Any query carrying `vector` (including hybrid) goes to the server unconditionally — no embeddings exist on the client.
2. Otherwise the client answers only when its synced window covers the whole table; until the backfill completes, the server answers, because it has the full corpus and the correct global relevance statistics. `entities[type].search_mode: 'client'` opts in regardless (a deliberate partial-corpus answer); `'server'` opts out of local search and local syncing entirely.
3. `default_threshold` / `entities[type].threshold` still force the server above a local document count, but are **deprecated** and unset by default — they existed to defend a memory ceiling that no longer exists. They are removed in the next major.

`getSearchMode()` therefore reports a live routing decision rather than a stored mode: an entity type reports `'server'` while its window is filling and flips to `'client'` when the backfill completes.

**Documents are indexed as the server projected them.** The worker no longer re-derives its own projection of a synced document (the old projection dropped values whose runtime type did not match the schema, to avoid an Orama insert throwing mid-page). A synced document is indexed verbatim; a document that originates locally — a create/update response, a websocket event carrying a full entity, a local patch — is reshaped exactly the way the server's `toSparse` does (declared searchable paths only, nulls omitted) and is overwritten by the server echo. Nothing in the write path can throw on a malformed value, so the class of bug where one bad document dropped the tail of a sync page cannot recur.
