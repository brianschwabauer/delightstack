---
'@delightstack/auth': patch
---

In dev, `createAuthHandle` trusts a proxy's `X-Forwarded-Proto: https` and upgrades `event.url` to https. Behind a TLS-terminating proxy (Caddy → Vite over http) the browser's https `Origin` no longer fails the CSRF check, and OAuth callback URLs, email links and passkey origins come out as https. Production is unchanged.
