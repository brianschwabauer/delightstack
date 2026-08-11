---
'@delightstack/database': minor
---

Search-index persistence moves from "full snapshot on every write" to journal + snapshot. Every entity write used to end in a full-index msgpack encode (`saveIndex`) — O(entire index) blocking CPU per write, which at mailbox scale (~50k docs) made a single `update()` cost ~10 seconds inside the DO. Writes now append one per-doc row to a new `search_journal` table inside the same transaction as the entity row (last-write-wins per doc); cold starts replay the journal on top of the last snapshot; and the expensive full-index snapshot runs only as a scheduled compaction once a journal exceeds 500 rows, off the write path. Also fixes a latent rollback bug: a throw inside `transaction()`/`batch()` rolled back SQL but left the in-memory Orama index mutated — touched indexes are now invalidated on rollback so phantom docs can't be served or baked into the next snapshot.
