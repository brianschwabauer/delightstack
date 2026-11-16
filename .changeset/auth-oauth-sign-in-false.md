---
'@delightstack/auth': minor
---

OAuth providers can be connect-only, and an `email_verified: "FALSE"` claim no longer counts as verified (security fix).

- **`sign_in: false` on an OAuth provider.** Every provider in `oauth` used to be a sign-in method as well as a connect target, so a provider configured only to link an API (a CRM, say) also answered `GET /signin/:vendor` and its callback, and could sign people in. With `sign_in: false`, both sign-in routes answer 404 as if the provider weren't configured, while `/oauth/:vendor` and its callback keep connecting accounts. The default is `true`, so existing configs behave as before.
- **Unknown providers on the sign-in routes answer 404** (they answered 400), the same as a `sign_in: false` provider, so a caller can't tell the two apart.
- **`email_verified` / `verified_email` are read case-insensitively.** Only the exact string `'false'` counted as unverified, so a vendor sending `"FALSE"` had its email treated as verified, and signing in linked the login to whichever existing user had that email. `false`, or the string `"false"` in any casing and with surrounding whitespace, now means unverified. A missing claim still counts as verified.
