---
'@delightstack/database': patch
---

Fix the client worker losing every synced document past the first 1000 of a sync page. Orama's `removeMultiple` only processes its first batch (default 1000 ids) synchronously and runs the rest on fire-and-forget `setTimeout` chains — so the worker's remove-before-insert had those deferred batches fire AFTER `insertMultiple` and delete every just-inserted doc past #1000, while the synced window still advanced (a 2500-thread mailbox stabilized at exactly its newest 1000 threads and never refetched the rest). All `removeMultiple` calls now pass an explicit `batchSize` covering every id.
