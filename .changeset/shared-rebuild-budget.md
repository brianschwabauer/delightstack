---
'@delightstack/database': patch
---

The chunked search rebuild's row budget is now shared across all pending entity types per invocation, instead of granting each type its own full slice.

With five types pending after an upgrade, the per-type cap multiplied one wake's rebuild work by five — enough to blow the Durable Object CPU limit all over again on heavy corpora, which is exactly what the cap exists to prevent. `runRebuild` now reports how many rows it processed, and both the constructor bootstrap and each alarm tick spend a single `searchRebuildRowsPerSlice()` budget across types in order; a type left unfunded stays pending and is picked up as earlier types finish. A schema-changed type still gets its `beginRebuild` (clear + cursor) even with no budget left, so a stale index is never served as if it matched the new schema.
