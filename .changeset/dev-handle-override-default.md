---
'@delightstack/utilities': minor
---

`createDevHandle` now replaces the listed Durable Object bindings by default (`override` defaults to `true`). When the server worker is running, wrangler's dev registry gives `getPlatformProxy()` its own stubs for cross-script DO bindings. Miniflare can't pass a thrown error back through those stubs: it fails `assert(typeHeader === "Promise")`, so a wrong password or any other `DelightError` crashes instead of returning its status. Under the old `false` default the HTTP bridge silently stood aside whenever those stubs existed. **Migration:** nothing to do if your DOs live in a separate worker. To keep a binding the platform proxy supplies and the bridge can't serve, leave it out of `bindings` or pass `override: false`.
