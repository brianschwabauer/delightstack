---
'@delightstack/utilities': minor
---

Add `generateSortKey(before, after)` for fractional indexing, and a `length` option to
`generateTimestampID()`.

`generateSortKey` returns a plain string that sorts strictly between its two neighbors under
ordinary string comparison, so an ordered list can be reordered by writing one row instead of
renumbering every row after it. `generateSortKey()` gives the first key, `generateSortKey(key)`
appends, `generateSortKey(null, key)` prepends, and `generateSortKey(a, b)` inserts between. Keys
are a base62 integer part with a self-delimiting magnitude marker plus an optional base62 fraction,
so appends and prepends stay short (10,000 of either stay at 4 characters) and only repeated
insertion at the same position grows them. Invalid or out-of-order input throws a `DelightError`.

`generateTimestampID({ length })` shortens or lengthens the ID (default 20, unchanged). The first 8
characters remain the base62 timestamp so IDs of different lengths still sort chronologically
against each other; the remainder is random. A length below 10, or a non-integer, throws a
`DelightError`.
