---
'@delightstack/database': patch
---

The legacy `search_index`/`search_journal` teardown after a completed migration is now chunked, fixing a CPU-limit wedge on large journals.

DO SQLite executes `DROP TABLE` (like every large delete) row by row. The legacy journal holds one msgpack row per document, so on a big corpus the single-transaction drop that runs right after the last rebuild finalizes could exceed the Durable Object CPU limit — and then retry identically on every wake, forever, taking the object down just as its migration completed. The teardown now empties the journal in bounded chunks (default 5000 rows per invocation, overridable via `legacyJournalDropBatch()`), continued by the same self-re-arming alarm as the chunked rebuild, and only runs the now-cheap `DROP`s once the final chunk fits.
