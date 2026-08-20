---
'@delightstack/database': minor
---

`.serverOnly()` — index a field in the Durable Object without shipping it to every client.

`.searchable()` put a field in the sparse sync payload and therefore in both indices, so there was no way to make a large field searchable on the server without also copying it to every device. A full document body is the case that forces the issue: you want term search across every body, and you emphatically do not want every body in every client's IndexedDB.

The field tiers were already two independent questions — does the value reach the client, is it indexed — with three of the four corners filled. This fills the last one, and it is the mirror image of `.carried()`: carried means the client gets the value and the index does not, server-only means the index gets it and the client does not.

| Tier | Synced | Indexed |
| --- | --- | --- |
| `.searchable()` | yes | both sides |
| `.carried()` | yes | no |
| `.searchable().serverOnly()` | no | server only |
| default | no | no |

```typescript
body: schema.string().searchable().serverOnly(),
```

Order does not matter. On its own `.serverOnly()` would describe a field that is neither synced nor indexed — the default tier — so it throws when the table is built, as does combining it with `.carried()` (the opposite tier) or `.sortable()` (the client index cannot order by a value it never receives).

The value is held back from the *wire*, not from the database — `db.get()` and any `sparse: false` read still return it. One list drives one strip, sharing the path vector fields already took out of the sync payload for the same reason: indexed where it lives, too heavy to copy everywhere.

`SearchEntity` types the field as absent, so reading it off a synced document is a compile error rather than a silent `any`; the full `Entity` type still has it. It is typed absent by intersection rather than removed with `Omit`, because the indexed-document type carries an open index signature — it deliberately admits dot-notation child paths — so subtracting a key does nothing there while intersecting one still narrows it.

A query naming such a field in `where`, `order`, `facets`, `boost`, `fields` or `distinct_on` routes to the server, as `vector` and `sparse: false` queries already do; `source: 'client'` on one is a 400 naming the field. A bare `term` search is deliberately not redirected — its default `fields: '*'` means "everything indexed here", and on the client that is legitimately a subset, which is coverage-based routing working rather than a query that cannot be answered.

There is no client-only counterpart. `index_schema` is a single object and the server indexes whatever it stores, so a client-only tier would require a second, divergent schema; a value only the client needs is `.carried()`.
