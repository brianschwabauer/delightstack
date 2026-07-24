# @delightstack/websocket

## 1.0.2

### Patch Changes

- 16f9b7f: Fix silent client-index document loss during large/live syncs (the "empty inbox" incident):

  - **Sync pages apply resiliently.** `insertMultiple` throws at the first invalid document, which silently dropped the rest of the page while the synced window still advanced — those documents were never refetched. Pages now fall back to per-document application, so one bad document costs only itself (loudly logged), never the page tail.
  - **Websocket entity events now carry the server's sparse (search-index) projection.** Clients previously inserted the FULL entity into an index built for the sparse schema; validation failures (arrays/objects/nulls) after the remove-before-insert silently evicted the document from the local index. The client indexes the `sparse` payload when present, projects full entities to the index schema otherwise, and rolls the synced window back + resyncs if an insert still fails.
  - **The client→server search-mode switch now measures the actual index size** (`count()`), not cumulative inserts — a live backfill re-syncs the same documents repeatedly and inflated the old counter past the threshold, abandoning the client index mid-sync.
  - **Equal-timestamp runs are never split across sync pages.** The server fetched exactly `limit` docs from Orama, so the "never split equal timestamps" trim could not see past the cut; the next page's exclusive boundary then skipped the rest of the run permanently. The fetch now grows until the boundary run is fully covered (legacy data only — writes get strictly monotonic timestamps).

- Updated dependencies [0c92f48]
  - @delightstack/utilities@1.0.1

## 1.0.0

### Major Changes

- 8420739: First stable release (1.0.0). The DelightStack packages now version together at a coordinated, stable 1.0. This bump declares the public API of each package stable; individual packages may not have changed since their previous release.

### Patch Changes

- Updated dependencies [8420739]
  - @delightstack/utilities@1.0.0
