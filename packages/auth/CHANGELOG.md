# @delightstack/auth

## 1.0.2

### Patch Changes

- 7252eb4: Fix OAuth sign-in leaving the browser signed out. The handler only set the session cookie when a route returned a JSON body containing `jwt`, but the OAuth callback finishes with a redirect — so the session it had just created was thrown away and the user landed back on the app unauthenticated. Route handlers now get an `applySession(jwt, decoded_jwt)` callback (session cookie + saved-preferences restore, the same path the JSON responses take) and the OAuth callback calls it before redirecting.

## 1.0.1

### Patch Changes

- 2d631f4: Security fixes: `decodeJwt` now verifies the key id and signature **before** checking expiry, so a forged token can no longer reach the session-refresh path (which trusts the token's `jti`) by claiming to be expired. The OAuth token exchange (`POST /oauth/token`) now authenticates the client — `client_secret` is verified and the auth code / refresh token must have been issued to the requesting `client_id`. Password reset and password change now properly `await` `checkPasswordStrength`, so weak or breached passwords are rejected again instead of the check being silently detached.
- 1faece7: Fix OAuth sign-in, which could never succeed: the callback exchanged the auth code for a token but never resolved _whose_ account it was, so `signInWithOauth` always threw `Oauth account does not have an email` (and `vendor_id` was always an empty string, which would have collided every account onto one row).

  `getOauthToken()` now resolves the account on the initial code exchange — reading the OpenID Connect `id_token` the vendor returns alongside the access token (Google, Microsoft, Apple, …), and falling back to a new optional `user_info_url` on the provider config for vendors that don't issue one (e.g. GitHub). The resolver is also exported as `getOauthAccount()`. Emails the vendor explicitly marks unverified are discarded rather than trusted, and `signInWithOauth` now rejects a token with no `vendor_id` instead of storing a blank one.

- Updated dependencies [4652846]
- Updated dependencies [16f9b7f]
- Updated dependencies [0c92f48]
  - @delightstack/database@1.0.1
  - @delightstack/utilities@1.0.1

## 1.0.0

### Major Changes

- 8420739: First stable release (1.0.0). Adds passkeys, one-time email codes, and organization route authorization.

  - **Passkeys (WebAuthn):** register, list, rename, and remove passkeys, plus passwordless sign-in with discoverable credentials. Uses server-stored single-use challenges (5-minute TTL, consumed before verification to prevent replay), signature-counter clone detection, and per-IP rate limits. New optional `passkeys` config (`rp_id` / `rp_name` / `origins`) — zero-config by default, derived from the request origin. Client: `auth.signIn.passkey({ autofill? })` and `auth.passkey.register/list/rename/remove/isSupported`.
  - **One-time email codes:** sign-in and verification emails can carry a 6-character code alongside (or instead of) the magic link, controlled by the new `email.link` / `email.code` config flags. Codes are cryptographically random, stored as salted hashes, single-use, and capped at 5 guesses per code with per-IP rate limiting. New routes `POST /signin/email/code` and `POST /email/verify/code`; client `auth.signIn.emailCode()` and `auth.email.confirmWithCode()`.
  - **Organization authorization (behavior change):** org routes are now access-controlled. Previously any signed-in user could rename or delete any organization, manage its members, or take ownership by id. Renaming and member management now require the new `org_admin_permission` (default `org:admin`; the owner always qualifies); deleting and ownership transfer require the current owner; listing members requires membership; members may always remove themselves. Adds the `auth.transferOrgOwnership()` client helper.

  Adds new `Passkey` types and `passkey_*` / `invalid_code` error codes. The `user_passkey` and `webauthn_challenge` tables and the `user_session.code_hash` / `code_attempts` columns are created automatically by the schema migrations on the next Durable Object upgrade.

### Patch Changes

- Updated dependencies [8420739]
  - @delightstack/database@1.0.0
  - @delightstack/utilities@1.0.0
