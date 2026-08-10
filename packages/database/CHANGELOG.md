# @delightstack/database

## 1.0.2

### Patch Changes

- 3450337: Fix DO cold starts rebuilding every search index and bumping its config_version, which forced every client into a permanent wipe-and-full-resync loop. The persisted orama config (JSON, function members dropped) was deep-compared against the live config (which always carries `components.getDocumentIndexId`), so the check failed on every wake. Both the index-config check and the sql_indexes definition check now compare against the serializable projection.

  Also normalize where-clause shorthands in both search paths: plain values and arrays on enum properties become `{eq}`/`{in}`, plain numbers become `{eq}` (Orama requires operation objects there and its throw surfaced as a 500), and Orama's filter-validation errors now return 400 instead of 500.

## 1.0.1

### Patch Changes

- 4652846: Raise the msgpack `maxDepth` to 4096 when persisting the saved Orama index. Large or deeply-nested indexes could exceed the default depth limit and fail to encode; the higher ceiling lets consumers with bigger indexes persist them without hitting the depth cap.
- 16f9b7f: Fix silent client-index document loss during large/live syncs (the "empty inbox" incident):

  - **Sync pages apply resiliently.** `insertMultiple` throws at the first invalid document, which silently dropped the rest of the page while the synced window still advanced — those documents were never refetched. Pages now fall back to per-document application, so one bad document costs only itself (loudly logged), never the page tail.
  - **Websocket entity events now carry the server's sparse (search-index) projection.** Clients previously inserted the FULL entity into an index built for the sparse schema; validation failures (arrays/objects/nulls) after the remove-before-insert silently evicted the document from the local index. The client indexes the `sparse` payload when present, projects full entities to the index schema otherwise, and rolls the synced window back + resyncs if an insert still fails.
  - **The client→server search-mode switch now measures the actual index size** (`count()`), not cumulative inserts — a live backfill re-syncs the same documents repeatedly and inflated the old counter past the threshold, abandoning the client index mid-sync.
  - **Equal-timestamp runs are never split across sync pages.** The server fetched exactly `limit` docs from Orama, so the "never split equal timestamps" trim could not see past the cut; the next page's exclusive boundary then skipped the rest of the run permanently. The fetch now grows until the boundary run is fully covered (legacy data only — writes get strictly monotonic timestamps).

- 0c92f48: Type-level fixes so consumer apps typecheck cleanly: the database schema's `Table` constraint no longer degenerates into an impossible `table_definition` union when a field generator's shape is `any`, and `StringFieldInputType` now matches the runtime (`tel` / `datetime-local` instead of `phone` / `datetime`); stripe's `PlanDefinition.entitlements` accepts `readonly string[]`; the images and ai request handles and utilities' `createDevHandle` are now generic over the event so they compose with SvelteKit's `Handle` without casts; the editor package no longer emits an `Editor` component export shadowed by the `Editor` class type (which made the component import type-only for consumers).
- Updated dependencies [0c92f48]
  - @delightstack/utilities@1.0.1

## 1.0.0

### Major Changes

- 8420739: First stable release (1.0.0). The DelightStack packages now version together at a coordinated, stable 1.0. This bump declares the public API of each package stable; individual packages may not have changed since their previous release.

### Patch Changes

- Updated dependencies [8420739]
  - @delightstack/utilities@1.0.0
