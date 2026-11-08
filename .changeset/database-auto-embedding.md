---
'@delightstack/database': minor
---

Auto-embedding from schema (DS-05)

`schema.vector(768).embedFrom(['title', 'summary'], { model?, debounce_ms? })` declares which
fields a vector is built from, and `DatabaseServer` keeps it current on its own: a create/update
that changes any source field enqueues a row into an internal `_embed_queue` (inside the write
transaction — a rollback un-queues it), and a self-registered `'auto_embed'` alarm handler drains
the queue later, debounced per row and batched one embedder call per model. The mutation never
awaits an embedding.

The one wiring step is `db.registerEmbedder((texts, model) => Promise<number[][]>)` — typically a
thin wrapper over Workers AI. Without one the queue accumulates and waits (a single warning is
logged); registering one picks it back up.

The regenerated vector is written **quietly**: no `updated_at` bump (so no sync churn for a value
the wire strips anyway), no change-log row (768 floats per regeneration would bloat forever-kept
histories), no broadcast — but the search index is refreshed in the same transaction, so vector
queries see the new vector immediately. An embedder failure retries with exponential backoff (8
attempts, then dropped and logged) and never loses the write that queued it. When `.embedFrom()`
first appears on a table — or its source fields, model or dimensions change — every existing row
is re-enqueued on the next boot, which is the backfill.

Validation runs at server boot rather than in `table()`: only the server acts on the declaration,
and the table builder runs on every client boot, where the checks would be dead bytes on the boot
chunk. Source fields must be top-level string/number/boolean/enum/array fields of the same table.

Review round: source text is capped at `max_chars` (default 2000 — roughly bge-base's 512-token
window of English; order fields densest-first) and the cap is part of the config signature; a row
that has failed three shared batches retries alone, so one poisoned text cannot walk 19 innocent
rows to the drop ceiling; a non-finite (NaN/Infinity) embedder answer is refused like a
wrong-length one; removing every `.embedFrom()` clears the stored backfill signatures and drops
the orphaned queue, so an identical declaration returning later backfills again; and
`historyPayload` strips vector fields outright (marker-less, unlike blobs — ~10-15KB of derived
floats per deleted row in forever-kept logs, and a reverted delete re-embeds through the queue).
