---
'@delightstack/database': patch
---

The legacy `search_journal` teardown batch default drops from 5000 to 500 rows per invocation.

5000 assumed plain rows; journal entries carry multi-KB msgpack sparse-doc blobs, and a production Durable Object measured ~6.5ms per deleted row — a single 5000-row chunk burned the entire 30s CPU budget and reset the object before the chunk's own log line printed. 500 keeps a chunk around ~3s worst case. Override `legacyJournalDropBatch()` to tune it per deployment.
