---
'@delightstack/auth': patch
---

Linking an OAuth account that's already linked to the same user now signs in with it instead of failing with "already connected to another user". Providers often hand back the account the browser is already signed into, which is the one already linked. The sign-in route also passes `?prompt=select_account` (or `consent` / `login`) through to the provider, so a "link another account" button can show the account chooser.
