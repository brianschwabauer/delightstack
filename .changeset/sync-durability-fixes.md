---
'@delightstack/database': patch
'@delightstack/websocket': patch
---

Fix silent client-index document loss during large/live syncs (the "empty inbox" incident):

- **Sync pages apply resiliently.** `insertMultiple` throws at the first invalid document, which silently dropped the rest of the page while the synced window still advanced — those documents were never refetched. Pages now fall back to per-document application, so one bad document costs only itself (loudly logged), never the page tail.
- **Websocket entity events now carry the server's sparse (search-index) projection.** Clients previously inserted the FULL entity into an index built for the sparse schema; validation failures (arrays/objects/nulls) after the remove-before-insert silently evicted the document from the local index. The client indexes the `sparse` payload when present, projects full entities to the index schema otherwise, and rolls the synced window back + resyncs if an insert still fails.
- **The client→server search-mode switch now measures the actual index size** (`count()`), not cumulative inserts — a live backfill re-syncs the same documents repeatedly and inflated the old counter past the threshold, abandoning the client index mid-sync.
- **Equal-timestamp runs are never split across sync pages.** The server fetched exactly `limit` docs from Orama, so the "never split equal timestamps" trim could not see past the cut; the next page's exclusive boundary then skipped the rest of the run permanently. The fetch now grows until the boundary run is fully covered (legacy data only — writes get strictly monotonic timestamps).
