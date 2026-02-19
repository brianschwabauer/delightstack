# Row-Level Security (RLS) Design Spec

## Overview

This document explores approaches for adding Row-Level Security to `@delightstack/database`. The goal is to enforce per-user/per-org access control at the database layer so that application code doesn't need to manually filter queries — the database package handles it transparently.

## Research Summary

### Inspiration: StarbaseDB

StarbaseDB implements RLS for SQLite via **SQL AST rewriting**:

- **Policies stored in SQLite**: A `tmp_rls_policies` table holds policy definitions with columns for `actions` (SELECT/INSERT/UPDATE/DELETE), `schema`/`table`, and a `using_expression` SQL fragment (e.g., `user_id = context.id()`).
- **SQL AST rewriting**: Uses `node-sql-parser` to parse every SQL query, then injects `WHERE` clauses from matching policies. For SELECT, it appends the policy's `using_expression` to the existing WHERE. For INSERT/UPDATE/DELETE, similar injection.
- **Context substitution**: Before injecting, replaces `context.id()` placeholders in the expression with the actual authenticated user ID.
- **Admin bypass**: A simple boolean flag skips all RLS checks.
- **Fail-closed**: If no matching policy exists for an operation, the query is blocked entirely.

**Pros**: Catches all SQL queries regardless of how they're constructed. Works at the SQL level.
**Cons**: Requires a full SQL parser (~50KB+ dependency). AST rewriting is fragile — edge cases with complex queries, CTEs, subqueries. Performance overhead on every query. Policies are raw SQL strings (no type safety).

### Inspiration: Drizzle ORM

Drizzle implements RLS via PostgreSQL's native `CREATE POLICY` statements:

- **`pgPolicy()`**: Declares policies with `for` (operation), `to` (role), `using` (read filter), `withCheck` (write filter).
- **`crudPolicy()`**: Convenience helper that creates both `using` and `withCheck` from a single condition.
- **Auth integration**: Provides helpers like `authUid()` that map to `auth.uid()` (Supabase/Neon-specific).
- **PostgreSQL-only**: Relies entirely on the database engine's native RLS. Not applicable to SQLite.

**Key takeaway**: The API design is clean — policies declared alongside table definitions, typed SQL expressions, CRUD convenience helpers. We can borrow the DX patterns even though we can't use PostgreSQL's engine.

### Auth Package (`@delightstack/auth`)

The auth package provides the identity context RLS needs:

- **JWT sessions**: `AuthSessionToken` contains `uid` (user ID), `org` (object mapping org IDs to roles), and `role` (bitwise-encoded permissions).
- **Bitwise permissions**: `encodePermissions()` packs an array of permission strings into a single integer. `decodePermissions()` reverses it. Stored in JWT as `org[orgId].role`.
- **Per-org multi-tenancy**: Each organization gets its own Durable Object (keyed by `db_id`), so data is physically isolated per-org. The auth token's `org[orgId]` section carries the user's role within that org.
- **Permission checking**: The `AuthServer` class has `hasPermission()` which checks bitwise flags against the user's role integer.

**Implication**: Since each org already has its own Durable Object (its own SQLite database), org-level isolation is already handled by architecture. RLS within a single org's database would enforce **user-level** access control (e.g., "users can only see their own records" or "admins can see everything").

### Database CRUD Flow

How data flows through `DatabaseServer`:

- **`transaction()`** is the central hub — all mutations (create/update/delete) can be routed through it. This is the natural interception point for write policies.
- **`get()` / `getBatch()`** — direct SQL SELECT. Needs filtering for read policies.
- **`list()`** — uses Orama search index + SQL. Needs filtering at the SQL level and/or search index level.
- **`sync()`** — returns entities for client sync. Currently has no RLS — would leak data if not filtered.
- **`exec()`** — raw SQL escape hatch. **Cannot be filtered** without SQL parsing. This is the biggest RLS gap.

---

## Approach Comparison

### Approach A: SQL AST Rewriting (StarbaseDB-style)

Intercept all SQL at the `storage.sql.exec()` level, parse the AST, inject WHERE clauses.

```
User code → DatabaseServer.get() → SQL → [RLS: parse + inject WHERE] → SQLite
```

**Pros:**
- Catches everything, including `exec()` raw queries
- Policies are SQL expressions (powerful, flexible)
- Single enforcement point

**Cons:**
- Requires `node-sql-parser` or similar (~50KB, not designed for Cloudflare Workers)
- AST rewriting is brittle — breaks on edge cases
- Performance overhead on every single query
- Policies as raw SQL strings have no type safety
- Overkill for our architecture — we control all the query generation

### Approach B: Application-Layer Middleware (Recommended)

Intercept at the `DatabaseServer` method level. Wrap CRUD methods to enforce policies before/after execution.

```
User code → DatabaseServer.get() → [RLS: check policy] → SQL → SQLite
                                  → [RLS: filter result]
```

**Pros:**
- No SQL parser needed — zero new dependencies
- Works with our existing CRUD methods which already generate SQL
- Type-safe policies (TypeScript functions, not SQL strings)
- Minimal performance overhead
- Simple to understand and debug

**Cons:**
- `exec()` bypasses RLS (must be documented / restricted)
- Must be applied to every CRUD method (get, list, create, update, delete, sync)
- Policies are JS functions, not SQL WHERE clauses (can't push filtering to SQLite for list/search)

### Approach C: Hybrid — Application-Layer + SQL WHERE Injection

Like Approach B, but for `list()` and `sync()`, inject WHERE clauses into the SQL generation (not via AST parsing — we control the SQL builder, so we just append conditions).

```
User code → DatabaseServer.list() → [RLS: inject WHERE into SQL builder] → SQL → SQLite
User code → DatabaseServer.get()  → [RLS: check result after fetch]      → SQL → SQLite
```

**Pros:**
- Efficient filtering for list/sync (pushed to SQLite, not post-fetch)
- No SQL parser — we generate the SQL, so we inject directly
- Type-safe policy definitions
- `get()`/`create()`/`update()`/`delete()` use simple checks
- `list()`/`sync()` get SQL-level filtering for performance

**Cons:**
- `exec()` still bypasses RLS
- Slightly more complex than pure Approach B
- Two enforcement mechanisms (JS checks + SQL injection) — must keep them consistent

---

## Recommended Design: Approach C (Hybrid)

### Policy Definition API

Policies are defined per-table when creating the `DatabaseServer`, using typed functions:

```typescript
import { DatabaseServer, type RlsContext } from '@delightstack/database';
import type { AuthSessionToken } from '@delightstack/auth';

// RLS context — passed to every policy function
interface RlsContext {
    /** Authenticated user ID (from JWT) */
    uid: string;
    /** User's role in this org (bitwise-encoded permissions) */
    role: number;
    /** Raw auth token for advanced checks */
    token: AuthSessionToken;
}

const db = new DatabaseServer(tables, getSearchIndex, ctx, env, {
    rls: {
        // Context provider — called once per request
        context: (request: Request) => ({
            uid: token.uid,
            role: token.org[orgId]?.role ?? 0,
            token,
        }),

        policies: {
            // Per-table policies
            posts: {
                select: (ctx) => ({ where: { user_id: ctx.uid } }),
                insert: (ctx, data) => data.user_id === ctx.uid,
                update: (ctx, id) => ({ where: { user_id: ctx.uid } }),
                delete: (ctx, id) => ({ where: { user_id: ctx.uid } }),
            },

            // Admin bypass — return true to allow all
            users: {
                select: (ctx) => hasPermission(ctx.role, 'admin') || { where: { id: ctx.uid } },
                insert: (ctx) => hasPermission(ctx.role, 'admin'),
                update: (ctx, id) => hasPermission(ctx.role, 'admin') || id === ctx.uid,
                delete: (ctx) => hasPermission(ctx.role, 'admin'),
            },
        },
    },
});
```

### Policy Return Types

```typescript
type SelectPolicy<Ctx> = (ctx: Ctx) =>
    | true                              // allow all rows
    | false                             // deny all rows
    | { where: Record<string, any> };   // filter condition (injected into SQL)

type MutationPolicy<Ctx> = (ctx: Ctx, ...args: any[]) =>
    | true      // allow
    | false;    // deny (throws 403)
```

### Enforcement Points

| Method | Enforcement | Mechanism |
|--------|------------|-----------|
| `get(type, id)` | Post-fetch check | Fetch row, verify policy, throw 403 if denied |
| `getBatch(requests)` | Post-fetch filter | Fetch all, filter by policy, throw 403 if any denied |
| `list(type, query)` | SQL WHERE injection | Append policy's `where` to query conditions |
| `create(type, data)` | Pre-insert check | Run policy with data, throw 403 if denied |
| `update(type, id, data)` | Pre-update check | Fetch existing, run policy, throw 403 if denied |
| `delete(type, id)` | Pre-delete check | Fetch existing, run policy, throw 403 if denied |
| `sync(type, ...)` | SQL WHERE injection | Same as list — append policy WHERE |
| `exec(sql)` | **No enforcement** | Document as RLS bypass, restrict to admin/internal use |
| `transaction(ops)` | Per-operation check | Each op in the transaction runs through its respective policy |

### The `exec()` Problem

`exec()` is a raw SQL escape hatch. Options:

1. **Document it**: Mark `exec()` as "bypasses RLS" in JSDoc. Developers must ensure they only use it for admin/system operations.
2. **Restrict it**: Add an `execUnsafe()` alias and make `exec()` throw if RLS is enabled (forcing developers to acknowledge the bypass).
3. **Audit it**: Log all `exec()` calls when RLS is enabled, for debugging.

**Recommendation**: Option 2 — rename to `execUnsafe()` when RLS is enabled. Clear naming prevents accidental misuse.

### Context Lifecycle

The RLS context should be set per-request, not per-DatabaseServer instance (since the Durable Object is long-lived):

```typescript
// Option A: Set context before each request
db.setRlsContext({ uid: '...', role: 0x3, token });
const result = db.get('posts', '123'); // uses current context
db.clearRlsContext();

// Option B: Scoped execution (preferred — no stale context risk)
db.withRls({ uid: '...', role: 0x3, token }, () => {
    const result = db.get('posts', '123');
    return result;
});

// Option C: Pass context per-call (verbose but explicit)
db.get('posts', '123', { rls: { uid: '...', role: 0x3, token } });
```

**Recommendation**: Option B (`withRls` scoped execution). It prevents stale context bugs and makes the RLS boundary explicit. Internally, uses a class field that's set/cleared around the callback.

### Integration with Auth Package

```typescript
// In Durable Object fetch handler:
async fetch(request: Request) {
    const token = await authServer.verifySession(request);
    if (!token) return new Response('Unauthorized', { status: 401 });

    const orgId = getOrgIdFromRequest(request);
    const role = token.org[orgId]?.role ?? 0;

    return db.withRls({ uid: token.uid, role, token }, () => {
        // All db operations in here are RLS-protected
        return handleRequest(request);
    });
}
```

### Orama Search Index Consideration

The `list()` method uses Orama for full-text search, then fetches matching IDs from SQLite. RLS needs to be enforced at both levels:

1. **Orama search**: Cannot easily filter by policy (Orama doesn't understand SQL WHERE). Two options:
   - **Post-filter**: Search Orama, get IDs, fetch from SQLite with RLS WHERE, return intersection. May return fewer results than requested.
   - **Dual index**: Maintain per-user search indexes. Impractical for most use cases.

   **Recommendation**: Post-filter with over-fetching. Request more results from Orama than needed, apply RLS filter, return the requested page size. Document that search result counts may be approximate when RLS is active.

2. **SQLite fallback**: When Orama returns IDs, the SQL query fetches those rows. Add the RLS WHERE clause to this fetch.

### No-Policy Default Behavior

When RLS is enabled but a table has no policy defined:

- **Option A (fail-open)**: Allow all access. Simple, but risky — forgetting a policy = data leak.
- **Option B (fail-closed)**: Deny all access. Safe, but annoying during development.
- **Option C (configurable)**: Let the developer choose the default.

**Recommendation**: Fail-closed with a clear error message: `"RLS is enabled but no policy defined for table 'posts'. Define a policy or set rls.default_policy: 'allow'."` This prevents accidental data exposure while giving an escape hatch.

---

## Implementation Phases

### Phase 1: Core RLS Infrastructure
- Add `RlsContext` type and policy type definitions
- Add `withRls()` scoped execution to `DatabaseServer`
- Enforce policies on `get()`, `create()`, `update()`, `delete()`
- Fail-closed default for tables without policies
- `exec()` → `execUnsafe()` rename when RLS enabled

### Phase 2: List & Sync Filtering
- Inject WHERE clauses into `list()` SQL generation
- Inject WHERE clauses into `sync()`
- Handle Orama search + RLS post-filtering with over-fetch
- Approximate counts documentation

### Phase 3: Transaction Support
- Per-operation policy checks within `transaction()`
- Abort transaction if any operation fails policy check

### Phase 4: Developer Experience
- RLS debugging mode (logs policy decisions)
- `db.can(context, 'select', 'posts', id)` — check without executing
- Policy testing utilities for unit tests

---

## Open Questions

1. **Should RLS be opt-in per table or global?** Current design requires per-table policies. An alternative: a single global policy function that receives the table name.

2. **How should `sync()` handle RLS?** The sync protocol sends diffs to clients. If RLS removes a previously-visible row, should it send a "delete" event to the client? This has implications for real-time sync correctness.

3. **Should policies have access to the full row on SELECT?** Current design for `select` only supports WHERE conditions (pre-fetch filtering). Some use cases need post-fetch field-level filtering (e.g., hide `email` field from non-admins). This is column-level security, not row-level — potentially a separate feature.

4. **Performance: should policy results be cached per-request?** If a policy function is pure (same context → same result), the WHERE clause only needs to be computed once per request, not per query.
