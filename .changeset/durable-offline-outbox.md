---
'@delightstack/database': minor
---

Durable offline mutation queue, and `{ op_id }` idempotent writes.

Until now a `DatabaseClient` write was optimistic but not durable: applied locally, POSTed, rolled back if the request failed. Close the tab mid-flight and the write is gone — which is the wrong trade for a local-first app, where "I edited this on a plane" has to survive a reload.

`offline: true` on the client config makes every mutation durable. It is assigned a client-generated `op_id`, applied to the local index, and appended to an `outbox` IndexedDB store **before** any network attempt. The queue drains in `seq` order, one request at a time, on reconnect, on app foreground, after a successful mutation, and on a 30-second tick, with exponential backoff and jitter capped at 30 seconds. `db.pending_count`, `db.failed` and `db.sync_state` mirror it reactively; `db.retryFailed(op_id)` and `db.discardFailed(op_id)` resolve what the new `onMutationFailed` hook reports.

`seq` is the object store's own key generator, which IndexedDB persists per store and never rewinds. That is the whole reason ordering survives a worker restart — a counter derived from `Date.now()` would not, and a client clock must never order anything anyway.

**Idempotency is enforced on the server, because that is the only place it can be.** `create`, `update`, `delete` and `transaction` take an `{ op_id }` write option. The first write carrying an id is applied and recorded in a new internal `_op_log`; every later write carrying it returns the original result without touching a row. The log row commits in the same transaction as the write, so a write that *threw* records nothing and a genuine retry still applies. Retention is seven days, swept by a registered alarm; `db.appliedOperation(op_id)` reads the record back. `batch()` refuses an `op_id` outright — its callback's return value is arbitrary, and dedupe that hands back the wrong thing is worse than no dedupe.

Two consequences of that log are deliberate rather than incidental. A replayed `delete` is a **no-op instead of a 404** — the row is gone because this operation removed it, and re-raising "not found" would turn a successful drain into a permanent failure. And `blob()` columns are recorded as the `__blob_omitted` marker rather than their bytes, on exactly the reasoning the change log already uses: a `Uint8Array` has no lossless JSON form, and the expanded one would push a single-megabyte blob past the Durable Object's 2 MB per-value ceiling. `file()` references are small descriptors and are recorded verbatim.

**An offline create needs its id up front**, because the edits queued behind it already name the row. So `db.create()` now takes `{ preserve_id: true }` (the option `transaction()`'s create operation already had), the SvelteKit handler honours a string primary key supplied in the request body, and the client mints one with `generateTimestampID()`. A table with a numeric primary key cannot be created offline and says so (`offline_create_unsupported`, 400) rather than handing back a row whose identity changes on landing.

**Failure handling had to pick a side.** A retryable failure stops the whole queue: everything behind the failed row may depend on it, and while offline nothing else would succeed either. A 4xx does not — the server reached a verdict, so the row moves to a `failed` store and the queue keeps draining, *except* for later mutations on the same row, which fail alongside it with `reason: 'dependency_failed'`. Applying an update whose create was rejected writes against a state that never existed; blocking the entire queue behind one rejected title change is the other kind of wrong. `retryFailed` re-enters at the back of the queue — the original `seq` was consumed when the row left — while keeping its `op_id`, so the server still applies it exactly once.

**A sync pull no longer erases queued work.** The server's answer predates anything still in the outbox, so committing a sync page verbatim made an offline edit flicker away and come back (and a deleted row reappear). Pending mutations are now layered back over every synced page before subscribers are notified, and a websocket echo for a row with queued changes is ignored, because it is stale by construction.

The backoff clock, timer and jitter source are injectable, so the 30-second cap is proved by a test that runs in milliseconds instead of one that sleeps.

`ExtraStoreDefinition` gained `auto_increment` for the outbox store; the worker's existing store-presence check upgrades pre-existing databases automatically, so nothing needs migrating.
