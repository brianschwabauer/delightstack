---
'@delightstack/database': patch
---

Fix updates/deletes throwing `Cannot read properties of null (reading 'length')` for docs restored from a persisted index. `toSparse()` materialized missing optional searchable fields as explicit `field: undefined` keys; the msgpack index save stores `undefined` as `null` (msgpack has no undefined), and after a DO cold start Orama's `remove()` crashes on a null array property — so an affected doc could never be updated or deleted again (every consumer write to it 500'd). `toSparse()` now omits null/undefined leaves entirely, and index load strips null values from restored docs so already-poisoned persisted indexes heal on their next cold start instead of needing a rebuild.
