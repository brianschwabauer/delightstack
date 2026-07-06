# @delightstack/auth

Full-stack authentication for SvelteKit apps on Cloudflare Workers. Email/password, magic links, email codes, passkeys (WebAuthn), OAuth providers, multi-org, invitations, permissions, preferences, and an OAuth 2.0 server — all backed by a single Durable Object.

## Features

- **Email/password auth** — Sign up, sign in, password reset, and password change with Argon2id hashing
- **Magic links** — Passwordless email sign-in via short-lived JWT links
- **Email codes** — Passwordless sign-in and email verification with a 6-character one-time code (case-insensitive; no vowels or ambiguous characters like 0/o and 1/l, so codes read cleanly and never spell words), for when the email lands on a different device than the app. Enable links, codes, or both — brute-force protected by per-IP rate limits and a persistent 5-guess cap per code
- **Passkeys (WebAuthn)** — Phishing-resistant, usernameless sign-in with Touch ID, Face ID, or security keys. Works with zero config alongside other sign-in methods
- **OAuth providers** — Sign in with Google, GitHub, or any OAuth 2.0 provider. Link multiple providers to one account
- **Multi-organization** — Users belong to multiple orgs with bitwise-encoded role permissions. Org switching, user management, and invitations built in
- **Invitation system** — Email or link-based invitations with configurable permissions, expiry, and max redemptions
- **Reactive client** — Svelte 5 `AuthClient` class with `$state`/`$derived` runes, auto-refresh, and typed API methods
- **Route guards** — `requireAuth`, `requireOrg`, `requirePermission`, and `requireEntitlement` guards for SvelteKit server loads
- **Three-cookie architecture** — Session JWT, cross-device preferences (persists across signouts, synced to DB), and per-org state (cache-only)
- **OAuth 2.0 server** — Be an OAuth provider: application registration, authorization codes, access/refresh tokens, secret rotation
- **Lifecycle hooks** — `onSignIn`, `onSignUp`, `onSignOut`, `onPasswordReset`, `onEmailVerified`, `onOrgJoined`

## Architecture

```
┌───────────────────────────────────────────────────────────┐
│  SvelteKit App                                            │
│                                                           │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  createAuthHandle()                                  │ │
│  │                                                      │ │
│  │  1. Extract JWT (cookie / header / query)            │ │
│  │  2. Decode & auto-refresh expired tokens             │ │
│  │  3. Read preferences + org state cookies             │ │
│  │  4. Resolve org_id (params / query / header / auto)  │ │
│  │  5. Populate event.locals (AuthLocals)               │ │
│  │  6. Match /api/auth/* routes → handle                │ │
│  │  7. CSRF verification on mutating requests           │ │
│  │  8. Flush dirty cookies + sync preferences to DB     │ │
│  └────────────────────────┬─────────────────────────────┘ │
│                           │ RPC                           │
│                           ▼                               │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  AuthDatabaseServer (Durable Object)                 │ │
│  │                                                      │ │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │ │
│  │  │  SQLite  │  │  Argon2  │  │  JWT (HMAC-SHA256) │  │ │
│  │  │ (users,  │  │  (WASM)  │  │  (Web Crypto API)  │  │ │
│  │  │  orgs,   │  └──────────┘  └────────────────────┘  │ │
│  │  │  tokens) │                                        │ │
│  │  └──────────┘                                        │ │
│  └──────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```

**Single-writer model:** Durable Objects guarantee one instance handles all auth writes, eliminating race conditions. SQLite provides the persistence layer with atomic transactions.

**Stateless JWTs with server-side revocation:** Sessions are JWT tokens (HMAC-SHA256) containing user info, org memberships, and encoded permissions. The Durable Object stores session records for revocation and refresh. Expired tokens are auto-refreshed transparently in the Handle.

**Three cookies:** The session JWT cookie carries the auth token. A separate preferences JWT cookie persists across signouts for things like dark mode and is synced to the user DB for cross-device access. Per-org state JWT cookies cache org-specific data and are cleared on signout.

## Quickstart

### 1. Define your config

```typescript
// src/lib/auth.config.ts
import { defineAuthConfig } from '@delightstack/auth/server';

export const authConfig = defineAuthConfig({
	secret: env.JWT_KEY_SECRET,
	issuer: 'my-app',
	permissions: ['org:read', 'org:write', 'org:admin', 'org:owner'] as const,
	oauth_scopes: ['profile', 'email'] as const,
	entitlements: ['premium', 'video-uploads', 'extra-usage'] as const,
	dev,
	cookies: {
		session_name: 'my-app-session',
		preferences_name: 'my-app-pref',
		org_state_prefix: 'my-app-org-',
	},
	email: {
		sendEmail: async ({ to, subject, html, text, link, code, type }) => {
			// Send via your email provider (Resend, SES, etc.)
		},
		// What sign-in / verification emails contain (enable either or both):
		link: true, // a clickable magic link (default)
		code: false, // a 6-character one-time code the user types in
	},
	hooks: {
		onSignUp: async ({ result, method }) => {
			// e.g. send welcome email, create default resources
		},
	},
});
```

### 2. Create the Durable Object

```typescript
// src/lib/server/auth.do.ts
// The Durable Object class must be imported from '/worker' — it depends on
// cloudflare:workers and .wasm modules that only resolve inside the Workers runtime
import { AuthDatabaseServer } from '@delightstack/auth/worker';

export class AuthDO extends AuthDatabaseServer {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env, {
			secret: env.JWT_KEY_SECRET,
			issuer: 'my-app',
			permissions: ['org:read', 'org:write', 'org:admin', 'org:owner'],
			oauth_scopes: ['profile', 'email'],
		});
	}
}
```

### 3. Wire into SvelteKit

```typescript
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import { createAuthHandle, type AuthServer } from '@delightstack/auth/server';

const authHandle = createAuthHandle({
	config: {
		secret: env.JWT_KEY_SECRET,
		issuer: 'my-app',
		permissions: ['org:read', 'org:write', 'org:admin', 'org:owner'],
		oauth_scopes: ['profile', 'email'],
		dev,
	},
	getAuthServer: (event) => {
		const platform = event.platform as App.Platform;
		const id = platform.env.AUTH.idFromName('main');
		return platform.env.AUTH.get(id) as unknown as AuthServer;
	},
});

export const handle = sequence(authHandle);
```

### 4. Use on the client

```typescript
// src/routes/+layout.server.ts
import type { AuthLocals } from '@delightstack/auth/server';

export const load = ({ locals }) => ({
	auth: (locals as AuthLocals).auth_client_data,
});

// src/routes/+layout.ts
import { AuthClient } from '@delightstack/auth/client';

export const load = ({ data }) => ({
	auth: new AuthClient(data.auth), // permissions included automatically from config
});
```

```svelte
<!-- src/routes/+layout.svelte -->
<script>
	const { data } = $props();
	const auth = data.auth;
</script>

{#if auth.signed_in}
	<p>Hello, {auth.name}</p>
	<button onclick={() => auth.signOut()}>Sign out</button>
{:else}
	<a href="/signin">Sign in</a>
{/if}
```

## Configuration

`AuthConfig` accepts these options:

| Option                      | Type                                                | Default                            | Description                                                              |
| --------------------------- | --------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| `secret`                    | `string`                                            | _required_                         | Hex-encoded HMAC-SHA256 key for JWT signing                              |
| `issuer`                    | `string`                                            | _required_                         | JWT issuer identifier                                                    |
| `permissions`               | `readonly string[]`                                 | _required_                         | Permission names for bitwise role encoding (index = bit position)        |
| `oauth_scopes`              | `readonly string[]`                                 | _required_                         | OAuth scope names for bitwise capability encoding (index = bit position) |
| `entitlements`              | `readonly string[]`                                 | `[]`                               | Entitlement names for bitwise org-level feature encoding (index = bit position) |
| `dev`                       | `boolean`                                           | `false`                            | Dev mode — disables secure cookies                                       |
| `base_path`                 | `string`                                            | `'/api/auth'`                      | Base path for auth API routes                                            |
| `csrf`                      | `boolean \| { allowed_origins }`                    | `true`                             | CSRF protection via Origin/Referer headers                               |
| `cookies.session_name`      | `string`                                            | `'auth-session'`                   | Session cookie name                                                      |
| `cookies.preferences_name`  | `string`                                            | `'auth-pref'`                      | Preferences cookie name                                                  |
| `cookies.org_state_prefix`  | `string`                                            | `'auth-org-'`                      | Per-org state cookie name prefix                                         |
| `cookies.path`              | `string`                                            | `'/'`                              | Cookie path                                                              |
| `cookies.secure`            | `boolean`                                           | `!dev`                             | HTTPS-only cookies                                                       |
| `cookies.http_only`         | `boolean`                                           | `true`                             | Prevents JavaScript access                                               |
| `cookies.same_site`         | `'strict' \| 'lax' \| 'none'`                       | `'lax'`                            | SameSite policy                                                          |
| `session.expires_in`        | `number`                                            | `3600`                             | Session duration in seconds                                              |
| `session.refresh_threshold` | `number`                                            | `600`                              | Auto-refresh threshold in seconds                                        |
| `resolveOrgId`              | `(event, session) => string \| null`                | URL params > query > header > auto | Custom org_id resolver                                                   |
| `oauth`                     | `Record<vendor, { client_id, client_secret, ... }>` | —                                  | OAuth provider credentials                                               |
| `passkeys.rp_id`            | `string`                                            | request hostname                   | WebAuthn relying party ID (the domain passkeys are bound to)             |
| `passkeys.rp_name`          | `string`                                            | `issuer`                           | App name shown in the browser's passkey prompt                           |
| `passkeys.origins`          | `string[]`                                          | `[request origin]`                 | Origins allowed to complete WebAuthn ceremonies                          |
| `email.sendEmail`           | `(options) => Promise<void>`                        | —                                  | Email sending function                                                   |
| `email.link`                | `boolean`                                           | `true`                             | Include a magic link in sign-in / verification emails                    |
| `email.code`                | `boolean`                                           | `false`                            | Include a one-time code in sign-in / verification emails                 |
| `org_admin_permission`      | `string`                                            | `'org:admin'`                      | Permission that marks a user as org admin for the org API routes        |
| `hooks`                     | `{ onSignIn, onSignUp, onSignOut, ... }`            | —                                  | Lifecycle hooks                                                          |

## API Routes

All routes are served under `base_path` (default `/api/auth`). The Handle intercepts matching requests automatically.

### Authentication

| Method | Path                       | Description                                    |
| ------ | -------------------------- | ---------------------------------------------- |
| `POST` | `/signin/email`            | Sign in with email and password                |
| `POST` | `/signin/email/magic`      | Request a sign-in email (link and/or code)     |
| `POST` | `/signin/email/code`       | Sign in with an emailed one-time code          |
| `GET`  | `/signin/email/verify`     | Verify a magic link token                      |
| `POST` | `/signup/email`            | Create a new account with email                |
| `GET`  | `/signin/:vendor`          | Initiate OAuth sign-in (redirects to provider) |
| `GET`  | `/signin/:vendor/callback` | OAuth sign-in callback                         |
| `POST` | `/signout`                 | Sign out (returns 204)                         |
| `GET`  | `/signout`                 | Sign out and redirect to `/`                   |

### Passkeys (WebAuthn)

| Method   | Path                      | Description                                             |
| -------- | ------------------------- | ------------------------------------------------------- |
| `POST`   | `/signin/passkey/options` | Get authentication options (challenge) for signing in   |
| `POST`   | `/signin/passkey`         | Verify a passkey assertion and sign in                  |
| `POST`   | `/passkey/options`        | Get registration options (challenge) — authenticated    |
| `POST`   | `/passkey`                | Verify registration and add the passkey — authenticated |
| `GET`    | `/passkey`                | List the user's passkeys                                |
| `PATCH`  | `/passkey/:id`            | Rename a passkey                                        |
| `DELETE` | `/passkey/:id`            | Remove a passkey (revokes its sign-in method)           |

Challenges are stored server-side, single-use, and expire after 5 minutes. Sign-in uses
discoverable credentials, so no email is needed first. Each passkey is backed by a
`user_auth` row and follows the same safety rules as other sign-in methods (e.g. the last
verified method can't be removed).

### Sessions

| Method   | Path               | Description               |
| -------- | ------------------ | ------------------------- |
| `GET`    | `/session`         | Get current session info  |
| `POST`   | `/session/refresh` | Refresh the session token |
| `GET`    | `/session/list`    | List all active sessions  |
| `DELETE` | `/session/:id`     | Revoke a specific session |

### Password

| Method  | Path                      | Description                       |
| ------- | ------------------------- | --------------------------------- |
| `POST`  | `/password/reset`         | Request a password reset email    |
| `POST`  | `/password/reset/confirm` | Confirm password reset with token |
| `PATCH` | `/password`               | Change password (authenticated)   |
| `POST`  | `/password/check`         | Check password strength           |

### Email

| Method | Path                    | Description                    |
| ------ | ----------------------- | ------------------------------ |
| `POST` | `/email/verify`         | Request email verification     |
| `POST` | `/email/verify/code`    | Verify email with emailed code |
| `GET`  | `/email/verify/confirm` | Verify email with token        |
| `GET`  | `/email/check`          | Check if an email is available |

### User

| Method   | Path                      | Description             |
| -------- | ------------------------- | ----------------------- |
| `GET`    | `/user`                   | Get user profile        |
| `PATCH`  | `/user`                   | Update user profile     |
| `DELETE` | `/user`                   | Delete user account     |
| `GET`    | `/user/signin-method`     | List sign-in methods    |
| `DELETE` | `/user/signin-method/:id` | Remove a sign-in method |

### Preferences

| Method  | Path          | Description                                    |
| ------- | ------------- | ---------------------------------------------- |
| `PATCH` | `/preference` | Update user preferences (merged, synced to DB) |

### Organizations

| Method   | Path                     | Description                              | Who can call it                    |
| -------- | ------------------------ | ---------------------------------------- | ---------------------------------- |
| `POST`   | `/org`                   | Create a new organization                | Any signed-in user                 |
| `POST`   | `/org/switch`            | Switch to a different organization       | Org members                        |
| `PATCH`  | `/org/:id`               | Update an organization                   | Admins; owner only for `owner_id`  |
| `DELETE` | `/org/:id`               | Delete an organization                   | Owner only                         |
| `GET`    | `/org/:id/user`          | List organization users                  | Org members                        |
| `PATCH`  | `/org/:id/user/:user_id` | Update a user's permissions              | Admins                             |
| `DELETE` | `/org/:id/user/:user_id` | Remove a user from the org               | Admins (members can remove selves) |
| `PATCH`  | `/org/:id/state`         | Update per-org state (cookie-only cache) | Org members                        |

"Admins" means users whose permission bitmask includes `org_admin_permission` (default `'org:admin'`) — the org owner always qualifies, even without the permission bit.

#### Transferring org ownership

Each org has a single owner (`owner_id` on the org row). Only the current owner can transfer ownership:

```typescript
// Client
await auth.transferOrgOwnership(org_id, new_owner_user_id);
// (equivalent to: await auth.updateOrg(org_id, { owner_id: new_owner_user_id }))

// Server (Durable Object stub, e.g. inside a hook or server route)
await locals.auth.updateOrg(org_id, { owner_id: new_owner_user_id });
```

On transfer, the new owner is granted the org admin permission — and added to the org if they weren't already a member. The previous owner keeps their existing membership and permissions; demote or remove them afterwards with `updateOrgUserPermission()` / `removeOrgUser()` if desired. Note that server-side `updateOrg` calls on the Durable Object stub bypass route authorization — the route-level owner check only applies to the HTTP API.

### Invitations

| Method   | Path                     | Description                      |
| -------- | ------------------------ | -------------------------------- |
| `GET`    | `/invitation`            | List invitations for current org |
| `POST`   | `/invitation`            | Create an invitation             |
| `GET`    | `/invitation/:id`        | Get invitation details           |
| `PATCH`  | `/invitation/:id`        | Update an invitation             |
| `DELETE` | `/invitation/:id`        | Delete an invitation             |
| `POST`   | `/invitation/:id/accept` | Accept an invitation             |

### OAuth — Account Linking

| Method   | Path                      | Description                       |
| -------- | ------------------------- | --------------------------------- |
| `GET`    | `/oauth/account`          | List connected OAuth accounts     |
| `DELETE` | `/oauth/account/:id`      | Disconnect an OAuth account       |
| `GET`    | `/oauth/:vendor`          | Initiate OAuth account connection |
| `GET`    | `/oauth/:vendor/callback` | OAuth connect callback            |

### OAuth — Server (Be an OAuth Provider)

| Method   | Path                                       | Description                                  |
| -------- | ------------------------------------------ | -------------------------------------------- |
| `GET`    | `/oauth/authorize`                         | Authorization page data                      |
| `POST`   | `/oauth/authorize`                         | Create an authorization code                 |
| `POST`   | `/oauth/token`                             | Exchange code/refresh token for access token |
| `GET`    | `/oauth/application`                       | List OAuth applications                      |
| `POST`   | `/oauth/application`                       | Register an OAuth application                |
| `GET`    | `/oauth/application/:id`                   | Get application details                      |
| `PATCH`  | `/oauth/application/:id`                   | Update an application                        |
| `DELETE` | `/oauth/application/:id`                   | Delete an application                        |
| `POST`   | `/oauth/application/:id/secret`            | Generate a client secret                     |
| `DELETE` | `/oauth/application/:id/secret/:secret_id` | Delete a client secret                       |
| `POST`   | `/oauth/application/:id/revoke`            | Revoke an authorized application             |

## Client

`AuthClient` is a reactive Svelte 5 class that combines auth state and API methods.

### Reactive State

All properties are reactive via `$state`/`$derived` runes:

| Property      | Type                                     | Description                                 |
| ------------- | ---------------------------------------- | ------------------------------------------- |
| `signed_in`   | `boolean`                                | Whether the user is authenticated           |
| `signed_out`  | `boolean`                                | Inverse of `signed_in`                      |
| `id`          | `string \| null`                         | User ID                                     |
| `name`        | `string \| null`                         | User display name                           |
| `email`       | `string \| null`                         | User email                                  |
| `verified`    | `boolean`                                | Whether email is verified                   |
| `org_id`      | `string \| null`                         | Current organization ID                     |
| `org`         | `{ id, name, permissions, db?, entitlements? } \| null` | Current org info                            |
| `orgs`        | `Array<{ id, name, permissions, db?, entitlements? }>`  | All orgs the user belongs to                |
| `org_ids`     | `string[]`                               | All org IDs                                 |
| `jwt`         | `string \| null`                         | Raw JWT token                               |
| `session`     | `SessionToken<'auth'> \| null`           | Decoded session token                       |
| `preferences` | `Record<string, unknown>`                | User preferences (persists across signouts) |
| `org_state`   | `Record<string, unknown>`                | Per-org state (cache-only)                  |

### API Methods

API methods live directly on the client (grouped into `signIn`, `signUp`, `password`, `emailVerification`, `user`, `invitation`, `oauth`, and `passkey` namespaces, with session and org methods at the top level). All of them throw `AuthClientError` on failure:

```typescript
// Sign in
const result = await auth.signIn.email({ email, password });
await auth.signIn.emailMagicLink({ email }); // sends a link and/or code (per server config)
const result = await auth.signIn.emailCode({ email, code }); // code is case-insensitive
auth.signIn.oauth('google', { redirect_to: '/dashboard' });

// Passkeys (WebAuthn) — sign in with the browser's passkey prompt
const result = await auth.signIn.passkey();
// Or with conditional UI (autofill on an <input autocomplete="username webauthn"> field)
const result = await auth.signIn.passkey({ autofill: true });

// Passkey management (requires an authenticated session)
if (auth.passkey.isSupported()) {
	await auth.passkey.register('MacBook Touch ID'); // prompts the browser's passkey UI
}
const passkeys = await auth.passkey.list();
await auth.passkey.rename(passkey_id, 'Work laptop');
await auth.passkey.remove(passkey_id);

// Sign up
const result = await auth.signUp.email({ name, email, password, org_name });

// Sign out
await auth.signOut();

// Sessions
const session = await auth.fetchSession();
const refreshed = await auth.refreshSession();
const sessions = await auth.listSessions();
await auth.revokeSession(session_id);

// Password
await auth.password.reset(email);
await auth.password.confirmReset(token, new_password);
await auth.password.change(new_password);
const strength = await auth.password.checkStrength(password);

// Email verification & availability
await auth.emailVerification.request();
await auth.emailVerification.confirmWithCode(code); // when email.code is enabled
const available = await auth.emailVerification.checkAvailability(email);

// User
const user = await auth.user.get();
await auth.user.update({ name: 'New Name' });
await auth.user.delete();
const methods = await auth.user.listSignInMethods();
await auth.user.removeSignInMethod(method_id);

// Organization
await auth.createOrg({ name: 'My Org' });
await auth.switchOrg(org_id);
await auth.updateOrg(org_id, { name: 'Renamed' }); // admins (or the owner)
await auth.transferOrgOwnership(org_id, new_owner_user_id); // current owner only
await auth.deleteOrg(org_id); // current owner only
const users = await auth.listOrgUsers(org_id);
await auth.updateOrgUserPermission(org_id, user_id, encoded_permission);
await auth.removeOrgUser(org_id, user_id);

// Invitations
const invites = await auth.invitation.list();
const invite = await auth.invitation.get(invite_id);
await auth.invitation.create({ email: 'new@user.com', permission: 0b1111 });
await auth.invitation.accept(invite_id);
await auth.invitation.delete(invite_id);

// OAuth accounts
auth.oauth.connect('google', { capabilities: ['profile', 'email'] });
const accounts = await auth.oauth.listAccounts();
await auth.oauth.disconnectAccount(account_id);
```

### Permission Checking

```typescript
// Permissions are included automatically from config via auth_client_data
const auth = new AuthClient(data.auth);
auth.hasPermission('org:admin'); // true if current org permissions has bit 2 set

// For typed autocomplete, pass permissions explicitly with as const:
const auth = new AuthClient(data.auth, {
	permissions: ['org:read', 'org:write', 'org:admin', 'org:owner'] as const,
});
auth.hasPermission('org:admin'); // autocomplete for the 4 permission strings
auth.hasPermission('invalid');   // TS error: Argument of type '"invalid"' is not assignable
```

### Preferences & Org State

```typescript
// Preferences persist across signouts and sync to user DB for cross-device access
await auth.setPreferences({ theme: 'dark', locale: 'en' });
auth.preferences; // { theme: 'dark', locale: 'en' }

// Org state is per-org cache (cleared on signout, NOT synced to DB)
await auth.setOrgState({ sidebar_collapsed: true });
auth.org_state; // { sidebar_collapsed: true }
```

On the server (SSR), these methods update local state only. Use `locals.setPreferences()` and `locals.setOrgState()` for server-side persistence.

### SSR Hydration

```typescript
// Server: serialize to JSON (includes permissions + entitlements)
const data = auth.toJSON(); // { jwt, session, org_id, preferences, org_state, permissions, entitlements }

// Client: hydrate from server data (permissions included automatically)
const auth = new AuthClient(data);
// or
const auth = AuthClient.from(data);
```

### Auto-Refresh

`AuthClient` automatically refreshes the session before it expires (based on `refresh_threshold_ms`, default 10 minutes before expiry). Call `auth.destroy()` to stop the refresh timer when the client is no longer needed.

## Route Guards

`createAuthGuards()` returns typed guard functions for SvelteKit server loads:

```typescript
// src/lib/auth.guards.ts
import { createAuthGuards } from '@delightstack/auth/sveltekit';

export const { requireAuth, requireOrg, requirePermission, requireEntitlement } = createAuthGuards({
	permissions: ['org:read', 'org:write', 'org:admin', 'org:owner'] as const,
	entitlements: ['premium', 'video-uploads', 'extra-usage'] as const,
});

// src/routes/dashboard/+layout.server.ts
import { requireAuth } from '$lib/auth.guards';

export const load = requireAuth(({ locals }) => {
	return { user: locals.user };
});

// src/routes/admin/+layout.server.ts
import { requirePermission } from '$lib/auth.guards';

export const load = requirePermission('org:admin', ({ locals }) => {
	return { user: locals.user, org: locals.org };
});
```

| Guard                         | Redirects to                        | When                                         |
| ----------------------------- | ----------------------------------- | -------------------------------------------- |
| `requireAuth`                 | `/signin?redirect=...`              | No session                                   |
| `requireOrg`                  | `/signin` or `/org/select`          | No session or no org selected                |
| `requirePermission(perm)`     | `/signin`, `/org/select`, or `/403` | No session, no org, or missing permission    |
| `requireEntitlement(ent)`     | `/signin`, `/org/select`, or `/403` | No session, no org, or missing entitlement   |

All guards accept an options object: `{ redirect_to?: string }` and `requirePermission`/`requireEntitlement` also accept `{ forbidden_redirect?: string }`.

## Cookies

The auth handler manages three types of cookies:

### Session Cookie

Contains the JWT token. httpOnly, secure, SameSite=lax. Deleted on signout.

### Preferences Cookie

Signed JWT (HS256) cookie for user preferences like dark mode. **Persists across signouts** so users don't lose settings. Automatically synced to the user DB (`user.json.preferences`) on write, and restored from DB on sign-in (DB wins on conflict for cross-device sync).

### Org State Cookie

Signed JWT (HS256) cookie namespaced per org (e.g., `auth-org-{org_id}`). Used for caching org-specific data. **Cleared on signout.** Not synced to DB — intended for transient cache data like sidebar state or last-viewed page.

## Permissions

Permissions use array-based bitwise encoding. The array index is the bit position:

```typescript
const permissions = ['org:read', 'org:write', 'org:admin', 'org:owner'] as const;
// org:read  = bit 0 (1)
// org:write = bit 1 (2)
// org:admin = bit 2 (4)
// org:owner = bit 3 (8)

// Encode: ['org:read', 'org:admin'] → 0b0101 (5)
encodePermissions(permissions, ['org:read', 'org:admin']); // 5

// Decode: 5 → ['org:read', 'org:admin']
decodePermissions(permissions, 5); // ['org:read', 'org:admin']
```

The permissions array is **append-only** — never reorder or remove entries, as that would change the meaning of stored permission integers. Add new permissions to the end.

## Entitlements

Entitlements are org-level feature flags using the same bitwise encoding as permissions. They describe what an org *has access to* (e.g. plan features), while permissions describe what a *user can do* within an org.

```typescript
// Config
defineAuthConfig({
	entitlements: ['premium', 'video-uploads', 'extra-usage'] as const,
	// ...
});

// Client
auth.hasEntitlement('video-uploads'); // true if org entitlements has bit 1 set

// Server guard
export const load = requireEntitlement('premium', ({ locals }) => {
	return { org: locals.org };
});
```

The `entitlements` array is **append-only** — same rules as permissions. The entitlements value is stored in the JWT token alongside permissions and is available on both `auth.org.entitlements` (client) and `locals.org.entitlements` (server).

> **Implementation detail:** JWT tokens use single-letter keys (`p` for permissions, `e` for entitlements, `d` for database ID, `n` for name) to minimize token size. This is transparent — the developer-facing API always uses full names.

## OAuth Providers

Configure OAuth providers for sign-in and account linking:

```typescript
defineAuthConfig({
	// ...
	oauth: {
		google: {
			client_id: env.GOOGLE_CLIENT_ID,
			client_secret: env.GOOGLE_CLIENT_SECRET,
			authorization_url: 'https://accounts.google.com/o/oauth2/v2/auth',
			access_token_url: 'https://oauth2.googleapis.com/token',
			scopes: ['openid', 'email', 'profile'],
		},
		github: {
			client_id: env.GITHUB_CLIENT_ID,
			client_secret: env.GITHUB_CLIENT_SECRET,
			authorization_url: 'https://github.com/login/oauth/authorize',
			access_token_url: 'https://github.com/login/oauth/access_token',
			scopes: ['user:email'],
		},
	},
});
```

**Sign-in flow:** `GET /signin/:vendor` redirects the user to the provider. The provider redirects back to `GET /signin/:vendor/callback`, which creates or signs into the account and sets the session cookie.

**Account linking flow:** `GET /oauth/:vendor` connects an additional OAuth account to an already-authenticated user. The callback at `GET /oauth/:vendor/callback` links the account.

## Lifecycle Hooks

Hooks fire after successful auth operations:

```typescript
defineAuthConfig({
	hooks: {
		onSignIn: async ({ result, method, is_new_user, meta }) => {
			// method: 'email' | 'magic-link' | 'email-code' | 'oauth' | 'passkey'
			// result: { user_id, jwt, decoded_jwt, ... }
			// meta: { ip_address, city, country, user_agent, ... }
		},
		onSignUp: async ({ result, method, meta }) => {
			// Fires on new account creation
		},
		onNewSignInMethod: async ({ result, vendor, meta }) => {
			// Fires when a new OAuth provider is linked
		},
		onSignOut: async ({ user_id, session_id }) => {},
		onPasswordReset: async ({ user_id, email }) => {},
		onEmailVerified: async ({ user_id, email }) => {},
		onOrgJoined: async ({ user_id, org_id }) => {},
	},
});
```

## Design Decisions

**Why a single Durable Object for all auth?**
Auth data is global to the application — users, sessions, orgs, and invitations all reference each other. A single DO eliminates cross-DO coordination, provides transactional consistency, and keeps the query model simple. The single-writer guarantee means no race conditions on concurrent sign-ups or permission changes.

**Why JWT (not opaque session tokens)?**
JWTs carry user info, org memberships, and permissions in the token itself, avoiding a DB lookup on every request. The tradeoff is that revocation requires checking a server-side session record, but the Handle auto-refreshes expired tokens transparently, so revoked sessions are caught within the refresh window.

**Why Argon2id (not bcrypt)?**
Argon2id is the current OWASP recommendation for password hashing. It's memory-hard (resistant to GPU/ASIC attacks), has configurable time and memory costs, and is available as a WASM module for Cloudflare Workers.

**Why array-based permissions (not a map)?**
Permission maps like `{ 'org:read': 0, 'org:write': 1 }` duplicate what array indices give for free and allow accidental duplicate or skipped bit positions. An array `['org:read', 'org:write']` is simpler, less error-prone, and reads better. The bitwise encoding is identical — array index IS the bit position.

**Why three cookies (not one)?**
The session JWT changes on every refresh and is deleted on signout. Preferences (dark mode, locale) should persist across signouts and sync across devices. Org state (sidebar collapsed, last page) is ephemeral cache per org. Combining these into one cookie would force unnecessary coupling — signing out would lose preferences, and refreshing the JWT would invalidate cached org state.

**Why CSRF via Origin/Referer (not tokens)?**
Origin/Referer checking is stateless, requires no hidden form fields or extra headers from the client, and works out of the box with `fetch()`. The `Origin` header is present on all same-origin POST/PATCH/DELETE requests in modern browsers. Referer is used as a fallback. Non-browser clients (APIs, CLIs) that omit both headers are allowed through, since they aren't vulnerable to CSRF.

## Usage Without SvelteKit

The `createAuthHandle()`, `AuthClient`, route guards, and cookie helpers are SvelteKit-specific. However, the core `AuthDatabaseServer` Durable Object works with any Cloudflare Workers framework. You get the full auth backend — sign-up, sign-in, sessions, orgs, permissions, invitations, OAuth — and handle the HTTP/cookie layer yourself.

### What's available

| Layer                  | SvelteKit | Other frameworks |
| ---------------------- | --------- | ---------------- |
| Auth Durable Object    | Yes       | Yes              |
| JWT generation/decode  | Yes       | Yes              |
| Permission encode/decode | Yes     | Yes              |
| `createAuthHandle()`   | Yes       | No               |
| `AuthClient` (Svelte 5 runes) | Yes | No            |
| Route guards           | Yes       | No               |
| Cookie helpers         | Yes       | No               |

### Hono

```typescript
import { Hono } from 'hono';
import { setCookie, getCookie } from 'hono/cookie';
import { AuthDatabaseServer } from '@delightstack/auth/worker';
import { generateJwt, decodeJwt } from '@delightstack/auth/server';

// Re-export the DO for wrangler
export { AuthDatabaseServer };

type Env = {
	Bindings: {
		AUTH: DurableObjectNamespace<AuthDatabaseServer>;
		JWT_KEY_SECRET: string;
	};
};

const app = new Hono<Env>();

function getAuth(c: Context<Env>) {
	const id = c.env.AUTH.idFromName('main');
	return c.env.AUTH.get(id);
}

app.post('/api/auth/signup', async (c) => {
	const auth = getAuth(c);
	const { name, email, password, org_name } = await c.req.json();
	const meta = { ip_address: c.req.header('CF-Connecting-IP') };

	const result = await auth.signUpWithEmail({ name, email, password, org_name }, meta);
	setCookie(c, 'session', result.jwt, { httpOnly: true, secure: true, sameSite: 'Lax' });
	return c.json(result);
});

app.post('/api/auth/signin', async (c) => {
	const auth = getAuth(c);
	const { email, password } = await c.req.json();
	const meta = { ip_address: c.req.header('CF-Connecting-IP') };

	const result = await auth.signInWithEmail({ email, password }, meta);
	setCookie(c, 'session', result.jwt, { httpOnly: true, secure: true, sameSite: 'Lax' });
	return c.json(result);
});

app.post('/api/auth/signout', async (c) => {
	const jwt = getCookie(c, 'session');
	if (jwt) {
		const auth = getAuth(c);
		await auth.revokeSessionToken(jwt);
	}
	setCookie(c, 'session', '', { maxAge: 0 });
	return c.body(null, 204);
});

// Auth middleware
app.use('/api/*', async (c, next) => {
	const jwt = getCookie(c, 'session');
	if (jwt) {
		try {
			const session = await decodeJwt(c.env.JWT_KEY_SECRET, jwt);
			c.set('session', session);
		} catch {
			// expired or invalid — clear cookie
			setCookie(c, 'session', '', { maxAge: 0 });
		}
	}
	await next();
});

export default app;
```

### Plain Cloudflare Worker

```typescript
import { AuthDatabaseServer } from '@delightstack/auth/worker';
import { decodeJwt } from '@delightstack/auth/server';

export { AuthDatabaseServer };

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const auth = env.AUTH.get(env.AUTH.idFromName('main'));
		const meta = { ip_address: request.headers.get('CF-Connecting-IP') || undefined };

		if (url.pathname === '/api/auth/signup' && request.method === 'POST') {
			const body = await request.json();
			const result = await auth.signUpWithEmail(body, meta);
			return Response.json(result, {
				headers: {
					'Set-Cookie': `session=${result.jwt}; HttpOnly; Secure; SameSite=Lax; Path=/`,
				},
			});
		}

		if (url.pathname === '/api/auth/signin' && request.method === 'POST') {
			const body = await request.json();
			const result = await auth.signInWithEmail(body, meta);
			return Response.json(result, {
				headers: {
					'Set-Cookie': `session=${result.jwt}; HttpOnly; Secure; SameSite=Lax; Path=/`,
				},
			});
		}

		// Decode JWT from cookie for protected routes
		const cookie = request.headers.get('Cookie') || '';
		const jwt = cookie.match(/session=([^;]+)/)?.[1];
		if (jwt) {
			const session = await decodeJwt(env.JWT_KEY_SECRET, jwt);
			// session.uid, session.org, session.email, etc.
		}

		return new Response('Not found', { status: 404 });
	},
};
```

### Key DO methods for direct use

The `AuthDatabaseServer` exposes RPC methods you can call directly from any Cloudflare Worker:

```typescript
const auth = env.AUTH.get(env.AUTH.idFromName('main'));

// Authentication
await auth.signUpWithEmail({ name, email, password, org_name }, meta);
await auth.signInWithEmail({ email, password }, meta);
await auth.signInWithOauth(oauth_token, { invitation_id, connect_user_id }, meta);
await auth.refreshSession(session_id, meta);
await auth.revokeSessionToken(jwt);

// Passkeys (WebAuthn) — rp is { rp_id, rp_name, origins }
await auth.createPasskeyRegistrationOptions(user_id, rp, meta);
await auth.verifyPasskeyRegistration(user_id, response, rp, { name }, meta);
await auth.createPasskeyAuthenticationOptions(rp, meta);
await auth.signInWithPasskey(response, { invitation_id }, rp, meta);
auth.listPasskeys(user_id);
auth.updatePasskey(user_id, passkey_id, { name });
auth.deletePasskey(user_id, passkey_id);

// Users
auth.getUser(user_id);
auth.updateUser(user_id, { name: 'New Name' });
auth.deleteUser(user_id);

// Organizations
auth.createOrg({ id, name, owner_id, ... });
auth.getOrg(org_id);
auth.listOrgUsers(org_id);
auth.updateUserPermission(org_id, user_id, encoded_permission);

// Sessions
auth.listSessions(user_id);
auth.revokeSession(session_id);
auth.revokeUserSessions(user_id);

// Invitations
auth.createInvitation({ org_id, permission, email, ... });
auth.acceptInvitation(invitation_id, user_id);
auth.listInvitations(org_id);

// Password
await auth.resetPassword(token, new_password, meta);
await auth.checkPasswordStrength(password);

// Email verification
await auth.verifyEmail(token, meta);

// Preferences
auth.getUserPreferences(user_id);
auth.setUserPreferences(user_id, { theme: 'dark' });
```

## Exports

### `@delightstack/auth/server`

| Export                      | Description                                                     |
| --------------------------- | --------------------------------------------------------------- |
| `AuthDatabaseServer` (type) | Type-only re-export of the Durable Object (class is in /worker) |
| `AuthDatabaseServerOptions` | Configuration for the Durable Object                            |
| `AuthConfig`                | Configuration interface                                         |
| `ResolvedAuthConfig`        | Config with defaults filled in                                  |
| `defineAuthConfig()`        | Fill config defaults                                            |
| `createAuthHandle()`        | Create SvelteKit Handle function                                |
| `AuthHandleOptions`         | Options for `createAuthHandle`                                  |
| `AuthServer`                | Type alias for DO stub interface                                |
| `AuthLocals`                | Auth properties on `event.locals`                               |
| `generateJwt()`             | Generate and sign a JWT                                         |
| `decodeJwt()`               | Verify and decode a JWT                                         |
| `extractJwtRefreshToken()`  | Extract JTI from a JWT for refresh                              |
| `getSecretKey()`            | Import hex secret as CryptoKey                                  |
| `getOauthToken()`           | Exchange auth code for OAuth token                              |

### `@delightstack/auth/worker`

| Export                      | Description                                                                  |
| --------------------------- | ---------------------------------------------------------------------------- |
| `AuthDatabaseServer`        | Durable Object class — import here (depends on the Cloudflare runtime + WASM) |
| `AuthDatabaseServerOptions` | Configuration for the Durable Object                                          |

### `@delightstack/auth/client`

| Export            | Description                             |
| ----------------- | --------------------------------------- |
| `AuthClient`      | Reactive auth state + API methods class |
| `AuthClientData`  | Serialized form for SSR hydration       |
| `AuthClientError` | Error shape from API methods            |

### `@delightstack/auth/sveltekit`

| Export                   | Description                                                         |
| ------------------------ | ------------------------------------------------------------------- |
| `createAuthGuards()`     | Factory for `requireAuth`, `requireOrg`, `requirePermission`, `requireEntitlement` guards |
| `getSessionCookie()`     | Get session JWT from cookies                                        |
| `setSessionCookie()`     | Set session JWT cookie                                              |
| `deleteSessionCookie()`  | Delete session cookie                                               |
| `serializeSessionCookie()` | Serialize session cookie to a `Set-Cookie` header value           |
| `serializeDeleteSessionCookie()` | Serialize a session cookie deletion header value            |
| `signState()`            | Sign state object into JWT cookie                                   |
| `verifyState()`          | Verify and parse JWT cookie                                         |
| `getPreferencesCookie()` | Get user preferences from JWT cookie                                |
| `setPreferencesCookie()` | Set preferences JWT cookie                                          |
| `getOrgStateCookie()`    | Get org state from JWT cookie                                       |
| `setOrgStateCookie()`    | Set org state JWT cookie                                            |
| `deleteOrgStateCookie()` | Delete org state cookie                                             |
| `deletePreferencesCookie()` | Delete preferences cookie                                        |

### `@delightstack/auth/types`

| Export                         | Description                                  |
| ------------------------------ | -------------------------------------------- |
| `EncodedPermission`            | Bitwise encoded permission type + Zod schema |
| `encodePermissions()`          | Encode permission names to bitwise integer   |
| `decodePermissions()`          | Decode bitwise integer to permission names   |
| `encodeOauthScopes()`          | Encode OAuth scope names to bitwise integer  |
| `decodeOauthScopes()`          | Decode bitwise integer to OAuth scope names  |
| `SessionToken`                 | Union of all JWT token types                 |
| `AuthSessionToken`             | Main user session token schema               |
| `OauthApplicationSessionToken` | OAuth app token schema                       |
| `EmailPasswordSignIn`          | Sign-in request schema                       |
| `EmailLinkSignIn`              | Magic link sign-in schema                    |
| `EmailSignUp`                  | Sign-up request schema                       |
| `User`, `UpdateUser`           | User entity and update schemas               |
| `UserSessionMeta`              | Request metadata (IP, geo, user agent)       |
| `UserSession`                  | Session record schema                        |
| `UserSignInMethod`             | Sign-in method record schema                 |
| `Passkey`                      | Registered passkey record schema             |
| `PasskeyRegistrationResponse`  | Browser WebAuthn registration response schema |
| `PasskeyAuthenticationResponse` | Browser WebAuthn authentication response schema |
| `PasskeyRelyingParty`          | Relying party info (rp_id, rp_name, origins) |
| `AuthErrorCode`                | Typed error code union                       |
| `resolveErrorCode()`           | Resolve error code from error detail/message |
| `OauthConfig`                  | OAuth provider configuration schema          |
| `OauthAccount`                 | Connected OAuth account schema               |
| `OauthToken`                   | OAuth token schema                           |
| `OauthApplication`             | OAuth application schema                     |
| `OauthApi`                     | Interface for OAuth provider implementations |

## Project Structure

```
packages/auth/src/
├── index.ts                       # Root entry — re-exports server + types
│
├── types/                         # (each module has a matching *.test.ts)
│   ├── index.ts                   # Type barrel exports
│   ├── auth.type.ts               # User, session, permission types + encode/decode
│   ├── oauth.type.ts              # OAuth account, token, application types + encode/decode
│   ├── passkey.type.ts            # Passkey (WebAuthn) record + ceremony response types
│   ├── error.type.ts              # Auth error codes and resolver
│   └── meta.type.ts               # Shared metadata fields (id, created_at, updated_at)
│
├── server/
│   ├── index.ts                   # Server barrel exports
│   ├── auth.config.ts             # AuthConfig interface + defineAuthConfig()
│   ├── auth.handler.ts            # createAuthHandle() — SvelteKit Handle
│   ├── auth.routes.ts             # All route handlers + matchRoute()
│   ├── auth.db.server.ts          # AuthDatabaseServer Durable Object
│   ├── auth.sql.schema.ts         # SQLite schema + migrations
│   ├── jwt.server.ts              # JWT generation + verification (Web Crypto)
│   └── oauth.helper.ts            # OAuth token exchange helpers
│
├── worker/
│   └── index.ts                   # Worker entry — exports the AuthDatabaseServer class
│
├── client/
│   ├── index.ts                   # Client barrel exports
│   └── auth.client.svelte.ts      # AuthClient reactive class
│
└── sveltekit/
    ├── index.ts                   # SvelteKit utilities barrel exports
    ├── cookies.ts                 # Cookie helpers (session, preferences, org state)
    └── guards.ts                  # createAuthGuards() factory
```
