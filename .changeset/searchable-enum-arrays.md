---
'@delightstack/database': minor
---

Let `enum[]` fields be declared searchable through the schema builder.

`schema.array(schema.enum([...])).searchable()` was silently a no-op: `ArrayFieldGenerator.searchable()` accepted only `string`/`number`/`boolean` item types, so an enum array never reached the index schema — even though the index-schema builder, both engines (Orama and the native SQLite driver), the `where` DSL (`contains_all` / `contains_any`) and facets have always understood the `'enum[]'` type. Marking one searchable now emits `'enum[]'` in `config.orama.schema` and adds the path to `config.searchable_fields`, on either engine. Like every other array, the values still live in the row's internal `json` column — no SQLite column is added.

An `enum[]` field is indexed as a list of exact tokens: it is filterable and facetable, but it never participates in full-text term matching (a term query cannot match a label value).

**Type fix: searchable arrays now appear in the inferred search schema.** `Database.SearchSchema<Table>` dropped *every* array field (the inference read the item's `type` one level too shallow and tested the wrong node for `.searchable()`), so `string[]`, `number[]`, `boolean[]` and `enum[]` fields were missing from the typed `where`/`facets`/`order` surfaces even though the runtime indexed them. They are now inferred correctly, which means previously-untyped filters on those fields become type-checked — an array field filtered with an operator that its type does not allow (for example anything other than `contains_all` / `contains_any` on an `enum[]`) is now a type error.
