---
'@delightstack/database': patch
---

The first-wake search rebuild is now resumable and chunked across wakes, so a large corpus can no longer wedge a Durable Object in a CPU-limit reset loop.

Previously `bootstrapSearch()` ran the entire rebuild (re-derive + re-index every entity row) synchronously in the constructor. On a corpus big enough to exceed the Durable Object 30s CPU limit, workerd killed and reset the object — and because the schema signature was only persisted *after* a completed rebuild, the next wake started over from row one. Every wake died the same way, taking every RPC (and the app on top of it) down with it, forever.

Now each rebuild persists a per-entity cursor (last primary key, window bounds, config-bump flag) in the state row, checkpointed inside each 200-row batch transaction. A wake advances the rebuild by at most `searchRebuildRowsPerSlice()` rows (default 1000 — a row cap rather than a wall-clock budget, because workerd freezes `Date.now()` during synchronous execution), then defers the rest to a self-re-arming alarm (registered as the `search_rebuild` handler). A killed or deferred wake resumes at the last committed batch instead of restarting. The legacy `search_index`/`search_journal` drop and the `config_version` bump both wait until the rebuild actually finishes, so mid-rebuild clients keep their old corpus and resync exactly once at the end.

Heads-up for subclasses that override `alarm()`: call `await super.alarm()` (or run the registered handlers yourself), or a deferred rebuild never continues.
