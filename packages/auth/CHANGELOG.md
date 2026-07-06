# @delightstack/auth

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
