# @delightstack/auth

## 1.2.1

### Patch Changes

- Updated dependencies [a3e0a38]
  - @delightstack/utilities@1.2.0

## 1.2.0

### Minor Changes

- d86752e: v2 simplification: one reactive handle API, zod removed, and a much smaller surface.

  **Client — three reactive handles replace five overlapping read APIs.** `db.get(type, id)` returns a cached reactive `EntityHandle` (`.value`, `.status`, `await .load()`), `db.entity(type, id)` stays the editing wrapper (now with `.load()` returning the entity and a `status` getter), and `db.list(type, query)` returns a reactive `ListHandle` — the merger of the old `db.list` and `db.watch` — with live `results`/`docs`/`count`/`has_more`/`mode`, a live `query`, `loadMore()`, and one-shot `await .load()` that also works on SSR. Removed: `db.watch` (`DatabaseWatch`), `db.read` (`EntityReader`), `EntityState.from`, `markHydrated`, the worker RPCs `getSearchMode`/`isSynced` (every result now carries `mode: 'client' | 'server'` — the live routing decision, per result), and `SearchResult.elapsed`. `WatchStatus` is renamed `HandleStatus`. The old `$derived(await db.get(id))` pattern becomes `db.get(id).value` or `$derived(await db.get(id).load())`.

  **Schema — zod is gone.** Validation is in-house and dependency-free; `parse()` behavior is unchanged except failures now throw `DelightError` (status 400, `issues` attached) and format checks compose with `min`/`max` (zod silently dropped a `min` when a format replaced the base schema). The zod-passthrough builder methods (`endsWith`, `transform`, `refine`, `gte`/`lte`, `prefault`, `multipleOf`, …) are deleted — `.check(fn)` is the custom-validation escape hatch and `.step(n)` sets the form step. `table()` now takes 2 generic parameters instead of 12, `Database.Table` is the one table type (`Database.AnyTable` remains as a deprecated alias), and `config.table_definition` is a plain `Record<string, string>`.

  **Server.** `createDatabaseHandle` supports only the `tables` + `hooks` mode (`tables` is required); `defineRoute` and the `routes` array are removed, and the sync endpoint is POST-only. `DatabaseSyncRequest` drops the top-level `start_updated_at`/`end_updated_at`/`limit` — ranges and limits are per-entity in the `entity` map (still one request for any number of entity types; `config_version` is now optional). The batch array overload of `DatabaseServer.get()` is removed, as are the never-read `event.user_id` fields on transaction operations. `SqlServer` moved into `@delightstack/auth` (it was auth-private in practice); `@delightstack/database` keeps `prepareSql`/`SqlTaggedTemplate`.

  **Websocket.** `EntityChangedMessage.user_id` is removed and `entityChanged` is now `(action, entity_type, id, data?, sparse?)` — the `user_id` slot was never populated.

  Internals: the search subsystem's three engines now share `core/pipeline.ts`/`core/dictionary.ts`/`core/schema_fields.ts` (golden vectors unchanged — behavior is frozen), and roughly 5,600 net lines were deleted across the packages.

  **DX round (same release).**

  - **Root entry is schema + types only.** `@delightstack/database` no longer re-exports `/server` — import `createDatabaseHandle` from `@delightstack/database/server`. The unused `./schema` export is removed. A schema-only import can no longer drag the SvelteKit handler into a worker/client bundle.
  - **`prepareSql`/`SqlTaggedTemplate`/`SqlPreparedQuery`/`SqlQueryFn` moved to `@delightstack/utilities`** (re-exported from `@delightstack/database/server` for compatibility). `@delightstack/auth` now depends only on utilities — not on the database package.
  - New **`DatabaseStub<Config>`** type: the async RPC projection of `DatabaseServer`, so a Durable Object stub can be cast once at the boundary (`event.locals.db`) and stay fully typed everywhere — no more hand-written `unknown`-typed RPC interfaces in `app.d.ts`.
  - New **alarm registry**: `DatabaseServer.registerAlarm(name, fn)` + a base `alarm()` that runs every registered handler with per-handler error isolation. `imageProcessing()` and `aiProcessing()` self-register, so subclasses no longer hand-write an `alarm()` fan-out. New `DatabaseServer.instanceName(ctx)` (static) and `this.instance_name` recover the `idFromName()` key without casting `ctx.id`.
  - **Typed database ↔ websocket contract.** `DatabaseBroadcast`, `DatabaseClientHooks`, and `DatabaseEntityChange` are exported from the database root; `WebsocketServer` `implements DatabaseBroadcast` and `WebsocketClient.databaseHooks()` returns `Required<DatabaseClientHooks>` (websocket gains a type-only dependency on database; `EntityChangeEvent` is now an alias of `DatabaseEntityChange`). Drift between the packages is now a compile error.
  - **`foreignKey` accepts the referenced table object** (`table: organizationTable`) as well as its name string — a typo'd reference becomes a compile error.
  - `@delightstack/ai`: the `ws` option is now the minimal `AiBroadcastChannel` (`broadcast()` only), satisfied by a `WebsocketServer` DO stub directly — no more `as unknown as WebsocketServer` at the call site. The AI tables also stop declaring `created_at`/`updated_at` (auto-managed epoch-ms numbers in v2; the old datetime-string declarations threw at table-definition time).

  **Follow-up round (same release).** `ListHandle.results`/`docs` renamed to `hits`/`items` (`SearchResult.docs` → `items`; hit objects keep `{ id, score, document }`). `createDatabaseHandle`'s `sync` option now defaults to `true`. `and`/`or`/`not`/`$derived` are reserved field names (compile-time + runtime errors — they collide with the where-clause grammar and the internal derived-values store). `sparse: false` routes client queries to the server automatically, and `source: 'client'` combined with it is an error like `vector`. Validation gained a coercion stage shared by `parse()` and the form standard schema (previously the form path was strict where `table.parse` was liberal): `Date` → epoch ms for `number()` fields (including `created_at`/`updated_at`) or ISO text for `.date()`/`.time()`/`.datetime()` fields, `URL` → `.href` for `.url()` fields, whole numeric strings → numbers, `'true'`/`'on'`/`'false'`-style tokens → booleans, typed arrays → plain `vector()` arrays, and `{ latitude, longitude }` → `{ lat, lon }` geopoints — ambiguous conversions (JSON strings, ISO text into plain number fields) are deliberately not attempted, and unformatted string fields still reject `Date`s. Several builder methods returned as in-house implementations: `startsWith`/`endsWith`/`includes`, the transforms `trim`/`toLowerCase`/`toUpperCase`/`normalize` (run before validators, in declaration order), and exclusive bounds `gt`/`lt`; `.step(n)` now validates divisibility (decimal-safe) in addition to setting the form step attribute. New `db.signOut()` wipes all locally persisted data (IndexedDB entity cache, sync cursors, and search index) with freeze-then-wipe semantics — no UI repaints between the call and the app's navigation — `init()` after sign-out restores a working client. `DatabaseClient`'s lifecycle booleans are consolidated into **`db.status`** (`'idle' | 'initializing' | 'ready' | 'signed_out'`) — `initialized`, `hydrated`, and `signed_out` are removed (`hydrated` is now internal); the `syncing`/`synced` booleans remain.

### Patch Changes

- Updated dependencies [d86752e]
  - @delightstack/utilities@1.1.0

## 1.1.4

### Patch Changes

- Updated dependencies [2562f06]
  - @delightstack/database@1.1.0

## 1.1.3

### Patch Changes

- Updated dependencies [2336fca]
  - @delightstack/database@1.0.4

## 1.1.2

### Patch Changes

- Updated dependencies [ed3a41e]
  - @delightstack/database@1.0.3

## 1.1.1

### Patch Changes

- Updated dependencies [3450337]
  - @delightstack/database@1.0.2

## 1.1.0

### Minor Changes

- c3643b5: Security hardening for org invitations, membership tokens, and token sources:

  - **Invitation routes now require org admin.** `POST /invitation` previously only required membership, so any member could mint an invitation with any permission bits (including admin) and escalate through a second account. `PATCH`/`DELETE /invitation/:id` additionally verify the invitation belongs to the caller's active org — they were unscoped primary-key operations, allowing cross-org escalation and deletion.
  - **`requireOrgAdmin` recognizes owners without a membership token.** Ownership is checked before membership, so an org owner passes admin checks even when their session token carries no permission bits for the org (e.g. immediately after `createOrg` with a misconfigured `org_admin_permission`).
  - **The only-admin removal guard uses the configured `orgAdminPermission`.** It previously matched the hardcoded name `'org:write'`, which silently disabled the "cannot remove the only admin" protection for every app with its own permission set.
  - **Permission-0 rows are excluded from session tokens and org resolution.** `createSessionToken` no longer encodes `org_user` rows with no permission bits, and `defaultResolveOrgId` ignores such tokens — a lingering zero-permission row can no longer resolve an org or pass membership checks.
  - **The `?auth=` query-parameter JWT source is now opt-in** via the new `allow_query_token` config flag (default `false`). URLs leak into Referer headers, browser history, and server logs, so a query-string token source must be a deliberate choice.

  Migration notes: apps that let non-admin members create invitations must now grant those members the admin permission or create invitations server-side. Apps relying on `?auth=` must set `allow_query_token: true`. Ensure `org_admin_permission` (handler config) and `orgAdminPermission` (Durable Object options) name a real entry in your `permissions` array — with the old default `'org:admin'` unmatched, org creators started with zero permission bits and only owners passed admin checks.

## 1.0.3

### Patch Changes

- 58e3108: Fix preference and org-state writes being silently dropped on auth routes. `PATCH /preference` and `PATCH /org/:id/state` answered `200` with the merged data, but the cookie never reached the browser: SvelteKit only attaches `event.cookies` to responses that go through `resolve()`, and auth routes return their own `Response` — only the session cookie was being serialized by hand. So `auth.setPreferences()` looked like it worked and then read back empty on the next request, taking anything built on it (first-run hints, dark mode, cached org data) with it. Both cookies (and the org-state deletions on sign-out) are now serialized onto the response alongside the session cookie.
- 12b9dfd: Close an open redirect in the sign-in routes. The `?redirect=` parameter was passed through to the browser's `Location` untouched, so `/api/auth/signin/google?redirect=//evil.example.com` sent users to another origin the moment they finished signing in — on the app's own domain, with a real session, which is exactly the shape a phishing link wants. The parameter is now narrowed to a same-site path (absolute URLs, protocol-relative `//host`, and `/\host` all fall back to `/`) both when the state is signed and again when the callback consumes it.

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
