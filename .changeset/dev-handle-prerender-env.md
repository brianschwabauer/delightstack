---
'@delightstack/utilities': patch
---

`createDevHandle` no longer crashes prerenderable routes in dev. adapter-cloudflare gives a route with `prerender = true` a stand-in `platform.env` whose bindings are getters that throw, and assigning the bridge over a getter-only property threw `Cannot set property AUTH of #<Object> which has only a getter`, so every prerendered page returned a 500 under `vite dev`. Those bindings are now left alone; a prerendered route never reaches a Durable Object.
