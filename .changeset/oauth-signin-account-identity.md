---
'@delightstack/auth': patch
---

Fix OAuth sign-in, which could never succeed: the callback exchanged the auth code for a token but never resolved *whose* account it was, so `signInWithOauth` always threw `Oauth account does not have an email` (and `vendor_id` was always an empty string, which would have collided every account onto one row).

`getOauthToken()` now resolves the account on the initial code exchange — reading the OpenID Connect `id_token` the vendor returns alongside the access token (Google, Microsoft, Apple, …), and falling back to a new optional `user_info_url` on the provider config for vendors that don't issue one (e.g. GitHub). The resolver is also exported as `getOauthAccount()`. Emails the vendor explicitly marks unverified are discarded rather than trusted, and `signInWithOauth` now rejects a token with no `vendor_id` instead of storing a blank one.
