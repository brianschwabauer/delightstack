---
'@delightstack/database': patch
---

New `searchRebuildInConstructor()` override (default `true`) lets heavy deployments keep the Durable Object constructor O(1): rebuild slices and legacy-teardown chunks then run only in alarm invocations.

With inline work, a single unit of migration work that exceeds the CPU limit kills every wake of the object — requests included — and no deploy can recover it, because the constructor re-runs the same doomed work first. With `searchRebuildInConstructor()` returning `false`, the constructor only records pending work and arms the alarm; an over-budget unit then kills an alarm attempt (retried, harmless to requests) while the object keeps serving.

Migration progress is also observable now: each cold wake logs its outstanding work (`bootstrap: pending rebuilds [...], legacy tables present/gone`), every rebuild batch logs its entity type and cursor BEFORE its transaction (a batch that dies from the CPU limit otherwise leaves no trace of which rows are the poison), and teardown chunks log before deleting.
