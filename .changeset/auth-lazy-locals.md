---
'@delightstack/auth': patch
---

`event.locals.auth` is lazy again. The handle copied its locals with `Object.assign`, which invokes the `auth` getter, so the auth server was built on every request whether or not anything used it. On a prerenderable route under `vite dev`, adapter-cloudflare's stand-in env throws on any binding access, so that eager build turned every prerendered page into a 500 (`Cannot access platform.env.AUTH in a prerenderable route`). The locals are now defined with their property descriptors, so the getter only runs when something reads `locals.auth`.
