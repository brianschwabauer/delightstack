---
'@delightstack/database': minor
---

`db.list(type, { sparse: false })` is now typed with full entities.

A `sparse: false` query has always been answered with complete rows — the client routes it to the server, which reads the entity table rather than the search projection. The types never said so: `ListHandle.hits`, `.items` and `load()` all claimed `Database.SearchEntity<T>` (searchable fields only), so any consumer that queried `sparse: false` to read a non-searchable field had to cast it away. The narrowing is now in the type: `db.list` infers the query type and resolves the document shape through `ListDocument<T, Q>` — `Database.Entity<T>` when the query carries `sparse: false`, `Database.SearchEntity<T>` otherwise.

Only a **literal** `false` narrows. An object literal, an `as const` query and the function form (`db.list('post', () => ({ sparse: false }))`) all infer it; a query held in a `Database.SearchQuery` variable widens `sparse` to `boolean` and keeps the sparse type, which is the safe direction — the type can never over-promise fields the projection might not carry.

`SearchHit` and `SearchResult` take a second, defaulted generic (`SearchHit<T, Doc = Database.SearchEntity<T>>`), so existing `SearchResult<typeof POST>` annotations keep exactly their old meaning and compile unchanged. **Pedantically breaking:** code that explicitly annotated the result of a `sparse: false` query as `SearchResult<T>` / `SearchEntity<T>` now sees the wider entity type on one side of that assignment — the annotation still compiles, but the casts it was written to justify are now unnecessary. Runtime behavior is untouched; this release changes types only.
