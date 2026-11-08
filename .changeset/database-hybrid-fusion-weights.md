---
'@delightstack/database': minor
---

Configurable hybrid fusion weights (DS-08)

`vector.weight` — the vector share of a hybrid query's fused score, `0..1` — is now part of the
public query surface: `{ term, vector: { value, field, similarity?, weight? } }`. Text gets the
complement (`1 - weight`), the default stays the previous fixed `0.5 / 0.5`, and the value rides
inside the existing `vector` JSON URL param, so encode/decode and the client→server routing carry
it unchanged.

The weight affects the ranking monotonically over max-normalized score sets, and the endpoints
short-circuit rather than fuse: `0` returns exactly the pure-text result — membership and order,
with no vector-only documents admitted at score 0 — and `1` exactly the pure-vector one. Anything
outside `0..1` (or not a finite number) is a 400 `invalid_vector_weight`, validated on every query
shape — vector-only included, where fusion would never read it. Server driver and memory reference
agree byte-for-byte; golden fixtures cover both endpoints, two intermediate weights and the error.
