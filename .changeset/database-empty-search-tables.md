---
'@delightstack/database': patch
---

Fewer rows written per create. A table with nothing to search (no `.searchable()` text fields and no vectors) no longer writes an empty `search_documents` row for every entity; its sync clock, `doc_count` and tombstones work as before. The rows older versions wrote are cleared once, on the next wake, without making clients resync. Every create on every table also writes its `search_state` row once instead of twice (the clock and the count in one statement). On an append-only audit log this is 9 rows per insert down to 6.
