# @delightstack/admin — Design Spec

## Why this package exists

Every product eventually needs a back-office: someone has to answer "why can't
this customer sign in", "comp this org a month of premium", "what does this
user's data actually look like". Teams re-build this panel from scratch for
every app, and on delightstack it is *specifically* annoying to hand-roll —
users live in an auth Durable Object, app data lives in per-org database DOs,
billing state is split between Stripe and the org row. The stack already has
all the raw material (auth DO RPCs like `listUsers`/`listSessions`/
`revokeUserSessions`, the enumerable `tables` schema registry with UI metadata,
`@delightstack/stripe`'s subscription sync, and `Table`/`CommandPalette`
components), so a drop-in panel is high leverage and cheap relative to what it
would cost any single app.

The package's "hell yeah" moment: mount one route + one handle and you get a
support panel that already knows your users, your schema, and your billing —
with impersonation and an audit trail done *correctly*, which is the part most
home-grown panels get wrong.

## Decisions (locked)

- **Package**: `@delightstack/admin`, `packages/admin/`. Follows the standard
  `create*Handle` + mountable-UI shape.
- **Superadmin identity is config, not data**: a `superadmins: string[]` email
  allowlist in the admin config (plus an optional `authorize` hook for custom
  logic). Superadmin status is never stored in the auth DB and never encoded in
  the JWT `org` permission record — permissions stay org-scoped. The existing
  guard that refuses to *assign* `superadmin:*` permissions
  (`packages/auth/src/server/auth.db.server.ts:2204`) stays as-is. Rationale:
  the panel must not be able to mint more superadmins; an allowlist lives in
  code review, not in the blast radius it protects.
- **Access requires a verified email + fresh session**: the handle rejects
  sessions whose `verified` is false or whose `iat` is older than
  `session_max_age` (default 24h). Passkey/password step-up is deferred to v2
  (needs an auth-side elevation flow).
- **The package ships its own Durable Object (`AdminServer`)** holding the
  append-only audit log (and, later, per-user feature flags). Apps bind it as
  `ADMIN`. Rationale: admin actions are cross-org and don't belong in the auth
  DO's schema; every delightstack package that owns state owns a DO.
- **Audit is a prerequisite, not a feature**: every mutating admin action is
  recorded before it executes; the panel ships an audit viewer module in v1.
- **Impersonation is a first-class token concept** (RFC 8693-style `act`
  claim), not "mint a session as user X". Short-lived, non-refreshable,
  visibly marked, admin-attributed. Requires additive auth-package changes
  (below).
- **Per-user feature flags are deferred to phase 3.** Org-level entitlements
  (bitwise, synced from billing) are the only flag primitive today; per-user
  flags need a hot-path read story that belongs in auth/database, with the
  panel as UI over it. Do not design it into v1.
- **Deploy/rollback is cut.** Cloudflare-API credentials, CI variance, and
  blast radius put it out of scope forever as a built-in; the custom-modules
  API is the escape hatch for apps that want it.
- **Stripe catalog editing is out of scope.** Products/prices are synced from
  `defineBillingConfig` (`syncProducts`); the panel operates *per customer*
  (view state, change plan, comp entitlements, open Stripe dashboard), never
  on the catalog.
- **DB browser is read-only by default**; writes and field redaction are
  per-table opt-in config.

## Package layout

```
packages/admin/
├── src/
│   ├── index.ts                      # re-exports server + types
│   ├── types/
│   │   └── index.ts                  # AdminConfig, AdminModule, AuditEntry, …
│   ├── server/
│   │   ├── index.ts
│   │   ├── admin.config.ts           # defineAdminConfig()
│   │   ├── admin.handler.ts          # createAdminHandle() → /api/admin/*
│   │   ├── admin.routes.ts           # route table (users/orgs/db/billing/audit/impersonate)
│   │   ├── admin.audit.ts            # audit(entry) helper — write-before-act
│   │   ├── admin.impersonate.ts      # start/stop impersonation, cookie swap
│   │   └── modules/                  # server side of each built-in module
│   │       ├── users.module.ts
│   │       ├── orgs.module.ts
│   │       ├── database.module.ts
│   │       ├── billing.module.ts
│   │       └── audit.module.ts
│   ├── worker/
│   │   ├── index.ts
│   │   └── admin.db.server.ts        # AdminServer DO (audit table; flags later)
│   ├── client/
│   │   ├── index.ts
│   │   └── admin.client.svelte.ts    # AdminClient — fetch wrapper + panel state
│   └── sveltekit/
│       ├── index.ts                  # AdminPanel export + createAdminGuard
│       ├── AdminPanel.svelte         # shell: nav, CommandPalette, module router
│       └── modules/                  # UI of each built-in module
│           ├── UsersModule.svelte
│           ├── OrgsModule.svelte
│           ├── DatabaseModule.svelte
│           ├── BillingModule.svelte
│           └── AuditModule.svelte
├── vite.config.ts                    # vitest edge-runtime + svelte plugin (like auth's)
├── package.json                      # exports: ., ./types, ./server, ./worker,
│                                     #   ./client, ./sveltekit (svelte condition)
└── README.md
```

Peer deps: `@delightstack/auth`, `@delightstack/components`,
`@delightstack/utilities`; `@delightstack/database` and `@delightstack/stripe`
are **optional** peers — the database and billing modules activate only when
their config sections are provided (same spirit as example-app gating billing
on `STRIPE_SECRET_KEY`).

## Config

```ts
export interface AdminConfig {
	/** Verified emails allowed into the panel. Empty array = panel disabled. */
	superadmins: string[];
	/**
	 * Extra authorization on top of the allowlist (return false to deny).
	 * Runs after the allowlist check — it can narrow, never widen.
	 */
	authorize?: (event: RequestEvent, locals: AuthLocals) => boolean | Promise<boolean>;
	/** Reject sessions older than this (seconds, from JWT iat) @default 86400 */
	session_max_age?: number;
	/** API base @default '/api/admin' — UI base is set by where the app mounts the route */
	base_path?: string;

	/** The auth DO stub — same accessor shape as createAuthHandle's getAuthServer */
	getAuthServer: (event: RequestEvent) => AuthServer;
	/** The AdminServer DO stub (audit log) */
	getAdminServer: (event: RequestEvent) => AdminServer;

	/** Enables the DB browser module */
	database?: {
		tables: Record<string, Database.AnyTable>;   // same registry as createDatabaseHandle
		/** Resolve a database DO for an org (admin browses across orgs) */
		getDatabase: (event: RequestEvent, org: { id: string; db?: string }) => DatabaseServer;
		/** Per-table overrides; default for unlisted tables is { mode: 'read' } */
		access?: Record<string, {
			mode?: 'hidden' | 'read' | 'write';      // @default 'read'
			/** Field names rendered as '•••' and stripped from API responses */
			redact?: string[];
		}>;
	};

	/** Enables the billing module */
	billing?: {
		config: ResolvedBillingConfig;               // reuse the app's defineBillingConfig result
		stripe_secret_key: string;
	};

	/** App-specific modules appended to the built-ins */
	modules?: AdminModule[];

	/** Impersonation options */
	impersonation?: {
		enabled?: boolean;                           // @default true
		/** Impersonation session TTL in seconds @default 1800 (30 min), never refreshable */
		expires_in?: number;
		onImpersonate?: (info: { admin_email: string; user_id: string; reason?: string }) => void | Promise<void>;
	};
}

export function defineAdminConfig(config: AdminConfig): ResolvedAdminConfig;
```

`createAdminHandle({ config })` mounts everything under `base_path` and guards
**at the handle level** (not per-route): no session → 401; email not in
`superadmins` or not `verified` → 404 (the panel's existence is not disclosed);
stale session → 401 with `code: 'admin/stale_session'` so the UI can prompt
re-sign-in. `authorize` runs last. Every check failure short-circuits before
any module code runs — defense in depth is the handle, module routes assume
nothing.

Route naming follows the repo convention (singular): `/api/admin/user`,
`/api/admin/user/[id]/session`, `/api/admin/org/[id]`, `/api/admin/db/[org_id]/[table]`,
`/api/admin/billing/[org_id]`, `/api/admin/audit`, `/api/admin/impersonate`.

## UI mounting

The app owns the URL; the package owns everything under it:

```svelte
<!-- src/routes/admin/[...path]/+page.svelte -->
<script>
	import { AdminPanel } from '@delightstack/admin/sveltekit';
</script>
<AdminPanel />
```

```ts
// src/routes/admin/[...path]/+page.server.ts
import { createAdminGuard } from '@delightstack/admin/sveltekit';
export const load = createAdminGuard(); // same checks as the handle; 404 on failure
```

`AdminPanel.svelte` is a self-routing shell (reads the `[...path]` param):
left nav of enabled modules, `CommandPalette` for quick-jump ("user
brian@…", "org Acme", "table post"), content pane per module. It talks only to
`/api/admin/*` via `AdminClient`. No app-side state or props required; module
list arrives from `GET /api/admin/config` (which returns only what the
authenticated superadmin may see).

## Superadmin & audit

### AdminServer DO

One global instance (`idFromName('main')`, like auth). Schema v1:

```sql
CREATE TABLE audit_log (
	id TEXT PRIMARY KEY,            -- ulid, time-ordered
	created_at INTEGER NOT NULL,
	admin_email TEXT NOT NULL,      -- from the allowlist-checked session
	admin_uid TEXT NOT NULL,
	action TEXT NOT NULL,           -- 'user.session.revoke' | 'impersonate.start' | 'db.row.update' | …
	target_type TEXT,               -- 'user' | 'org' | 'row' | …
	target_id TEXT,
	org_id TEXT,
	json TEXT                       -- action-specific detail (before/after for writes)
);
```

Append-only: the DO exposes `audit(entry)` and `listAudit(query)` — no update,
no delete. Every mutating admin route calls `audit()` **before** performing
the action (a failed action still leaves an attempt record with
`json.status: 'attempted'`, updated to `'ok'`/`'error'` after — two writes,
one row). Reads are not audited except `db.row.read` on tables with `redact`
config (viewing sensitive data is itself sensitive).

When `@delightstack/logging` lands, audit entries additionally flow to the
logger (`logger?` threaded through config, same as the other packages) — the
DO table remains the authoritative store.

## Impersonation

### Auth package changes (additive, separate commits in packages/auth)

1. **`act` claim on `AuthSessionToken`** (`auth.type.ts`): optional
   `act: z.object({ uid: z.string(), email: z.string() }).optional()` —
   present ⇒ this session is `act.uid` (an admin) acting as `uid` (the user).
   Additive and backward-compatible.
2. **`createImpersonationSession` RPC** on `AuthDatabaseServer`: takes
   `{ user_id, actor: { uid, email }, expires_in }`, reuses the
   `createSessionToken` path to mint a session for `user_id` with the `act`
   claim set and a hard `expires_in`, and inserts a `user_session` row with
   `type: 'impersonation'` (so it shows in the user's session list and is
   revocable like any session). **No refresh**: `/api/auth/session/refresh`
   rejects tokens carrying `act`.
3. **Sensitive-route lockout**: auth routes for password change, sign-in
   method add/remove, email change, passkey registration, and org ownership
   transfer reject sessions with `act` (`DelightError.forbidden`, `code:
   'auth/impersonation_blocked'`). Everything else behaves as the real user —
   that's the point of impersonation.
4. **`AuthLocals.session` surfaces `act`** so any app can render an
   impersonation banner: `{#if page.data.session?.act} You are impersonating… {/if}`.
   The docs/example-app get a reference banner component.

### Flow (admin package)

- `POST /api/admin/impersonate { user_id, reason? }` → audit
  (`impersonate.start`, reason stored) → `createImpersonationSession` → set
  the session cookie to the impersonation JWT and stash the admin's original
  JWT in a second httpOnly cookie (`admin-return`, same flags, TTL = the
  impersonation TTL) → return the redirect target (`/`).
- `POST /api/admin/impersonate/stop` (also callable while impersonating —
  it is the *one* admin route that accepts an `act` session, matched against
  `admin-return`): audit `impersonate.stop`, restore the original cookie,
  revoke the impersonation session row.
- Expiry: the impersonation JWT dies on its own (no refresh); the
  `admin-return` cookie outlives it by 5 minutes so "session expired → I'm
  the admin again" recovery works without re-sign-in.
- Default TTL 30 minutes; `onImpersonate` hook fires for apps that want to
  notify (e.g. email the account owner — some products do this for trust).

## Built-in modules

### users (v1)

Search/list via auth `listUsers` (Table with server pagination), detail view:
profile, auth methods (`user_auth` summary — provider + verified, never
hashes), org memberships with per-org permissions (`getUserPermissions`,
editable via `updateUserPermission`), active sessions (`listSessions`) with
revoke (one/all via `revokeUserSessions`), soft-delete/restore
(`markUserDeleted`), impersonate button (with required "reason" field —
goes to the audit log). Quick actions: trigger password-reset email, resend
verification (reuses existing auth flows).

### orgs (v1)

List/search (`listOrgs`), detail: members (`listOrgUsers`) with role editing,
invitations (`listInvitations`), plan (read from org; changes go through the
billing module when enabled, or `updateOrg` when not), session revocation
(`revokeOrgSessions`), soft-delete.

### audit (v1)

Filterable viewer over `listAudit` (by admin, action, target, org, time
range). Read-only by construction.

### database (phase 2)

Org picker (from `listOrgs`; the org record's `d` field gives the DO id) →
table list from the `tables` registry → auto-generated browser per table using
schema field metadata (`.label()`, `.searchable()`, enums) on
`Table.svelte` (virtual scroll + server pagination via `DatabaseServer.list`),
full-text search via the existing Orama path. Row detail = auto-generated
read view; edit/delete only for `mode: 'write'` tables (writes audited with
before/after in `json`). `redact` fields are stripped server-side (never sent
to the panel), not merely hidden. Interaction with the Row-Level Security spec
(`plans/database/Row-Level Security Design Spec.md`): admin reads bypass RLS
by construction (direct DO RPC, not the app's request context) — the spec's
implementation must note this path exists and that the audit log is the
compensating control.

### billing (phase 2)

Per-org customer view: subscription state (`fetchSubscriptionState` /
`activePlanIds`), invoices, payment methods, deep links to the Stripe
dashboard (customer page — the panel links out rather than re-implementing
Stripe's UI). Actions: change plan (through `syncSubscription` so org
entitlements/JWT stay consistent), cancel, **comp entitlements** — an
`entitlement_overrides` bitwise field on the org row (additive auth change:
ORed with plan entitlements during JWT encode) so support can grant features
without touching Stripe. A small stats header (active subscription count, MRR
estimate from active subscriptions) — anything heavier is Stripe dashboard
territory.

### Custom modules (phase 3)

```ts
export interface AdminModule {
	id: string;                                  // route segment + nav key
	title: string;
	icon?: Component;
	/** Rendered in the content pane; receives the AdminClient */
	component: Component<{ admin: AdminClient }>;
	/** Server actions exposed at POST /api/admin/module/[id]/[action] — auto-audited */
	actions?: Record<string, (event: RequestEvent, body: unknown) => Promise<unknown>>;
}
```

This is where deploy/rollback, "resend welcome email", app-specific tooling
live. Actions run behind the same handle guard and are audited as
`module.<id>.<action>` automatically — an app can't accidentally create an
unaudited admin mutation.

## Phasing

1. **Phase 1 — trust core**: package scaffold, `AdminServer` DO + audit,
   config/handle/guard, auth `act`-claim work, impersonation, users + orgs +
   audit modules, panel shell + CommandPalette. Independently shippable and
   already the most valuable slice.
2. **Phase 2**: database browser + billing module (+ `entitlement_overrides`
   auth change).
3. **Phase 3**: custom modules API; feature-flags UI *after* a per-user flags
   primitive is designed (own mini-spec; likely a `user_flag` store readable
   on the hot path — not decided here).

## Implementation checklist (phase 1)

1. Scaffold `packages/admin` (copy stripe's package/tsconfig/vite shape;
   `./sveltekit` export carries the `svelte` condition like components).
2. Types + `defineAdminConfig` + tests (allowlist normalization, defaults).
3. `AdminServer` DO: audit table, `audit`/`listAudit`, migrations scaffold +
   tests (mirror auth's DO test setup).
4. Auth package (separate commits): `act` claim + schema tests;
   `createImpersonationSession` RPC; refresh rejection; sensitive-route
   lockout; `AuthLocals` typing. All additive.
5. `createAdminHandle`: guard chain (session → verified → allowlist →
   freshness → authorize), 404-on-unauthorized, route table, audit-before-act
   helper + tests (fake RequestEvents, stripe's routes tests as the pattern).
6. Users/orgs/audit module server routes + tests.
7. Impersonation start/stop + cookie swap + tests (expiry, `admin-return`
   recovery, lockout of sensitive auth routes while impersonating).
8. `AdminPanel.svelte` shell + `AdminClient` + module UIs (Table,
   CommandPalette, Modal from components).
9. example-app wiring: `ADMIN` DO binding in wrangler.jsonc, handle in
   `hooks.server.ts` (gated on config presence like billing), `/admin` route,
   impersonation banner in the app layout. Verify via mock route locally
   (cross-session DO RPC fails under local wrangler — known trap).
10. README + docs page (apps/docs package guide) — must lead with the
    security model: allowlist, audit, impersonation semantics.
11. Changeset.

## Testing strategy

- Unit: config validation, allowlist/freshness guard matrix, audit
  write-before-act ordering, redaction stripping.
- Integration: handle routes via fake RequestEvents against a real
  `AdminServer` + `AuthDatabaseServer` in vitest workers-pool (auth's DO tests
  are the pattern); full impersonation lifecycle including refresh rejection.
- Manual: example-app run-through — sign in as allowlisted user, search a
  user, impersonate, verify banner + sensitive-route lockout, stop, check
  audit trail.

## Risks & mitigations

- **This package is a weapon if misconfigured** — mitigations are structural:
  allowlist-in-config (no self-service superadmins), 404 posture, handle-level
  guard, audit-before-act, read-only DB default, redaction server-side. Docs
  lead with the model. A `security-review` pass before first release.
- **Impersonation token leaks** — short TTL, no refresh, revocable session
  row, sensitive-route lockout, visible `act` claim. The `admin-return`
  cookie is scoped/flagged identically to the session cookie.
- **Auth-package coupling** — all auth changes are additive (`act` optional,
  new RPC, new rejections). Apps that never mount the admin package see zero
  behavior change; assert this in auth's existing test suite.
- **DB browser vs RLS** — the bypass is explicit and audited; the RLS spec
  gains a cross-reference so neither design silently invalidates the other.
- **Optional-peer sprawl** (database/stripe) — modules activate purely on
  config presence; imports of optional peers are dynamic within their module
  files so a billing-less app never loads stripe code (mind the
  optimizeDeps.include trap for dynamic optional peers in dev).
- **Panel UI scope creep** — the shell + Table-driven modules stay thin;
  anything bespoke an app wants goes through custom modules, not new config
  flags.
