---
'@delightstack/auth': patch
---

The auth handle no longer fails a request when `getClientAddress()` throws, as it does in `vite dev` once the client has hung up and during prerendering; `meta.ip_address` is left unset instead.
